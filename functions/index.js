// BudgetThrills Cloud Functions
// Handles contact-form reply emails via SendGrid

const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getAuth } = require("firebase-admin/auth");
const catalogSync = require("./catalog-sync");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const crypto = require("crypto");
initializeApp();
const db = getFirestore("default");
// ─── Email ────────────────────────────────────────────────────────────────────
// Provider-agnostic transactional email over plain HTTPS (no SDK). Set ONE API key in
// functions/.env and the provider is picked automatically, or force it with EMAIL_PROVIDER.
//   Brevo    (default, 300/day free)  BREVO_API_KEY     verify the sender under Senders & IPs
//   Resend   (3,000/month free)        RESEND_API_KEY    needs a verified domain for production
//   SendGrid (60-day trial only)       SENDGRID_API_KEY  single-sender verification
// EMAIL_FROM must be an address verified with that provider. Every send is logged in email-log/.
const EMAIL_PROVIDERS = {
  brevo:    { key: "BREVO_API_KEY",    looks: /^xkeysib-/, label: "Brevo" },
  resend:   { key: "RESEND_API_KEY",   looks: /^re_/,      label: "Resend" },
  sendgrid: { key: "SENDGRID_API_KEY", looks: /^SG\./,     label: "SendGrid" }
};
const EMAIL_PROVIDER = String(process.env.EMAIL_PROVIDER || Object.keys(EMAIL_PROVIDERS).find((k) => process.env[EMAIL_PROVIDERS[k].key]) || "brevo").toLowerCase();
const EMAIL_SPEC     = EMAIL_PROVIDERS[EMAIL_PROVIDER];
const EMAIL_KEY      = EMAIL_SPEC ? (process.env[EMAIL_SPEC.key] || "") : "";
const FROM_EMAIL     = process.env.EMAIL_FROM || process.env.SENDGRID_FROM_EMAIL || "";
const FROM_NAME      = process.env.EMAIL_FROM_NAME || process.env.SENDGRID_FROM_NAME || "BudgetThrills";
const SUPPORT_EMAIL  = process.env.SUPPORT_EMAIL || FROM_EMAIL;
const MAIL_READY     = !!(EMAIL_SPEC && EMAIL_KEY && FROM_EMAIL);
const mailFrom = (name) => ({ email: FROM_EMAIL, name: name || FROM_NAME });
// Brevo transactional templates (editable at app.brevo.com -> Transactional -> Templates).
// Defaults are the templates created for this account; override per kind with
// BREVO_TEMPLATE_ORDER_CONFIRMATION / BREVO_TEMPLATE_ORDER_SHIPPED / BREVO_TEMPLATE_REPLY, or set to 0 to use inline HTML.
const BREVO_TEMPLATES = {
  "order-confirmation": Number(process.env.BREVO_TEMPLATE_ORDER_CONFIRMATION ?? 1),
  "order-shipped":      Number(process.env.BREVO_TEMPLATE_ORDER_SHIPPED ?? 2),
  "reply":              Number(process.env.BREVO_TEMPLATE_REPLY ?? 3)
};
const templateFor = (kind) => (EMAIL_PROVIDER === "brevo" && BREVO_TEMPLATES[kind] > 0) ? BREVO_TEMPLATES[kind] : null;
const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const htmlEsc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function mailConfigProblems() {
  const p = [];
  if (!EMAIL_SPEC) { p.push(`EMAIL_PROVIDER "${EMAIL_PROVIDER}" is not one of brevo, resend, sendgrid`); return p; }
  if (!EMAIL_KEY) p.push(`${EMAIL_SPEC.key} is not set`);
  else if (!EMAIL_SPEC.looks.test(EMAIL_KEY)) p.push(`${EMAIL_SPEC.key} does not look like a ${EMAIL_SPEC.label} key`);
  if (!FROM_EMAIL) p.push(`EMAIL_FROM is not set (must be a sender verified in ${EMAIL_SPEC.label})`);
  return p;
}
/** Posts one message to the configured provider's REST API. Throws with the provider's error text. */
async function deliver(msg) {
  const to = (Array.isArray(msg.to) ? msg.to : [msg.to]).filter(Boolean);
  const from = msg.from || mailFrom();
  const replyTo = msg.replyTo || SUPPORT_EMAIL || "";
  const html = msg.html || `<pre style="font-family:Inter,system-ui,sans-serif;white-space:pre-wrap">${htmlEsc(msg.text)}</pre>`;
  let url, headers, body;
  if (EMAIL_PROVIDER === "brevo") {
    url = "https://api.brevo.com/v3/smtp/email";
    headers = { "api-key": EMAIL_KEY, "content-type": "application/json", "accept": "application/json" };
    body = msg.templateId
      ? { sender: { email: from.email, name: from.name }, to: to.map((email) => ({ email })), templateId: Number(msg.templateId), params: msg.params || {}, ...(replyTo ? { replyTo: { email: replyTo } } : {}) }
      : { sender: { email: from.email, name: from.name }, to: to.map((email) => ({ email })), subject: msg.subject, htmlContent: html, ...(msg.text ? { textContent: msg.text } : {}), ...(replyTo ? { replyTo: { email: replyTo } } : {}) };
  } else if (EMAIL_PROVIDER === "resend") {
    url = "https://api.resend.com/emails";
    headers = { "Authorization": `Bearer ${EMAIL_KEY}`, "content-type": "application/json" };
    body = { from: `${from.name} <${from.email}>`, to, subject: msg.subject, html, ...(msg.text ? { text: msg.text } : {}), ...(replyTo ? { reply_to: replyTo } : {}) };
  } else {
    url = "https://api.sendgrid.com/v3/mail/send";
    headers = { "Authorization": `Bearer ${EMAIL_KEY}`, "content-type": "application/json" };
    body = { personalizations: [{ to: to.map((email) => ({ email })) }], from, subject: msg.subject, ...(replyTo ? { reply_to: { email: replyTo } } : {}), content: [msg.text && { type: "text/plain", value: msg.text }, { type: "text/html", value: html }].filter(Boolean) };
  }
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let detail = raw;
    try { const j = JSON.parse(raw); detail = j.message || (Array.isArray(j.errors) && j.errors.map((e) => e.message || e).join("; ")) || j.error || raw; } catch (e) { /* plain text */ }
    throw new Error(`${EMAIL_SPEC.label} ${res.status}: ${String(detail).slice(0, 300)}`);
  }
}
/** Sends and records the outcome in email-log. Throws on failure so callers' sent-flags stay unset. */
async function sendMail(kind, msg) {
  const entry = { kind, provider: EMAIL_PROVIDER, to: Array.isArray(msg.to) ? msg.to.join(", ") : String(msg.to || ""), subject: msg.subject || "", at: new Date(), status: "sent" };
  const record = () => db.collection("email-log").add(entry).catch((e) => console.warn("email-log write failed:", e.message));
  if (!MAIL_READY) {
    entry.status = "skipped"; entry.error = mailConfigProblems().join("; ");
    console.warn(`Email (${kind}) skipped: ${entry.error}`); await record();
    throw new Error(entry.error);
  }
  try {
    try {
      await deliver(msg);
    } catch (err) {
      // A deleted or inactive Brevo template must not block the email: fall back to the inline HTML.
      if (msg.templateId && /template/i.test(err.message)) { console.warn(`Template ${msg.templateId} failed (${err.message}); sending inline HTML`); entry.note = "template fallback"; await deliver({ ...msg, templateId: undefined }); }
      else throw err;
    }
    await record();
  } catch (err) {
    entry.status = "failed"; entry.error = err.message;
    console.error(`Email (${kind}) to ${entry.to} failed: ${err.message}`); await record();
    throw err;
  }
}

/**
 * Firestore trigger: when a new document is written to
 * contact-messages/{msgId}/replies/{replyId},
 * send the reply as an email to the original customer.
 */
exports.sendReplyEmail = onDocumentCreated(
  { document: "contact-messages/{msgId}/replies/{replyId}", database: "default" },
  async (event) => {
    const reply = event.data.data();
    const msgId = event.params.msgId;

    if (!reply || !reply.body || !reply.toEmail) {
      console.log("Reply missing body or email, skipping.");
      return;
    }

    // Fetch the original message for context
    const msgSnap = await db
      .collection("contact-messages")
      .doc(msgId)
      .get();
    const original = msgSnap.exists ? msgSnap.data() : {};

    const subject =
      reply.subject ||
      `Re: Your ${original.topic || "message"} to BudgetThrills`;

    const emailHtml = `
      <div style="font-family: 'Inter', system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #0A0A0A; color: #FAFAFA; padding: 40px 32px; border-radius: 12px;">
        <div style="margin-bottom: 24px;">
          <span style="color: #BFFF1A; font-size: 24px; font-weight: 800; letter-spacing: -0.04em;">BudgetThrills</span>
        </div>

        <p style="font-size: 15px; line-height: 1.7; color: #A1A1AA; margin-bottom: 8px;">
          Hey ${original.name || "there"},
        </p>

        <p style="font-size: 15px; line-height: 1.7; color: #D4D4D8; margin-bottom: 24px;">
          ${reply.body.replace(/\n/g, "<br>")}
        </p>

        <div style="border-top: 1px solid #27272A; padding-top: 20px; margin-top: 24px;">
          <p style="font-size: 12px; color: #52525B; line-height: 1.6;">
            Re: ${original.topic || "General question"}${original.orderNumber ? " · Order " + original.orderNumber : ""}
            <br>Your message: "${(original.message || "").substring(0, 120)}${(original.message || "").length > 120 ? "..." : ""}"
          </p>
        </div>

        <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #27272A;">
          <p style="font-size: 11px; color: #3F3F46; line-height: 1.6;">
            BudgetThrills · Trendy products. Budget prices. Real thrills.
            <br>Need more help? Reply to this email or visit <a href="https://budgetthrills.shop/contact.html" style="color: #BFFF1A;">budgetthrills.shop/contact</a>
          </p>
        </div>
      </div>
    `;

    const emailText = `Hey ${original.name || "there"},\n\n${reply.body}\n\n---\nRe: ${original.topic || "General question"}${original.orderNumber ? " · Order " + original.orderNumber : ""}\nYour message: "${(original.message || "").substring(0, 120)}"\n\nBudgetThrills · budgetthrills.shop`;

    if (!MAIL_READY) {
      console.warn("SENDGRID_API_KEY not set. Saving reply but not sending email.");
      // Still mark reply as sent (no email provider configured)
      await db
        .collection("contact-messages")
        .doc(msgId)
        .collection("replies")
        .doc(event.params.replyId)
        .update({ emailSent: false, error: "No SendGrid API key configured" });

      // Mark original as replied
      await db
        .collection("contact-messages")
        .doc(msgId)
        .update({ replied: true, repliedAt: new Date() });

      return;
    }

    const msg = {
      to: reply.toEmail,
      from: mailFrom(),
      subject: subject,
      text: emailText,
      html: emailHtml,
      replyTo: SUPPORT_EMAIL,
      templateId: templateFor("reply"),
      params: { subject, name: original.name || "there", body: htmlEsc(reply.body).replace(/\n/g, "<br>"), topic: original.topic || "General question", orderNumber: original.orderNumber || "", originalMessage: String(original.message || "").substring(0, 160) }
    };

    try {
      await sendMail("reply", msg);
      console.log(`Reply email sent to ${reply.toEmail} for message ${msgId}`);

      // Mark reply as sent
      await db
        .collection("contact-messages")
        .doc(msgId)
        .collection("replies")
        .doc(event.params.replyId)
        .update({ emailSent: true, sentAt: new Date() });

      // Mark original message as replied
      await db
        .collection("contact-messages")
        .doc(msgId)
        .update({ replied: true, repliedAt: new Date() });
    } catch (err) {
      console.error(`Failed to send reply email:`, err.message);

      // Mark reply with error
      await db
        .collection("contact-messages")
        .doc(msgId)
        .collection("replies")
        .doc(event.params.replyId)
        .update({ emailSent: false, error: err.message });
    }
  }
);

// ─── Order Confirmation Email ─────────────────────────────────────────────────
exports.onOrderPaid = onDocumentWritten(
  { document: "orders/{orderId}", database: "default" },
  async (event) => {
  const after   = event.data.after.exists ? event.data.after.data() : null;
  const before  = event.data.before.exists ? event.data.before.data() : null;
  const orderId = event.params.orderId;
  if (!after) return null;

  const PAID = ["paid", "processing"];
  const wasPaid = before && PAID.includes(before.status);
  const isPaid  = PAID.includes(after.status);
  if (!isPaid || wasPaid || after.confirmationEmailSent) return null;

  const order = after;

  if (!MAIL_READY) {
    console.warn("Email not configured — skipping confirmation email for", orderId);
    return null;
  }
  if (!order.email) { console.warn("Order", orderId, "has no email"); return null; }

  const items    = order.items || [];
  const total    = items.reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  const itemRows = items.map(it =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #27272A">${it.name}${it.qty > 1 ? " &times;" + it.qty : ""}</td>` +
    `<td style="padding:8px 0;border-bottom:1px solid #27272A;text-align:right">$${Number(it.price || 0).toFixed(2)}</td></tr>`
  ).join("");

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0A0A0A;color:#F2F2F2;font-family:Inter,system-ui,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
  <div style="color:#BFFF1A;font-size:22px;font-weight:900;letter-spacing:-0.04em;margin-bottom:32px">BudgetThrills</div>
  <h1 style="font-size:36px;font-weight:900;margin:0 0 8px;letter-spacing:-0.02em">Order confirmed<span style="color:#BFFF1A">.</span></h1>
  <p style="color:#6E6E6E;margin:0 0 24px">Thanks ${order.customerName || ""}! Order <strong style="color:#F2F2F2">${order.id || orderId}</strong> received.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272A;margin-bottom:16px">${itemRows}</table>
  <div style="display:flex;justify-content:space-between;padding:12px 0;border-top:1px solid #27272A;border-bottom:1px solid #27272A;margin-bottom:24px">
    <strong>Total</strong><strong style="color:#BFFF1A">$${total.toFixed(2)}</strong>
  </div>
  <div style="background:#0E0E0E;border:1px solid #1C1C1C;padding:16px;margin-bottom:24px">
    <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#6E6E6E;margin-bottom:6px">Shipping to</div>
    <div>${order.address || "&mdash;"}</div>
  </div>
  <p style="color:#6E6E6E;font-size:13px">Track at <a href="https://budgetthrills.shop/track.html" style="color:#BFFF1A">budgetthrills.shop/track</a> using your order number + this email.</p>
  <p style="color:#6E6E6E;font-size:13px">Questions? <a href="mailto:support@budgetthrills.shop" style="color:#BFFF1A">support@budgetthrills.shop</a></p>
  <div style="margin-top:32px;padding-top:20px;border-top:1px solid #1C1C1C;font-size:11px;color:#6E6E6E">&copy; 2026 BudgetThrills</div>
</div></body></html>`;

  try {
    await sendMail("order-confirmation", {
      to:      order.email,
      from: mailFrom(),
      replyTo: SUPPORT_EMAIL,
      subject: `Your order ${order.id || orderId} is confirmed \u2713`,
      templateId: templateFor("order-confirmation"),
      params: {
        orderId: order.id || orderId, customerName: (order.customerName || "").split(" ")[0] || "",
        items: items.map((it) => ({ name: it.name, qty: Number(it.qty) || 1, lineTotal: money((it.price || 0) * (it.qty || 1)) })),
        subtotal: money(order.subtotal ?? total), discount: Number(order.discount) > 0 ? money(order.discount) : "", shipping: Number(order.shipping) > 0 ? money(order.shipping) : "Free",
        total: money(order.total ?? total), address: order.address || "", trackUrl: `${PUBLIC_BASE_URL || "https://budgetthrills.shop"}/track.html`
      },
      html,
      text: `Order ${order.id || orderId} confirmed!\n\nTotal: $${total.toFixed(2)}\nShipping to: ${order.address || "\u2014"}\n\nTrack: https://budgetthrills.shop/track.html\nHelp: support@budgetthrills.shop`
    });
    console.log("✓ Confirmation email sent to", order.email, "for", orderId);
    await db.collection("orders").doc(orderId).set({ confirmationEmailSent: true }, { merge: true });
  } catch (err) {
    console.error("SendGrid error for order", orderId, ":", err.response?.body || err.message);
  }
  return null;
});

// ─── Contact Form Admin Alert ─────────────────────────────────────────────────
exports.onContactMessage = onDocumentCreated(
  { document: "contact-messages/{msgId}", database: "default" },
  async (event) => {
  const msg = event.data.data();

  if (!MAIL_READY) {
    console.warn("Email not configured \u2014 skipping admin alert");
    return null;
  }
  const adminEmail = process.env.ADMIN_EMAIL || FROM_EMAIL;

  try {
    await sendMail("contact-alert", {
      to:      adminEmail,
      from: mailFrom("BudgetThrills Notifications"),
      replyTo: msg.email || SUPPORT_EMAIL,
      subject: `[Contact] ${msg.topic || "General"} \u2014 ${msg.name || msg.email}`,
      text: [
        "New contact form submission",
        "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
        "Name:  " + (msg.name  || "\u2014"),
        "Email: " + (msg.email || "\u2014"),
        "Order: " + (msg.orderNumber || "\u2014"),
        "Topic: " + (msg.topic || "\u2014"),
        "",
        msg.message || "(no message body)",
        "",
        "Reply directly to this email to respond to the customer."
      ].join("\n")
    });
    console.log("\u2713 Admin alert sent for contact message", event.params.msgId);
  } catch (err) {
    console.error("Admin alert error:", err.response?.body || err.message);
  }
  return null;
});

// ─── Payments ────────────────────────────────────────────────────────────────
// Secrets come from functions/.env (see functions/.env.example). Nothing is hardcoded.
const NOWPAYMENTS_API_KEY    = process.env.NOWPAYMENTS_API_KEY || "";
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET || process.env.NOWPAYMENTS_IPN_KEY || "";
const NOWPAYMENTS_BASE       = "https://api.nowpayments.io/v1";
const STRIPE_SECRET_KEY      = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET  = process.env.STRIPE_WEBHOOK_SECRET || "";
const PUBLIC_BASE_URL        = process.env.PUBLIC_BASE_URL || "";

function sortObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  return Object.keys(obj).sort().reduce((acc, key) => {
    acc[key] = (obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key]))
      ? sortObject(obj[key])
      : obj[key];
    return acc;
  }, {});
}

function siteOrigin(req) {
  const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : "");
  if (origin) return origin.replace(/\/$/, "");
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, "");
  return "https://budgetthrills.shop";
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Loads the pending order the storefront wrote at checkout. The amount charged is
 * always taken from Firestore, never from the request body, so a customer cannot
 * change the price on the way to the payment provider.
 */
async function loadPendingOrder(orderId) {
  if (!orderId || !/^BT-[A-Z0-9-]{3,20}$/i.test(String(orderId))) return { error: "Invalid orderId" };
  const snap = await db.collection("orders").doc(String(orderId)).get();
  if (!snap.exists) return { error: "Order not found. Please refresh and try again." };
  const order = snap.data();
  if (order.status !== "pending_payment") return { error: "This order is no longer awaiting payment." };
  if (!(Number(order.total) > 0)) return { error: "Order total is invalid." };
  return { order };
}

async function markOrder(orderId, patch) {
  await db.collection("orders").doc(orderId).set({ ...patch, updatedAt: new Date() }, { merge: true });
}

/** POST /api/create-invoice — NOWPayments crypto invoice */
exports.createInvoice = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  if (!NOWPAYMENTS_API_KEY) return res.status(503).json({ error: "Crypto payments are not configured (NOWPAYMENTS_API_KEY missing)." });

  const { orderId, product, customerEmail } = req.body || {};
  const { order, error } = await loadPendingOrder(orderId).catch((e) => ({ error: e.message }));
  if (error) return res.status(400).json({ error });

  const origin = siteOrigin(req);
  try {
    let payCurrency = req.body?.pay_currency ? String(req.body.pay_currency).toLowerCase().trim() : "";
    if (payCurrency === "usdt") payCurrency = "usdttrc20";

    const payload = {
      price_amount: round2(order.total),
      price_currency: "usd",
      order_id: String(orderId),
      order_description: String(product || `BudgetThrills order ${orderId}`).substring(0, 150),
      customer_email: customerEmail || order.email || undefined,
      ipn_callback_url: `${origin}/api/nowpayments-webhook`,
      success_url: `${origin}/order-confirmation.html?id=${encodeURIComponent(orderId)}&status=crypto_success`,
      cancel_url: `${origin}/checkout.html?status=crypto_cancelled`
    };
    if (payCurrency) payload.pay_currency = payCurrency;

    const response = await fetch(`${NOWPAYMENTS_BASE}/invoice`, {
      method: "POST",
      headers: { "x-api-key": NOWPAYMENTS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("NOWPayments invoice API error:", data);
      return res.status(502).json({ error: data.message || "NOWPayments rejected the invoice request." });
    }
    await markOrder(orderId, { paymentProvider: "nowpayments", nowpaymentsInvoiceId: data.id || null });
    return res.status(200).json({ invoice_id: data.id, checkout_url: data.invoice_url, amount: data.price_amount, currency: data.pay_currency });
  } catch (err) {
    console.error("Invoice creation failed:", err);
    return res.status(500).json({ error: "Failed to create invoice." });
  }
});

/** POST /api/nowpayments-webhook — NOWPayments IPN */
exports.nowpaymentsWebhook = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  if (!NOWPAYMENTS_IPN_SECRET) { console.error("NOWPAYMENTS_IPN_SECRET not set; rejecting IPN"); return res.status(503).send("IPN not configured"); }

  const receivedSig = req.headers["x-nowpayments-sig"];
  const sortedString = JSON.stringify(sortObject(req.body));
  const expected = crypto.createHmac("sha512", NOWPAYMENTS_IPN_SECRET).update(sortedString).digest("hex");
  const expectedSha256 = crypto.createHmac("sha256", NOWPAYMENTS_IPN_SECRET).update(sortedString).digest("hex");
  if (!receivedSig || (receivedSig !== expected && receivedSig !== expectedSha256)) {
    console.warn("Invalid NOWPayments IPN signature");
    return res.status(401).send("Invalid signature");
  }

  const body = req.body || {};
  const orderId = body.order_id;
  const status = String(body.payment_status || "").toLowerCase();
  if (!orderId) return res.sendStatus(200);

  const crypto_ = {
    paymentId: body.payment_id || null, payAmount: body.pay_amount || null, actuallyPaid: body.actually_paid || null,
    payCurrency: body.pay_currency || null, priceAmount: body.price_amount || null, outcomeAmount: body.outcome_amount || null
  };

  try {
    const ref = db.collection("orders").doc(String(orderId));
    const snap = await ref.get();
    if (!snap.exists) { console.warn("IPN for unknown order", orderId); return res.sendStatus(200); }
    const current = snap.data();
    // Never downgrade an order that is already fulfilled.
    if (["shipped", "delivered", "refunded"].includes(current.status)) return res.sendStatus(200);

    // Guard against underpayment: NOWPayments reports the fiat outcome; require >= 98% of the order total.
    const outcomeOk = !body.outcome_amount || Number(body.outcome_amount) >= Number(current.total) * 0.98;

    if (status === "finished" || (status === "confirmed" && outcomeOk)) {
      await markOrder(orderId, { status: "paid", paymentStatus: status, paidAt: new Date().toISOString(), paymentMethod: "Crypto (NOWPayments)", cryptoPayment: crypto_ });
    } else if (status === "expired" || status === "failed" || status === "refunded") {
      await markOrder(orderId, { status: status === "refunded" ? "refunded" : "payment_failed", paymentStatus: status, cryptoPayment: crypto_ });
    } else if (status === "partially_paid") {
      await markOrder(orderId, { status: "partially_paid", paymentStatus: status, cryptoPayment: crypto_ });
    } else if (["waiting", "confirming", "sending"].includes(status)) {
      await markOrder(orderId, { paymentStatus: status, cryptoPayment: crypto_ });
    } else {
      console.log(`Unhandled NOWPayments status '${status}' for ${orderId}`);
    }
  } catch (err) {
    console.error(`Error updating order ${orderId} from IPN:`, err);
    return res.status(500).send("error");
  }
  return res.sendStatus(200);
});

/** POST /api/create-checkout-session — Stripe Checkout (card, Apple Pay, Google Pay) */
/**
 * Builds Stripe line items whose sum equals the order total exactly. A promo discount is
 * allocated proportionally across the items instead of using the Coupons API, so a
 * restricted key (rk_live_...) without "Coupons: write" still charges the right amount.
 * Returns { lineItems, totalCents }.
 */
function buildStripeLineItems(order) {
  const cents = (n) => Math.round((Number(n) || 0) * 100);
  const items = (order.items || []).map((it) => ({
    name: String(it.name || "Item").substring(0, 120),
    image: it.image && /^https?:\/\//.test(it.image) ? [it.image] : [],
    qty: Math.max(1, Number(it.qty) || 1),
    unit: cents(it.price)
  })).filter((it) => it.unit > 0);
  const shipping = cents(order.shipping);
  const discount = Math.min(cents(order.discount), items.reduce((s, it) => s + it.unit * it.qty, 0));

  let lineItems;
  if (discount > 0 && items.length) {
    // Collapse each line to quantity 1 so the discounted amount is exact to the cent.
    const subtotal = items.reduce((s, it) => s + it.unit * it.qty, 0);
    let allocated = 0;
    lineItems = items.map((it, i) => {
      const gross = it.unit * it.qty;
      const share = i === items.length - 1 ? discount - allocated : Math.round(discount * gross / subtotal);
      allocated += share;
      return { quantity: 1, price_data: { currency: "usd", unit_amount: gross - share, product_data: { name: it.qty > 1 ? `${it.name} × ${it.qty}` : it.name, images: it.image, description: order.promoCode ? `Includes ${order.promoCode} discount` : "Includes discount" } } };
    }).filter((li) => li.price_data.unit_amount > 0);
  } else {
    lineItems = items.map((it) => ({ quantity: it.qty, price_data: { currency: "usd", unit_amount: it.unit, product_data: { name: it.name, images: it.image } } }));
  }
  if (shipping > 0) lineItems.push({ quantity: 1, price_data: { currency: "usd", unit_amount: shipping, product_data: { name: "Shipping" } } });
  const totalCents = lineItems.reduce((s, li) => s + li.price_data.unit_amount * li.quantity, 0);
  return { lineItems, totalCents };
}

exports.createCheckoutSession = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  if (!STRIPE_SECRET_KEY) return res.status(503).json({ error: "Card payments are not configured yet (STRIPE_SECRET_KEY missing). Please pay with crypto." });

  const { orderId, customerEmail } = req.body || {};
  const { order, error } = await loadPendingOrder(orderId).catch((e) => ({ error: e.message }));
  if (error) return res.status(400).json({ error });

  const origin = siteOrigin(req);
  try {
    const stripe = require("stripe")(STRIPE_SECRET_KEY);
    const { lineItems, totalCents } = buildStripeLineItems(order);
    const expected = Math.round(Number(order.total) * 100);
    if (!lineItems.length) return res.status(400).json({ error: "Order has no payable items." });
    if (Math.abs(totalCents - expected) > 1) {
      console.error(`Order ${orderId}: line items total ${totalCents} but order total is ${expected}`);
      return res.status(400).json({ error: "Order totals do not add up. Please rebuild your cart and try again." });
    }
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      client_reference_id: String(orderId),
      customer_email: customerEmail || order.email || undefined,
      metadata: { orderId: String(orderId), promoCode: order.promoCode || "" },
      success_url: `${origin}/order-confirmation.html?id=${encodeURIComponent(orderId)}&status=paid`,
      cancel_url: `${origin}/checkout.html?status=cancelled`
    });
    await markOrder(orderId, { paymentProvider: "stripe", stripeSessionId: session.id, stripeAmount: totalCents / 100 });
    return res.status(200).json({ checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error("Stripe session creation failed:", err);
    return res.status(502).json({ error: err.message || "Stripe error" });
  }
});

/** POST /api/stripe-webhook — marks the order paid once Stripe confirms the charge */
exports.stripeWebhook = onRequest({ cors: false }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) return res.status(503).send("Stripe webhook not configured");
  const stripe = require("stripe")(STRIPE_SECRET_KEY);
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn("Invalid Stripe signature:", err.message);
    return res.status(400).send("Invalid signature");
  }
  try {
    const obj = event.data.object;
    const orderId = obj.metadata?.orderId || obj.client_reference_id;
    if (event.type === "checkout.session.completed" && orderId) {
      if (obj.payment_status === "paid") {
        const snap = await db.collection("orders").doc(String(orderId)).get();
        const expected = snap.exists ? Math.round(Number(snap.data().total) * 100) : null;
        const mismatch = expected !== null && Math.abs((obj.amount_total || 0) - expected) > 1;
        if (mismatch) console.error(`Order ${orderId}: Stripe charged ${obj.amount_total} but order total is ${expected}`);
        await markOrder(orderId, { status: "paid", paymentStatus: "paid", paidAt: new Date().toISOString(), paymentMethod: "Card (Stripe)", stripePaymentIntent: obj.payment_intent || null, amountPaid: (obj.amount_total || 0) / 100, ...(mismatch ? { amountMismatch: true, adminNote: "Stripe charge did not match order total; review before shipping." } : {}) });
      }
    } else if (event.type === "checkout.session.async_payment_succeeded" && orderId) {
      await markOrder(orderId, { status: "paid", paymentStatus: "paid", paidAt: new Date().toISOString(), paymentMethod: "Card (Stripe)" });
    } else if ((event.type === "checkout.session.async_payment_failed" || event.type === "checkout.session.expired") && orderId) {
      await markOrder(orderId, { status: "payment_failed", paymentStatus: event.type.replace("checkout.session.", "") });
    } else if (event.type === "charge.refunded") {
      const q = await db.collection("orders").where("stripePaymentIntent", "==", obj.payment_intent).limit(1).get();
      if (!q.empty) await markOrder(q.docs[0].id, { status: "refunded", paymentStatus: "refunded" });
    }
  } catch (err) {
    console.error("Stripe webhook handling error:", err);
    return res.status(500).send("error");
  }
  return res.sendStatus(200);
});

/**
 * Fulfilment side effects when an order document changes:
 *  - status becomes "shipped" with a tracking number -> shipping email to the customer (SendGrid)
 *  - tracking number/carrier set on a Stripe-paid order -> attached to the PaymentIntent, which
 *    Stripe uses as dispute evidence and which lowers "item not received" chargebacks.
 */
exports.onOrderFulfilment = onDocumentWritten({ document: "orders/{orderId}", database: "default" }, async (event) => {
  const after = event.data.after.exists ? event.data.after.data() : null;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const orderId = event.params.orderId;
  if (!after) return null;
  const ref = db.collection("orders").doc(orderId);
  const patch = {};

  const trackingChanged = after.trackingNumber && (after.trackingNumber !== before.trackingNumber || after.carrier !== before.carrier);
  if (trackingChanged && after.stripePaymentIntent && STRIPE_SECRET_KEY) {
    try {
      const stripe = require("stripe")(STRIPE_SECRET_KEY);
      await stripe.paymentIntents.update(after.stripePaymentIntent, {
        shipping: { name: String(after.customerName || "Customer").substring(0, 100), phone: after.phone || undefined, carrier: String(after.carrier || "").substring(0, 50) || undefined, tracking_number: String(after.trackingNumber).substring(0, 100), address: { line1: String(after.address || "n/a").substring(0, 200), country: "US" } }
      });
      patch.stripeTrackingSyncedAt = new Date(); patch.stripeTrackingError = FieldValue.delete();
    } catch (err) {
      console.warn("Stripe tracking sync failed for", orderId, err.message);
      patch.stripeTrackingError = err.message;
    }
  }

  if (after.status === "shipped" && after.trackingNumber && !after.shippedEmailSent && after.email) {
    if (!MAIL_READY) { console.warn("SENDGRID_API_KEY not set — skipping shipping email for", orderId); }
    else {
      const carrier = after.carrier || "Carrier", tn = after.trackingNumber;
      const links = { USPS: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tn)}`, UPS: `https://www.ups.com/track?tracknum=${encodeURIComponent(tn)}`, FedEx: `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tn)}`, DHL: `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${encodeURIComponent(tn)}` };
      const trackUrl = links[carrier] || "https://budgetthrills.shop/track.html";
      const items = (after.items || []).map((it) => `<li>${it.name}${it.qty > 1 ? " × " + it.qty : ""}</li>`).join("");
      try {
        await sendMail("order-shipped", {
          to: after.email, from: mailFrom(), replyTo: SUPPORT_EMAIL,
          subject: `Your order ${after.id || orderId} has shipped`,
          templateId: templateFor("order-shipped"),
          params: { orderId: after.id || orderId, carrier, trackingNumber: tn, trackUrl, address: after.address || "", deliveryWindow: after.shippingMethod === "express" ? "2–4 business days" : "4–8 business days",
            items: (after.items || []).map((it) => ({ name: it.name, qty: Number(it.qty) || 1 })) },
          html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#0A0A0A;color:#F2F2F2"><div style="color:#BFFF1A;font-size:22px;font-weight:900;margin-bottom:24px">BudgetThrills</div><h1 style="font-size:28px;margin:0 0 8px">On its way<span style="color:#BFFF1A">.</span></h1><p style="color:#A1A1AA">Order <strong style="color:#F2F2F2">${after.id || orderId}</strong> shipped with ${carrier}.</p><p style="margin:20px 0"><a href="${trackUrl}" style="background:#BFFF1A;color:#000;padding:12px 20px;border-radius:4px;text-decoration:none;font-weight:700">Track ${tn}</a></p><ul style="color:#D4D4D8;padding-left:18px">${items}</ul><p style="color:#6E6E6E;font-size:13px;margin-top:24px">Shipping to: ${after.address || ""}<br>Questions? Reply to this email.</p></div>`,
          text: `Order ${after.id || orderId} has shipped with ${carrier}. Tracking: ${tn}\n${trackUrl}`
        });
        patch.shippedEmailSent = true;
      } catch (err) { console.error("Shipping email failed for", orderId, err.response?.body || err.message); }
    }
  }

  if (Object.keys(patch).length) await ref.set(patch, { merge: true });
  return null;
});

/** POST /api/email-test — admin only. {check:true} reports configuration; otherwise sends a test email to the admin. */
exports.emailTest = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: "Admin sign-in required." });
  const problems = mailConfigProblems();
  const status = { configured: problems.length === 0, problems, provider: EMAIL_SPEC ? EMAIL_SPEC.label : EMAIL_PROVIDER, from: FROM_EMAIL || null, fromName: FROM_NAME, supportEmail: SUPPORT_EMAIL || null, adminEmail: process.env.ADMIN_EMAIL || null, templates: EMAIL_PROVIDER === "brevo" ? BREVO_TEMPLATES : null, listId: EMAIL_PROVIDER === "brevo" ? BREVO_LIST_ID : null };
  if (req.body?.check) return res.json(status);
  const to = admin.email;
  if (!to) return res.status(400).json({ ...status, error: "Your admin account has no email address." });
  try {
    await sendMail("test", { to, subject: "BudgetThrills test email", text: `This is a test from the BudgetThrills admin. Sent by ${to} at ${new Date().toISOString()}.`,
      html: `<div style="font-family:Inter,system-ui,sans-serif;padding:24px"><h2 style="margin:0 0 8px">Email is working<span style="color:#BFFF1A">.</span></h2><p>Sent from <b>${FROM_EMAIL}</b> via ${EMAIL_SPEC.label} by ${to}.</p><p style="color:#666;font-size:12px">Order confirmations, shipping notices and contact replies will use this sender.</p></div>` });
    return res.json({ ...status, ok: true, sentTo: to });
  } catch (err) {
    return res.status(502).json({ ...status, ok: false, error: err.message });
  }
});

// ─── Newsletter signup (Brevo contact list) ───────────────────────────────────
const BREVO_LIST_ID = Number(process.env.BREVO_LIST_ID || 2);
/** Adds one address to the Brevo list. Returns { ok, error }. Never throws. */
async function brevoAddContact(email) {
  const key = process.env.BREVO_API_KEY;
  if (!key) return { ok: false, error: "BREVO_API_KEY missing" };
  try {
    const r = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST", headers: { "api-key": key, "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({ email, listIds: [BREVO_LIST_ID], updateEnabled: true })
    });
    if (r.ok || r.status === 204) return { ok: true };
    const raw = await r.text().catch(() => "");
    let detail = raw; try { detail = JSON.parse(raw).message || raw; } catch (e) { /* text */ }
    if (/already exist/i.test(detail)) return { ok: true };
    return { ok: false, error: `Brevo ${r.status}: ${String(detail).slice(0, 200)}` };
  } catch (err) { return { ok: false, error: err.message }; }
}

/**
 * POST /api/subscribe {email} — the homepage "Get the drop" form.
 * The address is saved to Firestore first so a Brevo outage (or Brevo's authorised-IP
 * block, which Cloud Functions cannot satisfy) never loses a lead; Brevo is then
 * attempted, and anything it rejected is retried by syncPendingSubscribers on each sync.
 */
exports.subscribe = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
  const id = crypto.createHash("sha256").update(email).digest("hex").slice(0, 32);
  const ref = db.collection("subscribers").doc(id);
  try {
    const existing = await ref.get();
    if (!existing.exists) await ref.set({ email, createdAt: new Date(), source: String(req.body?.source || "homepage").slice(0, 40), brevoSynced: false });
    const r = await brevoAddContact(email);
    await ref.set(r.ok ? { brevoSynced: true, brevoSyncedAt: new Date(), brevoError: FieldValue.delete() } : { brevoSynced: false, brevoError: r.error, lastAttemptAt: new Date() }, { merge: true });
    if (!r.ok) console.warn("Brevo subscribe deferred:", r.error);
    return res.json({ ok: true });
  } catch (err) {
    console.error("subscribe error:", err);
    return res.status(500).json({ error: "Could not save your email right now." });
  }
});

/** Pushes signups that Brevo rejected earlier. Runs after every catalog sync. */
async function syncPendingSubscribers() {
  const snap = await db.collection("subscribers").where("brevoSynced", "==", false).limit(100).get();
  const out = { pending: snap.size, synced: 0, failed: 0 };
  for (const d of snap.docs) {
    const r = await brevoAddContact(d.data().email);
    await d.ref.set(r.ok ? { brevoSynced: true, brevoSyncedAt: new Date(), brevoError: FieldValue.delete() } : { brevoError: r.error, lastAttemptAt: new Date() }, { merge: true });
    r.ok ? out.synced++ : out.failed++;
  }
  if (out.pending) console.log("subscribers sync:", JSON.stringify(out));
  return out;
}

// ─── Sitemap ──────────────────────────────────────────────────────────────────
const SITE_PAGES = [
  ["/", "daily", "1.0"], ["/trending.html", "daily", "0.9"], ["/collection.html", "daily", "0.8"], ["/phones.html", "daily", "0.8"],
  ["/tech.html", "daily", "0.8"], ["/accessories.html", "daily", "0.8"], ["/gaming.html", "daily", "0.8"], ["/drops.html", "weekly", "0.6"],
  ["/lookbook.html", "monthly", "0.4"], ["/story.html", "monthly", "0.4"], ["/help.html", "monthly", "0.5"], ["/contact.html", "monthly", "0.4"],
  ["/size-guide.html", "monthly", "0.3"], ["/track.html", "monthly", "0.3"]
];
const xmlEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
function buildSitemapXml(products, base) {
  const now = new Date().toISOString().slice(0, 10);
  const pages = SITE_PAGES.map(([path, freq, pri]) => `  <url><loc>${xmlEsc(base + path)}</loc><lastmod>${now}</lastmod><changefreq>${freq}</changefreq><priority>${pri}</priority></url>`);
  const items = (products || []).filter((p) => p && p.id).map((p) => {
    const lastmod = p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0, 10) : (p.firstSeenAt ? new Date(p.firstSeenAt).toISOString().slice(0, 10) : now);
    const img = Array.isArray(p.images) && p.images[0] ? `<image:image><image:loc>${xmlEsc(p.images[0])}</image:loc><image:title>${xmlEsc(p.name)}</image:title></image:image>` : "";
    return `  <url><loc>${xmlEsc(`${base}/pdp.html?id=${encodeURIComponent(p.id)}`)}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.6</priority>${img}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${pages.concat(items).join("\n")}\n</urlset>\n`;
}
let staticCatalogCache = null;
function staticCatalog() {
  if (staticCatalogCache) return staticCatalogCache;
  try { staticCatalogCache = require("./static-catalog.json"); } catch (e) { staticCatalogCache = []; }
  return staticCatalogCache;
}
/** GET /sitemap.xml — every live product plus the site pages; cached at the CDN for 6 hours. */
exports.sitemap = onRequest({ cors: false }, async (req, res) => {
  const base = (PUBLIC_BASE_URL || "https://budgetthrills.shop").replace(/\/$/, "");
  let products = [];
  try { const snap = await db.collection("catalog").doc("live").get(); products = snap.exists ? (snap.data().products || []) : []; } catch (e) { console.warn("sitemap: catalog read failed", e.message); }
  if (!products.length) products = staticCatalog();
  res.set("Content-Type", "application/xml; charset=utf-8");
  res.set("Cache-Control", "public, max-age=3600, s-maxage=21600");
  return res.status(200).send(buildSitemapXml(products, base));
});
exports._buildSitemapXml = buildSitemapXml;

/** POST /api/track-order — guest order lookup by order number + email (no public Firestore read) */
exports.trackOrder = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const orderId = String(req.body?.orderId || "").trim().toUpperCase();
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!orderId || !email) return res.status(400).json({ error: "orderId and email are required." });
  try {
    const snap = await db.collection("orders").doc(orderId).get();
    if (!snap.exists || String(snap.data().email || "").toLowerCase() !== email) return res.status(404).json({ error: "Order not found." });
    const o = snap.data();
    const iso = (v) => (v && v.toDate ? v.toDate().toISOString() : (v ? String(v) : null));
    const createdAt = iso(o.createdAt);
    return res.status(200).json({ order: {
      id: o.id || orderId, status: o.status, createdAt, carrier: o.carrier || "", trackingNumber: o.trackingNumber || "",
      address: o.address || "", eta: o.eta || "", total: o.total, shippingMethod: o.shippingMethod || "standard",
      paidAt: iso(o.paidAt), sourcedAt: iso(o.sourcedAt), shippedAt: iso(o.shippedAt), deliveredAt: iso(o.deliveredAt),
      items: (o.items || []).map((it) => ({ name: it.name, qty: it.qty, price: it.price, image: it.image, variant: it.variant }))
    } });
  } catch (err) {
    console.error("trackOrder error:", err);
    return res.status(500).json({ error: "Lookup failed." });
  }
});

// ─── eBay catalog sync ────────────────────────────────────────────────────────
const ADMIN_UIDS = (process.env.ADMIN_UIDS || "ExPolSW2P8UvRYLI4bowoRjCRix1").split(",").map((s) => s.trim()).filter(Boolean);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "eliudsamuel17@gmail.com,eliudsamwels7@gmail.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

async function requireAdmin(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  try {
    const t = await getAuth().verifyIdToken(m[1]);
    if (ADMIN_UIDS.includes(t.uid) || ADMIN_EMAILS.includes(String(t.email || "").toLowerCase())) return t;
    const prof = await db.collection("users").doc(t.uid).get();
    const d = prof.exists ? prof.data() : {};
    if (d.isAdmin === true || String(d.role || "").toLowerCase() === "admin") return t;
  } catch (e) { console.warn("requireAdmin:", e.message); }
  return null;
}

/** Scheduled: refresh existing listings and discover new ones. Needs the Blaze plan (Cloud Scheduler). */
exports.syncEbayCatalog = onSchedule({ schedule: "every 6 hours", timeoutSeconds: 540, memory: "512MiB", region: "us-central1" }, async () => {
  const summary = await catalogSync.runSync({ trigger: "schedule" });
  summary.subscribers = await syncPendingSubscribers().catch((e) => ({ error: e.message }));
  console.log("catalog sync:", JSON.stringify({ ...summary, log: undefined }));
});

/** POST /api/run-catalog-sync — admin-triggered run from the dashboard. */
exports.runCatalogSync = onRequest({ cors: true, timeoutSeconds: 540, memory: "512MiB" }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: "Admin sign-in required." });
  const summary = await catalogSync.runSync({ trigger: "manual:" + (admin.email || admin.uid) });
  summary.subscribers = await syncPendingSubscribers().catch((e) => ({ error: e.message }));
  return res.status(summary.ok ? 200 : 500).json(summary);
});

/** POST /api/publish-catalog — recompile catalog/live after admin edits. */
exports.publishCatalog = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: "Admin sign-in required." });
  try { const count = await catalogSync.publishLiveCatalog(db); return res.json({ ok: true, count }); }
  catch (err) { return res.status(500).json({ error: err.message }); }
});

exports._buildStripeLineItems = buildStripeLineItems;

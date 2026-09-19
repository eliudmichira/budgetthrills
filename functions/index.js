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
const sgMail = require("@sendgrid/mail");
initializeApp();
const db = getFirestore("default");
// Configure SendGrid API key from environment variable
// Set with: firebase functions:config:set sendgrid.key="SG.xxx"
const SENDGRID_KEY = process.env.SENDGRID_API_KEY || "";
const FROM_EMAIL = "hello@budgetthrills.com";
const FROM_NAME = "BudgetThrills";

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
            <br>Need more help? Reply to this email or visit <a href="https://budgetthrills.com/contact" style="color: #BFFF1A;">budgetthrills.com/contact</a>
          </p>
        </div>
      </div>
    `;

    const emailText = `Hey ${original.name || "there"},\n\n${reply.body}\n\n---\nRe: ${original.topic || "General question"}${original.orderNumber ? " · Order " + original.orderNumber : ""}\nYour message: "${(original.message || "").substring(0, 120)}"\n\nBudgetThrills · budgetthrills.com`;

    if (!SENDGRID_KEY) {
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

    sgMail.setApiKey(SENDGRID_KEY);

    const msg = {
      to: reply.toEmail,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject: subject,
      text: emailText,
      html: emailHtml,
      replyTo: { email: FROM_EMAIL, name: FROM_NAME },
    };

    try {
      await sgMail.send(msg);
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

  if (!SENDGRID_KEY) {
    console.warn("SENDGRID_API_KEY not set — skipping confirmation email for", orderId);
    return null;
  }
  if (!order.email) { console.warn("Order", orderId, "has no email"); return null; }

  sgMail.setApiKey(SENDGRID_KEY);

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
  <p style="color:#6E6E6E;font-size:13px">Track at <a href="https://budgetthrills.com/track.html" style="color:#BFFF1A">budgetthrills.com/track</a> using your order number + this email.</p>
  <p style="color:#6E6E6E;font-size:13px">Questions? <a href="mailto:support@budgetthrills.com" style="color:#BFFF1A">support@budgetthrills.com</a></p>
  <div style="margin-top:32px;padding-top:20px;border-top:1px solid #1C1C1C;font-size:11px;color:#6E6E6E">&copy; 2026 BudgetThrills</div>
</div></body></html>`;

  try {
    await sgMail.send({
      to:      order.email,
      from:    { email: FROM_EMAIL, name: FROM_NAME },
      replyTo: "support@budgetthrills.com",
      subject: `Your order ${order.id || orderId} is confirmed \u2713`,
      html,
      text: `Order ${order.id || orderId} confirmed!\n\nTotal: $${total.toFixed(2)}\nShipping to: ${order.address || "\u2014"}\n\nTrack: https://budgetthrills.com/track.html\nHelp: support@budgetthrills.com`
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

  if (!SENDGRID_KEY) {
    console.warn("SENDGRID_API_KEY not set \u2014 skipping admin alert");
    return null;
  }

  sgMail.setApiKey(SENDGRID_KEY);
  const adminEmail = process.env.ADMIN_EMAIL || "hello@budgetthrills.com";

  try {
    await sgMail.send({
      to:      adminEmail,
      from:    { email: FROM_EMAIL, name: "BudgetThrills Notifications" },
      replyTo: msg.email || "no-reply@budgetthrills.com",
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
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, "");
  const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : "");
  return origin || "https://budgetthrills.com";
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
exports.createCheckoutSession = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  if (!STRIPE_SECRET_KEY) return res.status(503).json({ error: "Card payments are not configured yet (STRIPE_SECRET_KEY missing). Please pay with crypto." });

  const { orderId, customerEmail } = req.body || {};
  const { order, error } = await loadPendingOrder(orderId).catch((e) => ({ error: e.message }));
  if (error) return res.status(400).json({ error });

  const origin = siteOrigin(req);
  try {
    const stripe = require("stripe")(STRIPE_SECRET_KEY);
    const items = (order.items || []).map((it) => ({
      quantity: Math.max(1, Number(it.qty) || 1),
      price_data: {
        currency: "usd",
        unit_amount: Math.round((Number(it.price) || 0) * 100),
        product_data: { name: String(it.name || "Item").substring(0, 120), images: it.image && /^https?:\/\//.test(it.image) ? [it.image] : [] }
      }
    }));
    if (Number(order.shipping) > 0) {
      items.push({ quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(Number(order.shipping) * 100), product_data: { name: "Shipping" } } });
    }
    const sessionParams = {
      mode: "payment",
      line_items: items,
      client_reference_id: String(orderId),
      customer_email: customerEmail || order.email || undefined,
      metadata: { orderId: String(orderId) },
      success_url: `${origin}/order-confirmation.html?id=${encodeURIComponent(orderId)}&status=paid`,
      cancel_url: `${origin}/checkout.html?status=cancelled`
    };
    if (Number(order.discount) > 0) {
      const coupon = await stripe.coupons.create({ amount_off: Math.round(Number(order.discount) * 100), currency: "usd", duration: "once", name: order.promoCode || "Discount" });
      sessionParams.discounts = [{ coupon: coupon.id }];
    }
    const session = await stripe.checkout.sessions.create(sessionParams);
    await markOrder(orderId, { paymentProvider: "stripe", stripeSessionId: session.id });
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
        await markOrder(orderId, { status: "paid", paymentStatus: "paid", paidAt: new Date().toISOString(), paymentMethod: "Card (Stripe)", stripePaymentIntent: obj.payment_intent || null, amountPaid: (obj.amount_total || 0) / 100 });
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
    const createdAt = o.createdAt && o.createdAt.toDate ? o.createdAt.toDate().toISOString() : (o.createdAt || null);
    return res.status(200).json({ order: {
      id: o.id || orderId, status: o.status, createdAt, carrier: o.carrier || "", trackingNumber: o.trackingNumber || "",
      address: o.address || "", eta: o.eta || "", total: o.total, shippedAt: o.shippedAt && o.shippedAt.toDate ? o.shippedAt.toDate().toISOString() : (o.shippedAt || null),
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
    const prof = await getFirestore().collection("users").doc(t.uid).get();
    const d = prof.exists ? prof.data() : {};
    if (d.isAdmin === true || String(d.role || "").toLowerCase() === "admin") return t;
  } catch (e) { console.warn("requireAdmin:", e.message); }
  return null;
}

/** Scheduled: refresh existing listings and discover new ones. Needs the Blaze plan (Cloud Scheduler). */
exports.syncEbayCatalog = onSchedule({ schedule: "every 6 hours", timeoutSeconds: 540, memory: "512MiB", region: "us-central1" }, async () => {
  const summary = await catalogSync.runSync({ trigger: "schedule" });
  console.log("catalog sync:", JSON.stringify({ ...summary, log: undefined }));
});

/** POST /api/run-catalog-sync — admin-triggered run from the dashboard. */
exports.runCatalogSync = onRequest({ cors: true, timeoutSeconds: 540, memory: "512MiB" }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: "Admin sign-in required." });
  const summary = await catalogSync.runSync({ trigger: "manual:" + (admin.email || admin.uid) });
  return res.status(summary.ok ? 200 : 500).json(summary);
});

/** POST /api/publish-catalog — recompile catalog/live after admin edits. */
exports.publishCatalog = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: "Admin sign-in required." });
  try { const count = await catalogSync.publishLiveCatalog(getFirestore()); return res.json({ ok: true, count }); }
  catch (err) { return res.status(500).json({ error: err.message }); }
});

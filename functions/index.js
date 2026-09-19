// BudgetThrills Cloud Functions
// Handles contact-form reply emails via SendGrid

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const crypto = require("crypto");
const sgMail = require("@sendgrid/mail");

initializeApp();

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
  "contact-messages/{msgId}/replies/{replyId}",
  async (event) => {
    const reply = event.data.data();
    const msgId = event.params.msgId;

    if (!reply || !reply.body || !reply.toEmail) {
      console.log("Reply missing body or email, skipping.");
      return;
    }

    // Fetch the original message for context
    const msgSnap = await getFirestore()
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
      await getFirestore()
        .collection("contact-messages")
        .doc(msgId)
        .collection("replies")
        .doc(event.params.replyId)
        .update({ emailSent: false, error: "No SendGrid API key configured" });

      // Mark original as replied
      await getFirestore()
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
      await getFirestore()
        .collection("contact-messages")
        .doc(msgId)
        .collection("replies")
        .doc(event.params.replyId)
        .update({ emailSent: true, sentAt: new Date() });

      // Mark original message as replied
      await getFirestore()
        .collection("contact-messages")
        .doc(msgId)
        .update({ replied: true, repliedAt: new Date() });
    } catch (err) {
      console.error(`Failed to send reply email:`, err.message);

      // Mark reply with error
      await getFirestore()
        .collection("contact-messages")
        .doc(msgId)
        .collection("replies")
        .doc(event.params.replyId)
        .update({ emailSent: false, error: err.message });
    }
  }
);

// ─── Order Confirmation Email ─────────────────────────────────────────────────
exports.onOrderCreated = onDocumentCreated("orders/{orderId}", async (event) => {
  const order   = event.data.data();
  const orderId = event.params.orderId;

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
    console.log("\u2713 Confirmation email sent to", order.email, "for", orderId);
  } catch (err) {
    console.error("SendGrid error for order", orderId, ":", err.response?.body || err.message);
  }
  return null;
});

// ─── Contact Form Admin Alert ─────────────────────────────────────────────────
exports.onContactMessage = onDocumentCreated("contact-messages/{msgId}", async (event) => {
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

// ─── NOWPayments Cryptocurrency Integration ────────────────────────────────────
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || "B0ZTQPJ-EAVMDB7-PYBB3F1-Z3X0ZM3";
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET || process.env.NOWPAYMENTS_IPN_KEY || "GZ48khcSJXMHVbNj5d2pxA3jV07ppaHK";
const NOWPAYMENTS_BASE = "https://api.nowpayments.io/v1";

function sortObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  return Object.keys(obj).sort().reduce((acc, key) => {
    acc[key] = (obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key]))
      ? sortObject(obj[key])
      : obj[key];
    return acc;
  }, {});
}

/**
 * Endpoint to create a NOWPayments payment invoice
 * POST /api/create-invoice
 */
exports.createInvoice = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { product, price, currency = "USD", customerEmail, orderId } = req.body || {};

  if (!price || !orderId) {
    return res.status(400).json({ error: "Missing required fields: price and orderId." });
  }

  const origin = req.headers.origin || "https://budgetthrills.web.app";

  try {
    let normalizedPayCurrency = req.body?.pay_currency;
    if (normalizedPayCurrency) {
      normalizedPayCurrency = String(normalizedPayCurrency).toLowerCase().trim();
      if (normalizedPayCurrency === "usdt") {
        normalizedPayCurrency = "usdttrc20";
      }
    }

    const payload = {
      price_amount: parseFloat(price),
      price_currency: String(currency).toLowerCase(),
      order_id: String(orderId),
      order_description: String(product || "BudgetThrills Order").substring(0, 150),
      customer_email: customerEmail || undefined,
      ipn_callback_url: `${origin}/api/nowpayments-webhook`,
      success_url: `${origin}/order-confirmation.html?id=${encodeURIComponent(orderId)}&status=crypto_success`,
      cancel_url: `${origin}/checkout.html?status=crypto_cancelled`
    };

    if (normalizedPayCurrency) {
      payload.pay_currency = normalizedPayCurrency;
    }

    const response = await fetch(`${NOWPAYMENTS_BASE}/invoice`, {
      method: "POST",
      headers: {
        "x-api-key": NOWPAYMENTS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("NOWPayments invoice API error:", data);
      return res.status(response.status).json({
        error: data.message || "NOWPayments API error",
        details: data
      });
    }

    return res.status(200).json({
      invoice_id: data.id,
      checkout_url: data.invoice_url,
      amount: data.price_amount,
      currency: data.pay_currency
    });
  } catch (error) {
    console.error("Invoice creation failed:", error);
    return res.status(500).json({ error: "Failed to create invoice", details: error.message });
  }
});

/**
 * NOWPayments IPN Webhook handler
 * POST /api/nowpayments-webhook
 */
exports.nowpaymentsWebhook = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const ipnSecret = NOWPAYMENTS_IPN_SECRET;
  const receivedSig = req.headers["x-nowpayments-sig"];

  // Verify signature if secret is configured and not default placeholder
  if (ipnSecret && ipnSecret !== "your-ipn-key-here") {
    const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body);
    const sortedString = JSON.stringify(sortObject(req.body));
    const expectedSig1 = crypto.createHmac("sha256", ipnSecret).update(rawBody).digest("hex");
    const expectedSig2 = crypto.createHmac("sha256", ipnSecret).update(sortedString).digest("hex");

    if (receivedSig !== expectedSig1 && receivedSig !== expectedSig2) {
      console.warn("Invalid NOWPayments IPN signature:", { receivedSig, expectedSig1, expectedSig2 });
      return res.status(401).send("Invalid signature");
    }
  }

  const body = req.body || {};
  console.log("NOWPayments IPN callback received:", JSON.stringify(body));

  // Support both custom event structure and official NOWPayments IPN payload
  let orderId = body.order_id || (body.data && body.data.order_id);
  let status = String(body.payment_status || body.type || "").toUpperCase();
  let paymentAmount = body.actually_paid || body.pay_amount || (body.data && body.data.amount);
  let payCurrency = body.pay_currency || (body.data && body.data.currency);
  let paymentId = body.payment_id || (body.data && body.data.payment_id);

  if (!orderId) {
    console.warn("No order_id in IPN body, ignoring.");
    return res.sendStatus(200);
  }

  const db = getFirestore();
  const orderRef = db.collection("orders").doc(orderId);

  try {
    if (status === "PAYMENT_CONFIRMED" || status === "FINISHED" || status === "CONFIRMED") {
      console.log(`\u2705 Payment confirmed for Order ${orderId}`);
      await orderRef.set({
        status: "paid",
        paymentStatus: "confirmed",
        paidAt: new Date().toISOString(),
        paymentMethod: "Crypto (NOWPayments)",
        cryptoPayment: {
          paymentId: paymentId || null,
          amount: paymentAmount || null,
          currency: payCurrency || null,
          confirmedAt: new Date().toISOString()
        },
        updatedAt: new Date()
      }, { merge: true });
    } else if (status === "PAYMENT_EXPIRED" || status === "EXPIRED" || status === "FAILED") {
      console.log(`\u274C Payment expired/failed for Order ${orderId}`);
      await orderRef.set({
        status: "payment_failed",
        paymentStatus: "failed",
        updatedAt: new Date()
      }, { merge: true });
    } else if (status === "PAYMENT_PARTIALLY_PAID" || status === "PARTIALLY_PAID") {
      console.log(`\u26A0\uFE0F Partial payment for Order ${orderId}: ${paymentAmount}`);
      await orderRef.set({
        status: "partially_paid",
        paymentStatus: "partially_paid",
        cryptoPayment: {
          paymentId: paymentId || null,
          actuallyPaid: paymentAmount || null,
          currency: payCurrency || null
        },
        updatedAt: new Date()
      }, { merge: true });
    } else if (status === "WAITING" || status === "CONFIRMING" || status === "SENDING") {
      console.log(`\u23F3 Payment state '${status}' for Order ${orderId}`);
      await orderRef.set({
        status: "processing",
        paymentStatus: status.toLowerCase(),
        updatedAt: new Date()
      }, { merge: true });
    }
  } catch (err) {
    console.error(`Error updating Firestore for Order ${orderId}:`, err);
  }

  return res.sendStatus(200);
});

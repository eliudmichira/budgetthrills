// BudgetThrills - Standalone Express Server with NOWPayments Integration
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || 'B0ZTQPJ-EAVMDB7-PYBB3F1-Z3X0ZM3';
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET || process.env.NOWPAYMENTS_IPN_KEY || 'GZ48khcSJXMHVbNj5d2pxA3jV07ppaHK';
const NOWPAYMENTS_BASE = 'https://api.nowpayments.io/v1';

// Middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, x-nowpayments-sig');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// JSON body parser with raw body capture for HMAC verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '.')));

function sortObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  return Object.keys(obj).sort().reduce((acc, key) => {
    acc[key] = (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key]))
      ? sortObject(obj[key])
      : obj[key];
    return acc;
  }, {});
}

// ─── 1. Create Payment Invoice ────────────────────────────────────────────────
app.post('/api/create-invoice', async (req, res) => {
  const { product, price, currency = 'USD', customerEmail, orderId } = req.body || {};

  if (!price || !orderId) {
    return res.status(400).json({ error: 'Missing required parameters: price and orderId' });
  }

  const host = req.get('host');
  const protocol = req.protocol;
  const baseUrl = `${protocol}://${host}`;

  try {
    let normalizedPayCurrency = req.body?.pay_currency;
    if (normalizedPayCurrency) {
      normalizedPayCurrency = String(normalizedPayCurrency).toLowerCase().trim();
      if (normalizedPayCurrency === 'usdt') {
        normalizedPayCurrency = 'usdttrc20';
      }
    }

    const payload = {
      price_amount: parseFloat(price),
      price_currency: String(currency).toLowerCase(),
      order_id: String(orderId),
      order_description: String(product || 'BudgetThrills Order').substring(0, 150),
      customer_email: customerEmail || undefined,
      ipn_callback_url: `${baseUrl}/api/nowpayments-webhook`,
      success_url: `${baseUrl}/order-confirmation.html?id=${encodeURIComponent(orderId)}&status=crypto_success`,
      cancel_url: `${baseUrl}/checkout.html?status=crypto_cancelled`
    };

    if (normalizedPayCurrency) {
      payload.pay_currency = normalizedPayCurrency;
    }

    const response = await fetch(`${NOWPAYMENTS_BASE}/invoice`, {
      method: 'POST',
      headers: {
        'x-api-key': NOWPAYMENTS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('NOWPayments API error:', data);
      return res.status(response.status).json({
        error: data.message || 'Failed to create invoice via NOWPayments',
        details: data
      });
    }

    res.json({
      invoice_id: data.id,
      checkout_url: data.invoice_url,
      amount: data.price_amount,
      currency: data.pay_currency
    });
  } catch (error) {
    console.error('Invoice creation failed:', error);
    res.status(500).json({ error: 'Failed to create invoice', details: error.message });
  }
});

// ─── 2. NOWPayments IPN Webhook Handler ───────────────────────────────────────
app.post('/api/nowpayments-webhook', (req, res) => {
  const ipnSecret = NOWPAYMENTS_IPN_SECRET;
  const receivedSig = req.headers['x-nowpayments-sig'];

  // Verify HMAC signature if secret key is set
  if (ipnSecret && ipnSecret !== 'your-ipn-key-here') {
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
    const sortedBody = JSON.stringify(sortObject(req.body));
    const expectedSig1 = crypto.createHmac('sha256', ipnSecret).update(rawBody).digest('hex');
    const expectedSig2 = crypto.createHmac('sha256', ipnSecret).update(sortedBody).digest('hex');

    if (receivedSig !== expectedSig1 && receivedSig !== expectedSig2) {
      console.warn('Invalid NOWPayments IPN signature received');
      return res.status(401).send('Invalid signature');
    }
  }

  const body = req.body || {};
  console.log('NOWPayments IPN event received:', body);

  const orderId = body.order_id || (body.data && body.data.order_id);
  const status = String(body.payment_status || body.type || '').toUpperCase();
  const paymentAmount = body.actually_paid || body.pay_amount || (body.data && body.data.amount);

  switch (status) {
    case 'PAYMENT_CONFIRMED':
    case 'CONFIRMED':
    case 'FINISHED':
      console.log(`\u2705 Payment confirmed: Order ${orderId} (Amount: ${paymentAmount})`);
      // Update database / trigger order fulfillment here
      break;

    case 'PAYMENT_EXPIRED':
    case 'EXPIRED':
    case 'FAILED':
      console.log(`\u274C Payment expired or failed: Order ${orderId}`);
      break;

    case 'PAYMENT_PARTIALLY_PAID':
    case 'PARTIALLY_PAID':
      console.log(`\u26A0\uFE0F Partial payment received for Order ${orderId}: ${paymentAmount}`);
      break;

    default:
      console.log(`\u23F3 Payment status update for Order ${orderId}: ${status}`);
  }

  res.sendStatus(200);
});

// Fallback for SPA routing to 404.html if not found
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '404.html'));
});

app.listen(PORT, () => {
  console.log(`\uD83D\uDE80 BudgetThrills server running at http://localhost:${PORT}`);
  console.log(`\uD83D\uDCB3 NOWPayments webhook listening at http://localhost:${PORT}/api/nowpayments-webhook`);
});

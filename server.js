// BudgetThrills — standalone Express server (local dev / self-hosting).
// Serves the static site and mounts the same payment + tracking handlers that run as
// Firebase Cloud Functions in production, so there is one implementation of each.
//
// Required env (see .env.example): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
// NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET, GOOGLE_APPLICATION_CREDENTIALS
// (a Firebase service-account JSON so order status can be written to Firestore),
// PUBLIC_BASE_URL (the URL payment providers redirect back to).
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-nowpayments-sig, stripe-signature');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Keep the raw body: Stripe and NOWPayments signatures are computed over it.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

let fns = null;
try {
  fns = require('./functions');
} catch (err) {
  console.warn('Payment handlers unavailable:', err.message);
  console.warn('Run "npm install" inside ./functions and set GOOGLE_APPLICATION_CREDENTIALS to enable /api routes locally.');
}

const mount = (route, name) => {
  app.post(route, (req, res) => {
    if (!fns || typeof fns[name] !== 'function') {
      return res.status(503).json({ error: 'Payment service is not configured on this server.' });
    }
    return fns[name](req, res);
  });
};
mount('/api/create-invoice', 'createInvoice');
mount('/api/nowpayments-webhook', 'nowpaymentsWebhook');
mount('/api/create-checkout-session', 'createCheckoutSession');
mount('/api/stripe-webhook', 'stripeWebhook');
mount('/api/track-order', 'trackOrder');

app.use(express.static(path.join(__dirname, '.')));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, '404.html')));

app.listen(PORT, () => {
  console.log(`BudgetThrills server running at http://localhost:${PORT}`);
  console.log(fns ? 'Payment routes mounted at /api/*' : 'Payment routes disabled (see warning above)');
});

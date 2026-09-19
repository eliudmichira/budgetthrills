/**
 * BudgetThrills — eBay Order Auto-Fulfillment Engine
 * Fetches the real order from Firestore, then places a programmatic
 * checkout session on eBay to fulfill it.
 *
 * Usage:
 *   node scripts/fulfill-order.js <ORDER_ID> [sandbox|production]
 *
 * Prerequisites:
 *   npm install firebase-admin
 *   Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   OR place serviceAccount.json in scripts/serviceAccount.json
 */

const https   = require('https');
const fs      = require('fs');
const path    = require('path');

const CLIENT_ID     = process.env.EBAY_CLIENT_ID     || 'EliudSam-ACTU-PRD-74e965bbe-5e8b161b';
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const ENV           = process.argv[3] || 'production';
if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
  console.error('Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in your environment (see .env.example) before running this script.');
  process.exit(1);
}
const HOST          = ENV === 'sandbox' ? 'api.sandbox.ebay.com' : 'api.ebay.com';
const ORDER_ID      = process.argv[2];

if (!ORDER_ID) {
  console.log('------------------------------------------------------------');
  console.log('⚡ BudgetThrills eBay Auto-Fulfillment Engine');
  console.log('------------------------------------------------------------');
  console.log('Usage: node scripts/fulfill-order.js <ORDER_ID> [production|sandbox]');
  console.log('Example: node scripts/fulfill-order.js BT-84920 production');
  console.log('------------------------------------------------------------');
  process.exit(0);
}

// ─── Firebase Admin Init ─────────────────────────────────────────────────────
let admin;
try {
  admin = require('firebase-admin');
} catch (e) {
  console.error('❌  firebase-admin is not installed. Run: npm install firebase-admin');
  process.exit(1);
}

function initFirebase() {
  if (admin.apps.length) return;

  // Prefer explicit service account file next to this script
  const localKey = path.join(__dirname, 'serviceAccount.json');
  if (fs.existsSync(localKey)) {
    const serviceAccount = require(localKey);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✓ Firebase Admin initialized (serviceAccount.json)');
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    console.log('✓ Firebase Admin initialized (GOOGLE_APPLICATION_CREDENTIALS)');
  } else {
    console.error('❌  No Firebase credentials found.\n' +
      '   Options:\n' +
      '   1. Place scripts/serviceAccount.json (download from Firebase Console → Project Settings → Service Accounts)\n' +
      '   2. Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json');
    process.exit(1);
  }
}

// ─── eBay OAuth ───────────────────────────────────────────────────────────────
function getBuyOAuthToken() {
  return new Promise((resolve, reject) => {
    const auth     = Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64');
    const postData = 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fbuy.order';

    const req = https.request({
      hostname: HOST,
      path: '/identity/v1/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + auth,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) resolve(json.access_token);
          else reject(new Error(json.error_description || JSON.stringify(json)));
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ─── eBay Checkout Session ────────────────────────────────────────────────────
function initiateCheckoutSession(token, order) {
  return new Promise((resolve, reject) => {
    // Parse address string "Street, City, STATE ZIP" or use individual fields
    const addrParts = (order.address || '').split(',').map(s => s.trim());
    const street    = addrParts[0] || '';
    const city      = addrParts[1] || 'San Francisco';
    const stateZip  = (addrParts[2] || 'CA 94105').split(' ');
    const state     = stateZip[0] || 'CA';
    const zip       = stateZip[1] || '94105';

    const payload = JSON.stringify({
      shippingAddress: {
        recipient:       order.customerName || order.customer?.name || 'BudgetThrills Customer',
        addressLine1:    street,
        city:            city,
        stateOrProvince: state,
        postalCode:      zip,
        country:         'US',
        phoneNumber:     (order.phone || order.customer?.phone || '5550192834').replace(/\D/g, '')
      },
      lineItemInputs: (order.items || []).map(item => ({
        itemId:   item.eBayItemId || item.ebayItemId || 'v1|1234567890|0',
        quantity: item.qty || item.quantity || 1
      }))
    });

    const req = https.request({
      hostname: HOST,
      path: '/buy/order/v2/guest_checkout_session/initiate',
      method: 'POST',
      headers: {
        'Authorization':            'Bearer ' + token,
        'X-EBAY-C-MARKETPLACE-ID':  'EBAY_US',
        'Content-Type':             'application/json',
        'Content-Length':           Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function fulfill() {
  console.log('🚀 BudgetThrills Auto-Fulfillment — Order: ' + ORDER_ID);

  // 1. Load real order from Firestore
  initFirebase();
  const db   = admin.firestore();
  console.log('📂 Fetching order from Firestore...');

  const docRef = db.collection('orders').doc(ORDER_ID);
  const snap   = await docRef.get();

  if (!snap.exists) {
    // Also try querying by the 'id' field (if doc ID != order ID)
    const q    = await db.collection('orders').where('id', '==', ORDER_ID).limit(1).get();
    if (q.empty) {
      console.error('❌  Order ' + ORDER_ID + ' not found in Firestore.');
      process.exit(1);
    }
    var order = q.docs[0].data();
    var ref   = q.docs[0].ref;
  } else {
    var order = snap.data();
    var ref   = docRef;
  }

  console.log('✓ Order found: ' + order.id + ' (' + (order.status || 'pending') + ')');
  console.log('  Customer: ' + (order.customerName || order.email));
  console.log('  Items:    ' + (order.items || []).length + ' item(s)');
  console.log('  Address:  ' + (order.address || '—'));

  // 2. Mark as "fulfilling" in Firestore
  await ref.update({ status: 'fulfilling', fulfilledAt: admin.firestore.FieldValue.serverTimestamp() });
  console.log('✓ Status set to "fulfilling" in Firestore');

  // 3. Get eBay OAuth token
  const token = await getBuyOAuthToken();
  console.log('✓ eBay OAuth token acquired');

  // 4. Initiate eBay checkout session
  console.log('📦 Dispatching checkout session to eBay...');
  const result = await initiateCheckoutSession(token, order);

  if (result.checkoutSessionId) {
    console.log('🎉 eBay Checkout Session Created: ' + result.checkoutSessionId);
    console.log('   Status: Ready for payment & auto-shipment');

    // 5. Write session ID back to Firestore
    await ref.update({
      status:            'processing',
      eBaySessionId:     result.checkoutSessionId,
      processingAt:      admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('✓ eBay session ID saved to Firestore order doc');
  } else {
    console.log('ℹ️  eBay response:');
    console.log(JSON.stringify(result, null, 2));
    await ref.update({ status: 'fulfillment-error', eBayResponse: JSON.stringify(result) });
  }
}

fulfill().catch(err => {
  console.error('⚠️  Fulfillment error:', err.message);
  process.exit(1);
});

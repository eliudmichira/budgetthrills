// BudgetThrills — Firestore Seeder via REST API
const API_KEY = "AIzaSyB3KGIZcuAVtDueP-ex5G274Mh8cyNvc8I";
const PROJECT_ID = "budgetthrills";
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function setDocument(collection, docId, fields) {
  const url = `${BASE_URL}/${collection}?documentId=${docId}&key=${API_KEY}`;
  const formattedFields = {};

  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string') {
      formattedFields[key] = { stringValue: val };
    } else if (typeof val === 'number') {
      formattedFields[key] = { doubleValue: val };
    } else if (typeof val === 'boolean') {
      formattedFields[key] = { booleanValue: val };
    } else if (Array.isArray(val)) {
      formattedFields[key] = {
        arrayValue: {
          values: val.map(item => ({
            mapValue: {
              fields: {
                name: { stringValue: item.name || '' },
                price: { doubleValue: Number(item.price) || 0 },
                qty: { integerValue: String(item.qty || 1) }
              }
            }
          }))
        }
      };
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: formattedFields })
  });

  if (!res.ok) {
    // If document already exists, try PATCH
    const patchUrl = `${BASE_URL}/${collection}/${docId}?key=${API_KEY}`;
    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: formattedFields })
    });
    if (!patchRes.ok) {
      const err = await patchRes.text();
      console.error(`Failed to set ${collection}/${docId}:`, err);
      return false;
    }
  }
  console.log(`✅ Seeded ${collection}/${docId}`);
  return true;
}

async function seed() {
  console.log('🌱 Seeding Firestore collections...');

  // 1. Seed Master Admin User
  await setDocument('users', 'ExPolSW2P8UvRYLI4bowoRjCRix1', {
    uid: 'ExPolSW2P8UvRYLI4bowoRjCRix1',
    email: 'eliudsamuel17@gmail.com',
    displayName: 'Store Admin',
    role: 'admin',
    isAdmin: true
  });

  // 2. Seed Test Order BT-95201
  await setDocument('orders', 'BT-95201', {
    id: 'BT-95201',
    customerName: 'mich michira',
    email: 'michmichira@gmail.com',
    phone: '0705893137',
    address: 'sovereign heights, Nairobi 01001',
    total: 55.00,
    subtotal: 55.00,
    shipping: 0.00,
    status: 'processing',
    paymentMethod: 'Credit Card (Stripe ref: OZ53LN5Z)',
    date: 'Aug 26, 2026',
    items: [
      { name: "Men's Shoes Nike Air Max 270 Athletic Ru", price: 55.00, qty: 1 }
    ]
  });

  // 3. Seed Starter Promo Codes
  await setDocument('coupons', 'THRILL10', {
    code: 'THRILL10',
    discount: '10% Off Entire Order',
    active: true
  });

  await setDocument('coupons', 'FREESHIP', {
    code: 'FREESHIP',
    discount: 'Free Express Shipping',
    active: true
  });

  // 4. Seed Welcome Contact Message
  await setDocument('contact-messages', 'MSG-1001', {
    name: 'Sarah Jenkins',
    email: 'sarah.j@example.com',
    topic: 'Shipping Inquiry',
    orderNumber: 'BT-95201',
    message: 'Hello! Just checking on the estimated delivery date for my recent order. Excited to receive it!',
    replied: false
  });

  console.log('🎉 Firestore seeding completed successfully!');
}

seed();

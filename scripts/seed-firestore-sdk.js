// BudgetThrills — Direct Firestore Seeder via Firebase JS SDK
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyB3KGIZcuAVtDueP-ex5G274Mh8cyNvc8I",
  authDomain: "budgetthrills.firebaseapp.com",
  projectId: "budgetthrills",
  storageBucket: "budgetthrills.firebasestorage.app",
  messagingSenderId: "1081492343396",
  appId: "1:1081492343396:web:89ed89bc65220c52762d71",
  measurementId: "G-L5E92YZ8G8"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function seedDatabase() {
  console.log('🌱 Writing seed documents to Firestore...');

  try {
    // 1. Seed Master Admin User (both UIDs / emails)
    await setDoc(doc(db, 'users', 'ExPolSW2P8UvRYLI4bowoRjCRix1'), {
      uid: 'ExPolSW2P8UvRYLI4bowoRjCRix1',
      email: 'eliudsamwels7@gmail.com',
      displayName: 'Store Admin',
      role: 'admin',
      isAdmin: true,
      updatedAt: serverTimestamp()
    }, { merge: true });
    console.log('✅ Seeded users/ExPolSW2P8UvRYLI4bowoRjCRix1');

    // 2. Seed Customer Orders
    await setDoc(doc(db, 'orders', 'BT-89052'), {
      id: 'BT-89052',
      customerName: 'mich michira',
      email: 'michmichira@gmail.com',
      phone: '0705893137',
      address: 'sovereign heights, Nairobi 01001',
      subtotal: 244.00,
      shipping: 0.00,
      discount: 0.00,
      total: 244.00,
      status: 'processing',
      paymentMethod: 'Credit Card (Stripe ref: KW15Q1NR)',
      date: 'Aug 26, 2026',
      items: [
        {
          id: 'apple-iphone-14-mint-128gb-unlocked',
          name: 'Apple iPhone 14 Mint 128GB Unlocked - Mu',
          price: 244.00,
          qty: 1,
          variant: '128GB'
        }
      ],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    console.log('✅ Seeded orders/BT-89052');

    await setDoc(doc(db, 'orders', 'BT-95201'), {
      id: 'BT-95201',
      customerName: 'mich michira',
      email: 'michmichira@gmail.com',
      phone: '0705893137',
      address: 'sovereign heights, Nairobi 01001',
      subtotal: 55.00,
      shipping: 0.00,
      discount: 0.00,
      total: 55.00,
      status: 'processing',
      paymentMethod: 'Credit Card (Stripe ref: OZ53LN5Z)',
      date: 'Aug 26, 2026',
      items: [
        {
          id: 'men-s-shoes-nike-air-max-270-a',
          name: "Men's Shoes Nike Air Max 270 Athletic Ru",
          price: 55.00,
          qty: 1,
          variant: 'Standard Edition · 7'
        }
      ],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    console.log('✅ Seeded orders/BT-95201');

    // 3. Seed Promotional Codes
    await setDoc(doc(db, 'coupons', 'THRILL10'), {
      code: 'THRILL10',
      discount: '10% Off Entire Order',
      active: true,
      createdAt: serverTimestamp()
    }, { merge: true });

    await setDoc(doc(db, 'coupons', 'DROP20'), {
      code: 'DROP20',
      discount: '20% Off Orders Over $100',
      active: true,
      createdAt: serverTimestamp()
    }, { merge: true });
    console.log('✅ Seeded coupons/THRILL10 and DROP20');

    // 4. Seed Inquiries into contact-messages
    await setDoc(doc(db, 'contact-messages', 'MSG-89052'), {
      name: 'mich michira',
      email: 'michmichira@gmail.com',
      topic: 'Order Status',
      orderNumber: 'BT-89052',
      message: 'Hi, confirming delivery schedule for my iPhone order. Thanks!',
      replied: false,
      createdAt: serverTimestamp()
    }, { merge: true });
    console.log('✅ Seeded contact-messages/MSG-89052');

    console.log('🎉 ALL DATA SUCCESSFULLY SEEDED INTO FIRESTORE!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding error:', err);
    process.exit(1);
  }
}

seedDatabase();

// BudgetThrills — Firebase init (ESM via gstatic CDN, no bundler needed)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyB3KGIZcuAVtDueP-ex5G274Mh8cyNvc8I",
  authDomain: "budgetthrills.firebaseapp.com",
  projectId: "budgetthrills",
  storageBucket: "budgetthrills.firebasestorage.app",
  messagingSenderId: "1081492343396",
  appId: "1:1081492343396:web:89ed89bc65220c52762d71",
  measurementId: "G-L5E92YZ8G8"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

let firestoreInstance;
try {
  firestoreInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  }, 'default');
} catch (err) {
  firestoreInstance = getFirestore(app, 'default');
}
export const db = firestoreInstance;
export const googleProvider = new GoogleAuthProvider();

// Persist signed-in state across reloads/tabs.
setPersistence(auth, browserLocalPersistence).catch(console.error);

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

// Use the site's own host as the auth domain when it is served by Firebase Hosting.
// Browsers that block third-party cookies (Safari, Chrome incognito, Brave) break
// signInWithRedirect when the auth domain is a different site from the page, which
// is what made "Continue with Google" silently return to the sign-in page.
// Firebase Hosting serves /__/auth/* on every connected domain, so this is safe.
// Add a custom domain here once it is connected to Firebase Hosting and listed under
// Authentication > Settings > Authorized domains.
const SAME_SITE_AUTH_HOSTS = ['budgetthrills.web.app', 'budgetthrills.firebaseapp.com'];
const authDomain = (typeof location !== 'undefined' && SAME_SITE_AUTH_HOSTS.includes(location.hostname))
  ? location.hostname
  : 'budgetthrills.firebaseapp.com';

const firebaseConfig = {
  apiKey: "AIzaSyB3KGIZcuAVtDueP-ex5G274Mh8cyNvc8I",
  authDomain,
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

// BudgetThrills — auth wiring (included on every page via type="module")
import { auth, db, googleProvider } from './firebase-init.js?v=27';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
  signOut,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  doc, setDoc, getDoc, getDocs, addDoc, deleteDoc, updateDoc,
  collection, query, where, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

/* ===== FIRESTORE ORDER SYNC & PERSISTENCE ===== */
const sanitizeForFirestore = (obj) => {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    clean[k] = v === undefined ? null : sanitizeForFirestore(v);
  }
  return clean;
};

window.BT_SAVE_FIRESTORE_ORDER = async (orderData) => {
  if (!orderData || !orderData.id) return false;
  try {
    const user = auth.currentUser;
    const orderDocRef = doc(db, 'orders', orderData.id);
    
    // Normalize item list
    const items = (orderData.items || []).map(it => ({
      id: it.id || '',
      name: it.name || it.title || 'Product',
      price: Number(it.price) || 0,
      qty: Number(it.qty) || 1,
      variant: it.variant || it.size || 'Standard',
      image: it.image || (it.images && it.images[0]) || ''
    }));

    const payload = {
      id: orderData.id,
      customerName: orderData.customerName || orderData.customer?.name || user?.displayName || 'Customer',
      email: orderData.email || orderData.customer?.email || user?.email || '',
      phone: orderData.phone || orderData.customer?.phone || '',
      address: orderData.address || orderData.customer?.address || '',
      subtotal: Number(orderData.subtotal) || Number(orderData.total) || 0,
      shipping: Number(orderData.shipping) || 0,
      discount: Number(orderData.discount) || 0,
      total: Number(orderData.total) || 0,
      paymentMethod: orderData.paymentMethod || 'Credit Card',
      items: items,
      userId: user ? user.uid : null,
      status: 'pending_payment',
      date: orderData.date || new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    // Create only. Firestore rules deny client updates so a stale local copy can never
    // overwrite a status set by the payment webhook or the admin dashboard.
    await setDoc(orderDocRef, sanitizeForFirestore(payload));
    return true;
  } catch (err) {
    if (err && err.code === 'permission-denied') return true; // already exists
    console.error('Firestore order write error:', err);
    return false;
  }
};

// Automatic backfill of existing localStorage orders to Firestore
const backfillLocalOrders = async () => {
  try {
    const raw = localStorage.getItem('bt-orders-v1');
    if (!raw) return;
    const orders = JSON.parse(raw);
    if (!Array.isArray(orders) || orders.length === 0) return;
    for (const ord of orders) {
      if (ord && ord.id) {
        await window.BT_SAVE_FIRESTORE_ORDER(ord);
      }
    }
  } catch (e) {}
};
backfillLocalOrders();

/* ===== HELPERS ===== */

const errMsg = (e) => {
  const map = {
    'auth/invalid-credential':    'Wrong email or password.',
    'auth/invalid-email':         'That email looks off.',
    'auth/user-not-found':        'No account with that email.',
    'auth/wrong-password':        'Wrong password.',
    'auth/email-already-in-use':  'An account with this email already exists.',
    'auth/weak-password':         'Password must be at least 6 characters.',
    'auth/popup-closed-by-user':  'Sign-in was closed before completing.',
    'auth/cancelled-popup-request': 'Sign-in was cancelled.',
    'auth/popup-blocked':         'Popup blocked by browser. Please allow popups or try again.',
    'auth/network-request-failed':'Network error — check your connection.',
    'auth/operation-not-allowed': 'Sign-in method not enabled in Firebase Console.',
    'auth/unauthorized-domain':   'Domain not authorised in Firebase Console.',
    'auth/too-many-requests':     'Too many attempts. Please wait a moment and try again.',
  };
  return map[e?.code] || e?.message || 'Something went wrong. Try again.';
};

const showError = (formEl, text) => {
  if (!formEl) return;
  let el = formEl.querySelector('[data-auth-error]');
  if (!el) {
    el = document.createElement('div');
    el.dataset.authError = '';
    el.className = 'text-orange text-sm mt-4';
    formEl.appendChild(el);
  }
  el.textContent = text;
};

const clearError = (formEl) => {
  const el = formEl?.querySelector('[data-auth-error]');
  if (el) el.textContent = '';
};

const checkIsAdmin = async (user) => {
  if (!user) return false;
  if (user.uid === 'ExPolSW2P8UvRYLI4bowoRjCRix1' || user.email === 'eliudsamwels7@gmail.com' || user.email === 'eliudsamuel17@gmail.com') return true;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const data = snap.exists() ? snap.data() : {};
    return data.isAdmin === true || data.isAdmin === 'true' || (typeof data.role === 'string' && data.role.toLowerCase() === 'admin');
  } catch (e) {
    return false;
  }
};

const AUTH_PAGES = /^\/(signin|signup|forgot|reset)(\.html)?(\?|$)/;
const goNext = async (user, fallback = '/account.html') => {
  const params = new URLSearchParams(window.location.search);
  const candidates = [params.get('next'), fallback];
  let target = candidates.find(n => n && n.startsWith('/') && !n.startsWith('//') && !AUTH_PAGES.test(n));
  if (!target || target === '/account.html') {
    const isAdmin = await checkIsAdmin(user);
    target = isAdmin ? '/admin.html' : (target || '/account.html');
  }
  window.location.replace(target);
};

const writeUserDoc = async (user, extra = {}) => {
  if (!user || !user.uid) return;
  try {
    await setDoc(doc(db, 'users', user.uid), {
      uid:            user.uid,
      email:          user.email,
      displayName:    user.displayName || extra.displayName || null,
      phone:          extra.phone || null,
      marketingOptIn: extra.marketingOptIn ?? true,
      updatedAt:      serverTimestamp(),
      ...(extra.isNew ? { createdAt: serverTimestamp() } : {})
    }, { merge: true });
  } catch (err) {
    console.warn('Firestore profile sync skipped:', err.message);
  }
};

/* ===== GOOGLE SIGN-IN =====
 * Popup first: it completes on the same page, keeps the `next` target, and does not
 * depend on third-party cookies. Fall back to a full redirect only when the popup is
 * blocked or the environment cannot open one (some in-app browsers). */
const GOOGLE_BTN_HTML = `<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Continue with Google`;
const REDIRECT_FALLBACK_CODES = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'];

const currentNext = () => {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/account.html';
};

const handleGoogleAuth = async (formEl, btnEl) => {
  clearError(formEl);
  const setBusy = (busy, label) => {
    if (!btnEl) return;
    btnEl.disabled = busy;
    btnEl.innerHTML = busy ? `<span class="inline-block animate-pulse">${label}</span>` : GOOGLE_BTN_HTML;
  };
  setBusy(true, 'Opening Google…');
  googleProvider.setCustomParameters({ prompt: 'select_account' });

  try {
    const res = await signInWithPopup(auth, googleProvider);
    setBusy(true, 'Signed in, redirecting…');
    writeUserDoc(res.user, { isNew: true }).catch(console.warn);
    await goNext(res.user, currentNext());
    return;
  } catch (err) {
    if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
      setBusy(false);
      if (formEl) showError(formEl, errMsg(err));
      return;
    }
    if (!REDIRECT_FALLBACK_CODES.includes(err?.code)) {
      console.warn('Google popup sign-in error:', err?.code, err?.message);
      setBusy(false);
      if (formEl) showError(formEl, errMsg(err));
      return;
    }
  }

  // Popup unavailable: full-page redirect. Remember where to land afterwards.
  try {
    setBusy(true, 'Redirecting to Google…');
    sessionStorage.setItem('bt_auth_next', currentNext());
    sessionStorage.setItem('bt_auth_redirect_started', String(Date.now()));
    await signInWithRedirect(auth, googleProvider);
  } catch (err) {
    console.warn('Google redirect sign-in error:', err?.code, err?.message);
    sessionStorage.removeItem('bt_auth_redirect_started');
    setBusy(false);
    if (formEl) showError(formEl, errMsg(err));
  }
};

/* ===== HANDLE REDIRECT RESULT (only used after the popup fallback) ===== */
getRedirectResult(auth).then(async (res) => {
  if (res && res.user) {
    writeUserDoc(res.user, { isNew: true }).catch(console.warn);
    const goTo = sessionStorage.getItem('bt_auth_next') || '/account.html';
    sessionStorage.removeItem('bt_auth_next');
    sessionStorage.removeItem('bt_auth_redirect_started');
    await goNext(res.user, goTo);
    return;
  }
  // We started a redirect but came back without a result: the browser dropped the
  // auth state (third-party cookie blocking) or the domain is not authorised.
  const started = Number(sessionStorage.getItem('bt_auth_redirect_started') || 0);
  if (started && Date.now() - started < 10 * 60 * 1000 && !auth.currentUser) {
    sessionStorage.removeItem('bt_auth_redirect_started');
    const form = document.querySelector('[data-auth-form]');
    if (form) showError(form, 'Google sign-in did not complete. Please allow popups for this site and try again, or sign in with email.');
  }
}).catch((err) => {
  sessionStorage.removeItem('bt_auth_redirect_started');
  if (err.code !== 'auth/no-current-user') {
    console.warn('Redirect result error:', err.code, err.message);
    const form = document.querySelector('[data-auth-form]');
    if (form) showError(form, errMsg(err));
  }
});

/* ===== GLOBAL AUTH STATE — NAV BAR & ROUTE GUARDS ===== */
onAuthStateChanged(auth, async (user) => {
  // Update topbar email display on every page
  document.querySelectorAll('[data-user-email]').forEach(el => {
    el.textContent = user ? `Signed in as ${user.email}` : 'USA · 2026';
  });

  const isAdmin = await checkIsAdmin(user);

  // Update nav Account link on every page
  document.querySelectorAll('a[href="/signin.html"]').forEach(a => {
    if (!a.querySelector('svg')) return;
    if (user) {
      a.href = isAdmin ? '/admin.html' : '/account.html';
      a.setAttribute('aria-label', isAdmin ? 'Admin Hub' : 'Account');
      const label = a.querySelector('span');
      if (label) label.textContent = isAdmin ? 'Admin' : (user.displayName?.split(' ')[0] || 'Account');
    } else {
      a.setAttribute('aria-label', 'Sign in');
      const label = a.querySelector('span');
      if (label) label.textContent = 'Account';
    }
  });

  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const page = document.body?.dataset?.page || '';
  const isAuthPage = ['signin', 'signup'].includes(page) ||
    ['/signin', '/signin.html', '/signup', '/signup.html'].some(p => path === p || path.endsWith(p));
  const isProtectedPage = ['account', 'order-detail'].includes(page) ||
    ['/account', '/account.html', '/order-detail', '/order-detail.html'].some(p => path === p || path.endsWith(p));

  // Signed-in user on signin/signup: send them on (the sign-in handlers redirect too; this
  // covers people who open the page while already logged in).
  if (user && isAuthPage) {
    await goNext(user, currentNext());
    return;
  }

  // ✅ If user is not signed in and visits a protected page, redirect to signin
  if (!user && isProtectedPage) {
    const dest = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace('/signin.html?next=' + dest);
  }
});

/* ===== PAGE: signin.html ===== */
const signinForm = document.querySelector('body[data-page="signin"] [data-auth-form]');
if (signinForm) {
  signinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(signinForm);
    const [email, password] = signinForm.querySelectorAll('input');
    const btn = signinForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const res = await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
      await goNext(res.user, currentNext());
    } catch (err) {
      showError(signinForm, errMsg(err));
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  const googleBtn = document.getElementById('signin-google-btn');
  if (googleBtn) {
    googleBtn.addEventListener('click', () => handleGoogleAuth(signinForm, googleBtn));
  }
}

/* ===== PAGE: signup.html ===== */
const signupForm = document.querySelector('body[data-page="signup"] [data-auth-form]');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(signupForm);
    const inputs = signupForm.querySelectorAll('input');
    const [first, last, email, phone, password] = inputs;
    const marketingOptIn = signupForm.querySelectorAll('input[type="checkbox"]')[1]?.checked ?? true;
    const btn = signupForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Creating account…';
    try {
      const res = await createUserWithEmailAndPassword(auth, email.value.trim(), password.value);
      const displayName = `${first.value.trim()} ${last.value.trim()}`.trim();
      await updateProfile(res.user, { displayName });
      await writeUserDoc(res.user, { displayName, phone: phone.value.trim(), marketingOptIn, isNew: true });
      await goNext(res.user, currentNext());
    } catch (err) {
      showError(signupForm, errMsg(err));
      btn.disabled = false;
      btn.textContent = 'Create account';
    }
  });

  const googleBtn = document.getElementById('signup-google-btn');
  if (googleBtn) {
    googleBtn.addEventListener('click', () => handleGoogleAuth(signupForm, googleBtn));
  }
}

/* ===== PAGE: forgot.html ===== */
const forgotForm = document.querySelector('body[data-page="forgot"] [data-forgot-form]');
if (forgotForm) {
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = forgotForm.querySelector('input').value.trim();
    const btn = forgotForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.style.opacity = .6;
    try {
      await sendPasswordResetEmail(auth, email);
      document.getElementById('step1')?.classList.add('hidden');
      const step2 = document.getElementById('step2');
      if (step2) {
        step2.innerHTML = `
          <div class="display text-[80px] sm:text-[120px] text-lime leading-none">&#9993;</div>
          <h2 class="display text-[36px] sm:text-[48px] mt-6">Check your email<span class="text-lime">.</span></h2>
          <p class="text-mute mt-4 mb-10">We sent a reset link to <span class="text-ink">${email}</span>. Click it to set a new password. The link expires in 1 hour.</p>
          <a href="/signin.html" class="btn-lime">Back to sign in</a>
          <p class="text-xs text-mute mt-6">Didn't get it? Check spam, or <button type="button" id="resend" class="text-ink underline underline-offset-4 hover:text-lime">resend</button>.</p>
        `;
        step2.classList.remove('hidden');
        document.getElementById('resend')?.addEventListener('click', () => sendPasswordResetEmail(auth, email));
      }
    } catch (err) {
      showError(forgotForm, errMsg(err));
      btn.disabled = false; btn.style.opacity = 1;
    }
  });
}

/* ===== PAGE: reset.html ===== */
const resetForm = document.querySelector('body[data-page="reset"] [data-reset-form]');
if (resetForm) {
  const params = new URLSearchParams(location.search);
  const oobCode = params.get('oobCode');
  const stepEl = document.getElementById('reset-step');
  const doneEl = document.getElementById('reset-done');
  const introP = stepEl?.querySelector('p.text-mute');

  if (!oobCode) {
    if (introP) introP.innerHTML = 'This page only opens from the password reset email. <a href="/forgot.html" class="text-ink hover:text-lime underline underline-offset-4">Request a new link &rarr;</a>';
    resetForm.style.display = 'none';
  } else {
    verifyPasswordResetCode(auth, oobCode)
      .then(email => { if (introP) introP.innerHTML = `Reset password for <span class="text-ink">${email}</span>. Pick something strong.`; })
      .catch(err => {
        if (introP) introP.innerHTML = `<span class="text-orange">${errMsg(err)}</span> <a href="/forgot.html" class="text-ink hover:text-lime underline underline-offset-4">Request a new link &rarr;</a>`;
        resetForm.style.display = 'none';
      });

    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw  = document.getElementById('pw')?.value;
      const pw2 = document.getElementById('pw2')?.value;
      const mismatch = document.getElementById('mismatch');
      if (pw !== pw2) { mismatch?.classList.remove('hidden'); return; }
      mismatch?.classList.add('hidden');
      const btn = resetForm.querySelector('button[type="submit"]');
      btn.disabled = true; btn.style.opacity = .6;
      try {
        await confirmPasswordReset(auth, oobCode, pw);
        stepEl?.classList.add('hidden');
        doneEl?.classList.remove('hidden');
      } catch (err) {
        showError(resetForm, errMsg(err));
        btn.disabled = false; btn.style.opacity = 1;
      }
    });
  }
}

/* ===== PAGE: account.html ===== */
const accountBody = document.querySelector('body[data-page="account"]');
if (accountBody) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    // ── Topbar email
    const emailEl = document.querySelector('[data-user-email]');
    if (emailEl) emailEl.textContent = `Signed in as ${user.email}`;

    // ── Greeting
    const first = (user.displayName || '').split(' ')[0] || 'there';
    const greetEl = document.querySelector('[data-greeting]');
    if (greetEl) greetEl.innerHTML = `Hey, ${first}<span class="text-lime">.</span>`;

    // ── Member meta
    const metaEl = document.querySelector('[data-user-meta]');
    if (metaEl && user.metadata?.creationTime) {
      const joined = new Date(user.metadata.creationTime).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      metaEl.textContent = `Member since ${joined}`;
    }

    // ── Profile form
    const profileForm = document.querySelector('[data-panel="profile"] form');
    if (profileForm) {
      const [fn, ln, em, ph] = profileForm.querySelectorAll('input');
      const nameParts = (user.displayName || '').split(' ');
      fn.value = nameParts[0] || '';
      ln.value = nameParts.slice(1).join(' ') || '';
      em.value = user.email || '';

      getDoc(doc(db, 'users', user.uid))
        .then(snap => { if (snap.exists()) ph.value = snap.data().phone || ''; })
        .catch(() => {});

      profileForm.querySelector('button')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const newDisplay = `${fn.value.trim()} ${ln.value.trim()}`.trim();
        const btn = profileForm.querySelector('button');
        btn.disabled = true;
        try {
          await updateProfile(user, { displayName: newDisplay });
          writeUserDoc(user, { displayName: newDisplay, phone: ph.value.trim() });
          btn.textContent = 'Saved ✓';
          setTimeout(() => { btn.textContent = 'Save changes'; btn.disabled = false; }, 1800);
        } catch (err) {
          alert(errMsg(err));
          btn.disabled = false;
        }
      });
    }

    // ── Orders (Firestore with graceful empty fallback)
    const ordersHeading = document.querySelector('[data-orders-heading]');
    const ordersList    = document.querySelector('[data-orders-list]');
    const ordersLoading = document.querySelector('[data-orders-loading]');

    if (ordersList) {
      try {
        const { collection, query, where, orderBy, getDocs } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
        const q = query(
          collection(db, 'orders'),
          where('userId', '==', user.uid),
          orderBy('createdAt', 'desc')
        );
        const snap = await getDocs(q);
        ordersLoading?.remove();

        if (snap.empty) {
          if (ordersHeading) ordersHeading.innerHTML = `No orders yet<span class="text-lime">.</span>`;
          ordersList.innerHTML = `
            <div class="empty-state">
              <div class="empty-icon">📦</div>
              <p>You haven't placed any orders yet.</p>
              <a href="/collection.html" class="btn-lime">Start shopping →</a>
            </div>`;
        } else {
          const count = snap.size;
          if (ordersHeading) ordersHeading.innerHTML = `${count} order${count !== 1 ? 's' : ''}<span class="text-lime">.</span>`;
          snap.forEach(docSnap => {
            const o = docSnap.data();
            const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '—';
            const statusClass = o.status === 'delivered' ? 'lime' : '';
            const statusLabel = o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1) : 'Processing';
            const row = document.createElement('div');
            row.className = 'order-row py-6 hairline-b';
            row.innerHTML = `
              <div class="card-media aspect-square" style="background:var(--bt-surface);display:flex;align-items:center;justify-content:center;font-size:28px;">📦</div>
              <div><div class="font-medium">Order ${o.orderId || docSnap.id.slice(0,8).toUpperCase()}</div><div class="text-mute text-xs mt-1">${o.itemCount || 1} item${(o.itemCount||1) !== 1 ? 's' : ''} &middot; $${Number(o.total||0).toFixed(2)} &middot; ${date}</div></div>
              <div class="hidden sm:block"><span class="badge ${statusClass}">${statusLabel}</span></div>
              <a href="/order-detail.html?id=${docSnap.id}" class="text-xs tracking-[0.2em] uppercase text-mute hover:text-ink whitespace-nowrap">View &rarr;</a>`;
            ordersList.appendChild(row);
          });
        }
      } catch (err) {
        ordersLoading?.remove();
        if (ordersHeading) ordersHeading.innerHTML = `Your orders<span class="text-lime">.</span>`;
        ordersList.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📦</div>
            <p>No orders found.</p>
            <a href="/collection.html" class="btn-lime">Start shopping →</a>
          </div>`;
      }
    }


    // ── Sign out button / link
    document.querySelectorAll('[data-signout-btn], [data-signout]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.textContent = 'Signing out…';
        try {
          await signOut(auth);
        } catch (err) {
          console.warn('SignOut err:', err);
        }
        window.location.replace('/');
      });
    });
  });
}

// Global delegated signout listener for any page
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-signout-btn], [data-signout], #account-signout, #btn-admin-signout');
  if (btn) {
    e.preventDefault();
    e.stopPropagation();
    btn.textContent = 'Signing out…';
    try {
      await signOut(auth);
    } catch (err) {
      console.warn('SignOut err:', err);
    }
    window.location.replace('/');
  }
});

/* ===== ADDRESSES (Firestore: users/{uid}/addresses) ===== */
if (document.querySelector('[data-panel="addresses"]')) {
  const addBtn    = document.getElementById('add-address-btn');
  const formWrap  = document.getElementById('address-form-wrap');
  const formTitle = document.getElementById('address-form-title');
  const addrForm  = document.getElementById('address-form');
  const addrList  = document.getElementById('addresses-list');
  const cancelBtn = document.getElementById('addr-cancel-btn');
  const formErr   = document.getElementById('addr-form-error');

  let _addrUser = null;

  async function fetchDocsSafely(ref, retries = 2) {
    try {
      return await getDocs(ref);
    } catch (e) {
      if (retries > 0) {
        await new Promise(res => setTimeout(res, 800));
        return fetchDocsSafely(ref, retries - 1);
      }
      throw e;
    }
  }

  async function loadAddresses(uid) {
    if (!addrList) return;
    addrList.innerHTML = '<div class="skeleton h-4 w-2/3 mb-4"></div><div class="skeleton h-4 w-1/2 mb-4"></div>';
    try {
      const col = collection(db, 'users', uid, 'addresses');
      const snap = await fetchDocsSafely(col);
      const headingEl = document.querySelector('[data-addresses-heading]');

      if (snap.empty) {
        if (headingEl) headingEl.innerHTML = `Saved addresses<span class="text-lime">.</span>`;
        addrList.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📍</div>
            <p>No saved addresses yet.</p>
            <button type="button" class="btn-lime" id="empty-add-btn">Add your first address</button>
          </div>`;
        document.getElementById('empty-add-btn')?.addEventListener('click', () => showAddrForm());
        return;
      }

      // Sort docs: defaults first, then newest first
      const docs = snap.docs.slice().sort((a, b) => {
        const da = a.data(), db = b.data();
        if (da.isDefault && !db.isDefault) return -1;
        if (!da.isDefault && db.isDefault) return 1;
        const ta = da.createdAt?.toMillis ? da.createdAt.toMillis() : (da.createdAt ? new Date(da.createdAt).getTime() : 0);
        const tb = db.createdAt?.toMillis ? db.createdAt.toMillis() : (db.createdAt ? new Date(db.createdAt).getTime() : 0);
        return tb - ta;
      });

      if (headingEl) {
        headingEl.innerHTML = `${docs.length} saved address${docs.length !== 1 ? 'es' : ''}<span class="text-lime">.</span>`;
      }

      addrList.innerHTML = docs.map(d => renderAddrCard(d.id, d.data())).join('');

      addrList.querySelectorAll('[data-edit-addr]').forEach(b => {
        b.addEventListener('click', () => {
          const docSnap = docs.find(d => d.id === b.dataset.editAddr);
          if (docSnap) showAddrForm(docSnap.id, docSnap.data());
        });
      });

      addrList.querySelectorAll('[data-del-addr]').forEach(b => {
        b.addEventListener('click', () => deleteAddr(uid, b.dataset.delAddr));
      });

      addrList.querySelectorAll('[data-default-addr]').forEach(b => {
        b.addEventListener('click', () => setAddrDefault(uid, b.dataset.defaultAddr, docs));
      });
    } catch (err) {
      console.error('Error loading addresses:', err);
      addrList.innerHTML = `<div class="text-orange text-sm mt-4">Failed to load addresses: ${err.message}</div>`;
    }
  }

  function renderAddrCard(id, d) {
    const defBadge = d.isDefault ? `<span class="badge lime ml-3" style="font-size:9px;vertical-align:middle;">Default</span>` : '';
    return `
      <div class="hairline-t py-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="font-medium flex items-center">${d.firstName || ''} ${d.lastName || ''} ${defBadge}</div>
            <div class="text-mute text-sm mt-2 leading-relaxed">
              ${d.line1 || ''}${d.line2 ? '<br>' + d.line2 : ''}<br>
              ${d.city || ''}, ${d.zip || ''}<br>
              ${d.country || ''}${d.phone ? '<br>' + d.phone : ''}
            </div>
          </div>
          <div class="flex flex-col gap-2 text-xs shrink-0 pt-1">
            <button type="button" class="text-mute hover:text-ink underline underline-offset-4 bg-transparent border-0 cursor-pointer p-0 text-left" data-edit-addr="${id}">Edit</button>
            ${!d.isDefault ? `<button type="button" class="text-mute hover:text-ink underline underline-offset-4 bg-transparent border-0 cursor-pointer p-0 text-left" data-default-addr="${id}">Set default</button>` : ''}
            <button type="button" class="text-mute hover:text-orange underline underline-offset-4 bg-transparent border-0 cursor-pointer p-0 text-left" data-del-addr="${id}">Remove</button>
          </div>
        </div>
      </div>`;
  }

  function showAddrForm(docId = '', data = {}) {
    document.getElementById('addr-doc-id').value  = docId;
    document.getElementById('addr-first').value   = data.firstName || '';
    document.getElementById('addr-last').value    = data.lastName  || '';
    document.getElementById('addr-line1').value   = data.line1     || '';
    document.getElementById('addr-line2').value   = data.line2     || '';
    document.getElementById('addr-city').value    = data.city      || '';
    document.getElementById('addr-zip').value     = data.zip       || '';
    document.getElementById('addr-phone').value   = data.phone     || '';
    document.getElementById('addr-default').checked = !!data.isDefault;
    const c = document.getElementById('addr-country');
    if (data.country) c.value = data.country;
    formTitle.textContent = docId ? 'Edit address' : 'New address';
    formErr.style.display = 'none';
    formWrap.style.display = 'block';
    formWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function hideAddrForm() { 
    formWrap.style.display = 'none'; 
    addrForm.reset(); 
    document.getElementById('addr-doc-id').value = '';
  }

  async function deleteAddr(uid, id) {
    if (!confirm('Remove this address?')) return;
    try {
      await deleteDoc(doc(db, 'users', uid, 'addresses', id));
      loadAddresses(uid);
    } catch (err) {
      alert('Could not remove address: ' + err.message);
    }
  }

  async function setAddrDefault(uid, id, allDocs) {
    try {
      await Promise.all(allDocs.map(d =>
        updateDoc(doc(db, 'users', uid, 'addresses', d.id), { isDefault: d.id === id })
      ));
      loadAddresses(uid);
    } catch (err) {
      alert('Could not update default: ' + err.message);
    }
  }

  addBtn?.addEventListener('click', () => showAddrForm());
  cancelBtn?.addEventListener('click', hideAddrForm);

  addrForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!_addrUser) {
      alert('Please sign in to save an address.');
      return;
    }
    const saveBtn = document.getElementById('addr-save-btn');
    saveBtn.disabled = true; 
    saveBtn.textContent = 'Saving…';
    formErr.style.display = 'none';

    const docId = document.getElementById('addr-doc-id').value;
    let isDefault = document.getElementById('addr-default').checked;
    const data = {
      firstName: document.getElementById('addr-first').value.trim(),
      lastName:  document.getElementById('addr-last').value.trim(),
      line1:     document.getElementById('addr-line1').value.trim(),
      line2:     document.getElementById('addr-line2').value.trim(),
      city:      document.getElementById('addr-city').value.trim(),
      zip:       document.getElementById('addr-zip').value.trim(),
      country:   document.getElementById('addr-country').value,
      phone:     document.getElementById('addr-phone').value.trim(),
      isDefault,
      updatedAt: serverTimestamp()
    };

    try {
      const uid = _addrUser.uid;
      const col = collection(db, 'users', uid, 'addresses');

      const saveOperation = async () => {
        const existing = await fetchDocsSafely(col);

        // If this is the user's first address, make it default automatically
        if (existing.empty && !docId) {
          data.isDefault = true;
          isDefault = true;
        }

        if (isDefault) {
          await Promise.all(existing.docs
            .filter(d => d.id !== docId && d.data().isDefault)
            .map(d => updateDoc(doc(db, 'users', uid, 'addresses', d.id), { isDefault: false }))
          );
        }
        if (docId) {
          await updateDoc(doc(db, 'users', uid, 'addresses', docId), data);
        } else {
          data.createdAt = serverTimestamp();
          await addDoc(col, data);
        }
      };

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Network request timed out. Please retry.')), 10000)
      );

      await Promise.race([saveOperation(), timeout]);

      hideAddrForm();
      loadAddresses(uid);
    } catch (err) {
      console.error('Save address err:', err);
      formErr.textContent = 'Save failed: ' + (err.message || err);
      formErr.style.display = 'block';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save address';
    }
  });

  onAuthStateChanged(auth, (user) => {
    _addrUser = user;
    if (user) loadAddresses(user.uid);
    else addrList.innerHTML = '<div class="text-mute text-sm">Sign in to manage addresses.</div>';
  });
}

/* ===== PREFERENCES (Firestore: users/{uid}.preferences) ===== */
if (document.querySelector('[data-panel="prefs"]')) {
  const savePrefsBtn = document.getElementById('save-prefs-btn');
  let _prefUser = null;

  onAuthStateChanged(auth, async (user) => {
    _prefUser = user;
    if (!user) return;
    try {
      let userSnap;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          userSnap = await getDoc(doc(db, 'users', user.uid));
          break;
        } catch (err) {
          if (attempt === 2) throw err;
          await new Promise(r => setTimeout(r, 800));
        }
      }
      if (userSnap?.exists()) {
        const prefs = userSnap.data()?.preferences || {};
        document.querySelectorAll('[data-pref]').forEach(cb => {
          const key = cb.dataset.pref;
          if (typeof prefs[key] === 'boolean') cb.checked = prefs[key];
        });
      }
    } catch (e) {
      console.warn('Load prefs err:', e);
    }
  });

  savePrefsBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!_prefUser) return;
    savePrefsBtn.disabled = true;
    savePrefsBtn.textContent = 'Saving…';

    const preferences = {};
    document.querySelectorAll('[data-pref]').forEach(cb => {
      preferences[cb.dataset.pref] = cb.checked;
    });

    try {
      await setDoc(doc(db, 'users', _prefUser.uid), {
        preferences,
        updatedAt: serverTimestamp()
      }, { merge: true });
      savePrefsBtn.textContent = 'Saved ✓';
      setTimeout(() => {
        savePrefsBtn.textContent = 'Save preferences';
        savePrefsBtn.disabled = false;
      }, 1800);
    } catch (err) {
      alert('Failed to save preferences: ' + err.message);
      savePrefsBtn.disabled = false;
      savePrefsBtn.textContent = 'Save preferences';
    }
  });
}


/* ===== STORE SETTINGS & COUPONS (managed from /admin.html) ===== */
// Loads settings/store into window.BT_STORE_SETTINGS so cart.js can use live
// shipping thresholds, and exposes a Firestore-backed coupon validator.
window.BT_STORE_SETTINGS = window.BT_STORE_SETTINGS || null;
(async () => {
  try {
    const snap = await getDoc(doc(db, 'settings', 'store'));
    if (snap.exists()) {
      window.BT_STORE_SETTINGS = snap.data();
      window.dispatchEvent(new CustomEvent('bt:settings-loaded', { detail: window.BT_STORE_SETTINGS }));
      const s = window.BT_STORE_SETTINGS;
      if (s.notice) {
        const bar = document.createElement('div');
        bar.setAttribute('data-store-notice', '');
        bar.style.cssText = 'background:#BFFF1A;color:#000;font-size:12px;font-weight:600;text-align:center;padding:8px 16px;letter-spacing:.04em';
        bar.textContent = s.notice;
        document.body.prepend(bar);
      }
      if (typeof s.freeShippingMin === 'number') {
        document.querySelectorAll('[data-free-ship-min]').forEach(el => { el.textContent = '$' + s.freeShippingMin; });
      }
    }
  } catch (err) {
    console.warn('Store settings unavailable, using defaults:', err.message);
  }
})();

window.BT_VALIDATE_COUPON = async (code) => {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  try {
    const snap = await getDoc(doc(db, 'coupons', clean));
    if (!snap.exists()) return null;
    const c = snap.data();
    if (c.active === false) return { error: 'This code is no longer active' };
    const exp = c.expiresAt && c.expiresAt.toDate ? c.expiresAt.toDate() : (c.expiresAt ? new Date(c.expiresAt) : null);
    if (exp && exp < new Date()) return { error: 'This code has expired' };
    return {
      code: clean,
      discountPercent: Number(c.discountPercent) || 0,
      freeShipping: !!c.freeShipping,
      minOrder: Number(c.minOrder) || 0,
      label: c.label || c.discount || (c.freeShipping ? 'Free shipping' : (Number(c.discountPercent) || 0) + '% off')
    };
  } catch (err) {
    console.warn('Coupon lookup failed:', err.message);
    return null;
  }
};

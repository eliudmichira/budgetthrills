/**
 * BudgetThrills — Cart & Commerce Engine
 * Handles persistent cart, promo codes, dynamic checkout & order state.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'bt-cart-v1';
  const PROMO_KEY = 'bt-promo-v1';
  const ORDERS_KEY = 'bt-orders-v1';
  const LAST_ORDER_KEY = 'bt-last-order-v1';

  const DEFAULT_ITEMS = [];

  function getCart() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        return [];
      }
      let items = JSON.parse(raw) || [];
      // Automatically purge any legacy mock demo items from older sessions
      const cleanItems = items.filter(i => {
        if (!i || !i.id) return false;
        if (i.id.startsWith('neon-runner') || i.id.startsWith('pro-buds') || i.id.startsWith('voltmax')) return false;
        if (i.url === '/pdp.html') return false;
        return true;
      });
      if (cleanItems.length !== items.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanItems));
      }
      return cleanItems;
    } catch (e) {
      return [];
    }
  }

  function saveCart(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.error(e);
    }
    updateBadges();
    window.dispatchEvent(new CustomEvent('bt:cart-updated', { detail: { items } }));
  }

  function getPromo() {
    try {
      return JSON.parse(localStorage.getItem(PROMO_KEY)) || null;
    } catch (e) {
      return null;
    }
  }

  const BUILTIN_PROMOS = {
    'THRILL10': { code: 'THRILL10', discountPercent: 10, label: '10% off' },
    'DROP20': { code: 'DROP20', discountPercent: 20, label: '20% off' },
    'FREESHIP': { code: 'FREESHIP', freeShipping: true, label: 'Free shipping' },
    'VIP30': { code: 'VIP30', discountPercent: 30, label: '30% off VIP' }
  };

  function storeSettings() {
    const s = (typeof window !== 'undefined' && window.BT_STORE_SETTINGS) || {};
    return {
      freeShippingMin: typeof s.freeShippingMin === 'number' ? s.freeShippingMin : 50,
      standardShipping: typeof s.standardShipping === 'number' ? s.standardShipping : 4.99,
      expressShipping: typeof s.expressShipping === 'number' ? s.expressShipping : 12.99
    };
  }

  // Synchronous apply: accepts a code (built-in list) or a resolved promo object.
  function applyPromo(codeOrPromo) {
    if (codeOrPromo && typeof codeOrPromo === 'object' && codeOrPromo.code) {
      localStorage.setItem(PROMO_KEY, JSON.stringify(codeOrPromo));
      return { ok: true, promo: codeOrPromo, msg: 'Promo ' + codeOrPromo.code + ' applied!' };
    }
    const clean = (codeOrPromo || '').trim().toUpperCase();
    if (!clean) return { ok: false, msg: 'Enter a promo code' };
    if (BUILTIN_PROMOS[clean]) {
      localStorage.setItem(PROMO_KEY, JSON.stringify(BUILTIN_PROMOS[clean]));
      return { ok: true, promo: BUILTIN_PROMOS[clean], msg: 'Promo ' + clean + ' applied!' };
    }
    return { ok: false, msg: 'Invalid promo code' };
  }

  // Async apply: checks Firestore coupons (managed in admin) first, then built-ins.
  async function applyPromoAsync(code) {
    const clean = (code || '').trim().toUpperCase();
    if (!clean) return { ok: false, msg: 'Enter a promo code' };
    if (typeof window.BT_VALIDATE_COUPON === 'function') {
      const res = await window.BT_VALIDATE_COUPON(clean);
      if (res && res.error) return { ok: false, msg: res.error };
      if (res && res.code) {
        const subtotal = getCart().reduce((sum, i) => sum + (i.price * (i.qty || 1)), 0);
        if (res.minOrder && subtotal < res.minOrder) {
          return { ok: false, msg: 'This code needs a $' + res.minOrder.toFixed(2) + ' minimum order' };
        }
        return applyPromo(res);
      }
    }
    return applyPromo(clean);
  }

  function removePromo() {
    localStorage.removeItem(PROMO_KEY);
  }

  function addToCart(item) {
    const cart = getCart();
    const existing = cart.find(i => i.id === item.id || (i.name === item.name && i.variant === item.variant));
    if (existing) {
      existing.qty += (item.qty || 1);
    } else {
      cart.push({
        id: item.id || 'item-' + Date.now(),
        name: item.name,
        price: parseFloat(item.price) || 0,
        originalPrice: parseFloat(item.originalPrice) || 0,
        img: item.img || 'https://i.ebayimg.com/images/g/Tf4AAeSwEChqcrXi/s-l1600.jpg',
        variant: item.variant || 'Standard',
        qty: item.qty || 1,
        url: item.url || '/pdp.html'
      });
    }
    saveCart(cart);
    showToast('Added ' + item.name + ' to cart!');
  }

  function updateQty(id, qty) {
    let cart = getCart();
    if (qty <= 0) {
      cart = cart.filter(i => i.id !== id);
    } else {
      const item = cart.find(i => i.id === id);
      if (item) item.qty = qty;
    }
    saveCart(cart);
  }

  function removeItem(id) {
    let cart = getCart();
    cart = cart.filter(i => i.id !== id);
    saveCart(cart);
  }

  function clearCart() {
    saveCart([]);
    removePromo();
  }

  function getCartSummary(selectedShipping = 'standard') {
    const items = getCart();
    const count = items.reduce((sum, i) => sum + (i.qty || 1), 0);
    const subtotal = items.reduce((sum, i) => sum + (i.price * (i.qty || 1)), 0);

    const promo = getPromo();
    let discount = 0;
    if (promo && promo.discountPercent) {
      discount = (subtotal * promo.discountPercent) / 100;
    }

    let shipping = 0;
    if (items.length > 0) {
      const cfg = storeSettings();
      if (selectedShipping === 'express') {
        shipping = cfg.expressShipping;
      } else {
        const isFree = subtotal >= cfg.freeShippingMin || (promo && promo.freeShipping);
        shipping = isFree ? 0 : cfg.standardShipping;
      }
    }

    discount = Math.round(discount * 100) / 100;
    const total = Math.round(Math.max(0, subtotal - discount + shipping) * 100) / 100;

    return {
      items,
      count,
      subtotal,
      discount,
      shipping,
      total,
      promo
    };
  }

  function updateBadges() {
    const cart = getCart();
    const totalCount = cart.reduce((s, i) => s + (i.qty || 1), 0);
    document.querySelectorAll('[data-cart-count]').forEach(el => {
      el.textContent = totalCount;
      if (totalCount > 0) {
        el.classList.remove('hidden');
        el.style.display = 'inline-flex';
      } else {
        el.classList.add('hidden');
        el.style.display = 'none';
      }
    });
  }

  function showToast(msg) {
    let toast = document.getElementById('bt-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'bt-toast';
      toast.className = 'fixed bottom-6 right-6 z-50 bg-ink text-bg px-5 py-3 rounded-none text-sm font-medium shadow-2xl flex items-center gap-4 transition-all duration-300 transform translate-y-20 opacity-0';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `
      <span>${msg}</span>
      <a href="/cart.html" class="text-lime font-bold uppercase tracking-wider text-xs underline underline-offset-4">View Cart →</a>
    `;
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-20', 'opacity-0');
      toast.classList.add('translate-y-0', 'opacity-100');
    });
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('translate-y-0', 'opacity-100');
      toast.classList.add('translate-y-20', 'opacity-0');
    }, 3500);
  }

  /* ---------- Page: cart.html ---------- */
  function initCartPage() {
    const container = document.querySelector('[data-cart-lines]');
    if (!container) return;

    function render() {
      const summary = getCartSummary();
      const emptyState = document.querySelector('[data-cart-empty]');
      const mainGrid = document.querySelector('[data-cart-grid]');
      const countLabel = document.querySelector('[data-cart-count-label]');
      if (countLabel) {
        countLabel.textContent = `${summary.count} item${summary.count === 1 ? '' : 's'} · ready to ship`;
      }

      if (summary.items.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        if (mainGrid) mainGrid.classList.add('hidden');
        if (countLabel) countLabel.textContent = '0 items';
        return;
      }

      if (emptyState) emptyState.classList.add('hidden');
      if (mainGrid) mainGrid.classList.remove('hidden');

      container.innerHTML = summary.items.map(item => `
        <div class="cart-line py-8 hairline-b" data-id="${item.id}">
          <a href="${item.url || '/pdp.html'}" class="card-media aspect-square">
            <img src="${item.img}" alt="${item.name}">
          </a>
          <div>
            <a href="${item.url || '/pdp.html'}" class="font-medium hover:text-lime transition">${item.name}</a>
            <div class="text-mute text-xs mt-1">${item.variant || ''}</div>
            <div class="mt-5 flex items-center gap-5">
              <div class="qty">
                <button type="button" data-qty-down>−</button>
                <input type="text" value="${item.qty}" inputmode="numeric" readonly>
                <button type="button" data-qty-up>+</button>
              </div>
              <button type="button" data-remove class="text-[11px] tracking-[0.2em] uppercase text-mute hover:text-orange transition">Remove</button>
            </div>
          </div>
          <div class="text-right">
            <div class="font-semibold" lang="en-US" translate="no">$${(item.price * item.qty).toFixed(2)}</div>
            ${item.originalPrice ? `<div class="text-mute text-xs line-through mt-1" lang="en-US" translate="no">$${(item.originalPrice * item.qty).toFixed(2)}</div>` : ''}
          </div>
        </div>
      `).join('');

      // Subtotal
      const subEl = document.querySelector('[data-cart-subtotal]');
      if (subEl) subEl.textContent = '$' + summary.subtotal.toFixed(2);

      // Discount row
      const discRow = document.querySelector('[data-cart-discount-row]');
      const discEl = document.querySelector('[data-cart-discount]');
      if (summary.discount > 0) {
        if (discRow) discRow.classList.remove('hidden');
        if (discEl) discEl.textContent = '-$' + summary.discount.toFixed(2);
      } else {
        if (discRow) discRow.classList.add('hidden');
      }

      // Shipping
      const shipEl = document.querySelector('[data-cart-ship]');
      if (shipEl) shipEl.textContent = summary.shipping === 0 ? 'Free' : '$' + summary.shipping.toFixed(2);

      // Total
      const totalEl = document.querySelector('[data-cart-total]');
      if (totalEl) totalEl.textContent = '$' + summary.total.toFixed(2);

      // Promo badge
      const promoWrap = document.querySelector('[data-promo-applied]');
      if (promoWrap) {
        if (summary.promo) {
          promoWrap.classList.remove('hidden');
          promoWrap.innerHTML = `
            <div class="flex items-center justify-between text-xs py-2 px-3 bg-lime/10 border border-lime/30 text-lime mt-3">
              <span>Code <strong>${summary.promo.code}</strong> (${summary.promo.label})</span>
              <button type="button" id="bt-remove-promo" class="text-ink hover:text-orange font-bold ml-2">✕</button>
            </div>
          `;
          document.getElementById('bt-remove-promo')?.addEventListener('click', () => {
            removePromo();
            render();
          });
        } else {
          promoWrap.classList.add('hidden');
        }
      }

      // Bind dynamic steppers & removes
      container.querySelectorAll('.cart-line').forEach(line => {
        const id = line.dataset.id;
        const item = summary.items.find(i => i.id === id);
        if (!item) return;

        line.querySelector('[data-qty-down]')?.addEventListener('click', () => {
          updateQty(id, item.qty - 1);
          render();
        });

        line.querySelector('[data-qty-up]')?.addEventListener('click', () => {
          updateQty(id, item.qty + 1);
          render();
        });

        line.querySelector('[data-remove]')?.addEventListener('click', () => {
          removeItem(id);
          render();
        });
      });
    }

    // Promo form submit
    const promoForm = document.querySelector('[data-promo-form]');
    if (promoForm) {
      promoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = promoForm.querySelector('input');
        const out = promoForm.querySelector('[data-promo-msg]') || document.querySelector('[data-promo-msg]');
        if (out) { out.textContent = 'Checking code…'; out.className = 'text-xs text-mute mt-2'; }
        const res = await applyPromoAsync(input.value);
        if (out) {
          out.textContent = res.msg;
          out.className = res.ok ? 'text-xs text-lime mt-2' : 'text-xs text-orange mt-2';
        }
        if (res.ok) {
          input.value = '';
          render();
        }
      });
    }

    render();
    window.addEventListener('bt:cart-updated', render);
    window.addEventListener('bt:settings-loaded', render);
  }

  /* ---------- Page: checkout.html ---------- */
  function initCheckoutPage() {
    const checkoutForm = document.querySelector('[data-checkout]');
    if (!checkoutForm) return;

    let selectedShipping = 'standard';
    document.querySelectorAll('input[name="ship"]').forEach(r => {
      r.addEventListener('change', () => {
        selectedShipping = r.value === 'express' ? 'express' : 'standard';
        renderSummary();
      });
    });

    // Returned from a cancelled payment page
    const params = new URLSearchParams(window.location.search);
    const notice = document.querySelector('[data-checkout-notice]');
    if (notice && /cancel/.test(params.get('status') || '')) {
      notice.textContent = 'Your payment was cancelled. Your cart is still here — you can try again or pick a different payment method.';
      notice.classList.remove('hidden');
      // Restore the cart if it was cleared before redirect
      try {
        const last = JSON.parse(localStorage.getItem(LAST_ORDER_KEY) || 'null');
        if (last && last.items && getCart().length === 0) saveCart(last.items);
      } catch (e) {}
    }

    function renderSummary() {
      const summary = getCartSummary(selectedShipping);
      const cfg = storeSettings();
      const linesWrap = document.querySelector('[data-checkout-lines]');
      if (linesWrap) {
        linesWrap.innerHTML = summary.items.map(item => `
          <div class="cart-line py-4 hairline-b">
            <div class="card-media aspect-square"><img src="${item.img}" alt="${item.name}"></div>
            <div>
              <div class="text-sm font-medium">${item.name}</div>
              <div class="text-mute text-xs mt-1">${item.variant} · ×${item.qty}</div>
            </div>
            <div class="text-sm font-semibold ml-auto" lang="en-US" translate="no">$${(item.price * item.qty).toFixed(2)}</div>
          </div>
        `).join('');
      }

      const setText = (sel, txt) => { const el = document.querySelector(sel); if (el) el.textContent = txt; };
      setText('[data-checkout-subtotal]', '$' + summary.subtotal.toFixed(2));
      setText('[data-checkout-shipping]', summary.shipping === 0 ? 'Free' : '$' + summary.shipping.toFixed(2));
      setText('[data-ship-fee-standard]', '$' + cfg.standardShipping.toFixed(2));
      setText('[data-ship-fee-express]', '$' + cfg.expressShipping.toFixed(2));
      setText('[data-free-ship-min]', '$' + cfg.freeShippingMin);

      const discRow = document.querySelector('[data-checkout-discount-row]');
      const discEl = document.querySelector('[data-checkout-discount]');
      if (summary.discount > 0) {
        if (discRow) discRow.classList.remove('hidden');
        if (discEl) discEl.textContent = '-$' + summary.discount.toFixed(2);
      } else if (discRow) {
        discRow.classList.add('hidden');
      }
      setText('[data-checkout-total]', '$' + summary.total.toFixed(2));
      updatePayButton(summary.total);
    }

    function updatePayButton(total) {
      const payBtn = document.querySelector('[data-pay-button]');
      if (!payBtn) return;
      const isCrypto = checkoutForm.querySelector('input[name="pay"]:checked')?.value === 'crypto';
      payBtn.innerHTML = (isCrypto ? 'Pay with Crypto $' : 'Pay $') + Number(total).toFixed(2) +
        ' <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>';
    }

    renderSummary();
    window.addEventListener('bt:settings-loaded', renderSummary);
    window.addEventListener('bt:cart-updated', renderSummary);
    checkoutForm.querySelectorAll('input[name="pay"]').forEach(r => r.addEventListener('change', () => updatePayButton(getCartSummary(selectedShipping).total)));

    // Empty cart guard
    if (getCart().length === 0) {
      const payBtn = document.querySelector('[data-pay-button]');
      if (payBtn) { payBtn.disabled = true; payBtn.textContent = 'Your cart is empty'; }
    }

    async function postJSON(url, body) {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('Payment service error (' + res.status + ')'));
      return data;
    }

    checkoutForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const summary = getCartSummary(selectedShipping);
      if (summary.items.length === 0) { showToast('Your cart is empty.'); return; }

      const submitBtn = checkoutForm.querySelector('button[type="submit"]');
      const originalBtn = submitBtn ? submitBtn.innerHTML : '';
      const setBusy = (busy) => {
        if (!submitBtn) return;
        submitBtn.disabled = busy;
        submitBtn.style.opacity = busy ? '0.7' : '1';
        if (busy) submitBtn.innerHTML = 'Redirecting to secure payment…'; else submitBtn.innerHTML = originalBtn;
      };
      setBusy(true);

      const f = (name) => (checkoutForm.querySelector('[name="' + name + '"]')?.value || '').trim();
      const email = f('email').toLowerCase();
      const selectedPay = checkoutForm.querySelector('input[name="pay"]:checked')?.value || 'card';
      const orderId = 'BT-' + Date.now().toString(36).toUpperCase().slice(-5) + Math.floor(100 + Math.random() * 900);
      const addressLine = [f('address'), f('city'), f('state'), f('zip')].filter(Boolean).join(', ');

      const orderData = {
        id: orderId,
        date: new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
        timestamp: Date.now(),
        customer: {
          name: `${f('firstName')} ${f('lastName')}`.trim() || 'Customer',
          email: email,
          phone: f('phone'),
          address: addressLine,
          notes: f('notes')
        },
        items: summary.items,
        subtotal: summary.subtotal,
        shipping: summary.shipping,
        shippingMethod: selectedShipping,
        discount: summary.discount,
        promoCode: summary.promo ? summary.promo.code : '',
        total: summary.total,
        paymentMethod: selectedPay === 'crypto' ? 'Crypto (NOWPayments)' : 'Card (Stripe)',
        status: 'pending_payment'
      };

      // Keep a local copy so the confirmation page can render immediately.
      try {
        localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(orderData));
        const orders = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
        orders.unshift(orderData);
        localStorage.setItem(ORDERS_KEY, JSON.stringify(orders.slice(0, 50)));
      } catch (err) { console.error(err); }

      // Create the pending order in Firestore before handing off to the payment provider,
      // so the webhook has a document to mark as paid.
      if (typeof window.BT_SAVE_FIRESTORE_ORDER === 'function') {
        try { await window.BT_SAVE_FIRESTORE_ORDER(orderData); } catch (err) { console.warn('Order save failed:', err); }
      }

      const description = summary.items.map(it => `${it.name}${it.qty > 1 ? ' x' + it.qty : ''}`).join(', ').substring(0, 150) || 'BudgetThrills Order';

      try {
        let redirectUrl;
        if (selectedPay === 'crypto') {
          const data = await postJSON('/api/create-invoice', { orderId, price: summary.total, currency: 'USD', product: description, customerEmail: email });
          redirectUrl = data.checkout_url;
        } else {
          const data = await postJSON('/api/create-checkout-session', {
            orderId,
            customerEmail: email,
            shipping: summary.shipping,
            discount: summary.discount,
            items: summary.items.map(it => ({ name: it.name, price: it.price, qty: it.qty, image: it.img }))
          });
          redirectUrl = data.checkout_url;
        }
        if (!redirectUrl) throw new Error('No checkout URL returned');
        clearCart();
        window.location.href = redirectUrl;
      } catch (err) {
        console.error('[BT] Checkout failed:', err);
        setBusy(false);
        showToast('Could not start payment: ' + err.message);
        if (notice) {
          notice.textContent = 'Could not start payment: ' + err.message + '. Please try again or choose a different payment method.';
          notice.classList.remove('hidden');
          notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });
  }

  /* ---------- Page: order-confirmation.html ---------- */
  function initOrderConfirmationPage() {
    if (document.body?.dataset?.page !== 'order-confirmation') return;
    const params = new URLSearchParams(window.location.search);
    const orderIdParam = params.get('id');
    const raw = localStorage.getItem(LAST_ORDER_KEY);
    let order = null;
    try {
      if (raw) order = JSON.parse(raw);
    } catch(e) {}

    if (!order && orderIdParam) {
      const orders = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
      order = orders.find(o => o.id === orderIdParam) || order;
    }

    if (order && typeof window.BT_SAVE_FIRESTORE_ORDER === 'function') {
      try {
        window.BT_SAVE_FIRESTORE_ORDER(order);
      } catch (e) {}
    }

    if (orderIdParam && (!order || order.id !== orderIdParam)) {
      try {
        const orders = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
        order = orders.find(o => o.id === orderIdParam) || order;
      } catch(e) {}
    }

    if (!order) return;

    const greetingEl = document.querySelector('[data-conf-greeting]');
    if (greetingEl && order.customer?.name) {
      greetingEl.innerHTML = `Thanks, ${order.customer.name.split(' ')[0]}<span class="text-lime">.</span>`;
    }

    const isCrypto = (order.paymentMethod && order.paymentMethod.includes('Crypto')) || params.get('status') === 'crypto_success';
    const isPaid = params.get('status') === 'paid';
    const msgEl = document.querySelector('[data-conf-message]');
    if (msgEl && order.customer?.email) {
      if (isCrypto) {
        msgEl.innerHTML = `Your crypto order <span class="text-ink font-mono">${order.id}</span> has been received! Once confirmed on the blockchain, your tracking dispatch and confirmation will follow to <span class="text-ink">${order.customer.email}</span>.`;
      } else {
        msgEl.innerHTML = isPaid
          ? `Your order <span class="text-ink font-mono">${order.id}</span> is confirmed. We've sent a receipt to <span class="text-ink">${order.customer.email}</span>.`
          : `Your order <span class="text-ink font-mono">${order.id}</span> has been received. You'll get a receipt at <span class="text-ink">${order.customer.email}</span> as soon as payment is confirmed.`;
      }
    }

    const idEl = document.querySelector('[data-conf-id]');
    if (idEl) idEl.textContent = order.id;

    const totalEl = document.querySelector('[data-conf-total]');
    if (totalEl) totalEl.textContent = '$' + Number(order.total || 0).toFixed(2);

    const payEl = document.querySelector('[data-conf-paymethod]');
    if (payEl) payEl.textContent = order.paymentMethod || (isCrypto ? 'Crypto (NOWPayments)' : 'Card (Stripe)');

    const addrEl = document.querySelector('[data-conf-address]');
    if (addrEl && order.customer) {
      addrEl.innerHTML = `
        <div class="font-medium">${order.customer.name || ''}</div>
        <div class="text-mute text-sm mt-1 leading-relaxed">${order.customer.address || ''}<br>${order.customer.phone || ''}</div>
      `;
    }

    const itemsWrap = document.querySelector('[data-conf-items]');
    if (itemsWrap && order.items && order.items.length > 0) {
      itemsWrap.innerHTML = order.items.map(item => `
        <div class="cart-line py-6 hairline-b">
          <div class="card-media aspect-square" style="background:var(--bt-surface);"><img src="${item.img || ''}" alt="${item.name || ''}" style="width:100%;height:100%;object-fit:cover;"></div>
          <div>
            <div class="font-medium">${item.name}</div>
            <div class="text-mute text-xs mt-1">${item.variant || 'Standard'} · ×${item.qty || 1}</div>
          </div>
          <div class="font-semibold ml-auto" lang="en-US" translate="no">$${((item.price || 0) * (item.qty || 1)).toFixed(2)}</div>
        </div>
      `).join('');
    }

    const detailLink = document.querySelector('[data-conf-detail-link]');
    if (detailLink) {
      detailLink.href = `/order-detail.html?id=${order.id}`;
    }
  }

  /* ---------- Page: order-detail.html ---------- */
  function initOrderDetailPage() {
    if (document.body?.dataset?.page !== 'order-detail') return;
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('id');

    let order = null;
    try {
      const orders = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
      if (orderId) {
        order = orders.find(o => o.id === orderId);
      }
      if (!order) {
        const lastRaw = localStorage.getItem(LAST_ORDER_KEY);
        if (lastRaw) {
          const last = JSON.parse(lastRaw);
          if (!orderId || last.id === orderId) order = last;
        }
      }
    } catch(e) {}

    const container = document.getElementById('order-container');
    if (!order) {
      if (container) {
        container.innerHTML = `
          <div class="empty-state max-w-xl mx-auto">
            <div class="empty-icon">📦</div>
            <h2 class="display text-3xl mb-3">Order not found<span class="text-lime">.</span></h2>
            <p class="text-mute text-sm mb-8">We couldn't locate this order. It may have been placed in a different session.</p>
            <div class="flex justify-center gap-4">
              <a href="/account.html" class="btn-lime">View your orders</a>
              <a href="/collection.html" class="btn-ghost">Browse catalog</a>
            </div>
          </div>
        `;
      }
      return;
    }

    document.title = `Order ${order.id} — BudgetThrills`;

    const crumbEl = document.querySelector('[data-order-crumb]');
    if (crumbEl) crumbEl.textContent = order.id;

    const idEl = document.querySelector('[data-order-id]');
    if (idEl) idEl.textContent = order.id;

    const metaEl = document.querySelector('[data-order-meta]');
    if (metaEl) metaEl.textContent = `Placed ${order.date || 'Recently'} · ${order.paymentMethod || 'Paid'}`;

    const statusEl = document.querySelector('[data-order-status]');
    if (statusEl) {
      const status = order.status || 'processing';
      const statusLabels = {
        'pending_payment': 'Awaiting Payment',
        'pending': 'Awaiting Payment',
        'processing': 'Processing',
        'shipped': 'Shipped',
        'delivered': 'Delivered',
        'cancelled': 'Cancelled',
        'refunded': 'Refunded'
      };
      statusEl.textContent = statusLabels[status] || status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
      // Dim the badge for pending payment orders
      if (status === 'pending_payment' || status === 'pending') {
        statusEl.classList.remove('lime');
        statusEl.style.opacity = '0.7';
      }
    }

    const placedTimeEl = document.querySelector('[data-timeline-placed]');
    if (placedTimeEl) placedTimeEl.textContent = order.date || 'Order received';

    const payTimeEl = document.querySelector('[data-timeline-payment]');
    const paymentStep = payTimeEl?.closest('.tl-step');
    const isPaid = order.status && order.status !== 'pending_payment' && order.status !== 'pending';
    if (paymentStep) {
      paymentStep.className = 'tl-step' + (isPaid ? ' done' : '');
    }
    if (payTimeEl) {
      payTimeEl.textContent = isPaid
        ? `${order.date || 'Confirmed'} · ${order.paymentMethod || 'Paid'}`
        : 'Awaiting payment confirmation';
    }

    const itemsWrap = document.querySelector('[data-order-items]');
    if (itemsWrap && order.items && order.items.length > 0) {
      itemsWrap.innerHTML = order.items.map(item => `
        <div class="cart-line py-6 hairline-b">
          <a href="${item.url || '/collection.html'}" class="card-media aspect-square" style="background:var(--bt-surface);"><img loading="lazy" src="${item.img || ''}" alt="${item.name || ''}" style="width:100%;height:100%;object-fit:cover;"></a>
          <div>
            <a href="${item.url || '/collection.html'}" class="font-medium hover:text-lime">${item.name}</a>
            <div class="text-mute text-xs mt-1">${item.variant || 'Standard'} · ×${item.qty || 1}</div>
            <div class="mt-3 flex gap-3 text-xs">
              <a href="${item.url || '/collection.html'}" class="text-mute hover:text-ink underline underline-offset-4">View item</a>
              <a href="/contact.html?topic=order&id=${order.id}" class="text-mute hover:text-ink underline underline-offset-4">Support</a>
            </div>
          </div>
          <div class="font-semibold" lang="en-US" translate="no">$${((item.price || 0) * (item.qty || 1)).toFixed(2)}</div>
        </div>
      `).join('');
    }

    const addrEl = document.querySelector('[data-order-address]');
    if (addrEl && order.customer) {
      addrEl.innerHTML = `
        <div class="font-medium">${order.customer.name || ''}</div>
        <div class="text-mute text-sm mt-1 leading-relaxed">${order.customer.address || ''}<br>${order.customer.phone || ''}</div>
      `;
    }

    const payMethodEl = document.querySelector('[data-order-payment-method]');
    if (payMethodEl) payMethodEl.textContent = order.paymentMethod || 'Credit Card';

    const payRefEl = document.querySelector('[data-order-payment-ref]');
    if (payRefEl) {
      const isPaid2 = order.status && order.status !== 'pending_payment' && order.status !== 'pending';
      payRefEl.textContent = isPaid2 ? ('Ref: ' + order.id) : 'Payment not yet received';
    }

    const subtotalEl = document.querySelector('[data-order-subtotal]');
    if (subtotalEl) subtotalEl.textContent = '$' + Number(order.subtotal || 0).toFixed(2);

    const shipEl = document.querySelector('[data-order-shipping]');
    if (shipEl) shipEl.textContent = (order.shipping === 0 || !order.shipping) ? 'Free' : '$' + Number(order.shipping).toFixed(2);


    const totalEl = document.querySelector('[data-order-total]');
    if (totalEl) totalEl.textContent = '$' + Number(order.total || 0).toFixed(2);

    const helpLink = document.querySelector('[data-help-link]');
    if (helpLink) helpLink.href = `/contact.html?topic=order&id=${order.id}`;
  }

  /* ---------- PDP Dynamic product loading & Add to cart ---------- */
  function initPDP() {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('id');
    const catalog = window.BT_CATALOG || [];
    const prod = productId ? catalog.find(p => p.id === productId) : null;

    if (prod && document.querySelector('[data-gallery]')) {
      document.title = `${prod.name} — BudgetThrills`;

      const breadcrumb = document.querySelector('.eyebrow.mb-8');
      if (breadcrumb) {
        breadcrumb.innerHTML = `<a href="/" class="hover:text-ink">Home</a> · <a href="${prod.categoryUrl}" class="hover:text-ink">${prod.category}</a> · ${prod.name}`;
      }

      const mainImg = document.querySelector('[data-gallery-main] img');
      if (mainImg && prod.images && prod.images[0]) {
        mainImg.src = prod.images[0];
        mainImg.alt = prod.name;
      }

      const thumbsWrap = document.querySelector('[data-gallery] .grid-cols-5');
      if (thumbsWrap && prod.images) {
        thumbsWrap.innerHTML = prod.images.slice(0, 5).map((img, i) =>
          `<button type="button" class="thumb ${i === 0 ? 'active' : ''}"><img src="${img}" alt="" onerror="this.src='https://i.ebayimg.com/images/g/Tf4AAeSwEChqcrXi/s-l1600.jpg'"></button>`
        ).join('');

        // Wire thumbnail clicks immediately
        thumbsWrap.querySelectorAll('.thumb').forEach(t => {
          t.addEventListener('click', () => {
            thumbsWrap.querySelectorAll('.thumb').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            const thumbImg = t.querySelector('img');
            if (mainImg && thumbImg) {
              mainImg.src = thumbImg.src;
            }
          });
        });
      }

      const tagEl = document.querySelector('.lg\\:col-span-4 .eyebrow.mb-3');
      if (tagEl && prod.tag) tagEl.textContent = prod.tag;

      const titleEl = document.querySelector('h1.display');
      if (titleEl) titleEl.innerHTML = `${prod.name}<span class="text-lime">.</span>`;

      const priceWrap = document.querySelector('.mt-5.flex.items-baseline');
      if (priceWrap) {
        priceWrap.innerHTML = `
          <span class="text-2xl font-semibold" lang="en-US" translate="no">$${prod.price.toFixed(2)}</span>
          ${prod.originalPrice ? `<span class="text-mute line-through" lang="en-US" translate="no">$${prod.originalPrice.toFixed(2)}</span>` : ''}
          ${prod.discount ? `<span class="text-lime text-xs tracking-[0.2em] uppercase font-semibold">${prod.discount}</span>` : ''}
        `;
      }

      const descEl = document.querySelector('.lg\\:col-span-4 p.text-mute');
      if (descEl && prod.desc) descEl.textContent = prod.desc;

      const swatchesWrap = document.querySelector('[data-swatches]');
      if (swatchesWrap) {
        const colors = (prod.colors && prod.colors.length > 0) ? prod.colors : [
          { name: 'Standard Edition', hex: '#1C1C1C', active: true },
          { name: 'Slate Grey', hex: '#6E7681', active: false },
          { name: 'Lime Edition', hex: '#BFFF1A', active: false }
        ];
        const colorLabel = document.querySelector('[data-color-label]');
        if (colorLabel) colorLabel.textContent = colors[0].name;

        swatchesWrap.innerHTML = colors.map((c, i) =>
          `<button type="button" class="swatch ${i === 0 ? 'active' : ''}" data-color="${c.name}"><span style="background:${c.hex};"></span></button>`
        ).join('');

        swatchesWrap.querySelectorAll('.swatch').forEach(s => {
          s.addEventListener('click', () => {
            swatchesWrap.querySelectorAll('.swatch').forEach(x => x.classList.remove('active'));
            s.classList.add('active');
            if (colorLabel) colorLabel.textContent = s.dataset.color || '';
          });
        });
      }

      const sizeHeading = document.querySelector('[data-size-heading]');
      const sizeGuideLink = document.querySelector('[data-size-guide-link]');
      const sizesWrap = document.querySelector('[data-sizes]');

      if (sizesWrap) {
        let sizes = ['Standard'];
        if (prod.category === 'Sneakers') {
          if (sizeHeading) sizeHeading.textContent = 'Size · US';
          if (sizeGuideLink) sizeGuideLink.style.display = '';
          sizes = ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12'];
        } else if (prod.category === 'Phones') {
          if (sizeHeading) sizeHeading.textContent = 'Storage Capacity';
          if (sizeGuideLink) sizeGuideLink.style.display = 'none';
          sizes = ['128GB', '256GB', '512GB'];
        } else {
          if (sizeHeading) sizeHeading.textContent = 'Edition / Variant';
          if (sizeGuideLink) sizeGuideLink.style.display = 'none';
          sizes = ['Standard', 'Midnight Edition', 'Pro Matte'];
        }

        sizesWrap.innerHTML = sizes.map((s, i) =>
          `<button type="button" class="size ${i === 0 ? 'active' : ''}">${s}</button>`
        ).join('');

        sizesWrap.querySelectorAll('.size').forEach(b => {
          b.addEventListener('click', () => {
            sizesWrap.querySelectorAll('.size').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
          });
        });
      }

      // Dynamic Specifications & Materials
      const detailsP = document.querySelector('.mt-24 p.text-sm.text-mute');
      if (detailsP && prod.details) detailsP.textContent = prod.details;

      // Dynamic Related Products ("More from this drop")
      const relatedWrap = document.querySelector('[data-related-grid]');
      if (relatedWrap) {
        const related = catalog.filter(p => p.id !== prod.id && p.category === prod.category).slice(0, 4);
        if (related.length > 0) {
          relatedWrap.innerHTML = related.map(item => `
            <a href="/pdp.html?id=${item.id}" class="card group">
              <div class="card-media aspect-[4/5]">
                <img class="img-primary" src="${item.images[0]}" alt="${item.name}" loading="lazy">
                ${item.images[1] ? `<img class="img-hover" src="${item.images[1]}" alt="" loading="lazy">` : ''}
                <span class="card-cta">View →</span>
              </div>
              <div class="pt-5">
                <h3 class="text-sm font-medium group-hover:text-lime transition">${item.name}</h3>
                <div class="text-mute text-xs mt-1">${item.tag || item.category}</div>
                <div class="mt-2 font-semibold" lang="en-US" translate="no">$${item.price.toFixed(2)}</div>
              </div>
            </a>
          `).join('');
        }
      }
    }

    const addBtn = document.querySelector('[data-add-cart]');
    if (!addBtn || addBtn.dataset.cartBound) return;
    addBtn.dataset.cartBound = 'true';

    addBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const title = document.querySelector('h1.display')?.textContent?.replace('.', '').trim() || (prod ? prod.name : 'Neon Runner Low');
      const price = prod ? prod.price : parseFloat(document.querySelector('.text-2xl.font-semibold')?.textContent?.replace('$', '') || '24.99');
      const originalPrice = prod ? prod.originalPrice : parseFloat(document.querySelector('.line-through')?.textContent?.replace('$', '') || '42.99');
      const color = document.querySelector('[data-color-label]')?.textContent || 'Lime / Black';
      const size = document.querySelector('[data-sizes] .size.active')?.textContent || '8';
      const qty = parseInt(document.querySelector('.qty input')?.value, 10) || 1;
      const img = document.querySelector('[data-gallery-main] img')?.src || (prod ? prod.images[0] : 'https://i.ebayimg.com/images/g/Tf4AAeSwEChqcrXi/s-l1600.jpg');

      const item = {
        id: `${(prod ? prod.id : title.toLowerCase().replace(/\s+/g, '-'))}-${color.toLowerCase().replace(/[^a-z0-9]/g, '')}-${size}`,
        name: title,
        price,
        originalPrice,
        variant: `${color} · ${size}`,
        qty,
        img,
        url: window.location.pathname + window.location.search
      };

      addToCart(item);
      addBtn.textContent = 'Added ✓';
      setTimeout(() => addBtn.textContent = 'Add to cart', 1500);
    });
  }

  /* ---------- Page: account.html dynamic orders ---------- */
  function initAccountOrders() {
    const ordersContainer = document.querySelector('[data-panel="orders"] .hairline-t');
    if (!ordersContainer) return;

    try {
      const orders = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
      if (orders.length > 0) {
        const countHeader = document.querySelector('[data-panel="orders"] h2.display');
        if (countHeader) countHeader.innerHTML = `${orders.length} total<span class="text-lime">.</span>`;

        ordersContainer.innerHTML = orders.map(ord => `
          <div class="order-row py-6 hairline-b">
            <div class="card-media aspect-square"><img src="${ord.items[0]?.img || 'https://i.ebayimg.com/images/g/Tf4AAeSwEChqcrXi/s-l1600.jpg'}" alt=""></div>
            <div><div class="font-medium">Order ${ord.id}</div><div class="text-mute text-xs mt-1">${ord.items.length} item${ord.items.length > 1 ? 's' : ''} · $${ord.total.toFixed(2)} · ${ord.date}</div></div>
            <div class="hidden sm:block"><span class="badge lime">Processing</span></div>
            <a href="/order-detail.html?id=${ord.id}" class="text-xs tracking-[0.2em] uppercase text-mute hover:text-ink whitespace-nowrap">View →</a>
          </div>
        `).join('');
      }
    } catch (e) {
      console.error(e);
    }
  }

  /* ---------- Page: order-detail.html dynamic order loading ---------- */
  function initOrderDetailPage() {
    if (document.body?.dataset?.page !== 'order-detail' && !window.location.pathname.includes('order-detail')) return;
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('id');
    const raw = localStorage.getItem(ORDERS_KEY);
    if (!raw) return;

    try {
      const orders = JSON.parse(raw);
      const order = (orderId ? orders.find(o => o.id === orderId) : null) || orders[0];
      if (!order) return;

      const titleEl = document.querySelector('h1.display span.font-mono');
      if (titleEl) titleEl.textContent = order.id;

      const metaDate = document.querySelector('section.hairline-b p.text-mute');
      if (metaDate) metaDate.textContent = `Placed ${order.date} · Paid via ${order.paymentMethod}`;

      const linesWrap = document.querySelector('main .hairline-t.mb-16');
      if (linesWrap && order.items) {
        linesWrap.innerHTML = order.items.map(item => `
          <div class="cart-line py-6 hairline-b">
            <a href="${item.url || '/pdp.html'}" class="card-media aspect-square"><img src="${item.img}" alt="${item.name}"></a>
            <div>
              <a href="${item.url || '/pdp.html'}" class="font-medium hover:text-lime">${item.name}</a>
              <div class="text-mute text-xs mt-1">${item.variant} · ×${item.qty}</div>
              <div class="mt-3 flex gap-3 text-xs">
                <a href="${item.url || '/pdp.html'}" class="text-mute hover:text-ink underline underline-offset-4">Buy again</a>
                <a href="/contact.html" class="text-mute hover:text-ink underline underline-offset-4">Return</a>
              </div>
            </div>
            <div class="font-semibold" lang="en-US" translate="no">$${(item.price * item.qty).toFixed(2)}</div>
          </div>
        `).join('');
      }

      const totalDisplay = document.querySelector('aside .display.text-3xl');
      if (totalDisplay) totalDisplay.textContent = `$${order.total.toFixed(2)}`;

      const subDisplay = document.querySelector('aside .space-y-3 .flex:first-child span:last-child');
      if (subDisplay) subDisplay.textContent = `$${order.subtotal.toFixed(2)}`;

      const shipDisplay = document.querySelector('aside .space-y-3 .flex:nth-child(2) span:last-child');
      if (shipDisplay) shipDisplay.textContent = order.shipping === 0 ? 'Free' : `$${order.shipping.toFixed(2)}`;

      const addressBlock = document.querySelector('main .grid .text-sm.leading-relaxed');
      if (addressBlock && order.customer) {
        addressBlock.innerHTML = `${order.customer.name}<br>${order.customer.address}<br><span class="text-mute">${order.customer.phone}</span>`;
      }
    } catch (e) {
      console.error(e);
    }
  }

  /* ---------- Page: track.html dynamic tracking ---------- */
  function initTrackPage() {
    const trackForm = document.querySelector('[data-track-form]');
    if (!trackForm) return;

    trackForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const inputId = trackForm.querySelector('input[type="text"]')?.value?.trim().toUpperCase();
      const inputEmail = trackForm.querySelector('input[type="email"]')?.value?.trim().toLowerCase();
      
      const orders = JSON.parse(localStorage.getItem(ORDERS_KEY) || localStorage.getItem('bt_orders') || '[]');
      const lastOrder = JSON.parse(localStorage.getItem(LAST_ORDER_KEY) || localStorage.getItem('bt_last_order') || 'null');
      if (lastOrder && !orders.some(o => o.id === lastOrder.id)) {
        orders.unshift(lastOrder);
      }

      const order = orders.find(o => 
        (inputId && o.id && o.id.toUpperCase() === inputId) || 
        (inputEmail && o.customer && o.customer.email && o.customer.email.toLowerCase() === inputEmail)
      );

      const foundContainer = document.querySelector('[data-track-found]');
      const notFoundContainer = document.querySelector('[data-track-not-found]');

      if (order) {
        if (foundContainer) foundContainer.classList.remove('hidden');
        if (notFoundContainer) notFoundContainer.classList.add('hidden');

        const orderIdDisplay = document.querySelector('[data-track-id]');
        if (orderIdDisplay) orderIdDisplay.textContent = order.id;

        const dateEl = document.querySelector('[data-track-date]');
        if (dateEl && order.placedAt) {
          dateEl.textContent = new Date(order.placedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }

        const addrEl = document.querySelector('[data-track-addr]');
        if (addrEl && order.customer) {
          const cust = order.customer;
          addrEl.innerHTML = `${cust.name || (cust.firstName + ' ' + (cust.lastName || ''))}<br>${cust.address || ''}, ${cust.city || ''} ${cust.state || ''} ${cust.zip || ''}`;
        }

        const itemsEl = document.querySelector('[data-track-items]');
        if (itemsEl && order.items && order.items.length > 0) {
          itemsEl.textContent = `${order.items.length} item${order.items.length > 1 ? 's' : ''} · ${order.items.map(i => i.name).join(', ')}`;
        }
      } else {
        if (foundContainer) foundContainer.classList.add('hidden');
        if (notFoundContainer) notFoundContainer.classList.remove('hidden');
      }

      const resultSection = document.getElementById('result-section');
      if (resultSection) {
        resultSection.classList.remove('hidden');
        resultSection.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  /* ---------- Page: contact.html message persistence ---------- */
  function initContactForm() {
    const contactForm = document.querySelector('[data-contact-form]');
    if (!contactForm) return;

    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const inputs = contactForm.querySelectorAll('input, textarea, select');
      const msgObj = {
        name: inputs[0]?.value,
        email: inputs[1]?.value,
        orderId: inputs[2]?.value,
        topic: inputs[3]?.value,
        message: inputs[4]?.value,
        date: new Date().toISOString()
      };

      const msgs = JSON.parse(localStorage.getItem(MESSAGES_KEY) || '[]');
      msgs.unshift(msgObj);
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(msgs));

      const out = contactForm.querySelector('[data-contact-out]');
      if (out) out.textContent = 'Thanks! Your message has been sent. We will reply within ~6 hours.';
      contactForm.reset();
    });
  }

  /* ---------- Catalog Add-to-cart & Wishlist integration ---------- */
  function initCatalogAddButtons() {
    document.querySelectorAll('[data-wl-grid] .wl-card').forEach(card => {
      const btn = card.querySelector('button.mt-4');
      const title = card.querySelector('h3')?.textContent || 'Product';
      const price = parseFloat(card.querySelector('.font-semibold')?.textContent?.replace('$', '') || '24.99');
      const img = card.querySelector('img')?.src || '';
      btn?.addEventListener('click', (e) => {
        e.preventDefault();
        addToCart({
          id: 'wl-' + title.toLowerCase().replace(/\s+/g, '-'),
          name: title,
          price,
          img,
          variant: 'Standard',
          qty: 1,
          url: '/pdp.html'
        });
        btn.textContent = 'Added ✓';
        setTimeout(() => btn.textContent = 'Add to cart', 1500);
      });
    });

    document.querySelectorAll('[data-remove][aria-label="Remove"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const card = btn.closest('.wl-card');
        card?.remove();
        const remaining = document.querySelectorAll('[data-wl-grid] .wl-card').length;
        if (remaining === 0) {
          document.querySelector('[data-wl-empty]')?.classList.remove('hidden');
        }
      });
    });

    document.querySelectorAll('#load-more, .mt-20 button').forEach(btn => {
      if (btn.textContent.includes('Load more')) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          btn.textContent = 'All items loaded ✓';
          btn.disabled = true;
          btn.style.opacity = '0.6';
        });
      }
    });
  }

  /* ---------- Dynamic Category & Featured Grid Renderer ---------- */
  function initCatalogGrids() {
    const catalog = window.BT_CATALOG || [];
    if (catalog.length === 0) return;

    // 1. Category Grids (Sneakers, Phones, Tech, Accessories)
    const categoryContainer = document.querySelector('[data-catalog-category]');
    if (categoryContainer) {
      const category = categoryContainer.dataset.catalogCategory;
      let allCategoryItems = catalog.filter(p => p.category.toLowerCase() === category.toLowerCase());
      if (allCategoryItems.length === 0) allCategoryItems = catalog;

      let activeFilter = 'all';
      let activeSort = 'trending';

      function getFilteredItems() {
        let list = [...allCategoryItems];

        if (activeFilter === 'all') {
          // all items
        } else if (activeFilter === 'sale') {
          list = list.filter(i => i.originalPrice && i.originalPrice > i.price);
        } else if (activeFilter === 'sneakers' || activeFilter === 'shoes') {
          list = list.filter(i => i.category === 'Sneakers');
        } else if (activeFilter === 'phones') {
          list = list.filter(i => i.category === 'Phones');
        } else if (activeFilter === 'tech') {
          list = list.filter(i => i.category === 'Tech');
        } else if (activeFilter === 'accessories') {
          list = list.filter(i => i.category === 'Accessories');
        } else if (activeFilter === 'nike') {
          list = list.filter(i => /nike/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'jordan') {
          list = list.filter(i => /jordan/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'running') {
          list = list.filter(i => /running|runner|trail|pegasus|react/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'vans' || activeFilter === 'casual') {
          list = list.filter(i => /vans|canvas|casual|samba|gazelle|skool|low top/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'iphone' || activeFilter === 'apple') {
          list = list.filter(i => /iphone|apple/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'samsung' || activeFilter === 'galaxy') {
          list = list.filter(i => /samsung|galaxy/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'pixel' || activeFilter === 'google') {
          list = list.filter(i => /pixel|google/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'oneplus') {
          list = list.filter(i => /oneplus/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'headphones' || activeFilter === 'audio') {
          list = list.filter(i => /headphone|sony|beats|over-ear|live/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'earbuds' || activeFilter === 'airpods') {
          list = list.filter(i => /airpods|earbuds|in-ear|tws/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'speakers' || activeFilter === 'speaker') {
          list = list.filter(i => /speaker|jbl|flip|charge|portable/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'power' || activeFilter === 'charging' || activeFilter === 'battery') {
          list = list.filter(i => /power|bank|battery|charger|anker|nano/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'watches' || activeFilter === 'watch') {
          list = list.filter(i => /watch|seiko|citizen|automatic|wrist/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'sunglasses' || activeFilter === 'eyewear') {
          list = list.filter(i => /sunglasses|ray-ban|oakley|polarized|wayfarer|frogskins/i.test(i.name + ' ' + (i.desc || '')));
        } else if (activeFilter === 'wallets' || activeFilter === 'wallet') {
          list = list.filter(i => /wallet|card|leather|rfid|minimalist/i.test(i.name + ' ' + (i.desc || '')));
        } else {
          // Generic keyword match
          const kw = activeFilter.toLowerCase();
          list = list.filter(i => (i.name + ' ' + (i.tag || '') + ' ' + (i.desc || '')).toLowerCase().includes(kw));
        }

        // Apply sort
        if (activeSort === 'price-asc') {
          list.sort((a, b) => a.price - b.price);
        } else if (activeSort === 'price-desc') {
          list.sort((a, b) => b.price - a.price);
        } else if (activeSort === 'discount') {
          list.sort((a, b) => {
            const discA = a.originalPrice ? (a.originalPrice - a.price) : 0;
            const discB = b.originalPrice ? (b.originalPrice - b.price) : 0;
            return discB - discA;
          });
        }

        return list;
      }

      function render() {
        const list = getFilteredItems();
        if (list.length === 0) {
          categoryContainer.innerHTML = `
            <div class="col-span-full py-20 text-center text-mute">
              <div class="text-4xl mb-4">🔍</div>
              <h3 class="text-lg font-medium text-ink mb-2">No items match this filter</h3>
              <p class="text-sm mb-6">Try picking another filter or browse all ${allCategoryItems.length} products.</p>
              <button data-reset-filter class="btn-lime text-xs">Show all products →</button>
            </div>
          `;
          categoryContainer.querySelector('[data-reset-filter]')?.addEventListener('click', () => {
            activeFilter = 'all';
            updateButtonStyles();
            render();
          });
          return;
        }

        categoryContainer.innerHTML = list.map(item => `
          <a href="/pdp.html?id=${item.id}" class="card group">
            <div class="card-media aspect-[4/5]">
              <img class="img-primary" src="${item.images[0]}" alt="${item.name}" loading="lazy">
              ${item.images[1] ? `<img class="img-hover" src="${item.images[1]}" alt="" loading="lazy">` : ''}
              <span class="card-cta">View →</span>
            </div>
            <div class="pt-5">
              <h3 class="text-sm font-medium group-hover:text-lime transition">${item.name}</h3>
              <div class="text-mute text-xs mt-1">${item.tag || item.category}</div>
              <div class="mt-3 flex items-baseline gap-3">
                <span class="font-semibold" lang="en-US" translate="no">$${item.price.toFixed(2)}</span>
                ${item.originalPrice ? `<span class="text-mute text-xs line-through" lang="en-US" translate="no">$${item.originalPrice.toFixed(2)}</span>` : ''}
              </div>
            </div>
          </a>
        `).join('');
      }

      function updateButtonStyles() {
        filterBtns.forEach(b => {
          const key = b.dataset.filter || 'all';
          if (key === activeFilter) {
            b.classList.add('border-lime', 'bg-lime/10', 'text-ink');
            b.classList.remove('text-mute');
          } else {
            b.classList.remove('border-lime', 'bg-lime/10', 'text-ink');
            b.classList.add('text-mute');
          }
        });
      }

      // Filter Buttons (cloned so a re-render after the live catalog loads drops old listeners)
      document.querySelectorAll('.flex.flex-wrap.gap-2 button, section select').forEach(el => el.replaceWith(el.cloneNode(true)));
      const filterBtns = document.querySelectorAll('.flex.flex-wrap.gap-2 button');
      filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const filterKey = btn.dataset.filter || (btn.textContent.toLowerCase().includes('sale') ? 'sale' : btn.textContent.toLowerCase().split(/\s+/)[0]);
          activeFilter = filterKey;
          updateButtonStyles();
          render();
        });
      });

      // Sort select
      const sortSelect = document.querySelector('select');
      if (sortSelect) {
        sortSelect.addEventListener('change', () => {
          if (sortSelect.value.includes('Low → High')) activeSort = 'price-asc';
          else if (sortSelect.value.includes('High → Low')) activeSort = 'price-desc';
          else if (sortSelect.value.includes('arrivals') || sortSelect.value.includes('Deals')) activeSort = 'discount';
          else activeSort = 'trending';
          render();
        });
      }

      // Update filter button count badges dynamically!
      filterBtns.forEach(btn => {
        const filterKey = btn.dataset.filter || (btn.textContent.toLowerCase().includes('sale') ? 'sale' : btn.textContent.toLowerCase().split(/\s+/)[0]);
        const countSpan = btn.querySelector('span');
        if (filterKey === 'all') {
          if (countSpan) countSpan.textContent = allCategoryItems.length;
        } else if (filterKey === 'sale') {
          const saleCount = allCategoryItems.filter(i => i.originalPrice && i.originalPrice > i.price).length;
          if (countSpan) countSpan.textContent = saleCount;
        } else if (filterKey === 'sneakers' || filterKey === 'shoes') {
          if (countSpan) countSpan.textContent = allCategoryItems.filter(i => i.category === 'Sneakers').length;
        } else if (filterKey === 'phones') {
          if (countSpan) countSpan.textContent = allCategoryItems.filter(i => i.category === 'Phones').length;
        } else if (filterKey === 'tech') {
          if (countSpan) countSpan.textContent = allCategoryItems.filter(i => i.category === 'Tech').length;
        } else if (filterKey === 'accessories') {
          if (countSpan) countSpan.textContent = allCategoryItems.filter(i => i.category === 'Accessories').length;
        }
      });

      // Initial active state
      updateButtonStyles();
      render();
    }

    // 1b. "Under $N" grid on the homepage: real catalog items, newest first, no invented savings
    const underGrid = document.querySelector('[data-catalog-under]');
    if (underGrid) {
      const cap = Number(underGrid.dataset.catalogUnder) || 50;
      const picks = catalog.filter(p => p.price <= cap && p.images && p.images[0]).sort((a, b) => (b.firstSeenAt || 0) - (a.firstSeenAt || 0)).slice(0, 4);
      const underSection = underGrid.closest('section');
      if (!picks.length) { if (underSection) underSection.classList.add('hidden'); }
      else { if (underSection) underSection.classList.remove('hidden'); underGrid.innerHTML = picks.map(item => `
          <a href="/pdp.html?id=${item.id}" class="card group">
            <div class="card-media aspect-[4/5]">
              <img class="img-primary" src="${item.images[0]}" alt="${item.name}" loading="lazy">
              ${item.images[1] ? `<img class="img-hover" src="${item.images[1]}" alt="" loading="lazy">` : ''}
              <span class="card-cta">View →</span>
            </div>
            <div class="pt-5">
              <h3 class="text-sm font-medium group-hover:text-lime transition">${item.name}</h3>
              <div class="text-mute text-xs mt-1">${item.category}${item.tag ? ' · ' + item.tag : ''}</div>
              <div class="mt-3 flex items-baseline gap-3"><span class="text-lg font-semibold" lang="en-US" translate="no">$${item.price.toFixed(2)}</span></div>
            </div>
          </a>`).join(''); }
    }

    // 2. Wishlist Grid
    const wlContainer = document.querySelector('[data-wl-grid]');
    if (wlContainer) {
      const wlItems = catalog.slice(0, 6);
      wlContainer.innerHTML = wlItems.map(item => `
        <div class="wl-card" data-id="${item.id}">
          <button class="wl-remove" data-remove aria-label="Remove">✕</button>
          <a href="/pdp.html?id=${item.id}" class="card group block">
            <div class="card-media aspect-[4/5]">
              <img class="img-primary" src="${item.images[0]}" alt="${item.name}" loading="lazy">
              ${item.images[1] ? `<img class="img-hover" src="${item.images[1]}" alt="" loading="lazy">` : ''}
            </div>
            <div class="pt-5">
              <h3 class="text-sm font-medium group-hover:text-lime transition">${item.name}</h3>
              <div class="text-mute text-xs mt-1">${item.tag || item.category}</div>
              <div class="mt-3 flex items-baseline gap-3">
                <span class="font-semibold" lang="en-US" translate="no">$${item.price.toFixed(2)}</span>
                ${item.originalPrice ? `<span class="text-mute text-xs line-through" lang="en-US" translate="no">$${item.originalPrice.toFixed(2)}</span>` : ''}
              </div>
            </div>
          </a>
          <button class="mt-4 w-full px-4 py-3 border hairline text-[11px] tracking-[0.2em] uppercase hover:border-ink hover:text-ink transition" data-wl-add>Add to cart</button>
        </div>
      `).join('');

      wlContainer.querySelectorAll('[data-wl-add]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const card = btn.closest('.wl-card');
          const id = card?.dataset.id;
          const item = catalog.find(p => p.id === id);
          if (item) {
            addToCart({
              id: item.id,
              name: item.name,
              price: item.price,
              originalPrice: item.originalPrice,
              img: item.images[0],
              variant: item.colors ? item.colors[0]?.name : 'Standard',
              qty: 1,
              url: '/pdp.html?id=' + item.id
            });
            btn.textContent = 'Added ✓';
            setTimeout(() => btn.textContent = 'Add to cart', 1500);
          }
        });
      });
    }
  }

  // Expose API on window
  window.BT_CART = {
    getCart,
    saveCart,
    addToCart,
    updateQty,
    removeItem,
    clearCart,
    applyPromo,
    applyPromoAsync,
    removePromo,
    getCartSummary,
    updateBadges
  };

  // Live catalog (scripts/catalog-live.js) replaces BT_CATALOG asynchronously; re-render what depends on it.
  window.addEventListener('bt:catalog-updated', () => {
    try { initPDP(); initCatalogGrids(); } catch (e) { console.warn('catalog re-render:', e); }
  });

  let isInitialized = false;
  function initAll() {
    if (isInitialized) return;
    isInitialized = true;
    updateBadges();
    initPDP();
    initCartPage();
    initCheckoutPage();
    initOrderConfirmationPage();
    initAccountOrders();
    initOrderDetailPage();
    initTrackPage();
    initContactForm();
    initCatalogAddButtons();
    initCatalogGrids();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
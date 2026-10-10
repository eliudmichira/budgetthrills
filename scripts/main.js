/* BudgetThrills — interactions + polish */
(function () {
  'use strict';

  /* ---- Canonical host ----
     budgetthrills.shop is the public address. The Firebase default hosts
     (*.web.app / *.firebaseapp.com) keep serving, but visitors who land
     there are sent to the custom domain so analytics, SEO and shared links
     all point at one place. Localhost and the Firebase auth handler are
     left alone. */
  (function canonicalHost() {
    const h = location.hostname;
    if (h === 'budgetthrills.web.app' || h === 'budgetthrills.firebaseapp.com' || h === 'www.budgetthrills.shop') {
      location.replace('https://budgetthrills.shop' + location.pathname + location.search + location.hash);
    }
  })();

  /* ---- Per-letter scroll reveal ----
     For any element with [data-split="chars"|"words"], split its text content
     into wrapped spans, then fire an animation on intersection. */
  function splitText(el) {
    const mode = el.dataset.split;            // "chars" | "words"
    const stagger = parseFloat(el.dataset.stagger || '0.025'); // seconds per token
    const baseDelay = parseFloat(el.dataset.delay || '0');     // seconds

    // Wrap whole text in a line wrapper so overflow:hidden masks the slide-up
    const original = el.textContent;
    el.textContent = '';

    const wrap = document.createElement('span');
    wrap.className = 'reveal-line';

    if (mode === 'chars') {
      [...original].forEach((ch, i) => {
        const span = document.createElement('span');
        span.className = 'reveal-char';
        span.style.animationDelay = (baseDelay + i * stagger) + 's';
        span.textContent = ch === ' ' ? ' ' : ch;
        wrap.appendChild(span);
      });
    } else {
      const words = original.split(/(\s+)/);
      let i = 0;
      words.forEach(token => {
        if (/^\s+$/.test(token)) {
          wrap.appendChild(document.createTextNode(token));
        } else {
          const span = document.createElement('span');
          span.className = 'reveal-word';
          span.style.animationDelay = (baseDelay + i * stagger) + 's';
          span.textContent = token;
          wrap.appendChild(span);
          i++;
        }
      });
    }

    el.appendChild(wrap);
    return wrap;
  }

  const splits = [];
  document.querySelectorAll('[data-split]').forEach(el => splits.push(splitText(el)));

  /* ---- IntersectionObserver to trigger reveals ----
     Honors prefers-reduced-motion. Has a 1.2s safety net so nothing
     stays hidden if the observer never fires (printing, headless capture,
     odd scroll situations). */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealNodes  = [...splits, ...document.querySelectorAll('[data-reveal]')];

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealNodes.forEach(n => n.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -4% 0px' });
    revealNodes.forEach(n => io.observe(n));

    // Safety net — reveal anything still hidden after 1.2s
    setTimeout(() => revealNodes.forEach(n => n.classList.add('in')), 1200);
  }

  /* ---- Homepage "new arrivals" showcase (replaces the old countdown drop) ----
   * Shows real catalog items, newest first when the live catalog is loaded. No timers,
   * no fake urgency: the item, its real price, and when it was added. */
  const $ = (id) => document.getElementById(id);
  const money = (n) => { const v = Number(n) || 0; const [d, c] = v.toFixed(2).split('.'); return `$${Number(d).toLocaleString('en-US')}<span class="text-mute text-xl align-top">.${c}</span>`; };
  const rel = (ms) => { if (!ms) return ''; const d = Math.floor((Date.now() - ms) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 7 ? d + ' days ago' : d < 30 ? Math.floor(d / 7) + ' week' + (d < 14 ? '' : 's') + ' ago' : 'this season'; };

  function poolFromCatalog() {
    const cat = window.BT_CATALOG || [];
    if (!cat.length) return [];
    const list = cat.filter(p => p.images && p.images[0]);
    if (window.BT_CATALOG_LIVE) list.sort((a, b) => (b.featured === true) - (a.featured === true) || (b.firstSeenAt || 0) - (a.firstSeenAt || 0));
    return list.slice(0, 8).map(p => ({
      pdpId: p.id, title: p.name, desc: p.desc || '', price: p.price, wasPrice: p.originalPrice || null, featured: !!p.featured,
      image: p.images[0], tag: [p.category, p.tag].filter(Boolean).join(' · '), addedAt: p.firstSeenAt || 0
    }));
  }
  function fallbackPool() {
    return (window.BT_DROP_POOL || []).map(d => ({ pdpId: d.pdpId, title: d.title, desc: d.desc, price: d.price, wasPrice: null, image: d.image, tag: d.category || '', addedAt: 0 }));
  }

  let pool = poolFromCatalog();
  if (!pool.length) pool = fallbackPool();
  let activeIndex = 0;
  let autoTimer = null;

  function renderShowcase(index, isTransition = false) {
    const item = pool[index];
    if (!item) return;
    const mediaLink = $('drop-media-link'), ctaLink = $('drop-cta-link'), details = $('drop-details');
    const update = () => {
      const url = `/pdp.html?id=${encodeURIComponent(item.pdpId)}`;
      if (mediaLink) mediaLink.href = url;
      if (ctaLink) ctaLink.href = url;
      const img = $('drop-img'); if (img) { img.src = item.image; img.alt = item.title; }
      const tag = $('drop-tag'); if (tag) tag.textContent = item.tag || 'New arrival';
      const shortTitle = (t) => { t = String(t || '').replace(/[<>]/g, '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim(); if (t.length > 42) { const cut = t.slice(0, 42); t = cut.slice(0, Math.max(20, cut.lastIndexOf(' '))); } return t.replace(/\s*\([^)]*$/, '').replace(/[\s,·\-–—:;/]+$/, ''); };
      const title = $('drop-title'); if (title) { title.innerHTML = `${shortTitle(item.title)}<span class="text-lime">.</span>`; title.title = item.title; }
      const desc = $('drop-desc'); if (desc) desc.textContent = (item.desc || '').slice(0, 140);
      const was = $('drop-was');
      if (was) { if (item.wasPrice && item.wasPrice > item.price) { was.textContent = `Listed at $${Number(item.wasPrice).toFixed(2)}`; was.classList.remove('hidden'); } else { was.classList.add('hidden'); } }
      const price = $('drop-price'); if (price) price.innerHTML = money(item.price);
      const indicator = $('drop-step-indicator'); if (indicator) indicator.textContent = `${index + 1} of ${pool.length}`;
      const eyebrow = $('drop-eyebrow'); if (eyebrow) { const ageDays = item.addedAt ? (Date.now() - item.addedAt) / 864e5 : 99; eyebrow.textContent = ageDays <= 7 ? `Added ${rel(item.addedAt)}` : (item.featured ? 'Featured' : 'Top pick'); }
    };
    if (isTransition && mediaLink) {
      mediaLink.classList.add('opacity-30', 'scale-[0.98]');
      if (details) details.classList.add('opacity-30');
      setTimeout(() => { update(); mediaLink.classList.remove('opacity-30', 'scale-[0.98]'); if (details) details.classList.remove('opacity-30'); }, 200);
    } else {
      update();
    }
  }

  function renderLiveStats() {
    const cat = window.BT_CATALOG || [];
    const count = $('live-count'); if (count) count.textContent = cat.length.toLocaleString('en-US');
    const upd = $('live-updated');
    if (upd) { const t = window.BT_CATALOG_LIVE && window.BT_CATALOG_LIVE.updatedAt; upd.textContent = t ? rel(t.getTime()) : 'today'; }
  }

  function startAuto() {
    clearInterval(autoTimer);
    if (pool.length < 2) return;
    autoTimer = setInterval(() => { activeIndex = (activeIndex + 1) % pool.length; renderShowcase(activeIndex, true); }, 8000);
  }

  if ($('drop-title')) {
    renderShowcase(0);
    renderLiveStats();
    startAuto();
    $('drop-prev-btn')?.addEventListener('click', (e) => { e.preventDefault(); activeIndex = (activeIndex - 1 + pool.length) % pool.length; renderShowcase(activeIndex, true); startAuto(); });
    $('drop-next-btn')?.addEventListener('click', (e) => { e.preventDefault(); activeIndex = (activeIndex + 1) % pool.length; renderShowcase(activeIndex, true); startAuto(); });
    window.addEventListener('bt:catalog-updated', () => { pool = poolFromCatalog(); if (!pool.length) pool = fallbackPool(); activeIndex = 0; renderShowcase(0); renderLiveStats(); startAuto(); });
  }

  /* ---- Qty stepper (static pages only) ---- */
  if (!document.querySelector('[data-cart-lines]')) {
    document.querySelectorAll('.qty').forEach(q => {
      const input = q.querySelector('input');
      q.querySelector('[data-qty-down]')?.addEventListener('click', () => {
        input.value = Math.max(1, (parseInt(input.value, 10) || 1) - 1);
        input.dispatchEvent(new Event('change'));
      });
      q.querySelector('[data-qty-up]')?.addEventListener('click', () => {
        input.value = (parseInt(input.value, 10) || 1) + 1;
        input.dispatchEvent(new Event('change'));
      });
    });
  }

  /* ---- Cart line totals (legacy static template helper) ---- */
  function recalcCart() {
    const lines = document.querySelectorAll('[data-line]');
    if (!lines.length) return;
    const subEl = document.querySelector('[data-cart-subtotal]');
    if (!subEl) return;
    let sub = 0;
    lines.forEach(line => {
      const price = parseFloat(line.dataset.price) || 0;
      const qty = parseInt(line.querySelector('input')?.value, 10) || 1;
      const total = price * qty;
      line.querySelector('[data-line-total]').textContent = '$' + total.toFixed(2);
      sub += total;
    });
    subEl.textContent = '$' + sub.toFixed(2);
    const ship = sub > 50 ? 0 : 4.99;
    const shipEl = document.querySelector('[data-cart-ship]');
    if (shipEl) shipEl.textContent = ship === 0 ? 'Free' : '$' + ship.toFixed(2);
    const totalEl = document.querySelector('[data-cart-total]');
    if (totalEl) totalEl.textContent = '$' + (sub + ship).toFixed(2);
  }
  document.querySelectorAll('[data-line] input').forEach(i => i.addEventListener('change', recalcCart));
  document.querySelectorAll('[data-line-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('[data-line]').remove();
      recalcCart();
    });
  });
  if (document.querySelectorAll('[data-line]').length > 0) {
    recalcCart();
  }

  /* ---- Newsletter ---- */
  const nlForm = document.querySelector('[data-newsletter]');
  if (nlForm) {
    nlForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = nlForm.querySelector('input[type="email"]');
      const btn = nlForm.querySelector('button');
      const out = nlForm.querySelector('[data-nl-out]') || document.querySelector('[data-nl-out]');
      const email = (input && input.value || '').trim();
      if (!email) return;
      if (btn) { btn.disabled = true; btn.textContent = 'Joining…'; }
      try {
        const res = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not save your email right now.');
        if (out) { out.textContent = "You're on the list. New finds land in your inbox first."; out.classList.remove('text-orange'); }
        try { window.dispatchEvent(new CustomEvent('bt:subscribed')); } catch (err2) {}
        if (input) input.value = '';
      } catch (err) {
        if (out) { out.textContent = err.message; out.classList.add('text-orange'); }
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Join →'; }
    });
  }

  /* ---- Theme toggle ---- */
  // Belt-and-braces logo swap: CSS handles it via `content: url()` in evergreen
  // browsers, but we also flip the <img> src directly so older/embedded webviews
  // still get the right wordmark.
  function swapLogos(theme) {
    var darkSrc  = '/brand/logo-dark.svg';
    var lightSrc = '/brand/logo-light.svg';
    var wantSrc  = theme === 'light' ? lightSrc : darkSrc;
    var pattern  = /\/brand\/logo-(dark|light)\.svg(\?.*)?$/;
    document.querySelectorAll('img').forEach(function (img) {
      if (pattern.test(img.getAttribute('src') || '')) img.src = wantSrc;
    });
  }
  // Apply once on load so the initial theme (restored from localStorage in <head>)
  // also gets the right logo.
  swapLogos(document.documentElement.getAttribute('data-theme') || 'dark');

  document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      var next = cur === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('bt-theme', next); } catch (e) {}
      swapLogos(next);
    });
  });

  // Global image error fallback guard to prevent broken image icons
  document.addEventListener('error', function (e) {
    if (e.target && e.target.tagName === 'IMG') {
      e.target.onerror = null;
      var src = e.target.getAttribute('src') || '';
      e.target.style.display = 'none';
    }
  }, true);
})();

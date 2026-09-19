/* BudgetThrills — interactions + polish */
(function () {
  'use strict';

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

  /* ---- Dynamic Drop Rotation Engine & Synchronized Countdown ---- */
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const CIRCUMFERENCE = 2 * Math.PI * 120; // matches SVG r=120
  const ring = $('cd-ring');
  const wrap = document.querySelector('.cd-wrap');

  // 4-hour synchronized drop cycle (6 drops / day across global timezones)
  const CYCLE_MS = 4 * 60 * 60 * 1000;

  function getCurrentCycleIndex(poolLength) {
    if (!poolLength) return 0;
    return Math.floor(Date.now() / CYCLE_MS) % poolLength;
  }

  function getNextTargetTime() {
    const currentCycle = Math.floor(Date.now() / CYCLE_MS);
    return (currentCycle + 1) * CYCLE_MS;
  }

  let dropTarget = getNextTargetTime();
  let totalTime = CYCLE_MS;
  let activeDropIndex = 0;
  let isManualPreview = false;

  const pool = (window.BT_DROP_POOL && window.BT_DROP_POOL.length > 0) ? window.BT_DROP_POOL : [
    {
      pdpId: "sony-playstation-5-ps5-slim-disc",
      category: "Gaming Console",
      tag: "Tonight · Flagship Console",
      title: "Sony PlayStation 5 Slim",
      desc: "1TB Disc Edition with Tempest 3D Audio, ultra-fast SSD and Ray Tracing.",
      price: 429,
      wasPrice: 499,
      image: "https://i.ebayimg.com/images/g/~XsAAeSw9P9qoaia/s-l1600.jpg"
    }
  ];

  activeDropIndex = getCurrentCycleIndex(pool.length);

  function renderDropItem(index, isTransition = false) {
    const item = pool[index];
    if (!item) return;

    const mediaLink = $('drop-media-link');
    const ctaLink = $('drop-cta-link');
    const details = $('drop-details');
    const img = $('drop-img');
    const tag = $('drop-tag');
    const title = $('drop-title');
    const desc = $('drop-desc');
    const wasPrice = $('drop-was');
    const price = $('drop-price');
    const badge = $('drop-badge-pill');
    const indicator = $('drop-step-indicator');
    const nextPreview = $('drop-next-preview');
    const eyebrow = $('drop-eyebrow');

    const updateDOM = () => {
      const pdpUrl = `/pdp.html?id=${item.pdpId}`;
      if (mediaLink) mediaLink.href = pdpUrl;
      if (ctaLink) ctaLink.href = pdpUrl;
      if (img) {
        img.src = item.image;
        img.alt = item.title;
      }
      if (tag) tag.textContent = item.tag || `${item.category} Drop`;
      if (title) title.innerHTML = `${item.title}<span class="text-lime">.</span>`;
      if (desc) desc.textContent = item.desc;
      if (wasPrice) wasPrice.textContent = `Was $${Number(item.wasPrice).toFixed(2)}`;
      if (price) price.innerHTML = `$${item.price}<span class="text-mute text-xl align-top">.00</span>`;
      if (badge) badge.textContent = 'View Deal →';
      if (indicator) indicator.textContent = `Drop ${index + 1} of ${pool.length}`;

      const nextItem = pool[(index + 1) % pool.length];
      if (nextPreview && nextItem) {
        nextPreview.textContent = `Next drop: ${nextItem.title} ($${nextItem.price})`;
      }

      if (eyebrow) {
        if (isManualPreview && index !== getCurrentCycleIndex(pool.length)) {
          eyebrow.innerHTML = `<span class="text-lime">Preview</span> · Upcoming Drop`;
        } else {
          eyebrow.textContent = `Ends Tonight`;
        }
      }
    };

    if (isTransition && mediaLink) {
      mediaLink.classList.add('opacity-30', 'scale-[0.98]');
      if (details) details.classList.add('opacity-30');
      setTimeout(() => {
        updateDOM();
        mediaLink.classList.remove('opacity-30', 'scale-[0.98]');
        if (details) details.classList.remove('opacity-30');
      }, 200);
    } else {
      updateDOM();
    }
  }

  // Initial render
  renderDropItem(activeDropIndex);

  // Manual Next/Prev Drop Preview navigation
  $('drop-prev-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    isManualPreview = true;
    activeDropIndex = (activeDropIndex - 1 + pool.length) % pool.length;
    renderDropItem(activeDropIndex, true);
  });

  $('drop-next-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    isManualPreview = true;
    activeDropIndex = (activeDropIndex + 1) % pool.length;
    renderDropItem(activeDropIndex, true);
  });

  // Interpolate colour: lime → orange → red as progress drops
  function ringColor(progress) {
    if (progress > 0.25) {
      const t = 1 - (progress - 0.25) / 0.75;
      const r = Math.round(191 + (255 - 191) * t);
      const g = Math.round(255 + (107 - 255) * t);
      const b = Math.round(26 + (44 - 26) * t);
      return `rgb(${r},${g},${b})`;
    } else if (progress > 0.05) {
      const t = 1 - (progress - 0.05) / 0.20;
      const r = Math.round(255);
      const g = Math.round(107 + (60 - 107) * t);
      const b = Math.round(44 + (60 - 44) * t);
      return `rgb(${r},${g},${b})`;
    }
    return 'rgb(255,60,60)';
  }

  function tick() {
    const now = Date.now();
    let diff = dropTarget - now;

    // Transition triggered when countdown expires
    if (diff <= 0) {
      // 1. Advance to next drop target
      dropTarget = getNextTargetTime();
      diff = Math.max(0, dropTarget - Date.now());

      // 2. Advance active item in drop pool
      activeDropIndex = getCurrentCycleIndex(pool.length);
      isManualPreview = false;
      renderDropItem(activeDropIndex, true);

      // 3. Ring flash effect
      if (ring) {
        ring.style.stroke = '#BFFF1A';
        ring.style.filter = 'drop-shadow(0 0 16px #BFFF1A)';
        setTimeout(() => {
          if (ring) ring.style.filter = '';
        }, 1200);
      }
    }

    const h = Math.floor(diff / 3.6e6);
    const m = Math.floor((diff % 3.6e6) / 6e4);
    const s = Math.floor((diff % 6e4) / 1e3);
    if ($('cd-h')) $('cd-h').textContent = pad(h);
    if ($('cd-m')) $('cd-m').textContent = pad(m);
    if ($('cd-s')) $('cd-s').textContent = pad(s);

    if (ring && wrap) {
      const progress = totalTime > 0 ? Math.min(1, Math.max(0, diff / totalTime)) : 0;
      ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);
      ring.style.stroke = ringColor(progress);

      // Urgency classes
      wrap.classList.toggle('urgent', progress <= 0.25 && progress > 0.05);
      wrap.classList.toggle('critical', progress <= 0.05);
    }
  }

  setInterval(tick, 1000); 
  tick();

  /* ---- Mobile nav toggle ---- */
  const navBtn = document.querySelector('[data-nav-toggle]');
  const navMenu = document.querySelector('[data-nav-menu]');
  if (navBtn && navMenu) {
    navBtn.addEventListener('click', () => navMenu.classList.toggle('hidden'));
  }

  /* ---- Cart count & cart management are handled by scripts/cart.js ---- */

  /* ---- PDP: thumb / swatch / size ---- */
  document.querySelectorAll('[data-gallery]').forEach(gallery => {
    const main = gallery.querySelector('[data-gallery-main] img');
    gallery.querySelectorAll('.thumb').forEach(t => {
      t.addEventListener('click', () => {
        gallery.querySelectorAll('.thumb').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        if (main) main.src = t.querySelector('img').src;
      });
    });
  });
  document.querySelectorAll('[data-swatches]').forEach(group => {
    group.querySelectorAll('.swatch').forEach(s => {
      s.addEventListener('click', () => {
        group.querySelectorAll('.swatch').forEach(x => x.classList.remove('active'));
        s.classList.add('active');
        const label = document.querySelector('[data-color-label]');
        if (label) label.textContent = s.dataset.color || '';
      });
    });
  });
  document.querySelectorAll('[data-sizes]').forEach(group => {
    group.querySelectorAll('.size').forEach(b => {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        group.querySelectorAll('.size').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      });
    });
  });

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
    nlForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = nlForm.querySelector('[data-nl-out]') || document.querySelector('[data-nl-out]');
      if (out) out.textContent = "You're in. Check your inbox for the drop.";
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

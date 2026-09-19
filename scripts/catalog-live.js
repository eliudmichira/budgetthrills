// BudgetThrills — live catalog loader
// Replaces the static window.BT_CATALOG (scripts/products.js) with the compiled
// catalog/live document that the eBay sync publishes. One Firestore read per visit,
// served from the persistent cache on repeat visits. Falls back to the static file
// if the document is missing or empty.
import { db } from './firebase-init.js?v=27';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

(async () => {
  try {
    const snap = await getDoc(doc(db, 'catalog', 'live'));
    if (!snap.exists()) return;
    const data = snap.data();
    const products = Array.isArray(data.products) ? data.products.filter(p => p && p.id && p.images && p.images.length) : [];
    if (!products.length) return;
    window.BT_CATALOG_STATIC = window.BT_CATALOG || [];
    window.BT_CATALOG = products;
    window.BT_CATALOG_LIVE = { count: products.length, updatedAt: data.updatedAt && data.updatedAt.toDate ? data.updatedAt.toDate() : null };
    renderFeatured(products);
    window.dispatchEvent(new CustomEvent('bt:catalog-updated', { detail: { products } }));
  } catch (err) {
    console.warn('Live catalog unavailable, using static catalog:', err.message);
  }
})();

function card(item) {
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<a href="/pdp.html?id=${esc(item.id)}" class="card group">
    <div class="card-media aspect-[4/5]">
      <img class="img-primary" src="${esc(item.images[0])}" alt="${esc(item.name)}" loading="lazy">
      ${item.images[1] ? `<img class="img-hover" src="${esc(item.images[1])}" alt="" loading="lazy">` : ''}
      <span class="card-cta">View →</span>
    </div>
    <div class="pt-5">
      <h3 class="text-sm font-medium group-hover:text-lime transition">${esc(item.name)}</h3>
      <div class="text-mute text-xs mt-1">${esc(item.tag || item.category)}</div>
      <div class="mt-3 flex items-baseline gap-3">
        <span class="font-semibold" lang="en-US" translate="no">$${Number(item.price).toFixed(2)}</span>
        ${item.originalPrice ? `<span class="text-mute text-xs line-through" lang="en-US" translate="no">$${Number(item.originalPrice).toFixed(2)}</span>` : ''}
      </div>
    </div>
  </a>`;
}

// Homepage featured grid: featured items first, then the newest arrivals.
function renderFeatured(products) {
  const grid = document.querySelector('[data-catalog-featured]');
  if (!grid) return;
  const count = grid.querySelectorAll('a.card').length || 8;
  const list = products.slice().sort((a, b) => (b.featured === true) - (a.featured === true) || (b.firstSeenAt || 0) - (a.firstSeenAt || 0)).slice(0, count);
  if (list.length) grid.innerHTML = list.map(card).join('');
}

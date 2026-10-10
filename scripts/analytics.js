// BudgetThrills — analytics (GA4 through the Firebase measurement id)
// Loads gtag only when an id is set and the visitor has not opted out
// (localStorage 'bt-analytics' = 'off'). Sends the e-commerce events that matter:
// view_item, add_to_cart, begin_checkout, purchase, search, sign_up.
(function () {
  var GA_ID = 'G-L5E92YZ8G8';
  var LAST_ORDER_KEY = 'bt-last-order-v1';
  try { if (localStorage.getItem('bt-analytics') === 'off') return; } catch (e) {}
  if (!GA_ID || /^localhost$|^127\./.test(location.hostname)) { window.BT_TRACK = function () {}; return; }

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID; document.head.appendChild(s);
  gtag('js', new Date());
  gtag('config', GA_ID, { send_page_view: true, anonymize_ip: true });

  var item = function (p, qty) { return { item_id: p.id, item_name: p.name, item_category: p.category, price: Number(p.price) || 0, quantity: qty || 1 }; };
  var track = window.BT_TRACK = function (name, params) { try { gtag('event', name, params || {}); } catch (e) {} };

  // view_item on product pages (after the catalog has resolved the product)
  function viewItem() {
    var id = new URLSearchParams(location.search).get('id'); if (!id || !window.BT_CATALOG) return;
    var p = window.BT_CATALOG.find(function (x) { return x.id === id; }); if (!p || viewItem.sent === id) return;
    viewItem.sent = id; track('view_item', { currency: 'USD', value: Number(p.price) || 0, items: [item(p)] });
  }
  if (location.pathname.indexOf('pdp') >= 0) { setTimeout(viewItem, 800); window.addEventListener('bt:catalog-updated', viewItem); }

  window.addEventListener('bt:add-to-cart', function (e) { var it = e.detail || {}; track('add_to_cart', { currency: 'USD', value: (Number(it.price) || 0) * (it.qty || 1), items: [item({ id: it.id, name: it.name, category: it.category, price: it.price }, it.qty)] }); });
  window.addEventListener('bt:subscribed', function () { track('sign_up', { method: 'newsletter' }); });

  if (location.pathname.indexOf('checkout') >= 0) {
    setTimeout(function () {
      var cart = window.BT_CART && window.BT_CART.getCart ? window.BT_CART.getCart() : [];
      if (cart.length) track('begin_checkout', { currency: 'USD', value: cart.reduce(function (s, i) { return s + i.price * (i.qty || 1); }, 0), items: cart.map(function (i) { return item({ id: i.id, name: i.name, price: i.price }, i.qty); }) });
    }, 600);
  }

  if (location.pathname.indexOf('order-confirmation') >= 0 && new URLSearchParams(location.search).get('status') === 'paid') {
    try {
      var order = JSON.parse(localStorage.getItem(LAST_ORDER_KEY) || 'null');
      var id = new URLSearchParams(location.search).get('id');
      if (order && order.id === id && localStorage.getItem('bt-ga-purchase-' + id) !== '1') {
        localStorage.setItem('bt-ga-purchase-' + id, '1');
        track('purchase', { transaction_id: id, currency: 'USD', value: Number(order.total) || 0, shipping: Number(order.shipping) || 0, coupon: order.promoCode || undefined, items: (order.items || []).map(function (i) { return item({ id: i.id, name: i.name, price: i.price }, i.qty); }) });
      }
    } catch (e) {}
  }

  var q = document.getElementById('q');
  if (q) { var t; q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { if (q.value.trim().length > 2) track('search', { search_term: q.value.trim().slice(0, 100) }); }, 900); }); }
})();

const test = require('node:test');
const assert = require('node:assert/strict');
const src = require('fs').readFileSync(__dirname + '/../functions/index.js', 'utf8');
const build = new Function(src.slice(src.indexOf('function buildStripeLineItems'), src.indexOf('exports.createCheckoutSession')) + '; return buildStripeLineItems;')();

test('line items always sum to the order total', () => {
  const orders = [
    { items: [{ name: 'A', price: 389, qty: 1 }, { name: 'B', price: 12.5, qty: 2 }], shipping: 4.99, discount: 0, total: 418.99 },
    { items: [{ name: 'A', price: 389, qty: 1 }], shipping: 12.99, discount: 38.9, total: 363.09 },
    { items: [{ name: 'A', price: 389, qty: 1 }, { name: 'B', price: 12.5, qty: 3 }, { name: 'C', price: 33.33, qty: 1 }], shipping: 0, discount: 45.98, total: 413.85 },
    { items: [{ name: 'A', price: 19.99, qty: 3 }, { name: 'B', price: 0.01, qty: 1 }], shipping: 4.99, discount: 5.99, total: 58.98 },
    { items: [{ name: 'A', price: 10, qty: 1 }], shipping: 4.99, discount: 50, total: 4.99 }
  ];
  for (const o of orders) assert.equal(build(o).totalCents, Math.round(o.total * 100), JSON.stringify(o));
});

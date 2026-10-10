const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../functions/catalog-sync.js');
const settings = { ...sync.DEFAULT_SETTINGS, targetMargin: 0.25, priceCeiling: 200, priceFloor: 40, priceEnding: 99 };

test('sale price leaves the target margin after fees', () => {
  for (const landed of [30, 60, 100, 140]) {
    const sale = sync.priceFor(landed, settings);
    assert.ok(Math.abs(sale - Math.floor(sale)) > 0.98, `ends in .99: ${sale}`);
    assert.ok(sync.marginAt(sale, landed) >= 0.25, `margin at ${landed}: ${sync.marginAt(sale, landed)}`);
  }
});

const item = (over = {}) => ({ itemId: 'v1|1|0', title: 'DeWalt DCD771 20V Drill Tool Only', price: { value: '79.99', currency: 'USD' }, conditionId: '1000', buyingOptions: ['FIXED_PRICE'], itemLocation: { country: 'US' }, seller: { feedbackPercentage: '99.6', feedbackScore: '2450' }, shippingOptions: [{ shippingCostType: 'FIXED', shippingCost: { value: '0.00' } }], topRatedBuyingExperience: true, ...over });

test('evaluate accepts a clean listing and rejects risky ones', () => {
  assert.equal(sync.evaluate(item(), settings, { name: 'Tools' }, 'dewalt 20v tool only').ok, true);
  assert.ok(sync.evaluate(item({ price: { value: '170', currency: 'USD' } }), settings, { name: 'Tools' }).reasons.some((r) => r.startsWith('over ceiling')));
  assert.ok(sync.evaluate(item({ conditionId: '3000' }), settings, { name: 'Tools' }).reasons.some((r) => r.startsWith('condition')));
  assert.ok(sync.evaluate(item({ seller: { feedbackPercentage: '97', feedbackScore: '20' } }), settings, { name: 'Tools' }).reasons.length >= 2);
});

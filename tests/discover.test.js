const sync = require('../functions/catalog-sync.js');
const DAY = 864e5;
function fakeDb(products, settingsDoc) {
  const writes = [], retired = [];
  const docs = products.map((p, i) => ({ id: p.id, data: () => p, ref: { id: p.id } }));
  return {
    writes, retired,
    collection: (name) => ({
      where: () => ({ get: async () => ({ forEach: (fn) => docs.filter(d => d.data().active).forEach(fn), docs }) }),
      doc: (id) => ({ get: async () => ({ exists: !!(name === 'settings' && settingsDoc), data: () => settingsDoc }), set: async (data) => writes.push({ id, data }) })
    }),
    batch: () => { const ops = []; return { set: (ref, data) => ops.push({ id: ref.id, data }), commit: async () => retired.push(...ops) }; }
  };
}
const mkItem = (n) => ({ itemId: `v1|${n}|0`, title: `Mechanical Keyboard Model ${n} RGB Hot-swap`, price: { value: '79.99', currency: 'USD' }, conditionId: '1000', buyingOptions: ['FIXED_PRICE'], itemLocation: { country: 'US' }, seller: { feedbackPercentage: '99.6', feedbackScore: '5000' }, shippingOptions: [{ shippingCostType: 'FIXED', shippingCost: { value: '0.00' } }], topRatedBuyingExperience: true, image: { imageUrl: 'https://i.ebayimg.com/x/s-l500.jpg' }, additionalImages: [] });
let searchCalls = 0;
const fakeApi = async (token, path) => { if (path.includes('item_summary/search')) { searchCalls++; return { status: 200, json: { itemSummaries: Array.from({ length: 20 }, (_, i) => mkItem(searchCalls * 100 + i)) } }; } return { status: 200, json: { title: 'Mechanical Keyboard', image: { imageUrl: 'https://i.ebayimg.com/x/s-l500.jpg' }, returnTerms: { returnsAccepted: true, returnPeriod: { value: 30 } }, estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'IN_STOCK' }] } }; };
const existing = (n, source, cat, opts = {}) => Array.from({ length: n }, (_, i) => ({ id: `${source}-${cat}-${i}`, name: `${cat} item ${i}`, category: cat, source, active: true, firstSeenAt: Date.now() - (n - i) * DAY, score: 50 + i, ebayItemId: source === 'ebay' ? `v1|old${i}|0` : null, ...opts }));

const test = require('node:test');
const assert = require('node:assert/strict');
test('discovery fills, rotates and respects quotas', async () => {
  const log = [];
  const origLog = console.log; console.log = (...a) => log.push(a.join(' '));
  try {
  // Scenario 1: Tech is over quota (12 eBay + 5 static vs quota 10). Expect 3 fresh added, 3 oldest rotated.
  let db = fakeDb([...existing(12, 'ebay', 'Tech'), ...existing(5, 'static', 'Tech')], { maxProducts: 10, cacheImages: false, categories: [{ name: 'Tech', weight: 0.9, keywords: ['mechanical keyboard'] }] });
  let settings = await sync.loadSettings(db);
  console.log('normalised weight:', settings.categories[0].weight, '| perRun:', settings.newPerCategoryPerRun, 'minFresh:', settings.minFreshPerCategory);
  let r = await sync.discover(db, 'tok', settings, new Set(), () => {}, { api: fakeApi });
  console.log('S1 over quota  -> added', r.added, 'rotated', r.rotated, 'quota/have', r.byCategory.Tech.quota, r.byCategory.Tech.have, 'manual', r.byCategory.Tech.manual, '| rotated ids:', db.retired.map(x => x.id).join(','), '| reason:', db.retired[0]?.data.retiredReason);
  console.log('   expected: added 3, rotated 3 (oldest: ebay-Tech-0,1,2), static untouched ->', r.added === 3 && r.rotated === 3 && db.retired.map(x => x.id).join(',') === 'ebay-Tech-0,ebay-Tech-1,ebay-Tech-2' ? 'PASS' : 'FAIL');

  // Scenario 2: under quota (2 eBay vs quota 10): fill up to perRun (6), no rotation.
  db = fakeDb(existing(2, 'ebay', 'Tech'), { maxProducts: 10, cacheImages: false, categories: [{ name: 'Tech', weight: 1, keywords: ['mechanical keyboard'] }] });
  settings = await sync.loadSettings(db); r = await sync.discover(db, 'tok', settings, new Set(), () => {}, { api: fakeApi });
  console.log('S2 under quota -> added', r.added, 'rotated', r.rotated, r.added === 6 && r.rotated === 0 ? 'PASS' : 'FAIL');

  // Scenario 3: featured + override items are never rotated.
  db = fakeDb(existing(10, 'ebay', 'Tech', { featured: true }), { maxProducts: 10, cacheImages: false, categories: [{ name: 'Tech', weight: 1, keywords: ['mechanical keyboard'] }] });
  settings = await sync.loadSettings(db); r = await sync.discover(db, 'tok', settings, new Set(), () => {}, { api: fakeApi });
  console.log('S3 all featured -> added', r.added, 'rotated', r.rotated, r.added === 3 && r.rotated === 0 ? 'PASS' : 'FAIL');

  // Scenario 4: rotation disabled, manual counted.
  db = fakeDb([...existing(4, 'ebay', 'Tech'), ...existing(8, 'static', 'Tech')], { maxProducts: 10, cacheImages: false, rotateExcess: false, countManualInQuota: true, minFreshPerCategory: 2, categories: [{ name: 'Tech', weight: 1, keywords: ['mechanical keyboard'] }] });
  settings = await sync.loadSettings(db); r = await sync.discover(db, 'tok', settings, new Set(), () => {}, { api: fakeApi });
  console.log('S4 manual counted, no rotate -> have', r.byCategory.Tech.have, 'added', r.added, 'rotated', r.rotated, r.byCategory.Tech.have === 12 && r.added === 2 && r.rotated === 0 ? 'PASS' : 'FAIL');
  } finally { console.log = origLog; }
  const fails = log.filter((l) => /FAIL/.test(l));
  assert.deepEqual(fails, [], log.join('\n'));
});

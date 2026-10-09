// Writes functions/static-catalog.json: the sitemap's fallback until the first eBay sync publishes catalog/live.
// Run after editing scripts/products.js:  node scripts/build-static-catalog.js
const fs = require('fs');
const w = {}; global.window = w; require('./products.js');
const out = w.BT_CATALOG.map((p) => ({ id: p.id, name: p.name, images: (p.images || []).slice(0, 1) }));
fs.writeFileSync(__dirname + '/../functions/static-catalog.json', JSON.stringify(out));
console.log('functions/static-catalog.json:', out.length, 'products');

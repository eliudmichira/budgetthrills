const test = require('node:test');
const assert = require('node:assert/strict');
const src = require('fs').readFileSync(__dirname + '/../functions/index.js', 'utf8');
const build = new Function(src.slice(src.indexOf('const SITE_PAGES'), src.indexOf('let staticCatalogCache')) + '; return buildSitemapXml;')();

test('sitemap lists pages and products with escaped urls', () => {
  const xml = build([{ id: 'dewalt-drill-a1b2c', name: 'DeWalt 20V Drill & Driver', images: ['https://i.ebayimg.com/x/s-l1600.jpg'], firstSeenAt: Date.now() }], 'https://budgetthrills.web.app');
  assert.ok(xml.includes('<loc>https://budgetthrills.web.app/pdp.html?id=dewalt-drill-a1b2c</loc>'));
  assert.ok(xml.includes('DeWalt 20V Drill &amp; Driver'));
  assert.ok((xml.match(/<url>/g) || []).length > 10);
});

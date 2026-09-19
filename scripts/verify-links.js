const fs = require('fs');

const catalogCode = fs.readFileSync('scripts/products.js', 'utf8');
const sandbox = {};
eval(catalogCode.replace('window.BT_CATALOG', 'sandbox.BT_CATALOG'));
const validIds = new Set(sandbox.BT_CATALOG.map(p => p.id));

console.log('Catalog has ' + validIds.size + ' unique product IDs');

const htmlFiles = ['index.html', 'collection.html', 'phones.html', 'tech.html', 'accessories.html', 'wishlist.html', 'search.html'];
let brokenCount = 0;

for (const file of htmlFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const regex = /href="\/pdp\.html\?id=([^"]+)"/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const id = match[1];
    if (!validIds.has(id)) {
      console.log('  ⚠️ Invalid ID in ' + file + ': ' + id);
      brokenCount++;
    }
  }
}

if (brokenCount === 0) {
  console.log('✓ All PDP links in all HTML files match valid catalog IDs 100%!');
} else {
  console.log('Found ' + brokenCount + ' mismatched links.');
}

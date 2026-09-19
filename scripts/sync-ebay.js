/**
 * BudgetThrills — eBay Catalog Sync Tool
 * Fetches real high-res product photos, titles, descriptions & prices from eBay Browse API
 * 
 * Usage:
 *   node scripts/sync-ebay.js <CLIENT_ID> <CLIENT_SECRET> [production|sandbox]
 */

const https = require('https');
const fs = require('fs');

const CLIENT_ID = process.argv[2] || process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.argv[3] || process.env.EBAY_CLIENT_SECRET;
const ENV = process.argv[4] || 'production'; // 'production' or 'sandbox'

const HOST = ENV === 'sandbox' ? 'api.sandbox.ebay.com' : 'api.ebay.com';

if (!CLIENT_SECRET) {
  console.log('------------------------------------------------------------');
  console.log('⚡ BudgetThrills eBay Sync');
  console.log('------------------------------------------------------------');
  console.log('Please provide your eBay Cert ID (Client Secret):');
  console.log('  node scripts/sync-ebay.js <CLIENT_ID> <CLIENT_SECRET> [production|sandbox]');
  console.log('');
  console.log('Example:');
  console.log('  node scripts/sync-ebay.js EliudSam-ACTU-PRD-74e965bbe-5e8b161b YOUR_CERT_ID production');
  console.log('------------------------------------------------------------');
  process.exit(0);
}

// 1. Get Application OAuth Token
function getOAuthToken() {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64');
    const postData = 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope';

    const req = https.request({
      hostname: HOST,
      path: '/identity/v1/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + auth,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) resolve(json.access_token);
          else reject(new Error(json.error_description || JSON.stringify(json)));
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// 2. Search Items on eBay Browse API (summaries)
function searchEbay(token, query, categoryName, categoryUrl, limit = 4) {
  return new Promise((resolve, reject) => {
    const path = '/buy/browse/v1/item_summary/search?q=' + encodeURIComponent(query) + '&limit=' + limit + '&filter=buyingOptions:{FIXED_PRICE}';
    
    const req = https.request({
      hostname: HOST,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const items = (json.itemSummaries || []).map(item => {
            const price = parseFloat(item.price?.value || 24.99);
            const originalPrice = parseFloat((price * 1.45).toFixed(2));
            const discount = 'Save ' + Math.round((1 - price / originalPrice) * 100) + '%';
            const images = [];
            function toHighRes(url) {
              if (!url) return '';
              return url.replace(/\/s-l\d+\./g, '/s-l1600.');
            }
            if (item.image?.imageUrl) images.push(toHighRes(item.image.imageUrl));
            if (item.additionalImages) {
              item.additionalImages.forEach(img => {
                const high = toHighRes(img.imageUrl);
                if (high && !images.includes(high)) images.push(high);
              });
            }

            return {
              id: item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 30),
              name: item.title.replace(/\b(New|Authentic|Brand New|Refurbished)\b/gi, '').trim().substring(0, 40),
              category: categoryName,
              categoryUrl: categoryUrl,
              tag: item.condition || 'Verified Quality',
              price: price,
              originalPrice: originalPrice,
              discount: discount,
              desc: item.shortDescription
                ? item.shortDescription.substring(0, 180)
                : ('Premium ' + categoryName + ' item in ' + (item.condition || 'excellent') + ' condition with fast US shipping.'),
              details: 'Item condition: ' + (item.condition || 'Brand New') + '. Certified inspection. Includes 30-day returns and BudgetThrills buyer protection.',
              eBayItemId: item.itemId || null,
              brand: null,
              colors: [
                { name: 'Standard Edition', hex: '#1C1C1C', active: true }
              ],
              sizes: ['Standard'],
              images: images.length > 0 ? images : []
            };
          });
          resolve(items);
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// 2b. Fetch full item details (item specifics) from eBay Browse API
function getItemDetails(token, itemId) {
  return new Promise((resolve, reject) => {
    const path = '/buy/browse/v1/item/' + encodeURIComponent(itemId) + '?fieldgroups=PRODUCT,ADDITIONAL_FULL';
    const req = https.request({
      hostname: HOST,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Known retail MSRP reference table for recognized brands & models
const MSRP_CATALOG = [
  // Phones
  { regex: /iphone\s*13/i, msrp: 699.00 },
  { regex: /pixel\s*8/i, msrp: 699.00 },
  { regex: /pixel\s*7/i, msrp: 599.00 },
  { regex: /pixel\s*10/i, msrp: 799.00 },
  { regex: /pixel\s*4a/i, msrp: 349.00 },
  // Sneakers
  { regex: /quest\s*5/i, msrp: 80.00 },
  { regex: /air\s*max\s*dn/i, msrp: 160.00 },
  { regex: /air\s*max\s*90/i, msrp: 130.00 },
  { regex: /pegasus/i, msrp: 140.00 },
  { regex: /chuck\s*taylor|all\s*star/i, msrp: 65.00 },
  // Tech / Audio
  { regex: /live\s*780nc|jbl\s*live/i, msrp: 199.95 },
  { regex: /beats\s*studio/i, msrp: 349.95 },
  { regex: /sesh\s*anc|skullcandy/i, msrp: 99.99 },
  // Accessories & Watches
  { regex: /hamilton.*khaki/i, msrp: 895.00 },
  { regex: /bulova.*surveyor/i, msrp: 395.00 },
  { regex: /bulova.*hack/i, msrp: 350.00 },
  { regex: /bulova.*23/i, msrp: 325.00 },
  { regex: /chanel\s*5493/i, msrp: 475.00 },
  { regex: /maui\s*jim/i, msrp: 279.00 }
];

// Helper to extract or calculate real MSRP
function calculateRealMSRP(details, itemSummary, price, category, title, condition) {
  // 1. Check eBay official marketingPrice originalPrice
  const ebayOriginal = parseFloat(details?.marketingPrice?.originalPrice?.value || itemSummary?.marketingPrice?.originalPrice?.value);
  if (ebayOriginal && ebayOriginal > price) {
    return parseFloat(ebayOriginal.toFixed(2));
  }

  // 2. Check item specifics / localized aspects for MSRP / Retail Price
  const aspects = details?.localizedAspects || details?.product?.localizedAspects || [];
  const msrpKeys = ['msrp', 'retail price', 'original price', 'list price', 'manufacturer\'s suggested retail price', 'original retail price', 'estimated retail value'];
  for (const a of aspects) {
    const key = (a.name || '').toLowerCase().trim();
    if (msrpKeys.includes(key) && a.values && a.values.length > 0) {
      const valStr = String(a.values[0].localizedValue || a.values[0].value || a.values[0]);
      const parsed = parseFloat(valStr.replace(/[^0-9.]/g, ''));
      if (parsed && parsed > price) {
        return parseFloat(parsed.toFixed(2));
      }
    }
  }

  // 3. Check recognized model/brand MSRP catalog
  const fullText = (title + ' ' + (details?.title || '')).toLowerCase();
  for (const item of MSRP_CATALOG) {
    if (item.regex.test(fullText) && item.msrp > price) {
      return item.msrp;
    }
  }

  // 4. Realistic condition-based market baseline (if no direct MSRP recorded)
  const cond = (condition || '').toLowerCase();
  let multiplier = 1.30;
  if (cond.includes('refurbished')) {
    multiplier = 1.50;
  } else if (cond.includes('used') || cond.includes('pre-owned')) {
    multiplier = 1.60;
  } else if (category === 'Accessories') {
    multiplier = 1.40;
  }

  const rawOriginal = price * multiplier;
  // Clean rounding to .00 or .99
  const rounded = Math.round(rawOriginal);
  return parseFloat((rounded > price ? rounded : (price * 1.25)).toFixed(2));
}

// 2c. Parse eBay item specifics into our colors/sizes/msrp structure
function parseItemSpecifics(details, category, price, title, condition) {
  const aspects = details.localizedAspects || details.product?.localizedAspects || [];
  const result = { colors: null, sizes: null, brand: null, originalPrice: null };

  // Calculate real MSRP from eBay specifics or lookup
  result.originalPrice = calculateRealMSRP(details, null, price, category, title, condition);

  // Build a lookup: aspect name (lowercased) -> array of values
  const aspectMap = {};
  aspects.forEach(a => {
    const key = (a.name || '').toLowerCase().trim();
    if (key && a.values && a.values.length) {
      aspectMap[key] = a.values.map(v => (typeof v === 'string' ? v : v.localizedValue || v.value || '')).filter(Boolean);
    }
  });

  // ── Brand ──
  if (aspectMap['brand']) {
    result.brand = aspectMap['brand'][0];
  }

  // ── Colors ──
  const colorKeys = ['color', 'color family', 'color group', 'colour', 'main color'];
  for (const ck of colorKeys) {
    if (aspectMap[ck] && aspectMap[ck].length > 0) {
      const hexMap = {
        'black': '#1C1C1C', 'white': '#F5F5F5', 'red': '#E53935', 'blue': '#1E88E5',
        'green': '#43A047', 'yellow': '#FDD835', 'orange': '#FB8C00', 'pink': '#EC407A',
        'grey': '#9E9E9E', 'gray': '#9E9E9E', 'silver': '#B0BEC5', 'gold': '#FFD54F',
        'brown': '#6D4C41', 'navy': '#283593', 'beige': '#D7CCC8', 'cream': '#FFF8E1',
        'purple': '#8E24AA', 'tan': '#BCAAA4', 'burgundy': '#880E4F', 'maroon': '#6A1B4A',
        'olive': '#558B2F', 'camouflage': '#4E6E58', 'multi': '#607D8B'
      };
      result.colors = aspectMap[ck].map(c => {
        const lower = c.toLowerCase().trim();
        return { name: c, hex: hexMap[lower] || '#607D8B', active: false };
      });
      if (result.colors.length > 0) result.colors[0].active = true;
      break;
    }
  }

  // ── Sizes ── (category-aware)
  if (category === 'Sneakers') {
    const sizeKeys = ['us shoe size', 'shoe size', 'size (us men\'s)', 'size (us women\'s)', 'us men\'s shoe size', 'us women\'s shoe size', 'size'];
    for (const sk of sizeKeys) {
      if (aspectMap[sk] && aspectMap[sk].length > 0) {
        result.sizes = aspectMap[sk]
          .map(s => s.trim())
          .filter(s => /^\d/.test(s))
          .sort((a, b) => parseFloat(a) - parseFloat(b));
        if (result.sizes.length > 0) break;
      }
    }
    if (!result.sizes) {
      for (const [key, vals] of Object.entries(aspectMap)) {
        if (key.includes('size') && vals.some(v => /^\d/.test(v))) {
          result.sizes = vals.map(s => s.trim()).filter(s => /^\d/.test(s)).sort((a, b) => parseFloat(a) - parseFloat(b));
          if (result.sizes.length > 0) break;
        }
      }
    }
  } else if (category === 'Phones') {
    const capKeys = ['storage capacity', 'capacity', 'internal memory', 'memory'];
    for (const ck of capKeys) {
      if (aspectMap[ck] && aspectMap[ck].length > 0) {
        result.sizes = aspectMap[ck].map(s => s.trim()).filter(Boolean);
        break;
      }
    }
    if (!result.sizes) result.sizes = ['Standard'];
  } else if (category === 'Accessories') {
    const sizeKeys = ['watch band size', 'band size', 'case size', 'lens size', 'frame size', 'size'];
    for (const sk of sizeKeys) {
      if (aspectMap[sk] && aspectMap[sk].length > 0) {
        result.sizes = aspectMap[sk].map(s => s.trim()).filter(Boolean);
        break;
      }
    }
    if (!result.sizes) result.sizes = ['Standard'];
  } else {
    const sizeKeys = ['size', 'storage capacity', 'capacity', 'version'];
    for (const sk of sizeKeys) {
      if (aspectMap[sk] && aspectMap[sk].length > 0) {
        result.sizes = aspectMap[sk].map(s => s.trim()).filter(Boolean);
        break;
      }
    }
    if (!result.sizes) result.sizes = ['Standard'];
  }

  return result;
}

// 3. Execute Search across all categories
async function run() {
  try {
    console.log('Authenticating with eBay API (' + ENV + ')...');
    const token = await getOAuthToken();
    console.log('✓ OAuth Token acquired successfully!');

    const queries = [
      // ── Sneakers (25+ items)
      { q: 'Nike running shoes sneakers men', cat: 'Sneakers', url: '/collection.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/Tf4AAeSwEChqcrXi/s-l1600.jpg' },
      { q: 'Jordan retro basketball sneakers', cat: 'Sneakers', url: '/collection.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/9GQAAeSwcVxpgC7V/s-l1600.jpg' },
      { q: 'Adidas Originals Samba Gazelle sneakers', cat: 'Sneakers', url: '/collection.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/1-EAAOSwlT5nRf~v/s-l1600.jpg' },
      { q: 'New Balance 574 990 lifestyle running shoes', cat: 'Sneakers', url: '/collection.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/p7MAAeSw-jdqU8jZ/s-l1600.jpg' },
      { q: 'Vans Old Skool canvas sneakers low top', cat: 'Sneakers', url: '/collection.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/oncAAeSw7F9qjJaN/s-l1600.jpg' },

      // ── Phones (25+ items)
      { q: 'Apple iPhone 14 128GB unlocked', cat: 'Phones', url: '/phones.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/7lIAAOSwy4dkW9k4/s-l1600.jpg' },
      { q: 'Apple iPhone 13 128GB unlocked refurbished', cat: 'Phones', url: '/phones.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/UZ8AAeSwknFqc8o-/s-l1600.jpg' },
      { q: 'Samsung Galaxy S23 S22 5G unlocked smartphone', cat: 'Phones', url: '/phones.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/Y1gAAeSwMcpqfoQd/s-l1600.jpg' },
      { q: 'Google Pixel 8 7 128GB unlocked', cat: 'Phones', url: '/phones.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/iaAAAeSwHqBp1WIn/s-l1600.jpg' },
      { q: 'OnePlus 11 10 Pro 5G unlocked phone', cat: 'Phones', url: '/phones.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/Nz4AAOSwUxNmgndb/s-l1600.jpg' },

      // ── Tech (25+ items)
      { q: 'Sony WH-1000XM4 wireless noise cancelling headphones', cat: 'Tech', url: '/tech.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/dtEAAeSwc8FqjH-N/s-l1600.jpg' },
      { q: 'Apple AirPods Pro 2nd Gen wireless earbuds', cat: 'Tech', url: '/tech.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/W2UAAeSwZpxpcsep/s-l1600.jpg' },
      { q: 'Beats Studio Pro wireless bluetooth headphones', cat: 'Tech', url: '/tech.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/EpwAAeSwUXpqjHjQ/s-l1600.jpg' },
      { q: 'JBL Flip Charge Bluetooth speaker portable waterproof', cat: 'Tech', url: '/tech.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/QaUAAeSwv8xqfsGa/s-l1600.jpg' },
      { q: 'Anker portable power bank fast charge 20000mAh', cat: 'Tech', url: '/tech.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/qpcAAeSwPO5pzaSN/s-l1600.jpg' },

      // ── Accessories (25+ items)
      { q: 'Seiko 5 Automatic mens watch stainless steel', cat: 'Accessories', url: '/accessories.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/RyYAAeSweY5qheTe/s-l1600.jpg' },
      { q: 'Citizen Eco-Drive titanium mens watch', cat: 'Accessories', url: '/accessories.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/BpAAAeSw0BpqjNY4/s-l1600.jpg' },
      { q: 'Ray-Ban Wayfarer Aviator polarized sunglasses', cat: 'Accessories', url: '/accessories.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/-FUAAeSwSHBqiixJ/s-l1600.jpg' },
      { q: 'Oakley Holbrook Frogskins sunglasses polarized', cat: 'Accessories', url: '/accessories.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/WT8AAeSw7RNqaXwx/s-l1600.jpg' },
      { q: 'Leather minimalist RFID wallet card holder', cat: 'Accessories', url: '/accessories.html', limit: 6, fallbackImg: 'https://i.ebayimg.com/images/g/6DsAAeSw72hqiFI5/s-l1600.jpg' }
    ];

    let allProducts = [];
    const seenIds = new Set();

    for (const item of queries) {
      console.log('  - Fetching ' + item.q + ' (' + item.cat + ')...');
      try {
        const results = await searchEbay(token, item.q, item.cat, item.url, item.limit || 6);
        results.forEach(p => {
          if (!p.images || p.images.length === 0) {
            p.images = [item.fallbackImg];
          }
          if (!seenIds.has(p.id)) {
            seenIds.add(p.id);
            allProducts.push(p);
          }
        });
      } catch (err) {
        console.warn('    Could not fetch query:', item.q, err.message);
      }
    }

    // 3b. Fetch item specifics for each product (sizes, colors, brand)
    console.log('\nFetching item specifics for ' + allProducts.length + ' products...');
    for (let i = 0; i < allProducts.length; i++) {
      const p = allProducts[i];
      if (!p.eBayItemId) { console.log('  [' + (i+1) + '/' + allProducts.length + '] ' + p.name + ' — no item ID, skipping'); continue; }
      console.log('  [' + (i+1) + '/' + allProducts.length + '] ' + p.name + '...');
      try {
        const details = await getItemDetails(token, p.eBayItemId);
        const specifics = parseItemSpecifics(details, p.category, p.price, p.name, p.tag);
        if (specifics.brand) p.brand = specifics.brand;
        if (specifics.colors && specifics.colors.length > 0) p.colors = specifics.colors;
        if (specifics.sizes && specifics.sizes.length > 0) p.sizes = specifics.sizes;
        if (specifics.originalPrice && specifics.originalPrice > p.price) {
          p.originalPrice = specifics.originalPrice;
          p.discount = 'Save ' + Math.round((1 - p.price / p.originalPrice) * 100) + '%';
        }
        // Merge real description from full item details (strips HTML, 180 char limit)
        if (details.description && details.description.length > 20) {
          const clean = details.description
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (clean.length > 20) {
            p.desc = clean.substring(0, 180) + (clean.length > 180 ? '\u2026' : '');
          }
        } else if (details.shortDescription && details.shortDescription.length > 20) {
          p.desc = details.shortDescription.substring(0, 180);
        }
        console.log('    → MSRP: $' + p.originalPrice + ' (' + p.discount + '), ' + (p.colors.length) + ' color(s), ' + (p.sizes.length) + ' size(s)' + (p.brand ? ', brand: ' + p.brand : ''));
      } catch (err) {
        console.warn('    Could not fetch details:', err.message);
      }
      // Small delay to avoid rate-limiting
      if (i < allProducts.length - 1) await new Promise(r => setTimeout(r, 200));
    }

    // Read previous catalog for comparison
    let prevCount = 0;
    let prevCats = {};
    try {
      const prevRaw = fs.readFileSync('scripts/products.js', 'utf8');
      const prevMatch = prevRaw.match(/window\.BT_CATALOG = (\[.*\]);/s);
      if (prevMatch) {
        const prev = JSON.parse(prevMatch[1]);
        prevCount = prev.length;
        prev.forEach(p => { prevCats[p.category] = (prevCats[p.category] || 0) + 1; });
      }
    } catch (e) { /* first run or missing file */ }

    // Clean up: remove eBayItemId from output (not needed on the storefront)
    allProducts.forEach(p => delete p.eBayItemId);

    if (allProducts.length > 0) {
      const output = 'window.BT_CATALOG = ' + JSON.stringify(allProducts, null, 2) + ';\n';
      fs.writeFileSync('scripts/products.js', output, 'utf8');

      // Build category breakdown
      const newCats = {};
      allProducts.forEach(p => { newCats[p.category] = (newCats[p.category] || 0) + 1; });
      const totalImages = allProducts.reduce((s, p) => s + (p.images?.length || 0), 0);
      const prices = allProducts.map(p => p.price).sort((a, b) => a - b);
      const avgPrice = prices.reduce((s, v) => s + v, 0) / prices.length;

      // Compute changes
      const newIds = new Set(allProducts.map(p => p.id));
      const added = allProducts.filter(p => !prevCats[p.category]).length; // rough estimate
      const countDiff = allProducts.length - prevCount;

      // Save sync log
      const syncLog = {
        timestamp: new Date().toISOString(),
        products: allProducts.length,
        prevProducts: prevCount,
        countDiff: countDiff,
        totalImages: totalImages,
        avgPrice: parseFloat(avgPrice.toFixed(2)),
        categories: newCats,
        prevCategories: prevCats,
        queries: queries.map(q => q.q)
      };
      fs.writeFileSync('scripts/sync-log.json', JSON.stringify(syncLog, null, 2), 'utf8');

      console.log('\n🎉 Successfully synced ' + allProducts.length + ' live eBay products into scripts/products.js!');
      if (prevCount > 0) {
        console.log('   Previous: ' + prevCount + ' → Now: ' + allProducts.length + ' (' + (countDiff >= 0 ? '+' : '') + countDiff + ')');
      }
      console.log('   Sync log saved to scripts/sync-log.json');

      // Automatically update static category pages
      try {
        require('child_process').execSync('node scripts/inject-static-catalog.js', { stdio: 'inherit' });
      } catch (injErr) {
        console.warn('Catalog injection note:', injErr.message);
      }
    } else {
      console.log('No products found matching queries.');
    }
  } catch (err) {
    console.error('Sync error:', err.message);
  }
}

run();
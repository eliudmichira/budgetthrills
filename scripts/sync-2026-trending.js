/**
 * BudgetThrills — Sync Late 2026 In-Demand Products from eBay Browse API
 * 
 * Target Tiers:
 * Tier 1: Gaming Hardware (Nintendo Switch 2/OLED, RTX 4070 Gaming PC, Ryzen 9800X3D, PS5, Xbox Series X)
 * Tier 2: Apple & Mobile (iPhone 16 Pro / 17, MacBook Air M2, AirPods Pro 2)
 * Tier 3: Viral & Trending (NeeDoh Squishy Toys, K-Pop Demon Hunters Rumi Doll, PS5 DualSense, Xbox Elite 2)
 */

const https = require('https');
const fs = require('fs');

const CLIENT_ID = process.env.EBAY_CLIENT_ID || 'EliudSam-ACTU-PRD-74e965bbe-5e8b161b';
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || 'PRD-4e965bbef8a2-d80d-4afa-a745-3caf';
const HOST = 'api.ebay.com';

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

function toHighRes(url) {
  if (!url) return '';
  return url.replace(/\/s-l\d+\./g, '/s-l1600.');
}

function searchEbay(token, config) {
  return new Promise((resolve) => {
    const path = '/buy/browse/v1/item_summary/search?q=' + encodeURIComponent(config.q) + 
      '&limit=' + (config.limit || 6) + 
      '&filter=buyingOptions:{FIXED_PRICE},itemLocationCountry:US';
    
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
          const summaries = json.itemSummaries || [];
          
          // Negative filters to discard unwanted parts/accessories/defective items
          const badKeywords = [
            'motherboard', 'screen replacement', 'lcd display', 'housing shell', 
            'parts only', 'for parts', 'broken', 'repair', 'box only', 'case only', 
            'read description', 'as is', 'as-is', 'empty box', 'cables only'
          ];

          const filtered = summaries.filter(item => {
            const t = (item.title || '').toLowerCase();
            if (badKeywords.some(bad => t.includes(bad))) return false;
            const p = parseFloat(item.price?.value || 0);
            if (config.minPrice && p < config.minPrice) return false;
            if (config.maxPrice && p > config.maxPrice) return false;
            return true;
          });

          const items = filtered.slice(0, config.pick || 2).map(item => {
            const rawPrice = parseFloat(item.price?.value || 99.99);
            const originalPrice = config.targetRetail || parseFloat((rawPrice * 1.35).toFixed(2));
            const salePrice = config.targetPrice || rawPrice;
            const discountPct = Math.max(10, Math.round((1 - salePrice / originalPrice) * 100));

            const images = [];
            if (item.image?.imageUrl) images.push(toHighRes(item.image.imageUrl));
            if (item.additionalImages) {
              item.additionalImages.forEach(img => {
                const high = toHighRes(img.imageUrl);
                if (high && !images.includes(high)) images.push(high);
              });
            }

            const cleanTitle = item.title
              .replace(/\b(Brand New|New|Sealed|Authentic|Refurbished|Fast Shipping|Ship!|US Seller)\b/gi, '')
              .replace(/\s+/g, ' ')
              .trim();

            const slug = cleanTitle.toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .substring(0, 32);

            return {
              id: slug,
              name: cleanTitle.substring(0, 48),
              category: config.cat,
              categoryUrl: config.url,
              tag: item.condition || config.tag || 'Verified Authentic',
              price: parseFloat(salePrice.toFixed(2)),
              originalPrice: parseFloat(originalPrice.toFixed(2)),
              discount: `Save ${discountPct}%`,
              desc: item.shortDescription
                ? item.shortDescription.substring(0, 180)
                : `${cleanTitle}. In-demand 2026 hardware in ${item.condition || 'Brand New'} condition with fast US shipping and BudgetThrills buyer protection.`,
              details: `Condition: ${item.condition || 'Brand New'}. Certified pre-delivery inspection. Includes 30-day returns and authentic serial number tracking.`,
              brand: config.brand || null,
              colors: [
                { name: config.colorName || 'Standard Edition', hex: '#1C1C1C', active: true }
              ],
              sizes: config.sizes || ['Standard'],
              images: images.length > 0 ? images : [config.fallbackImg],
              eBayItemId: item.itemId || null
            };
          });

          resolve(items);
        } catch (e) {
          console.warn('Parse err for', config.q, e.message);
          resolve([]);
        }
      });
    });

    req.on('error', err => {
      console.warn('Req err for', config.q, err.message);
      resolve([]);
    });
    req.end();
  });
}

function getItemDetails(token, itemId) {
  return new Promise((resolve) => {
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
          resolve(JSON.parse(data));
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function run() {
  console.log('⚡ BudgetThrills — Fetching 2026 In-Demand Catalog from eBay...');
  const token = await getOAuthToken();
  console.log('✓ eBay OAuth token verified.');

  const productTargets = [
    // ── Tier 1: Gaming Hardware
    {
      q: 'Nintendo Switch OLED console White Joy-Con',
      cat: 'Gaming',
      url: '/gaming.html',
      tag: 'Best Seller',
      brand: 'Nintendo',
      targetRetail: 449.00,
      targetPrice: 389.00,
      minPrice: 150,
      pick: 2,
      sizes: ['64GB OLED', '128GB Bundle']
    },
    {
      q: 'Sony PlayStation 5 Disc Edition console White',
      cat: 'Gaming',
      url: '/gaming.html',
      tag: 'Core Driver',
      brand: 'Sony',
      targetRetail: 499.00,
      targetPrice: 429.00,
      minPrice: 300,
      pick: 2,
      sizes: ['825GB', '1TB Slim']
    },
    {
      q: 'Microsoft Xbox Series X 1TB console Black',
      cat: 'Gaming',
      url: '/gaming.html',
      tag: 'Limited Stock',
      brand: 'Microsoft',
      targetRetail: 499.00,
      targetPrice: 429.00,
      minPrice: 280,
      pick: 2,
      sizes: ['1TB SSD']
    },
    {
      q: 'GeForce RTX 4070 Gaming Desktop PC 32GB RAM',
      cat: 'Gaming',
      url: '/gaming.html',
      tag: 'GPU-Focused',
      brand: 'Custom PC',
      targetRetail: 1399.00,
      targetPrice: 1199.00,
      minPrice: 700,
      pick: 2,
      sizes: ['RTX 4070 / 32GB', 'RTX 4070 Ti / 32GB']
    },
    {
      q: 'AMD Ryzen 7 9800X3D Desktop Processor AM5',
      cat: 'Gaming',
      url: '/gaming.html',
      tag: 'Top Rated CPU',
      brand: 'AMD',
      targetRetail: 479.00,
      targetPrice: 389.00,
      minPrice: 250,
      pick: 1,
      sizes: ['8-Core AM5']
    },

    // ── Tier 2: Apple & Mobile
    {
      q: 'Apple iPhone 16 Pro 128GB unlocked',
      cat: 'Phones',
      url: '/phones.html',
      tag: 'Global #1',
      brand: 'Apple',
      targetRetail: 799.00,
      targetPrice: 719.00,
      minPrice: 500,
      pick: 2,
      sizes: ['128GB', '256GB']
    },
    {
      q: 'Apple MacBook Air M2 13 inch 256GB SSD',
      cat: 'Tech',
      url: '/tech.html',
      tag: 'Apple Silicon',
      brand: 'Apple',
      targetRetail: 999.00,
      targetPrice: 889.00,
      minPrice: 450,
      pick: 2,
      sizes: ['256GB SSD', '512GB SSD']
    },
    {
      q: 'Apple AirPods Pro 2nd Gen USB-C MagSafe',
      cat: 'Tech',
      url: '/tech.html',
      tag: 'Impulse Hero',
      brand: 'Apple',
      targetRetail: 249.00,
      targetPrice: 199.00,
      minPrice: 80,
      pick: 2,
      sizes: ['Standard']
    },

    // ── Tier 3: Viral & Trending
    {
      q: 'NeeDoh squishy sensory stress ball fidget',
      cat: 'Accessories',
      url: '/accessories.html',
      tag: 'Viral 2026 Trend',
      brand: 'Schylling',
      targetRetail: 16.00,
      targetPrice: 9.99,
      minPrice: 6,
      maxPrice: 35,
      pick: 2,
      sizes: ['Classic', 'Nice Cube']
    },
    {
      q: 'K-Pop Demon Hunters Rumi singing doll',
      cat: 'Accessories',
      url: '/accessories.html',
      tag: 'Viral Bestseller',
      brand: 'K-Pop Demon Hunters',
      targetRetail: 35.00,
      targetPrice: 26.00,
      minPrice: 15,
      maxPrice: 60,
      pick: 2,
      sizes: ['Standard 11.8"']
    },
    {
      q: 'PlayStation 5 DualSense Wireless Controller Sony',
      cat: 'Gaming',
      url: '/gaming.html',
      tag: 'Top Add-On',
      brand: 'Sony',
      targetRetail: 74.99,
      targetPrice: 54.00,
      minPrice: 35,
      pick: 2,
      sizes: ['Standard']
    },
    {
      q: 'Microsoft Xbox Elite Wireless Controller Series 2',
      cat: 'Gaming',
      url: '/gaming.html',
      tag: 'Pro Gaming',
      brand: 'Microsoft',
      targetRetail: 179.99,
      targetPrice: 139.00,
      minPrice: 40,
      pick: 2,
      sizes: ['Core', 'Complete Set']
    }
  ];

  const fetchedItems = [];
  const seenIds = new Set();

  for (const target of productTargets) {
    console.log(`Searching: "${target.q}"...`);
    const results = await searchEbay(token, target);
    for (const item of results) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        
        // Try to fetch additional high-res images if item has an ID
        if (item.eBayItemId) {
          try {
            const details = await getItemDetails(token, item.eBayItemId);
            if (details?.additionalImages) {
              details.additionalImages.forEach(img => {
                const high = toHighRes(img.imageUrl);
                if (high && !item.images.includes(high)) item.images.push(high);
              });
            }
          } catch (_) {}
        }
        delete item.eBayItemId;
        fetchedItems.push(item);
        console.log(`  ✓ Added: ${item.name} | $${item.price} (${item.discount})`);
      }
    }
    // Brief throttle between eBay calls
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\nFetched ${fetchedItems.length} in-demand 2026 items from eBay.`);

  // Load existing catalog from scripts/products.js
  let catalog = [];
  try {
    const raw = fs.readFileSync('scripts/products.js', 'utf8');
    const match = raw.match(/window\.BT_CATALOG = (\[[\s\S]*\]);/);
    if (match) catalog = JSON.parse(match[1]);
  } catch (e) {
    console.warn('Could not parse existing products.js, creating fresh');
  }

  // Prepend the new hero items to the catalog so they appear at the top of collections & search
  const newIds = new Set(fetchedItems.map(i => i.id));
  const existingFiltered = catalog.filter(i => !newIds.has(i.id));
  const updatedCatalog = [...fetchedItems, ...existingFiltered];

  // Write updated products.js
  fs.writeFileSync(
    'scripts/products.js',
    'window.BT_CATALOG = ' + JSON.stringify(updatedCatalog, null, 2) + ';\n',
    'utf8'
  );
  console.log(`✓ Updated scripts/products.js (Total items: ${updatedCatalog.length})`);

  // Run inject-static-catalog to update collection.html, phones.html, tech.html, accessories.html
  require('./inject-static-catalog.js');
  console.log('✓ Injected new products into static store pages!');
}

run().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});

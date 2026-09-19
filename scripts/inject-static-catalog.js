const fs = require('fs');

// Load catalog
const catalogCode = fs.readFileSync('scripts/products.js', 'utf8');
const sandbox = {};
eval(catalogCode.replace('window.BT_CATALOG', 'sandbox.BT_CATALOG'));
const catalog = sandbox.BT_CATALOG;

function makeCardHtml(item, isFeatured = false) {
  const hoverImg = item.images[1] ? `<img class="img-hover" src="${item.images[1]}" alt="" loading="lazy">` : '';
  const priceClass = isFeatured ? 'text-lg font-semibold' : 'font-semibold';
  return `        <a href="/pdp.html?id=${item.id}" class="card group">
          <div class="card-media aspect-[4/5]">
            <img class="img-primary" src="${item.images[0]}" alt="${item.name}" loading="lazy">
            ${hoverImg}
            <span class="card-cta">View →</span>
          </div>
          <div class="pt-5">
            <h3 class="text-sm font-medium group-hover:text-lime transition">${item.name}</h3>
            <div class="text-mute text-xs mt-1">${item.tag || item.category}</div>
            <div class="mt-3 flex items-baseline gap-3">
              <span class="${priceClass}" lang="en-US" translate="no">$${item.price.toFixed(2)}</span>
              ${item.originalPrice ? `<span class="text-mute text-xs line-through" lang="en-US" translate="no">$${item.originalPrice.toFixed(2)}</span>` : ''}
            </div>
          </div>
        </a>`;
}

// 1. Update collection.html (Sneakers)
const sneakers = catalog.filter(p => p.category === 'Sneakers');
let collHtml = fs.readFileSync('collection.html', 'utf8');
const collGridRegex = /<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-category="Sneakers">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/;
if (collGridRegex.test(collHtml)) {
  const cardsHtml = sneakers.map(s => makeCardHtml(s)).join('\n\n');
  const replacement = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-category="Sneakers">\n${cardsHtml}\n      </div>\n    </div>\n  </section>`;
  collHtml = collHtml.replace(collGridRegex, replacement);
  fs.writeFileSync('collection.html', collHtml, 'utf8');
  console.log('✓ Updated collection.html with ' + sneakers.length + ' real eBay sneakers');
}

// 2. Update phones.html (Phones)
const phones = catalog.filter(p => p.category === 'Phones');
let phonesHtml = fs.readFileSync('phones.html', 'utf8');
const phonesGridRegex = /<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-category="Phones">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/;
if (phonesGridRegex.test(phonesHtml)) {
  const cardsHtml = phones.map(p => makeCardHtml(p)).join('\n\n');
  const replacement = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-category="Phones">\n${cardsHtml}\n      </div>\n    </div>\n  </section>`;
  phonesHtml = phonesHtml.replace(phonesGridRegex, replacement);
  fs.writeFileSync('phones.html', phonesHtml, 'utf8');
  console.log('✓ Updated phones.html with ' + phones.length + ' real eBay phones');
}

// 3. Update tech.html (Tech)
const tech = catalog.filter(p => p.category === 'Tech');
let techHtml = fs.readFileSync('tech.html', 'utf8');
const techGridRegex = /<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-category="Tech">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/;
if (techGridRegex.test(techHtml)) {
  const cardsHtml = tech.map(t => makeCardHtml(t)).join('\n\n');
  const replacement = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-category="Tech">\n${cardsHtml}\n      </div>\n    </div>\n  </section>`;
  techHtml = techHtml.replace(techGridRegex, replacement);
  fs.writeFileSync('tech.html', techHtml, 'utf8');
  console.log('✓ Updated tech.html with ' + tech.length + ' real eBay tech products');
}

// 4. Update accessories.html (Accessories)
const acc = catalog.filter(p => p.category === 'Accessories');
let accHtml = fs.readFileSync('accessories.html', 'utf8');
const accGridRegex = /<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-category="Accessories">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/;
if (accGridRegex.test(accHtml)) {
  const cardsHtml = acc.map(a => makeCardHtml(a)).join('\n\n');
  const replacement = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-category="Accessories">\n${cardsHtml}\n      </div>\n    </div>\n  </section>`;
  accHtml = accHtml.replace(accGridRegex, replacement);
  fs.writeFileSync('accessories.html', accHtml, 'utf8');
  console.log('✓ Updated accessories.html with ' + acc.length + ' real eBay accessories');
}

// 5. Update index.html (Homepage Diverse Cross-Category Featured)
let indexHtml = fs.readFileSync('index.html', 'utf8');
const indexGridRegex = /<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-featured>[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/;
if (indexGridRegex.test(indexHtml)) {
  // Pick 2 top items from EACH category to create a rich variety
  const topSneakers = catalog.filter(p => p.category === 'Sneakers').slice(0, 2);
  const topPhones = catalog.filter(p => p.category === 'Phones').slice(0, 2);
  const topTech = catalog.filter(p => p.category === 'Tech').slice(0, 2);
  const topAcc = catalog.filter(p => p.category === 'Accessories').slice(0, 2);
  
  // Interleave them: Sneaker, Phone, Tech, Accessory, Sneaker, Phone, Tech, Accessory
  const diverseFeatured = [
    topSneakers[0], topPhones[0], topTech[0], topAcc[0],
    topSneakers[1], topPhones[1], topTech[1], topAcc[1]
  ].filter(Boolean);

  const cardsHtml = diverseFeatured.map(f => makeCardHtml(f, true)).join('\n\n');
  const replacement = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-featured>\n${cardsHtml}\n      </div>\n    </div>\n  </section>`;
  indexHtml = indexHtml.replace(indexGridRegex, replacement);
  fs.writeFileSync('index.html', indexHtml, 'utf8');
  console.log('✓ Updated index.html trending section with 8 diverse cross-category items');
}

// 6. Update gaming.html (Gaming)
if (fs.existsSync('gaming.html')) {
  const gaming = catalog.filter(p => p.category === 'Gaming');
  let gamingHtml = fs.readFileSync('gaming.html', 'utf8');
  const gamingGridRegex = /<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-category="Gaming" id="gaming-grid">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/;
  if (gamingGridRegex.test(gamingHtml)) {
    const cardsHtml = gaming.map(g => makeCardHtml(g)).join('\n\n');
    const replacement = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-category="Gaming" id="gaming-grid">\n${cardsHtml}\n      </div>\n    </div>\n  </section>`;
    gamingHtml = gamingHtml.replace(gamingGridRegex, replacement);
    fs.writeFileSync('gaming.html', gamingHtml, 'utf8');
    console.log('✓ Updated gaming.html with ' + gaming.length + ' real eBay gaming items');
  }
}

// 7. Update trending.html (All Products)
if (fs.existsSync('trending.html')) {
  let trendingHtml = fs.readFileSync('trending.html', 'utf8');
  const trendingGridRegex = /<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-category="All">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/;
  if (trendingGridRegex.test(trendingHtml)) {
    const cardsHtml = catalog.map(item => makeCardHtml(item)).join('\n\n');
    const replacement = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" data-reveal data-catalog-category="All">\n${cardsHtml}\n      </div>\n    </div>\n  </section>`;
    trendingHtml = trendingHtml.replace(trendingGridRegex, replacement);
    fs.writeFileSync('trending.html', trendingHtml, 'utf8');
    console.log('✓ Updated trending.html with all ' + catalog.length + ' real eBay products');
  }
}


// BudgetThrills — automated eBay catalog sync
//
// Pulls fixed-price listings from the eBay Browse API, scores them for flip margin and
// payment-processor risk, prices them with the store's margin rule, and writes them to
// Firestore `products/{id}`. Existing products are re-verified every run (price refresh,
// sold-out / ended detection). The active set is compiled into a single `catalog/live`
// document that the storefront loads with one read.
//
// Env: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET (Browse API app credentials, production keyset).

const https = require("https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const HOST = process.env.EBAY_ENV === "sandbox" ? "api.sandbox.ebay.com" : "api.ebay.com";
const MARKETPLACE = "EBAY_US";
const PROCESSING_FEE_PCT = 0.035;   // card processor percentage
const PROCESSING_FEE_FIXED = 0.30;  // card processor fixed fee

// Condition IDs from eBay. Used phones/consoles are deliberately excluded.
const CONDITIONS = {
  1000: "New", 1500: "Open box", 2000: "Certified - Refurbished", 2010: "Excellent - Refurbished",
  2020: "Very Good - Refurbished", 2030: "Good - Refurbished"
};

const DEFAULT_SETTINGS = {
  enabled: true,
  targetMargin: 0.25,          // net margin after processing fees, as a fraction of sale price
  priceCeiling: 200,           // max sale price shown on the store
  priceFloor: 40,              // min sale price
  maxProducts: 160,            // total active catalog size the sync aims for
  priceEnding: 99,             // cents every price ends in
  minSellerFeedbackPct: 99,
  minSellerFeedbackScore: 100,
  requireTopRated: false,
  requireFreeShipping: true,
  requireReturns: true,
  newPerCategoryPerRun: 6,     // cap on new listings added per category each run (keeps the API budget low)
  minFreshPerCategory: 3,      // always add at least this many fresh listings per category per run, even when full
  rotateExcess: true,          // when a category is over quota, retire its oldest eBay listings to make room
  countManualInQuota: false,   // imported products.js / manual items count against the category quota
  // Category weights decide the catalog mix. Keywords are the eBay searches per category.
  categories: [
    { name: "Tech",        weight: 0.20, url: "/tech.html",        keywords: ["mechanical keyboard", "wireless gaming mouse", "usb-c hub", "portable ssd 1tb", "webcam 4k"] },
    { name: "Accessories", weight: 0.15, url: "/accessories.html", keywords: ["seiko automatic watch", "anker power bank", "leather wallet rfid", "ray-ban sunglasses", "belkin charger"] },
    { name: "Tools",       weight: 0.15, url: "/category.html?c=Tools", keywords: ["dewalt 20v tool only", "milwaukee m18 tool only", "makita 18v tool only", "dewalt battery 5ah"] },
    { name: "Home",        weight: 0.10, url: "/category.html?c=Home", keywords: ["ninja air fryer", "dyson v8", "vitamix blender", "kitchenaid hand mixer", "instant pot"] },
    { name: "Audio",       weight: 0.10, url: "/category.html?c=Audio", keywords: ["focusrite scarlett", "shure sm58", "audio-technica turntable", "jbl flip 6", "sony wh-1000xm4"] },
    { name: "Toys",        weight: 0.10, url: "/category.html?c=Toys", keywords: ["lego retired set", "hot wheels premium", "funko pop exclusive", "nerf elite"] },
    { name: "Gaming",      weight: 0.10, url: "/gaming.html",      keywords: ["xbox elite controller series 2", "dualsense edge", "nintendo switch pro controller", "logitech g pro"] },
    { name: "Sneakers",    weight: 0.05, url: "/collection.html",  keywords: ["nike air max new with box", "adidas samba new with box", "new balance 574 new"] },
    { name: "Phones",      weight: 0.05, url: "/phones.html",      keywords: ["iphone 13 unlocked refurbished", "pixel 7 unlocked refurbished"] }
  ],
  blockedItemIds: []
};

/* ---------------------------------- eBay API ---------------------------------- */

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let json = null;
        try { json = data ? JSON.parse(data) : {}; } catch (e) { json = { raw: data }; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("eBay request timed out")));
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  const id = process.env.EBAY_CLIENT_ID, secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set in functions/.env");
  const body = "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope");
  const { status, json } = await request({
    hostname: HOST, path: "/identity/v1/oauth2/token", method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + Buffer.from(id + ":" + secret).toString("base64"),
      "Content-Length": Buffer.byteLength(body)
    }
  }, body);
  if (status !== 200 || !json.access_token) throw new Error("eBay OAuth failed: " + (json.error_description || JSON.stringify(json)));
  return json.access_token;
}

function api(token, path) {
  return request({
    hostname: HOST, path, method: "GET",
    headers: {
      "Authorization": "Bearer " + token,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
      "X-EBAY-C-ENDUSERCTX": "contextualLocation=country=US,zip=10001",
      "Accept": "application/json"
    }
  });
}

/* ---------------------------------- pricing ---------------------------------- */

function applyEnding(price, endingCents) {
  const cents = Math.max(0, Math.min(99, Number(endingCents) || 0)) / 100;
  let p = Math.floor(price) + cents;
  if (p < price) p += 1;
  return Math.round(p * 100) / 100;
}

function processingFee(sale) { return sale * PROCESSING_FEE_PCT + PROCESSING_FEE_FIXED; }

/** Sale price that leaves `margin` of the sale price as profit after fees and landed cost. */
function priceFor(landedCost, settings) {
  const raw = (landedCost + PROCESSING_FEE_FIXED) / (1 - settings.targetMargin - PROCESSING_FEE_PCT);
  return applyEnding(raw, settings.priceEnding);
}

function marginAt(sale, landedCost) {
  return sale > 0 ? (sale - processingFee(sale) - landedCost) / sale : 0;
}

/* ---------------------------------- scoring ---------------------------------- */

function shippingCost(item) {
  const opts = item.shippingOptions || [];
  if (!opts.length) return null; // unknown
  const costs = opts.map((o) => (o.shippingCostType === "CALCULATED" && !o.shippingCost) ? null : Number(o.shippingCost?.value ?? 0));
  if (costs.some((c) => c === null)) return null;
  return Math.min(...costs);
}

/**
 * Returns { ok, reasons[], score, landed, sale } for a search summary.
 * Rejections are hard rules; score orders the survivors.
 */
function evaluate(item, settings, category, keyword) {
  const reasons = [];
  const price = Number(item.price?.value);
  const currency = item.price?.currency;
  const ship = shippingCost(item);
  const seller = item.seller || {};
  const fbPct = Number(seller.feedbackPercentage);
  const fbScore = Number(seller.feedbackScore);
  const condId = Number(item.conditionId);

  if (!(price > 0) || currency !== "USD") reasons.push("price");
  if (!CONDITIONS[condId]) reasons.push("condition:" + (item.condition || condId));
  if (!(item.buyingOptions || []).includes("FIXED_PRICE")) reasons.push("not fixed price");
  if ((item.itemLocation?.country || "US") !== "US") reasons.push("not US");
  if (!(fbPct >= settings.minSellerFeedbackPct)) reasons.push("seller feedback " + fbPct);
  if (!(fbScore >= settings.minSellerFeedbackScore)) reasons.push("seller score " + fbScore);
  if (settings.requireTopRated && !item.topRatedBuyingExperience) reasons.push("not top rated");
  if (ship === null) reasons.push("shipping unknown");
  if (settings.requireFreeShipping && ship > 0) reasons.push("paid shipping");

  const landed = price + (ship || 0);
  const sale = priceFor(landed, settings);
  if (sale > settings.priceCeiling) reasons.push("over ceiling $" + sale);
  if (sale < settings.priceFloor) reasons.push("under floor $" + sale);
  if (marginAt(sale, landed) < settings.targetMargin - 0.005) reasons.push("margin");

  // Titles that signal risk or unsellable listings.
  if (/\b(lot of|bulk|parts only|for parts|read description|as is|broken|cracked|locked|bad esn|blacklisted|replica|read!!)\b/i.test(item.title || "")) reasons.push("title flag");
  if (keyword) titleProblems(item.title, keyword).forEach((p) => reasons.push("title:" + p));

  let score = 0;
  if (item.topRatedBuyingExperience) score += 30;
  score += Math.min(20, (fbScore || 0) / 500);
  score += (fbPct - 99) * 10;
  if (condId === 1000) score += 15; else if (condId === 1500) score += 10; else score += 5;
  const disc = Number(item.marketingPrice?.discountPercentage) || 0;
  score += Math.min(15, disc / 2);
  if ((item.additionalImages || []).length >= 3) score += 5;
  // Prefer mid-band prices: lowest fraud, best conversion.
  if (sale >= 60 && sale <= 150) score += 10;

  return { ok: reasons.length === 0, reasons, score, landed, sale, ship: ship || 0, price };
}

/* ---------------------------------- product mapping ---------------------------------- */

function slugify(title) {
  return String(title || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
function shortHash(s) {
  let h = 0; for (const ch of String(s)) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36).slice(0, 5);
}
function stripHtml(html) {
  return String(html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
// ---------------------------------- titles ----------------------------------
// eBay titles are keyword soup. Customers should see a product name, and the sync should
// refuse clones, accessories and parts that match a brand search without being the product.
const NOISE_PHRASES = /\b(brand new|new in box|new sealed|factory sealed|sealed|new with tags?|new without tags?|nwt|nwot|nib|bnib|in hand|ships? (fast|free|today|same day)|same day ship\w*|free ship\w*|fast ship\w*|us seller|100% (authentic|genuine)|authentic|genuine|rare|htf|hard to find|retired|discontinued|limited|read|look|wow|hot|sale|deal|must see|l@@k|new)\b/gi;
const PAREN_NOISE = /\b(tool[- ]only|bare tool|new|sealed|retired|free|fast|ship\w*|read|no box|with box|w\/ ?box|box|used|refurb\w*|open box|oem|genuine|authentic|rare|htf|nib|nwt|lot|in hand|20(2[4-9]))\b/i;
const ACRONYMS = new Set(["usb","ssd","hdd","rgb","led","oled","lcd","qled","hdmi","nvme","ram","gpu","cpu","tv","xl","xxl","uhd","hdr","amd","ati","nfc","gps","lte","esim","bt","pc","ps4","ps5","xbox","vr","ar","ai","dj","usa","uk","eu","abs","fm","am","dvd","cd","ssl","atx","itx","sfx","ttl","iso","oem","mtb","bmx","suv","atv","utv","rv","ac","dc","ev","ii","iii","iv","vi","vii","mk","mkii","se","pro","max","mini","air","plus","ultra","fuel","m12","m18","v20","v8","v10","v11","v12","v15","k2","k6","k8","g2","g3","g4","g5","x","xt","xr","xs","rtx","gtx","rx","ryzen"]);
const BRAND_CASE = { dewalt: "DeWalt", lego: "LEGO", jbl: "JBL", iphone: "iPhone", ipad: "iPad", imac: "iMac", macbook: "MacBook", airpods: "AirPods", playstation: "PlayStation", dualsense: "DualSense", kitchenaid: "KitchenAid", "ray-ban": "Ray-Ban", rayban: "Ray-Ban", gopro: "GoPro", steelseries: "SteelSeries", hyperx: "HyperX", vitamix: "Vitamix", nerf: "Nerf", funko: "Funko", yeti: "YETI", ryobi: "RYOBI", makita: "Makita", milwaukee: "Milwaukee", dyson: "Dyson", ninja: "Ninja", seiko: "Seiko", casio: "Casio", sony: "Sony", bose: "Bose", nike: "Nike", adidas: "adidas", apple: "Apple", samsung: "Samsung", google: "Google", logitech: "Logitech", razer: "Razer", corsair: "Corsair", keychron: "Keychron", anker: "Anker", belkin: "Belkin", shure: "Shure", focusrite: "Focusrite", oakley: "Oakley", garmin: "Garmin", fitbit: "Fitbit", xbox: "Xbox", nintendo: "Nintendo", lenovo: "Lenovo", asus: "ASUS", msi: "MSI", hp: "HP", dell: "Dell", acer: "Acer" };

function cleanTitleInfo(raw) {
  let t = String(raw || "").replace(/[™®©]/g, "").replace(/[★⭐🔥✨💥🎁❤️✅🆕]+/g, " ").replace(/\s+/g, " ").trim();
  const toolOnly = /\btool[- ]only\b|\bbare[- ]tool\b|\(no battery\)|\bno battery\b/i.test(t);
  // parenthetical / bracketed noise
  t = t.replace(/[\(\[][^\)\]]*[\)\]]/g, (g) => (PAREN_NOISE.test(g) ? " " : g));
  t = t.replace(/\btool[- ]only\b|\bbare[- ]tool\b|\bno battery( or charger)?( included)?\b/gi, " ");
  t = t.replace(/\*+[^*]+\*+/g, " ").replace(/!{2,}/g, " ").replace(/\bw\/\b/gi, "with ");
  t = t.replace(NOISE_PHRASES, " ");
  // separators and leftovers
  t = t.replace(/\s*[|•·]\s*/g, " - ").replace(/\s*-\s*-\s*/g, " - ").replace(/,\s*,/g, ",").replace(/\s+/g, " ").trim();
  t = t.replace(/^[\s\-–—,:;/]+|[\s\-–—,:;/]+$/g, "").replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s+/g, " ").trim();
  t = t.replace(/\s+(20(2[4-9]))$/, "");
  // casing: shouting words become Title Case unless they are known acronyms or brand spellings
  t = t.split(" ").map((w) => {
    const bare = w.replace(/[^a-z0-9\-]/gi, "").toLowerCase();
    if (BRAND_CASE[bare]) return w.replace(new RegExp(bare, "i"), BRAND_CASE[bare]);
    if (/^[A-Z][A-Z0-9\-]{3,}$/.test(w) && !/\d/.test(w) && !ACRONYMS.has(bare)) return w[0] + w.slice(1).toLowerCase();
    if (/^[A-Z]{2,3}$/.test(w) && !ACRONYMS.has(bare) && bare.length === 3 && !/^(max|pro|air|new|the|and|for|all|set|kit|usb|led)$/.test(bare)) return w;
    return w;
  }).join(" ");
  // length: cut at a word boundary, never leaving an open bracket
  if (t.length > 80) { t = t.slice(0, 80); t = t.slice(0, Math.max(40, t.lastIndexOf(" "))); }
  t = t.replace(/\s*\([^)]*$/, "").replace(/[\s\-–—,:;/]+$/g, "").trim();
  return { name: t || String(raw || "Item").slice(0, 80), toolOnly };
}
function cleanTitle(t) { return cleanTitleInfo(t).name; }

const ACCESSORY_WORDS = ["case","cases","cover","covers","skin","skins","stand","mount","holder","bracket","strap","band","cable","cord","adapter","charger","battery","batteries","protector","sleeve","pouch","bag","filter","filters","blade","blades","bit","bits","replacement","spare","parts","decal","decals","sticker","stickers","grip","grips","hook","clip","tray","shelf","lanyard","tether","wrap","pad","pads","insert","inserts","insole","insoles","laces","manual","box only","empty box","remote only","controller only","cap","caps","keycap","keycaps","dock","cradle","film","screen protector","lens cap","hood"];
const KEYWORD_STOP = new Set(["tool","only","new","retired","set","sets","with","box","unlocked","refurbished","renewed","bundle","kit","edition","series","the","a","an","of","for","and","in","to","exclusive","premium","promo"]);
const BRAND_ALIASES = { milwaukee: ["milwaukee"], dewalt: ["dewalt","de walt"], makita: ["makita"], ryobi: ["ryobi"], dyson: ["dyson"], ninja: ["ninja"], vitamix: ["vitamix"], kitchenaid: ["kitchenaid","kitchen aid"], "instant pot": ["instant pot","instapot"], focusrite: ["focusrite"], shure: ["shure"], "audio-technica": ["audio-technica","audio technica"], jbl: ["jbl"], sony: ["sony"], bose: ["bose"], nintendo: ["nintendo"], logitech: ["logitech"], xbox: ["xbox","microsoft"], playstation: ["playstation","sony"], dualsense: ["dualsense","sony","playstation"], nike: ["nike","jordan"], adidas: ["adidas"], "new balance": ["new balance"], iphone: ["apple","iphone"], ipad: ["apple","ipad"], macbook: ["apple","macbook"], airpods: ["apple","airpods"], pixel: ["google","pixel"], samsung: ["samsung","galaxy"], seiko: ["seiko"], casio: ["casio","g-shock"], citizen: ["citizen"], anker: ["anker"], "ray-ban": ["ray-ban","rayban","ray ban"], oakley: ["oakley"], belkin: ["belkin"], lego: ["lego"], "hot wheels": ["hot wheels","hotwheels"], funko: ["funko"], nerf: ["nerf"], keychron: ["keychron"], razer: ["razer"], corsair: ["corsair"], gopro: ["gopro"], garmin: ["garmin"], yeti: ["yeti"], stanley: ["stanley"] };
function brandOfKeyword(kw) { const k = String(kw || "").toLowerCase(); return Object.keys(BRAND_ALIASES).sort((a, b) => b.length - a.length).find((b) => k.includes(b)) || null; }

/**
 * Reasons a listing is not the product the keyword asked for: clones ("For Milwaukee…"),
 * accessories and parts ("…Stand for Focusrite", "…Battery for Dyson"), unbranded items,
 * or titles that don't contain the keyword at all. Empty array = fine.
 */
function titleProblems(rawTitle, keyword, brandAspect) {
  const problems = [];
  const t = " " + String(rawTitle || "").toLowerCase().replace(/[^a-z0-9+&/\- ]/g, " ").replace(/\s+/g, " ") + " ";
  if (/^\s(for|fits?|fit for|compatible|compatibl|replacement|replaces|aftermarket|generic|universal|upgrade for)\b/.test(t)) problems.push("clone or accessory ('for/fits/compatible' title)");
  if (/\b(compatible with|fits? (for|most|all|the)|replacement for|aftermarket|generic|unbranded|no brand|3rd party|third[- ]party|for use with|works with|designed for|suitable for)\b/.test(t)) problems.push("compatible-with wording");
  // the part of the title before any "with / includes / +" describes the product; after it, the extras
  const core = t.split(/\b(with|includes?|incl|plus)\b|\s[+&]\s/)[0];
  const kw = String(keyword || "").toLowerCase();
  // Only flag accessory words when the search itself is for a main product; a search for
  // "anker power bank" or "usb-c hub" is an accessory category and gets a pass here.
  const keywordIsAccessory = /\b(power bank|charger|charging|hub|cable|case|stand|mount|adapter|battery|batteries|protector|strap|band|keycaps?|dock|holder|wallet|bag|sleeve|grip|pad|mat)\b/.test(kw);
  const accessory = (!kw || keywordIsAccessory) ? null : ACCESSORY_WORDS.find((w) => new RegExp("\\b" + w.replace(/ /g, "\\s") + "\\b").test(core));
  if (accessory) problems.push(`accessory/part (${accessory})`);
  if (kw) {
    const tokens = kw.split(/[^a-z0-9\-]+/).filter((w) => w && !KEYWORD_STOP.has(w));
    const missing = tokens.filter((w) => !t.includes(w.replace(/-/g, " ")) && !t.includes(w.replace(/-/g, "")) && !t.includes(w));
    if (missing.length) problems.push(`keyword mismatch (${missing.join(", ")})`);
    const brand = brandOfKeyword(kw);
    if (brand) {
      const aliases = BRAND_ALIASES[brand];
      if (!aliases.some((a) => t.includes(" " + a + " ") || t.includes(" " + a))) problems.push(`brand ${brand} not in title`);
      const ba = String(brandAspect || "").toLowerCase().trim();
      if (ba && !/^(does not apply|n\/a|na|none|-)$/.test(ba)) {
        if (/unbranded|generic|universal|no brand|oem replacement/.test(ba)) problems.push("unbranded");
        else if (!aliases.some((a) => ba.includes(a)) && !aliases.some((a) => a.includes(ba))) problems.push(`brand aspect "${brandAspect}" is not ${brand}`);
      }
    }
  } else if (/\b(unbranded|generic)\b/.test(t)) problems.push("unbranded");
  return problems;
}

function buildProduct(summary, detail, evalResult, category, settings, keyword) {
  const images = [];
  const push = (u) => { if (u && /^https?:\/\//.test(u) && !images.includes(u)) images.push(u.replace(/s-l\d+\.(jpg|webp)/, "s-l1600.$1")); };
  push(detail.image?.imageUrl || summary.image?.imageUrl);
  (detail.additionalImages || summary.additionalImages || []).forEach((i) => push(i.imageUrl));
  const rawTitle = String(detail.title || summary.title || "");
  const { name: title, toolOnly } = cleanTitleInfo(rawTitle);
  const brand = detail.brand || (detail.localizedAspects || []).find((a) => a.name === "Brand")?.value || "";
  const msrp = Number(detail.marketingPrice?.originalPrice?.value || summary.marketingPrice?.originalPrice?.value) || 0;
  const originalPrice = msrp > evalResult.sale ? Math.round(msrp * 100) / 100 : null;
  const returnsDays = Number(detail.returnTerms?.returnPeriod?.value) || 0;
  const condition = CONDITIONS[Number(detail.conditionId || summary.conditionId)] || detail.condition || summary.condition || "New";
  const desc = stripHtml(detail.shortDescription || detail.description).slice(0, 600) || `${title}. ${condition} condition, ships from a top-rated US seller.`;
  const toolNote = toolOnly ? "Tool only: battery and charger are not included. " : "";
  const id = slugify(title) + "-" + shortHash(summary.itemId);
  const variants = (detail.localizedAspects || []).filter((a) => /size|storage|capacity/i.test(a.name)).map((a) => a.value).filter(Boolean);
  const color = (detail.localizedAspects || []).find((a) => /colou?r/i.test(a.name))?.value;

  return {
    id, name: title, category: category.name, categoryUrl: category.url || "/trending.html",
    tag: condition, price: evalResult.sale, originalPrice,
    discount: originalPrice ? "Save " + Math.round((1 - evalResult.sale / originalPrice) * 100) + "%" : null,
    desc, details: `${toolNote}${condition}. Ships from the US within 1 business day. ${returnsDays ? returnsDays + "-day returns accepted." : ""}`.trim(),
    rawTitle, sourceKeyword: keyword || null, toolOnly,
    brand, colors: [{ name: color || "Standard", hex: "#1C1C1C", active: true }], sizes: variants.length ? variants.slice(0, 6) : ["Standard"],
    images: images.slice(0, 8),
    source: "ebay", ebayItemId: summary.itemId, ebayUrl: detail.itemWebUrl || summary.itemWebUrl || "",
    ebayPrice: evalResult.price, ebayShipping: evalResult.ship, landedCost: Math.round(evalResult.landed * 100) / 100,
    margin: Math.round(marginAt(evalResult.sale, evalResult.landed) * 1000) / 1000,
    seller: { username: summary.seller?.username || "", feedbackPct: Number(summary.seller?.feedbackPercentage) || null, feedbackScore: Number(summary.seller?.feedbackScore) || null, topRated: !!summary.topRatedBuyingExperience },
    returnsDays, score: Math.round(evalResult.score),
    active: true, hidden: false, featured: false, priceOverride: null,
    firstSeenAt: FieldValue.serverTimestamp(), lastVerifiedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  };
}

/* ---------------------------------- sync ---------------------------------- */

const CATEGORY_PAGES = { Gaming: "/gaming.html", Phones: "/phones.html", Tech: "/tech.html", Accessories: "/accessories.html", Sneakers: "/collection.html" };
const categoryPageFor = (name) => CATEGORY_PAGES[name] || ("/category.html?c=" + encodeURIComponent(name));

async function loadSettings(db) {
  const snap = await db.collection("settings").doc("sync").get();
  const s = { ...DEFAULT_SETTINGS, ...(snap.exists ? snap.data() : {}) };
  if (!Array.isArray(s.categories) || !s.categories.length) s.categories = DEFAULT_SETTINGS.categories;
  s.targetMargin = Number(s.targetMargin) > 1 ? Number(s.targetMargin) / 100 : Number(s.targetMargin) || 0.25;
  // Weights are a mix, not absolutes: normalise so 90% or 120% totals still spread maxProducts fully.
  const totalWeight = s.categories.reduce((n, c) => n + (Number(c.weight) || 0), 0) || 1;
  s.categories = s.categories.map((c) => ({ ...c, weight: (Number(c.weight) || 0) / totalWeight }));
  s.categories = s.categories.map((c) => ({ ...c, url: (!c.url || c.url === "/trending.html") ? categoryPageFor(c.name) : c.url }));
  s.minFreshPerCategory = Math.max(0, Number(s.minFreshPerCategory ?? DEFAULT_SETTINGS.minFreshPerCategory) || 0);
  s.newPerCategoryPerRun = Math.max(s.minFreshPerCategory, Number(s.newPerCategoryPerRun) || 0);
  return s;
}

/** Refresh price and availability of every eBay-sourced product. Returns counts. */
async function refreshExisting(db, token, settings, log) {
  const snap = await db.collection("products").where("source", "==", "ebay").get();
  // Listings the admin blocked or the sync rotated out stay retired; only sold-out/ended ones are rechecked.
  const docs = snap.docs.filter((d) => d.data().ebayItemId && !["rotated out", "blocked by admin"].includes(d.data().retiredReason) && !/^screened out/.test(d.data().retiredReason || ""));
  const counts = { checked: docs.length, repriced: 0, retired: 0, restored: 0, calls: 0 };
  for (let i = 0; i < docs.length; i += 20) {
    const batch = docs.slice(i, i + 20);
    const ids = batch.map((d) => encodeURIComponent(d.data().ebayItemId)).join(",");
    const { status, json } = await api(token, `/buy/browse/v1/item/get_items?item_ids=${ids}`);
    counts.calls++;
    if (status !== 200) { log(`get_items failed (${status}): ${JSON.stringify(json).slice(0, 200)}`); continue; }
    const found = new Map((json.items || []).map((it) => [it.itemId, it]));
    const wb = db.batch();
    for (const d of batch) {
      const p = d.data(); const it = found.get(p.ebayItemId);
      const patch = { lastVerifiedAt: FieldValue.serverTimestamp() };
      const avail = it?.estimatedAvailabilities?.[0];
      const ended = !it || (avail && (avail.estimatedAvailabilityStatus === "OUT_OF_STOCK" || avail.estimatedAvailableQuantity === 0)) || (it?.itemEndDate && new Date(it.itemEndDate) < new Date());
      if (ended) {
        if (p.active) { patch.active = false; patch.retiredReason = !it ? "listing ended" : "sold out"; counts.retired++; }
      } else {
        if (!p.active && p.retiredReason) { patch.active = true; patch.retiredReason = FieldValue.delete(); counts.restored++; }
        const ev = evaluate({ ...it, buyingOptions: it.buyingOptions || ["FIXED_PRICE"] }, settings, { name: p.category });
        if (ev.price && Math.abs(ev.landed - (p.landedCost || 0)) > 0.5) {
          patch.ebayPrice = ev.price; patch.ebayShipping = ev.ship; patch.landedCost = Math.round(ev.landed * 100) / 100;
          if (!p.priceOverride) { patch.price = ev.sale; patch.margin = Math.round(marginAt(ev.sale, ev.landed) * 1000) / 1000; }
          if (ev.sale > settings.priceCeiling || marginAt(p.priceOverride || ev.sale, ev.landed) < settings.targetMargin - 0.05) { patch.active = false; patch.retiredReason = "price moved"; counts.retired++; }
          counts.repriced++;
        }
      }
      wb.set(d.ref, patch, { merge: true });
    }
    await wb.commit();
  }
  return counts;
}

async function discover(db, token, settings, existingIds, log, deps = {}) {
  const call = deps.api || api;
  const counts = { searched: 0, considered: 0, rejected: {}, added: 0, rotated: 0, calls: 0, byCategory: {} };
  const activeSnap = await db.collection("products").where("active", "==", true).get();
  const activeByCat = {}; // category -> [{ ref, data }]
  activeSnap.forEach((d) => { const p = d.data(); (activeByCat[p.category] = activeByCat[p.category] || []).push({ ref: d.ref, data: p }); });
  const blocked = new Set(settings.blockedItemIds || []);
  const toMs = (v) => (v && v.toMillis ? v.toMillis() : (v && v.toDate ? v.toDate().getTime() : (typeof v === "number" ? v : 0)));

  for (const cat of settings.categories) {
    const all = activeByCat[cat.name] || [];
    const ebayItems = all.filter((x) => x.data.source === "ebay");
    const counted = settings.countManualInQuota ? all.length : ebayItems.length;
    const quota = Math.round(settings.maxProducts * (Number(cat.weight) || 0));
    // Fill up to quota, but never add fewer than the freshness floor: a full category
    // still gets new listings and rotates its oldest ones out below.
    let need = Math.max(settings.minFreshPerCategory, Math.min(settings.newPerCategoryPerRun, quota - counted));
    counts.byCategory[cat.name] = { quota, have: counted, manual: all.length - ebayItems.length, added: 0, rotated: 0 };
    if (need <= 0 || !(cat.keywords || []).length) continue;

    const candidates = [];
    const priceMax = Math.floor(settings.priceCeiling * (1 - settings.targetMargin - PROCESSING_FEE_PCT));
    // Rotate the starting keyword each run so the same searches don't dominate.
    const kws = cat.keywords.slice(); const offset = Math.floor(Date.now() / 36e5) % kws.length;
    const ordered = kws.slice(offset).concat(kws.slice(0, offset));
    for (const kw of ordered) {
      if (candidates.length >= need * 4) break;
      const filter = [
        "buyingOptions:{FIXED_PRICE}", `conditionIds:{${Object.keys(CONDITIONS).join("|")}}`, "itemLocationCountry:US", "deliveryCountry:US",
        `price:[${Math.max(10, Math.floor(settings.priceFloor * 0.5))}..${priceMax}]`, "priceCurrency:USD"
      ];
      if (settings.requireReturns) filter.push("returnsAccepted:true");
      if (settings.requireFreeShipping) filter.push("maxDeliveryCost:0");
      const path = `/buy/browse/v1/item_summary/search?q=${encodeURIComponent(kw)}&limit=50&sort=newlyListed&filter=${encodeURIComponent(filter.join(","))}`;
      const { status, json } = await call(token, path);
      counts.calls++; counts.searched++;
      if (status !== 200) { log(`search "${kw}" failed (${status}): ${JSON.stringify(json).slice(0, 200)}`); continue; }
      for (const it of json.itemSummaries || []) {
        counts.considered++;
        if (existingIds.has(it.itemId) || blocked.has(it.itemId)) continue;
        const ev = evaluate(it, settings, cat, kw);
        if (!ev.ok) { ev.reasons.forEach((r) => { const k = r.split(":")[0]; counts.rejected[k] = (counts.rejected[k] || 0) + 1; }); continue; }
        candidates.push({ it, ev, kw });
      }
    }

    candidates.sort((a, b) => b.ev.score - a.ev.score);
    const seenTitles = new Set(ebayItems.map((x) => cleanTitle(x.data.name).toLowerCase().slice(0, 40)));
    let added = 0;
    for (const c of candidates) {
      if (added >= need) break;
      const key = cleanTitle(c.it.title).toLowerCase().slice(0, 40);
      if (seenTitles.has(key)) continue;
      const { status, json: detail } = await call(token, `/buy/browse/v1/item/${encodeURIComponent(c.it.itemId)}`);
      counts.calls++;
      if (status !== 200) continue;
      if (settings.requireReturns && detail.returnTerms && detail.returnTerms.returnsAccepted === false) continue;
      const avail = detail.estimatedAvailabilities?.[0];
      if (avail && avail.estimatedAvailabilityStatus === "OUT_OF_STOCK") continue;
      const detailBrand = detail.brand || (detail.localizedAspects || []).find((x) => x.name === "Brand")?.value || "";
      const late = titleProblems(detail.title || c.it.title, c.kw, detailBrand);
      if (late.length) { late.forEach((r) => { counts.rejected["title"] = (counts.rejected["title"] || 0) + 1; }); continue; }
      const product = buildProduct(c.it, detail, c.ev, cat, settings, c.kw);
      await db.collection("products").doc(product.id).set(product, { merge: false });
      existingIds.add(c.it.itemId); seenTitles.add(key);
      added++; counts.added++; counts.byCategory[cat.name].added++;
    }

    // Rotation: keep the category at quota by retiring the oldest, lowest-scored eBay listings.
    // Featured items and anything the admin edited by hand are never rotated out.
    const over = (counted + added) - quota;
    if (settings.rotateExcess && quota > 0 && over > 0 && added > 0) {
      const victims = ebayItems.filter((x) => !x.data.featured && !x.data.priceOverride)
        .sort((a, b) => toMs(a.data.firstSeenAt) - toMs(b.data.firstSeenAt) || (a.data.score || 0) - (b.data.score || 0))
        .slice(0, Math.min(over, added));
      if (victims.length) {
        const wb = db.batch();
        victims.forEach((v) => wb.set(v.ref, { active: false, retiredReason: "rotated out", retiredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
        await wb.commit();
        counts.rotated += victims.length; counts.byCategory[cat.name].rotated = victims.length;
        log(`${cat.name}: rotated out ${victims.length} oldest listing(s) to stay near quota ${quota}`);
      }
    }
  }
  return counts;
}

/** Re-apply the title rules to listings already in the catalog: retire clones/accessories, tidy names. */
async function rescreen(db, log) {
  const snap = await db.collection("products").where("source", "==", "ebay").get();
  const counts = { checked: 0, retired: 0, renamed: 0 };
  let wb = db.batch(), n = 0;
  const flush = async () => { if (n) { await wb.commit(); wb = db.batch(); n = 0; } };
  for (const d of snap.docs) {
    const p = d.data();
    if (p.active === false) continue;
    counts.checked++;
    const raw = p.rawTitle || p.name || "";
    const problems = titleProblems(raw, p.sourceKeyword || "", p.brand || "");
    if (problems.length) {
      wb.set(d.ref, { active: false, retiredReason: "screened out: " + problems[0], retiredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      counts.retired++; n++; log(`screened out ${p.id}: ${problems[0]}`);
    } else {
      const { name, toolOnly } = cleanTitleInfo(raw);
      if (name && name !== p.name) {
        const patch = { name, rawTitle: raw, toolOnly, updatedAt: FieldValue.serverTimestamp() };
        if (toolOnly && !/tool only/i.test(p.details || "")) patch.details = "Tool only: battery and charger are not included. " + (p.details || "");
        wb.set(d.ref, patch, { merge: true }); counts.renamed++; n++;
      }
    }
    if (n >= 400) await flush();
  }
  await flush();
  return counts;
}

/** Compile the storefront document from active, unhidden products. */
async function publishLiveCatalog(db = getFirestore("default")) {
  const snap = await db.collection("products").where("active", "==", true).get();
  const toMs = (v) => (v && v.toMillis ? v.toMillis() : (typeof v === "number" ? v : 0));
  const products = snap.docs.map((d) => d.data()).filter((p) => !p.hidden && Array.isArray(p.images) && p.images.length)
    .sort((a, b) => (b.featured === true) - (a.featured === true) || toMs(b.firstSeenAt) - toMs(a.firstSeenAt))
    .map((p) => ({
      id: p.id, name: p.name, category: p.category, categoryUrl: (!p.categoryUrl || p.categoryUrl === "/trending.html") ? categoryPageFor(p.category) : p.categoryUrl, tag: p.tag || "New",
      price: Number(p.priceOverride) > 0 ? Number(p.priceOverride) : Number(p.price), originalPrice: p.originalPrice || null, discount: p.discount || null,
      desc: p.desc || "", details: p.details || "", brand: p.brand || "", colors: p.colors || [{ name: "Standard", hex: "#1C1C1C", active: true }],
      sizes: p.sizes || ["Standard"], images: (p.images || []).slice(0, 6), featured: !!p.featured, source: p.source || "manual",
      firstSeenAt: toMs(p.firstSeenAt), score: p.score || 0
    }));
  await db.collection("catalog").doc("live").set({ products, count: products.length, updatedAt: FieldValue.serverTimestamp() });
  return products.length;
}

async function runSync({ trigger = "schedule" } = {}) {
  const db = getFirestore("default");
  const started = Date.now();
  const logLines = [];
  const log = (m) => { logLines.push(m); console.log("[catalog-sync]", m); };
  const settings = await loadSettings(db);
  const summary = { trigger, startedAt: new Date(started).toISOString(), ok: false };
  const runRef = db.collection("settings").doc("sync");
  await runRef.set({ lastRunStartedAt: FieldValue.serverTimestamp(), lastRunStatus: "running" }, { merge: true });
  try {
    if (settings.enabled === false && trigger === "schedule") { log("sync disabled in settings"); summary.skipped = true; }
    else {
      const token = await getToken();
      const existing = new Set();
      (await db.collection("products").where("source", "==", "ebay").select("ebayItemId").get()).forEach((d) => existing.add(d.data().ebayItemId));
      summary.refresh = await refreshExisting(db, token, settings, log);
      summary.rescreen = await rescreen(db, log);
      summary.discover = await discover(db, token, settings, existing, log);
      summary.published = await publishLiveCatalog(db);
      summary.apiCalls = summary.refresh.calls + summary.discover.calls;
    }
    summary.ok = true;
  } catch (err) {
    log("ERROR " + err.message);
    summary.error = err.message;
  }
  summary.durationMs = Date.now() - started;
  summary.log = logLines.slice(-40);
  const updatePayload = {
    lastRunAt: FieldValue.serverTimestamp(),
    lastRunStatus: summary.ok ? "ok" : "error",
    lastRun: summary
  };
  if (summary.ok) {
    updatePayload["lastRun.error"] = FieldValue.delete();
  }
  await runRef.set(updatePayload, { merge: true });
  return summary;
}

module.exports = { runSync, publishLiveCatalog, discover, loadSettings, rescreen, evaluate, priceFor, applyEnding, marginAt, cleanTitle, cleanTitleInfo, titleProblems, DEFAULT_SETTINGS, CONDITIONS };

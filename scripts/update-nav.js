const fs = require('fs');
const path = require('path');

const files = fs.readdirSync('.').filter(f => f.endsWith('.html'));

function getHeaderHtml(active = '') {
  return `  <header class="sticky top-0 z-40 nav-shell">
    <div class="max-w-7xl mx-auto px-6 lg:px-10 h-20 flex items-center justify-between">
      <a href="/" class="flex items-center">
        <img loading="lazy" src="/brand/logo-dark.svg" alt="BudgetThrills" class="h-7 w-auto">
      </a>
      <nav class="hidden md:flex items-center gap-10 text-[13px] font-medium" data-catalog-nav>
        <a href="/gaming.html" class="${active === 'gaming' ? 'text-lime font-semibold' : 'hover:text-lime transition'}">Gaming</a>
        <a href="/collection.html" class="${active === 'drip' ? 'text-lime font-semibold' : 'hover:text-lime transition'}">Sneakers</a>
        <a href="/phones.html" class="${active === 'phones' ? 'text-lime font-semibold' : 'hover:text-lime transition'}">Phones</a>
        <a href="/tech.html" class="${active === 'tech' ? 'text-lime font-semibold' : 'hover:text-lime transition'}">Tech</a>
      </nav>
      <div class="flex items-center gap-6 text-[13px] font-medium">
        <a href="/search.html" class="hidden sm:flex items-center gap-2 hover:text-lime transition" aria-label="Search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <span class="hidden lg:inline">Search</span>
        </a>
        <a href="/signin.html" class="hidden sm:flex items-center gap-2 hover:text-lime transition" aria-label="Sign in">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>
          <span class="hidden lg:inline">Account</span>
        </a>
        <button data-theme-toggle class="theme-toggle" aria-label="Toggle theme">
          <svg class="icon-moon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
          <svg class="icon-sun" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        </button>
        <a href="/cart.html" class="flex items-center gap-2 hover:text-lime transition">
          <span>Cart</span>
          <span data-cart-count class="hidden bg-lime text-black text-[10px] font-bold rounded-full w-4 h-4 inline-flex items-center justify-center">0</span>
        </a>
        <button data-nav-toggle class="md:hidden" aria-label="Open menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        </button>
      </div>
    </div>
    <nav data-nav-menu class="hidden md:hidden hairline-t">
      <div class="px-6 py-4 flex flex-col gap-4 text-sm">
        <a href="/gaming.html" class="${active === 'gaming' ? 'text-lime font-semibold' : ''}">Gaming</a>
        <a href="/collection.html" class="${active === 'drip' ? 'text-lime font-semibold' : ''}">Sneakers</a>
        <a href="/phones.html" class="${active === 'phones' ? 'text-lime font-semibold' : ''}">Phones</a>
        <a href="/tech.html" class="${active === 'tech' ? 'text-lime font-semibold' : ''}">Tech</a>
      </div>
    </nav>
  </header>`;
}

function getFooterShopHtml(active = '') {
  return `        <div class="eyebrow mb-5">Shop</div>
        <ul class="space-y-3 text-sm">
          <li><a href="/gaming.html" class="${active === 'gaming' ? 'text-lime' : 'hover:text-lime transition'}">Gaming</a></li>
          <li><a href="/collection.html" class="${active === 'drip' ? 'text-lime' : 'hover:text-lime transition'}">Sneakers</a></li>
          <li><a href="/phones.html" class="${active === 'phones' ? 'text-lime' : 'hover:text-lime transition'}">Phones</a></li>
          <li><a href="/tech.html" class="${active === 'tech' ? 'text-lime' : 'hover:text-lime transition'}">Tech</a></li>
        </ul>`;
}

const headerRegex = /<header class="sticky top-0 z-40 nav-shell">[\s\S]*?<\/header>/;
const footerShopRegex = /<div class="eyebrow mb-5">Shop<\/div>\s*<ul class="space-y-3 text-sm">[\s\S]*?<\/ul>/;

let count = 0;
for (const f of files) {
  if (f === 'admin.html') continue;
  let content = fs.readFileSync(f, 'utf8');
  let changed = false;

  let active = '';
  if (f === 'gaming.html') active = 'gaming';
  else if (f === 'collection.html') active = 'drip';
  else if (f === 'phones.html') active = 'phones';
  else if (f === 'tech.html') active = 'tech';

  if (headerRegex.test(content)) {
    content = content.replace(headerRegex, getHeaderHtml(active));
    changed = true;
  }

  if (footerShopRegex.test(content)) {
    content = content.replace(footerShopRegex, getFooterShopHtml(active));
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(f, content, 'utf8');
    count++;
    console.log(`✓ Completely standardized header & footer in ${f}`);
  }
}

console.log(`\nSuccessfully standardized ${count} pages.`);

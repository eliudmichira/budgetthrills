# BudgetThrills

Trendy products. Budget prices. Real thrills.

## Stack
- Static HTML
- Tailwind CSS (compiled build via `npm run build:css`)
- Vanilla JS for countdown / cart placeholder / newsletter
- All SVG branding (no PNG dependency for logos)

## Development
```bash
npm install        # install Tailwind CLI
npm run watch:css  # rebuild styles/app.css on change
python -m http.server 8770   # open http://localhost:8770
```

## Structure
```
BUDGETTHRILLS/
├── index.html             # Homepage
├── tailwind.config.js     # Tailwind theme (colors, fonts, safelist)
├── styles/
│   ├── tailwind.css       # Tailwind source (@tailwind base/components/utilities)
│   ├── app.css            # Compiled output (generated — do not edit)
│   ├── fonts.css          # @font-face declarations (Inter + JetBrains Mono)
│   └── main.css           # Custom components, light theme, animations
├── fonts/                 # Self-hosted woff2 (latin subset)
│   ├── inter/inter-latin.woff2
│   └── jetbrains-mono/jetbrains-mono-latin.woff2
├── scripts/main.js        # Countdown, cart, newsletter
├── brand/                 # Source logos (SVG)
│   ├── logo-stacked.svg   # Primary mark
│   ├── logo-dark.svg      # Horizontal (nav/email)
│   ├── logo-light.svg     # Light bg fallback
│   ├── logo-monogram.svg  # BT icon
│   └── preview.html       # Side-by-side comparison
├── favicons/              # Generated favicon set
│   ├── favicon.svg        # Modern browsers
│   ├── favicon-{16,32,180,192,512}.png
│   ├── apple-touch-icon.png
│   └── favicon.ico
├── assets/products/       # Drop product imagery here
└── README.md
```

## Brand tokens
| Token         | Hex       | Use                           |
| ------------- | --------- | ----------------------------- |
| `--bt-bg`     | `#0A0A0A` | Canvas                        |
| `--bt-bg-soft`| `#111111` | Section bands, cards          |
| `--bt-lime`   | `#A8FF00` | CTAs, "THRILLS", price accent |
| `--bt-orange` | `#FF6B2C` | Hot / urgency / sale badges   |
| `--bt-ink`    | `#E8E8E8` | Body text                     |
| `--bt-mute`   | `#8A8A8A` | Secondary text                |

## Typography
- **Display:** Inter (variable weight 100–900). Self-hosted woff2, latin subset.
- **Mono:** JetBrains Mono (variable weight 100–800). Self-hosted woff2, latin subset.

## Going to production
Before launch:
1. Replace placeholder `product-ph` divs with real product images (`/assets/products/*.webp`).
2. Wire `[data-add-cart]` and `[data-newsletter]` to whatever backend you pick (Shopify Storefront API / Klaviyo / etc.).

## Migrating to Shopify
The HTML is structured so each `<section>` maps cleanly to a Shopify section:
- Hero → `sections/hero.liquid`
- Trending → `sections/featured-collection.liquid` (loop `collection.products`)
- Deals → `sections/deal-of-the-day.liquid` (custom metafields for countdown)
- UGC → `sections/ugc.liquid` (TikTok embed widget)
- Newsletter → `sections/newsletter.liquid` (Shopify's built-in customer subscribe)

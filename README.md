# BudgetThrills ⚡

> **Autonomous Arbitrage E-Commerce Platform & High-Performance Web Storefront**
> Live Production URL: [budgetthrills.shop](https://budgetthrills.shop)

[![CI](https://github.com/eliudmichira/budgetthrills/actions/workflows/ci.yml/badge.svg)](https://github.com/eliudmichira/budgetthrills/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%20%7C%2022-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Firebase](https://img.shields.io/badge/Firebase-Functions%20%7C%20Firestore%20%7C%20Hosting-FFCA28?logo=firebase&logoColor=black)](https://firebase.google.com/)
[![Stripe](https://img.shields.io/badge/Stripe-Payment%20Processing-635BFF?logo=stripe&logoColor=white)](https://stripe.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🌟 Executive Summary

**BudgetThrills** is a full-stack e-commerce engine designed to bridge real-time wholesale/secondary marketplace supply with a curated, editorial direct-to-consumer storefront. Built from the ground up to solve the operational friction of dropshipping and arbitrage, the platform features:

1. **Automated eBay Marketplace Ingestion Engine:** High-volume inventory discovery, algorithmic screening, duplicate/clone elimination, dynamic margin pricing, and lifecycle rotation.
2. **Serverless Event-Driven Microservices:** Google Cloud Functions (2nd Gen) orchestrating idempotent order processing, secure Stripe Checkout sessions, multi-currency crypto invoices (NOWPayments), and transactional email notifications via Brevo.
3. **High-Performance Editorial Front-End:** Zero-framework, sub-millisecond DOM execution adhering to a custom **"Luxury Streetwear Minimalist"** design language, complete with dark/light theme switching, responsive viewports, and WCAG AAA compliance.
4. **Resilient Production Pipeline:** Automated GitHub Actions CI validating dynamic pricing models, line-item precision, and XML sitemaps.

---

## 🏗 Architecture Overview

```
                                      +-----------------------------------------+
                                      |         eBay Marketplace API            |
                                      +-----------------------------------------+
                                                           |
                                                (OAuth2 Client Credentials)
                                                           |
                                                           v
+--------------------------------------------------------------------------------------------------+
| Cloud Functions (Node.js 22 runtime)                                                             |
|                                                                                                  |
|   [Scheduler / Admin Trigger]                                                                    |
|              │                                                                                   |
|              ▼                                                                                   |
|      catalog-sync.js                                                                             |
|      ├── Category Weight Quota Balancer                                                          |
|      ├── Multi-Layer Risk & Heuristic Filter (Seller Rating, Top-Rated, Condition)              |
|      ├── NLP Title Sanitizer & Clone/Accessory Part Rejection                                    |
|      ├── Dynamic Profit Margin Pricing Model (MSRP deduction + fee amortization)                |
|      └── Automated Inventory Rotation (FIFO retirements for non-featured items)                  |
|              │                                                                                   |
|              ▼                                                                                   |
|      Firestore (/catalog/live & /products) <─── Image Caching (Firebase Storage)                 |
+--------------------------------------------------------------------------------------------------+
                                                           │
                                                           │ (1 Read / Client Session Cache)
                                                           ▼
+------------------------------------+             +-----------------------------------------------+
| Storefront Client (Vanilla JS)     |             | Payment & Webhook Infrastructure              |
|                                    |             |                                               |
|  • Responsive Dynamic Nav          |             |  • Stripe Checkout Sessions (/api/checkout)   |
|  • Dynamic Related Drops           |────────────>|  • NOWPayments Webhooks (/api/nowpayments-ipn)|
|  • Persistent LocalStorage Cart    |             |  • Brevo Transactional SMTP Engine            |
|  • Micro-animations & Fast DOM     |             |  • Dynamic XML Sitemap (/sitemap.xml)         |
+------------------------------------+             +-----------------------------------------------+
```

---

## 🚀 Core Technical Highlights

### 1. Algorithmic Sourcing & Catalog Sync Engine (`functions/catalog-sync.js`)
Instead of static imports, BudgetThrills runs an autonomous inventory discovery worker that queries eBay's Browse API and continuously balances the live catalog.

* **Heuristic Risk Screening:**
  * Rejects listings below a strict seller threshold (`feedbackPercentage >= 99.0%` and `feedbackScore >= 100`).
  * Enforces domestic US-only locations with guaranteed 30-day return windows and free fixed-rate shipping.
  * Filters out refurbished/damaged conditions based on strict eBay condition IDs.
* **Intelligent Clone & Part Rejection (NLP Heuristics):**
  * Automatically detects and rejects third-party compatible knockoffs (e.g., titles matching `^For\b`, `^Fits\b`, `Compatible with`).
  * Prevents accessory contamination: searches for "Milwaukee M18 Tool" will reject standalone batteries, replacement chucks, cases, or chargers.
  * Enforces brand consistency: if searching for "Focusrite Scarlett", secondary stands or generic cables are barred from entering the catalog.
* **Title Cleansing Pipeline:**
  * Strips eBay clickbait shouting (`"BRAND NEW SEALED"`, `"FREE SHIPPING!!!"`, star emojis, trailing dangling parentheses).
  * Moves qualifiers like `"(Tool Only)"` into discrete structured metadata properties while keeping titles clean and editorial.
* **Algorithmic Margin & Dynamic Pricing Model:**
  Calculates retail listing prices ensuring target net margin after payment processor fees, platform overhead, and fulfillment reserves:
  $$\text{Price} = \left\lceil \frac{\text{Landed Cost} + \text{Flat Fee}}{1 - \text{Target Margin} - \text{Variable Fee}} \right\rceil - 0.01$$
  Every price automatically conforms to custom psychological endings (e.g., `.99` or `.95`).
* **Category Quota & Rotation Engine:**
  Prevents any single category (such as Power Tools) from monopolizing the storefront. Implements a weighted FIFO queue that introduces fresh listings on each run while gracefully retiring older, un-purchased inventory (while pinning admin-curated/featured items).

### 2. Payment Gateway & Webhook Reconciliation
* **Stripe Hosted Checkout:** Native card, Apple Pay, and Google Pay support with real-time server-side line item calculations.
* **NOWPayments Crypto Rails:** IPN HMAC-SHA512 webhook signature verification with underpayment tolerance thresholds (requires $\ge 98\%$ of fiat outcome).
* **Anti-Tampering Architecture:** Front-end clients never submit price values. Checkout sessions resolve prices strictly against server-side Firestore records using cryptographic validation.

### 3. Resilient Communication & Subscription Pipeline
* **Two-Stage Lead Capture:** Homepage drops and newsletter subscriptions commit directly to Firestore before attempting external API syncs, protecting against third-party outages or IP restriction blocks.
* **Auto-Retrying Worker:** Failed API dispatches are marked as `pending` and retried automatically on every catalog sync cycle.

---

## 📂 Repository Directory Layout

```
BUDGETTHRILLS/
├── .github/workflows/
│   └── ci.yml               # Automated GitHub Actions CI workflow
├── functions/               # Firebase Cloud Functions (Node.js 22)
│   ├── index.js             # API entry points, Webhooks, Stripe & Brevo controllers
│   ├── catalog-sync.js      # eBay API crawler, NLP title sanitizer & pricing engine
│   └── package.json         # Backend dependencies (firebase-admin, stripe, etc.)
├── scripts/                 # Client-side performance scripts
│   ├── catalog-live.js      # Dynamic Firestore live-catalog synchronizer
│   ├── cart.js              # Cart state machine, promos & dynamic recommendations
│   ├── main.js              # Viewport reveal observer, mobile nav & theme toggle
│   ├── products.js          # Static catalog fallback for instant initial paint
│   └── analytics.js         # Privacy-conscious Google Analytics 4 event dispatcher
├── styles/                  # Styling architecture
│   ├── main.css             # Design tokens, hairlines, display typography, animations
│   ├── tailwind.css         # Tailwind source entry
│   └── fonts.css            # Self-hosted typography definitions (Inter + JetBrains Mono)
├── tests/                   # Native Node.js test runner suite
│   ├── discover.test.js     # Catalog rotation, quotas, and FIFO retirement tests
│   ├── pricing.test.js      # Margin algorithms and psychological pricing tests
│   ├── screening.test.js    # Clone rejection, accessory filtering, title cleanup
│   ├── stripe-lines.test.js # Line-item summation and decimal precision tests
│   └── sitemap.test.js      # XML escaping and dynamic URL generation tests
├── admin.html               # Secure authenticated admin dashboard
├── cart.html                # Persistent slide-over / page cart
├── checkout.html            # Checkout gateway
├── pdp.html                 # Dynamic product detail page template
├── index.html               # Storefront homepage
├── firebase.json            # Hosting rewrites, headers, security policies
├── firestore.rules          # Granular security rules for orders & subscribers
└── README.md                # Project documentation
```

---

## 🧪 Automated Testing & CI/CD

BudgetThrills utilizes Node.js's native test runner (`node:test` and `node:assert/strict`) for rapid, dependency-free execution:

```bash
# Execute local test suite
npm test
```

### Test Coverage Highlights:
* `tests/screening.test.js`: Confirms rejection of compatible items, knockoff batteries, unbranded stands, and verifies NLP cleanups.
* `tests/pricing.test.js`: Verifies profit margin retention at various landed costs with psychological ending validation.
* `tests/discover.test.js`: Simulates catalog rotation across quota scenarios, ensuring manual and featured overrides are never dropped.
* `tests/stripe-lines.test.js`: Verifies floating point precision and Stripe line-item reconciliation.
* `tests/sitemap.test.js`: Validates XML compliance and escaping across product slugs.

---

## 💻 Local Development & Setup

### Prerequisites
* **Node.js**: `v20.x` or `v22.x`
* **Firebase CLI**: `npm install -g firebase-tools`

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/eliudmichira/budgetthrills.git
cd budgetthrills
npm install
npm install --prefix functions
```

### 2. Environment Configuration
Create `functions/.env` (modeled after `functions/.env.example`):
```env
PUBLIC_BASE_URL=https://budgetthrills.shop
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
EBAY_CLIENT_ID=your_ebay_app_id
EBAY_CLIENT_SECRET=your_ebay_cert_id
BREVO_API_KEY=xkeysib-...
NOWPAYMENTS_API_KEY=...
NOWPAYMENTS_IPN_SECRET=...
```

### 3. Run Locally
```bash
# Run unit test suite
npm test

# Serve static frontend locally
npx serve .
```

---

## 🚢 Deployment

Deploy directly to Firebase Hosting, Cloud Functions, and Firestore:

```bash
# Login to Firebase
firebase login

# Full multi-target deploy
firebase deploy --only "hosting,functions,firestore:rules"
```

---

## 🔒 Security Best Practices

* **Content Security Policy (CSP):** Strict script, frame, and connect boundaries configured in `firebase.json` blocking untrusted third-party DOM injections.
* **Atomic Firestore Rules:** Public clients have zero read/write access to internal sync metrics, orders, or subscriber data; only authenticated admins and Cloud Function triggers possess escalated privileges.
* **Webhook Signature Verification:** Cryptographic HMAC verification across all Stripe and NOWPayments callbacks prior to order state transitions.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

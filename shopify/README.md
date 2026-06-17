# Charmé Customizer — Shopify deployment

This folder packages the customizer as a **Shopify theme app extension** (an *app
block* a merchant drops onto a product page) plus a small **proof-upload** backend
function. Finished designs are added to the cart with the native Cart AJAX API, so
**Shopify handles pricing, checkout, taxes and payments** — there is no custom
pricing engine to trust.

```
shopify/
  shopify.app.toml                       app config (scopes, CLI)
  extensions/charme-customizer/
    shopify.extension.toml               theme app extension config
    blocks/customizer.liquid             the app block (settings + loader)
    assets/                              built widget + charm cut-outs (generated)
    locales/en.default.json
  widget/
    entry.jsx                            mounts the customizer, wires the cart
    shopifyCart.js                       /cart/add.js integration + variant map
    variant-map.example.json             id → Shopify variant id mapping
  app/upload-proof.js                    serverless: store proof PNG on Shopify Files
  scripts/copy-assets.mjs                copies charm PNGs/catalogue into the extension
  test-harness.html                      local sanity check (no store needed)
```

---

## The model

| Storefront object | Shopify object |
|---|---|
| Phone case / tote base | A normal **product** (one variant per model + finish). |
| Each charm | A real **product/variant** the brand already sells (Grande £3, Midi/Mini £2…). |
| A finished design | One **cart line item per object**, joined by a shared `_design_token`, with the styled-preview image (`_proof`) and full layout (`_layout` JSON) as line-item properties. |

Because every charm is a real variant, the cart total is correct automatically and
each order tells the maker exactly which physical charms to pick.

---

## 1. Build the widget

```bash
# from the repo root
npm install
npm run assets          # ensure charm cut-outs + catalogue exist
npm run build:shopify   # bundles widget → extensions/charme-customizer/assets/
```

This produces `charme-customizer.js` + `charme-customizer.css` and copies the 23
charm PNGs and `charm-catalog.json` into the extension's `assets/`.

## 2. Install with the Shopify CLI

```bash
npm install -g @shopify/cli @shopify/theme
shopify app config link        # links shopify/shopify.app.toml to your app
shopify app dev                # preview the app block on your dev store
# when ready:
shopify app deploy             # ships the theme app extension version
```

> The extension only needs the `write_files` scope (used by the proof uploader).
> If you skip proofs you need no scopes at all.

## 3. Add the block to a product page

Theme editor → open your **“Build your own case”** product template →
**Add block → Apps → Charmé Customizer**. Configure:

- **Variant map (JSON)** — paste from `widget/variant-map.example.json`, with your
  real variant ids. Find an id in Admin → Products → variant (the number at the end
  of the URL) or via `/products/<handle>.js`.
- **Proof upload endpoint** *(optional)* — the deployed URL of `app/upload-proof.js`.
- **After add to cart** — go to cart / open drawer / stay.
- **Widget height** — e.g. `86vh`.

## 4. (Optional) Deploy the proof uploader

`app/upload-proof.js` is a framework-agnostic Node handler. Deploy it to Vercel,
Netlify, Cloudflare Workers, or your app's backend, with env vars:

```
SHOPIFY_STORE=your-store.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_...           # Admin API token with write_files
ALLOWED_ORIGIN=https://your-storefront.com
```

It stages an upload, pushes the PNG, registers it on **Shopify Files**, and returns
the CDN URL that becomes the line item's `_proof` property. Without it, orders still
carry the `_layout` JSON so the maker can regenerate the proof.

---

## Asset hosting

The app block derives the **asset base** from any extension asset, so the bundled
charm cut-outs are served straight from Shopify's CDN — no manual URL editing. To
swap art later, replace the PNGs in `assets/` (keep the `<id>.png` names) and
re-deploy, or point the widget at Shopify Files URLs.

## Local sanity check (no store)

```bash
npm run build:shopify
cd shopify && python3 -m http.server 8090
# open http://localhost:8090/test-harness.html
```

`test-harness.html` fakes `window.Shopify` + `/cart/add.js`, so you can design and
“Add to bag” and inspect the resulting line items in `window.__lastCartAdd`.

## Theme compatibility notes

- Add to cart uses `Shopify.routes.root + 'cart/add.js'` — works on all themes.
- `cartRedirect: "drawer"` dispatches `cart:refresh` / `charme:added` events; if
  your theme's drawer listens to different events, wire them in `widget/shopifyCart.js`.
- The widget is ~200 KB gzipped (React + Ant Design bundled). Put it on the
  dedicated customizer template, not every page.

See **[MERCHANT-GUIDE.md](MERCHANT-GUIDE.md)** for the day-to-day listing and
fulfilment workflow.

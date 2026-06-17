# The Charmé Edit — Charm Customizer

An interactive customizer for **charm phone cases & canvas totes**, inspired by
[thecharmeedit.com](https://thecharmeedit.com). Customers drag real charms onto a
true-to-scale product, the app checks for overlaps and off-product placement in
real time, prices the design live, and produces two order proofs. A built-in
**Merchant Studio** turns plain charm photos into measured, background-removed
cut-outs that feed the catalogue.

Two builds live in this repo:

| Build | Folder | What it is |
|------|--------|-----------|
| **Standalone app** | `src/` | React + Vite + Ant Design app you iterate on with `npm run dev`. |
| **Shopify embed** | `shopify/` | The same customizer bundled as a Shopify **theme app extension** that adds finished designs to the cart. |

---

## Quick start (standalone)

```bash
npm install
npm run assets      # one-time: download + cut out the real charm catalogue
npm run dev         # http://localhost:5173
```

- **Customise** tab — the customer experience.
- **Merchant studio** tab — charm intake (upload → background removal → measure → export).

## How it works

### Charm tiers → interaction types
| Tier | Type | Behaviour |
|------|------|-----------|
| **Grande** | 1 · Statement | Fixed size. Drag (desktop) or tap-to-add, then reposition. |
| **Midi** | 2 · Feature | Resizable within a min/max range. Drag on, then scale/rotate. |
| **Mini** | 3 · Filler | Tap to **scatter** automatically into the free gaps. |

### Physical-scale model
Products and charms are described in **millimetres** (`src/data/products.js`,
`src/data/catalog.json`). The stage derives a px-per-mm scale to fit the viewport,
so a 3.2 cm shell looks correctly large on a 7.8 cm phone and correctly small on a
38 cm tote. Collision and boundary maths run in mm (`src/lib/geometry.js`,
oriented-bounding-box SAT + rounded-rect containment), independent of zoom.

### Validation
Charms that overlap each other, sit over the camera plateau, or hang off the edge
are outlined in red and block checkout until resolved.

### Two order proofs (`src/lib/exportImage.js`)
1. **Maker proof** — Statement charms exact; Feature & Filler as dashed placement zones.
2. **Styled preview** — Statement exact; Feature & Filler shown with sample charms.

## Asset pipeline (`npm run assets`)
`scripts/process-assets.mjs` downloads real product photography, knocks out the
background with a corner-seeded flood fill (keeping interior highlights), trims to
the artwork, derives a real-world size from the brand size guide, and writes
`public/assets/charms/*.png` + `src/data/catalog.json`. The Merchant Studio does
the same thing at runtime in the browser for one-off intake.

## Project layout
```
src/
  App.jsx                     mode switch (Customise / Merchant studio)
  customizer/CustomizerPage   orchestrates state, drag, drawers, pricing
  components/
    ProductStage.jsx          pointer-drag surface + selection toolbar
    ProductCanvas.jsx         SVG phone case / tote (scales crisply)
    CharmTray.jsx             catalogue browser (tabs by tier)
    ProductPicker.jsx         base + finish picker
    PriceBar.jsx              live price + validation + submit
    SummaryModal.jsx          two proofs + order summary
    MerchantStudio.jsx        upload → cut-out → measure → export
  lib/  geometry · catalog · exportImage
  data/ products.js · catalog.json (generated)
scripts/process-assets.mjs    build-time asset pipeline
shopify/                       Shopify theme app extension + docs
```

## Build
```bash
npm run build           # standalone production build (dist/)
npm run build:shopify   # Shopify widget bundle into the extension
```

## Shopify
See **[shopify/README.md](shopify/README.md)** for deployment and
**[shopify/MERCHANT-GUIDE.md](shopify/MERCHANT-GUIDE.md)** for the merchant
listing-and-selling flow.

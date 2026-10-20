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

### Import / sync Shopify decorations
In Merchant Admin → Decorations → Charms or Patches, use **Import / sync Shopify
variants**. First enter an optional naming-rule keyword (case-insensitive,
matching product titles, variant titles or handles). Leave it blank to scan all
variants. Scanning is read-only.

The review modal shows **New / missing** variants first, followed by existing
catalogue items, with search and independent checkboxes. Hidden catalogue items
still count as linked. Nothing is selected automatically. Confirm saves only the
checked items directly to Shopify catalogue metaobjects; no second Publish click
is needed. Unchecked existing items are neither changed nor deleted. Checked
existing items refresh their linked Shopify price only, preserving edited names,
images, dimensions and visibility.

New items use Shopify names, images and store-currency prices; they start at
Midi / 16 × 16 mm and must have their physical size, category and artwork checked
after import. Variants without images cannot be imported; sold-out variants can.
Items with missing/deleted variant associations remain visible but cannot be
price-synced. Confirmation rechecks current links, uses stable import IDs and
reports per-item failures so retrying does not duplicate successful imports.
Shopify credentials must be configured; this workflow does not write to the
legacy D1 backend.

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
All products have no upper limit on charm or patch quantity, including repeated
picks of legacy flat-price bundle charms. Minimum order quantities still apply;
the 12–15 charm suggestion is guidance, not a cap. Pricing groups continue to
charge per quantity block, and legacy flat-price bundles bill once per charm id.

Charms that overlap each other, sit over the camera plateau, or hang off the edge
are outlined in red and block checkout until resolved.

### Shopify prices and browser recovery
In Shopify cart/editor mode, the selected product, charm/patch cards, pricing
groups and order summary use Shopify contextual variant prices for the active
country and currency. The product picker uses those prices for phones, totes
and frames, not the catalogue's stored base-price estimates. Product quote
resolution follows the same variant precedence as the cart. Quotes expire after
one minute and refresh while the editor is visible or regains focus.

Price requests bypass the browser HTTP cache, time out after eight seconds per
attempt and retry once. Final failures or missing prices open a recovery dialog
with a retry button, guidance to switch browser/profile, and a fallback to send a
design screenshot to support@thecharmeedit.com or Instagram @the.charme.edit for a
direct quote. Retrying preserves the current design. A failed
catalogue API read returns an error rather than a successful empty catalogue.
No unconfirmed design can be submitted in Shopify cart/editor mode.

### Two order proofs (`src/lib/exportImage.js`)
1. **Maker proof** — Statement charms exact; Feature & Filler as dashed placement zones.
2. **Styled preview** — Statement exact; Feature & Filler shown with sample charms.

### Save a design link
The preview/order summary for phone cases, totes and frames includes a read-only
**Design link**, a copy button and a reminder to save the link as a backup on
desktop and mobile. The link restores the selected product, finishes, charm
positions and typed words, including both tote sides, without relying on local
browser storage. Opening a backup link does not replace an existing cart design;
prices are reloaded for the market carried by the link.

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

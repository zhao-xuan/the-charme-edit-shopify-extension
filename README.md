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
existing items refresh their linked Shopify price only by default, preserving
edited names, images, dimensions and visibility. Enable **Also remove backgrounds
from selected existing catalogue images** to repair previously imported photos;
this replaces the current catalogue artwork with its transparent cut-out, rather
than fetching a replacement product photo. Names, dimensions and visibility
remain unchanged.

After confirmation, the modal shows **Auto-remove backgrounds** and **Save to
Shopify** progress. New images are automatically processed locally in the browser
using the existing standalone extractor, then uploaded to Shopify Files as
transparent PNGs. Already-transparent images are preserved. Keep the window open
until syncing finishes. Use a single decoration on a clean, plain background;
ambiguous/multiple subjects and unreadable images fail explicitly without saving
the original background. Fix failed artwork using a transparent PNG or the manual
auto-extract tool, then retry; successful items are kept.

New items use Shopify names and store-currency prices; they start at
Midi / 16 × 16 mm and must have their physical size, category and artwork checked
after import. Variants without images cannot be imported; sold-out variants can.
Items with missing/deleted variant associations remain visible but cannot be
price-synced. Confirmation rechecks current links, uses stable import IDs and
reports per-item failures so retrying does not duplicate successful imports.
Shopify credentials must be configured; this workflow does not write to the
legacy D1 backend.

### Catalogue deletion and storefront sync
The live theme opens the designer at `https://design.thecharmeedit.com/editor/`,
a custom domain bound to the existing Cloudflare Pages project. Phone, tote,
mobile purchase and cart-edit links must use this host rather than navigating
to `pages.dev`, which triggers Shopify's external-site confirmation. API calls
may still use the production Pages origin. The cart market handoff also upgrades
legacy designer links without changing their query parameters or design hash.

Admin and customer builds use the same API origin (including on Pages previews,
unless `CharmeConfig.apiBase` explicitly selects another backend). Deleting a
charm is immediate: no Publish step is required. The admin reports success only
after Shopify confirms deletion and a fresh catalogue read no longer contains
the item. This removes the catalogue entry, not the linked Shopify product or
variant.

Newly opened customizers bypass the catalogue cache. Already-open, visible
customizers refresh every 30 seconds and on focus/return; with the server's
30-second cache, changes normally appear within 60 seconds after a successful
save. Deleted/hidden decorations disappear from the tray and from restored or
open designs, with a warning when a design changes. Published phone charms are
authoritative: local admin drafts cannot restore deleted items. If Shopify
cannot refresh an expired catalogue, the API fails explicitly instead of
returning an old successful snapshot; checkout remains blocked until recovery.
Deploy both the standalone and Shopify widget builds for these client-side
refresh changes to take effect.

### Charm size studio
Selecting a charm prepares a tightly cropped transparent cut-out for the live
size preview, removing plain backgrounds and transparent padding. The size slider
is enabled after preparation; it scales the visible artwork rather than the
original photo's blank canvas. Size edits automatically save the same prepared
PNG and absolute millimetre dimensions to Shopify. Preparation failures are shown
in the studio and block size saves until the artwork is replaced. Edits made
while an earlier save is in flight are saved after that request completes.
Save failures stay visible with a **Retry save** action; artwork still being
processed by Shopify is not persisted as an empty image reference.

### Linking Shopify billing variants
The variant picker searches Shopify directly by product name, product handle or
numeric variant ID, rather than relying only on the initial catalogue download.
Search is debounced and paginated; spelling separators such as spaces and hyphens
are ignored in local matches. Search errors appear inside the dropdown with a
retry action instead of being shown as an empty catalogue. Sold-out variants can
still be linked (their availability is shown in the option); this does not change
Shopify inventory or make them purchasable. A selection retains its current
Shopify price when adding a charm or product, including results absent from the
initial download.

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

### Stable mobile workspace
Adding or removing a decoration already covered by the current price quote does
not restart price loading. Quote requests track the distinct Shopify billing
variants, including both tote sides and pricing groups; market changes and quote
expiry still trigger fresh confirmation. Mobile validation and price notices
share a fixed two-line, scrollable status area so updates do not resize the
preview or move the charm tray.

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

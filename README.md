# The Charmé Edit — Charm Customizer

> **Public Shopify app track (2026-10-25):** The new [Product Studio](doc/product-studio.md)
> uses five shared editing workflows across 25 product templates. The Shopify
> app configuration at the repository root publishes the Product Studio theme
> block and embedded merchant home. The original charm editor and Shopify
> widget below remain as single-store legacy code. See the
> [release readiness checklist](shopify/APP_STORE_READINESS.zh-CN.md) before
> configuring or submitting the public app.

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
| **Legacy Shopify widget** | `shopify/` and `public/widget/` | Single-store charm customizer retained for the existing shop. |
| **Public Shopify Studio** | `src/studio/`, `functions/api/studio/`, `extensions/charme-customizer-theme/` | Five editing workflows, merchant review and a theme app block. |

---

## Quick start (standalone)

```bash
npm install
npm run assets      # one-time: download + cut out the real charm catalogue
npm run dev         # http://localhost:5173
```

- **Customise** tab — the customer experience.
- **Merchant studio** tab — charm intake (upload → background removal → measure → export).

On mobile, the charm selector starts at 42% of the workspace so customers can
browse complete charm rows immediately. Drag the divider to adjust the preview
and selector balance.
Mobile totes show the patch collections directly without a redundant
single-option "Patches" category switch.
Selected decorations use a large curved double-ended rotation arrow along the
dashed circle, with a 44px-wide touch target. Grabbing either end preserves the
current angle until the pointer moves.

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

### Pending drafts and Publish
Existing catalogue edits (including charm size) save immediately; they do not
need **Publish**. Publish uploads new browser-local drafts only. The **Pending
drafts** panel exposes old uploads and auto-extracted charms, including drafts
that predate required Shopify variant bindings. Search for and link the correct
variant there, or explicitly discard an unwanted local draft. Discarding does
not delete any live catalogue item or Shopify product. Draft bindings and
discards are saved in this browser.

Publishing first reads a fresh catalogue and checks every new charm's binding.
Missing bindings stop the operation before any drafts are uploaded. An exact
catalogue ID already present online is cleared from the pending queue without
overwriting its live dimensions, image or variant. Similar names are never
automatically merged. Each successful upload is removed from the local queue
immediately, so retrying after a later failure does not upload those items again.
The charm API also validates all variant references in a batch before uploading
any images or writing catalogue entries.

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

Phone photo crop coordinates are calibrated to the source canvas in
`src/data/official-phone-case-image-bounds.json`. The stage and order proofs use
the same normalized crop, including when a CDN serves resized artwork. When
replacing artwork, update its crop and camera keep-out together. iPhone XR's
current black/white 1024 × 1536 images share the shell crop
`left=104, top=210, width=816, height=1131`; the old 823-pixel-wide calibration
must not be reused. Existing flattened order proofs do not update automatically.

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
share a content-sized status area, capped at two scrollable lines. On all product
pages, the area collapses completely when empty, leaving more room for browsing
decorations above the cart button without resizing the preview.

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
The iPhone Duo black/white cutouts can be reproduced with
`node scripts/import-iphone-duo.mjs [source-directory]`. The catalog uses Apple's
[folded dimensions](https://www.apple.com/iphone-duo/specs/) (84.1 × 117.8 mm),
with a measured horizontal camera keep-out; the images retain their original
phone colours and remove only the border-connected background.
With the existing Shopify environment configured, run
`node --env-file=.env scripts/publish-iphone-duo.mjs --apply` to upload both
finishes and bind only Duo to its existing sellable base variant and live price.
Use `--verify` instead to check the publication without changing the store.

Merchant Admin's **Import / sync Shopify variants** requires either a fresh
Shopify embedded session or the existing standalone admin token. Outside Shopify,
enter that token in the sync dialog (or Admin header); Shopify login is not
required. If authentication is rejected, correct the token and retry. A scan is
read-only, and retrying an interrupted save preserves already-saved items.

See **[shopify/README.md](shopify/README.md)** for deployment and
**[shopify/MERCHANT-GUIDE.md](shopify/MERCHANT-GUIDE.md)** for the merchant
listing-and-selling flow.

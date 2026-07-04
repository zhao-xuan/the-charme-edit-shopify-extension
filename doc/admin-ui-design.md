# Admin UI design — merchant-driven customization platform

> Context: today the app is a bespoke charm customizer for **one** brand
> (The Charmé Edit). To reach the App Store we must generalise it so **any**
> merchant can stand up their own "glue charms/pieces onto a product" experience
> with minimal effort. This doc designs the **admin (merchant-facing) UI** around
> four real needs.

Related: data lives in Shopify (see [shopify-storage.md](./shopify-storage.md)).
Current admin implementation: [src/components/AdminPage.jsx](../src/components/AdminPage.jsx).

---

## 0. Design principles

1. **Time-to-first-charm < 5 minutes.** A merchant should get a working
   customizer on a product page fast, before learning any advanced feature.
2. **Progressive disclosure.** Three effort levels, same data model:
   - *Instant*: import existing products, use a starter charm pack.
   - *Bulk*: upload one flat-lay photo → AI splits it into charms.
   - *Manual*: upload/edit charms one by one for full control.
3. **Everything is reviewable.** AI and import steps always land in an editable
   review grid before publish — never auto-publish guesses.
4. **The merchant's store is the source of truth** (metaobjects + Files), not us.

---

## 1. Onboarding & catalogue import

Goal: cover as many merchants as possible; let them reuse what they already have.

### 1.1 Import existing Shopify products (auto)
- On first open, call the Admin API and show the merchant's **existing products**.
- Let them tag which products are **customizable bases** (case / frame / tote / …)
  and which are **charms/add-ons** (they may already sell charms as products —
  e.g. the `add-on-charms` collection).
- One click "Import as charm" reads the product's featured image + price +
  title → creates a `charme_charm` metaobject. Price/size are pre-filled from the
  product; merchant confirms size (see §4 for auto-sizing).

### 1.2 Import an existing charm/piece list (CSV / JSON)
- Accept a CSV/JSON upload: `name, price, category, tier, width_mm, height_mm,
  image_url`. Map columns in a preview table (handle messy headers).
- Fetch each `image_url`, run background-removal, store via Files API.
- Also accept a Shopify **collection** as the source (pull every product in it).

### 1.3 Starter packs
- Offer a few ready-made charm packs (gold/silver/gems/letters/seasonal) the
  merchant can clone into their store to demo instantly, then edit/replace.

### 1.4 Primary path: upload charm image + price
- The core, always-available flow: drag in a transparent (or any) PNG, set price,
  category, tier, physical size. This is the current [AdminPage](../src/components/AdminPage.jsx)
  behaviour — keep it as the "manual" tier, but make it faster (batch drop,
  inline edit, auto background-removal, size suggestion).

**Import review grid** (shared by all of the above): a table/gallery of pending
charms with inline-editable `name / price / category / tier / size / hidden`,
per-row confidence + warnings, and a bulk **Publish** action.

---

## 2. Which products can be customized? (research) & per-product UI

The engine is "place small pieces onto/around a base image with real-world mm
sizing + keep-out zones." That generalises far beyond phone cases. Group products
by **UI archetype** so we implement 4 renderers, not 40 product types.

### Archetype A — Flat 2D surface with keep-outs *(current phone-case model)*
Base photo, printable rectangle, exclusion zones (camera/lens). Charms are draggable, rotatable, size in mm.
- **Phone cases** ✅ (camera keep-out)
- **Laptop sleeves / tablet cases / e-reader cases**
- **Journals / notebooks / planner covers**
- **AirPods / earbud cases** (small, hinge keep-out)
- **MagSafe wallets / card holders**
- **Luggage tags, passport covers**

### Archetype B — Rectangular print canvas (aspect + DPI) *(current frame model)*
A bounded canvas with an aspect ratio and print-resolution guardrails; pieces or
uploaded art placed within.
- **Photo frames / canvas prints / posters / wall art** ✅
- **Apparel print area** (t-shirts, hoodies, tote print panel) — front/back panels
- **Tote / canvas bags** ✅ (soft-surface print area)
- **Greeting cards / wedding stationery / invitations**
- **Stickers / sticker sheets**

### Archetype C — Small-object charm attach *(the charm metaphor, 1:1)*
Base is a small object; pieces "clip/glue" on. Same as phone case but different
base image + smaller/different keep-outs. **Highest-affinity category.**
- **Croc-style clogs / shoes (Jibbitz)** — extremely close analog, big market
- **Charm bracelets / necklaces / anklets** — literally charms
- **Keychains / bag charms / phone charms**
- **Hair clips / claw clips / scrunchies**
- **Press-on nail sets** (place charms on nails)
- **Pet collars / pet ID tags**
- **Hats / caps** (pin/patch placement), **denim jackets** (patches/pins)
- **Christmas ornaments / baubles**, **cake toppers**

### Archetype D — Cylindrical / wrap (2.5D)
A flat "wrap rectangle" mapped to a curved surface; edit flat, optionally preview
with a mockup warp.
- **Mugs / tumblers / water bottles / cans**
- **Candles / jars**, **pencil cases**

### Per-archetype UI differences
| Aspect | A (surface+keepout) | B (print canvas) | C (small attach) | D (cylindrical) |
|--------|--------------------|------------------|------------------|-----------------|
| Base | product photo | blank/framed canvas | small object photo | unrolled wrap |
| Guides | keep-out rects | aspect + DPI/bleed | attach points/keep-out | seam + safe margins |
| Sizing | mm via product width | mm + print DPI | mm (small) | mm around circumference |
| Warnings | overlaps camera | low-res / out of bleed | too many pieces | crosses seam |
| Preview | flat photo | framed mockup | flat photo | curved mockup |

**Admin implication:** when a merchant adds a customizable product they pick an
**archetype template**, then set: base image, physical dimensions, keep-out zones
(a simple rectangle drawing tool over the base photo), and price. The archetype
drives which storefront renderer and guardrails load — no per-product code.

> Recommendation: ship **A + C first** (they share almost all logic and cover the
> highest-value long tail: cases, shoes, bracelets, keychains, clips). Add **B**
> (already have frame/tote) and **D** later.

---

## 3. Matching the merchant's storefront theme

The widget must feel native to each merchant's theme. Layered strategy:

### 3.1 Ship as a Theme App Extension (App Block + App Embed)
- Merchants add the customizer via the **Theme Editor** as an *app block* on the
  product template (and an *app embed* for the global trigger). This gives us a
  **schema of settings** the merchant configures visually, with a live preview —
  the standard, review-friendly Shopify way (avoids the current "merchant
  re-pastes Liquid by hand" problem noted in the repo).

### 3.2 Inherit the theme's design tokens (auto-match)
- Online Store 2.0 themes (Dawn et al.) expose CSS custom properties:
  `--color-foreground`, `--color-background`, button radius, and font faces via
  the theme's `settings`. Render the widget's chrome with `inherit` /
  `currentColor` / `var(--…)` and `font-family: inherit` so it picks up the
  theme's typography and colours automatically.
- Use the block schema's **`color_scheme` setting type** so the merchant maps the
  widget to one of their own defined colour schemes (best-practice, future-proof).

### 3.3 Auto-sample from the live page
- On mount, read `getComputedStyle` of representative elements: `body`
  (font-family, base colour), the theme's **Add-to-cart button** (background,
  text colour, border-radius, border) → derive the widget's accent + button style
  so our CTA visually matches the theme's primary button without configuration.

### 3.4 Explicit overrides in the block settings
- Provide a small, safe set of overrides in the Theme Editor: accent colour,
  button shape (pill/rounded/square), font (theme font vs. a chosen webfont),
  corner radius, light/dark, trigger label/placement. Show a live preview in the
  admin.

### 3.5 Isolate our internals
- The customizer's *internal* UI (Ant Design) runs inside a full-screen overlay;
  scope its styles (shadow DOM or a strict class prefix) so the theme can't break
  it and it can't leak into the theme. Only the **trigger button + top bar**
  adopt theme tokens — the rest is our controlled surface.

> Net: **inherit tokens by default → auto-sample the page → allow explicit
> overrides**, all delivered through a Theme App Extension so it's editor-native
> and passes app review.

---

## 4. "Upload one photo, we do the rest" — AI charm split + sizing

Lowest-effort path: the merchant uploads **one flat-lay photo of their charms**
(optionally on the product) and we auto-produce individual, priced, correctly
sized charms. (We already have a classic-CV version of this in
[scripts/track-and-measure-pieces.mjs](../scripts/track-and-measure-pieces.mjs) —
productise it and add a vision-LLM path.)

### 4.1 Two engines, same output
- **Vision LLM** (GPT-4o / equivalent): send the image, get back strict JSON of
  bounding boxes + labels + category/tier + suggested mm size + suggested price.
- **Classic CV** (our sharp pipeline): background/desk detection → connected
  components → per-piece crop. More precise boxes, no semantic labels.
- **Best combo:** CV for *precise cut-outs*, LLM for *naming/category/price/size
  sanity*. Merge on overlap.

### 4.2 Establishing real-world size (the hard part)
Pixels alone can't give millimetres. Offer the merchant one of:
1. **Known base object as ruler** — "these sit on an iPhone 16 Pro Max case
   (81.6 mm wide)" → scale from the detected case width (exactly today's method).
2. **Include a reference** — a coin or a printed ruler in the shot; detect it.
3. **Type one known dimension** — merchant enters the width of any one charm; we
   scale the rest.
4. **Fallback tiers** — map size to `grande/midi/mini` presets if no scale given
   (clearly flagged as estimated).

### 4.3 Prompt / contract (vision-LLM path)
Ask for **strict JSON only**, with enums and a scale hint. Sketch:

```
System: You are a product-catalogue vision assistant. Return ONLY valid JSON.
User (with image):
  The image is a flat-lay of decorative charms.
  Scale hint: the white phone case in the image is 81.6 mm wide  (or: "no scale").
  For EACH distinct charm return:
    { "box": [x0,y0,x1,y1] normalized 0..1,
      "name": short human label,
      "category": one of ["gold","silver","colourful","natural"],
      "tier": one of ["grande","midi","mini"],
      "width_mm": number, "height_mm": number,   // use the scale hint
      "suggested_price": number,                  // from price tiers below
      "confidence": 0..1 }
  Price tiers: mini=2, midi=2, grande=3 (merchant-editable).
  Do not merge touching charms; do not include the case, desk, ruler or shadows.
  Output: { "charms": [ ... ] }
```

- Server validates JSON against a schema; rejects/repairs malformed output.
- Use the returned normalized boxes to **crop** from the original high-res image
  (client canvas or server sharp), run background removal → transparent PNG →
  Files API.

### 4.4 Human-in-the-loop review UI (critical)
After a run, show an **extraction review** screen:
- Grid of proposed charms, each: cropped preview, editable name/category/tier,
  size (mm) with a "measured vs estimated" badge, suggested price, confidence.
- Low-confidence / probable-duplicate / merged items flagged.
- Tools: **split** a box (drag a divider), **merge** two, **re-crop** (drag
  handles), **delete**, **re-run with a better scale hint**.
- Bulk edit (set price/category for selection) → **Publish selected**.

### 4.5 Guardrails
- Rate-limit / cost-cap the LLM calls per shop; queue big images.
- Never publish without merchant confirm (principle §0.3).
- Cache the raw upload so re-runs don't re-upload.
- Show estimated cost/time for large sheets.

---

## 5. Proposed admin IA (information architecture)

```
Charmé admin (embedded in Shopify Admin)
├── Home / Setup checklist        → time-to-first-charm guidance
├── Products (customizable bases)
│    └── Add base → pick ARCHETYPE (A/B/C/D) → image, size, keep-outs, price
├── Charms & pieces
│    ├── Add manually (upload + price)          ← always available
│    ├── AI split (upload one photo)            ← §4
│    ├── Import (Shopify products / CSV / collection)  ← §1
│    └── Review grid (edit + publish)
├── Presets / saved designs        → digitised looks that auto-load per product
├── Storefront appearance          → theme tokens, button style, trigger, preview  ← §3
└── Orders / proofs                → design token + proof PNG per order
```

---

## 6. Build order (recommendation)

1. Generalise the base-product model to **archetypes A + C** (share logic).
2. Ship the **Theme App Extension** (app block/embed) + token inheritance (§3.1–3.3)
   to fix the manual-Liquid pain and pass review.
3. Make the **manual charm upload** flow fast (batch, inline edit, bg-removal,
   size suggestion) + the **import** flows (§1).
4. Add **AI split** with the review grid (§4) as the headline "easy" feature.
5. Add archetype **B** (reuse frame/tote) then **D** (cylindrical) for reach.

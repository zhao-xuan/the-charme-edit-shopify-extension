# Selling custom charm pieces on Shopify — merchant guide

This guide walks through listing and selling your customisable charm cases & totes
on Shopify, **from a merchant's point of view** — what to set up once, what happens
when a customer designs a piece, what lands in your order, and how to fulfil it.

---

## 0. The big picture

A finished design becomes a **normal Shopify order** made of several line items:

```
Order #1042
 ├─ iPhone 17 Pro case — White · Glitter gel      £48.00   ← base product
 │    _design_token: cd_ylh7pg6g
 │    _proof:        https://cdn.shopify.com/.../charme-cd_ylh7pg6g.png
 │    _layout:       { …charm positions in mm… }
 ├─ Spiral Shell · Gold (charm)                    £3.00   ← real charm product
 ├─ Ancient Riviera · I (charm)                    £2.00
 └─ Ancient Riviera · II (charm)                   £2.00
                                          Total    £55.00
```

You don't maintain a separate price list — **each charm is a real product**, so the
maths is Shopify's. The `_design_token` ties the lines together; the `_proof` image
and `_layout` JSON tell you exactly what to build.

---

## 1. One-time setup

### 1.1 Create the base products
Create one product per blank you offer (e.g. *Custom iPhone 17 Pro Case*, *Classic
Canvas Tote*). Add a **variant for each model + finish** (White Glitter / White /
Black). Set the base price (the case/tote itself). These match the entries in the
customizer's product picker.

> Tip: keep a dedicated product template (e.g. `product.customizer`) for these so
> the customizer block only loads where you need it.

### 1.2 Create the charm products
You likely already sell charms individually. Make sure each charm the customizer
offers exists as a **product/variant** with the right price (Grande £3, Midi £2,
Mini £2, etc.) and **inventory tracking** on. The customer's chosen charms are added
as their own line items, so stock decrements automatically.

### 1.3 Upload the charm cut-outs
The customizer needs transparent PNGs of each charm. Either:
- ship them inside the app extension (default — `npm run build:shopify` copies them), or
- upload them to **Content → Files** and point the catalogue at those URLs.

New charm? Use the **Merchant Studio** (in the standalone app) to drop a photo on a
plain background → it removes the background, measures the real size, and exports a
cut-out PNG + a catalogue JSON entry. Add both to the catalogue and re-deploy.

### 1.4 Install the customizer
Follow **[README.md](README.md)**: build, `shopify app deploy`, add the **Charmé
Customizer** block to the base product template, and paste your **variant map**
(charm/product id → Shopify variant id). Optionally deploy the proof uploader so the
design image is saved with each order.

---

## 2. The customer journey (what the buyer sees)

1. Opens the *Build your own* product page → the customizer loads.
2. Picks a base (model + finish) — the price starts at the base price.
3. Drags **Statement** & **Feature** charms on, taps **Filler** charms to scatter.
   The running total updates with every charm.
4. Overlapping or off-product charms turn red and **block checkout** until fixed —
   so you never receive an unbuildable layout.
5. Hits **Preview & order** → sees two proofs (maker proof + styled preview) and a
   line-item breakdown → **Add to bag** → normal Shopify checkout.

---

## 3. What you receive per order

On the order page (and via the Orders API / webhooks) each line item carries
**properties**. Properties prefixed with `_` are hidden from the customer but stored
on the order:

| Property | On | Meaning |
|---|---|---|
| `_design_token` | every line | Groups the case + its charms for one design. |
| `Design` | base | Human summary, e.g. “12 charms”. |
| `Finish` | base | Chosen colour/finish. |
| `_proof` | base | URL of the styled-preview PNG (if the uploader is enabled). |
| `_layout` | base | Full JSON: product, every charm’s id, **x/y in mm**, scale, rotation, total. |
| `_role: charm` | charms | Marks the add-on charm lines. |

### Reading the two proofs
- **Maker proof** — Statement charms are exact; Feature & Filler are dashed *zones*.
  Use it as the technical placement guide; you finalise Feature/Filler by hand within
  those zones (this is why those tiers are “resizable” / “scatter”).
- **Styled preview** — what the customer expects it to look like. Use it for the
  customer-facing confirmation and your QA photo comparison.

If you didn't enable the uploader, regenerate either proof from `_layout` (the JSON
has every position in millimetres).

---

## 4. Fulfilment workflow

1. **Pick** the base + each charm line (they're real SKUs, so your pick list is the
   order itself).
2. **Lay out** using the maker proof / `_layout` mm coordinates on the physical case.
3. **Finalise** Feature & Filler placement by hand within the marked zones.
4. **QA** against the styled preview, photograph, and mark fulfilled.

Suggested order admin hygiene:
- Add an automatic **tag** `custom-design` (Shopify Flow: *order created → contains a
  line item with property `_design_token` → add tag*) so these route to your
  made-to-order queue.
- Put your lead time in the product description and order confirmation (these are
  hand-finished, made-to-order pieces).

---

## 5. Pricing & merchandising options

- **Charms as line items (default).** Transparent, automatic, decrements charm stock.
  The cart shows the case + each charm.
- **Single rolled-up price.** Prefer one clean line? Use **Shopify Functions
  (cart transform / bundles)** to merge the charm lines into the case line at
  checkout, or **Draft Orders** with a custom total. Keep `_layout` for the maker.
- **Grouped stone pricing.** In **Merchant Admin → Charms → Grouped pricing**, set
  the number of pieces and price for each started block. Styles matching the same
  rule share one allowance; for example, 7 Filling Stones at 6 per block charge
  two £1.50 blocks. Native cart mode also needs a Shopify billing variant whose
  price equals the configured block price; Draft Orders use the configured price.
- **Design fee / deposit.** Add a fixed “Bespoke design” product if you charge for
  the service on top of materials.
- **Min/refundable rules.** The customizer already enforces “no overlaps / on-product
  only” and “at least one charm”, so every order is buildable.

---

## 6. Inventory, returns & curation

- **Inventory:** because charms are real variants, overselling protection and
  low-stock alerts just work. Hide a charm from the customizer by removing it from the
  catalogue (or mark the variant unavailable and prune the variant map).
- **Returns:** personalised, made-to-order goods are typically final sale — state this
  clearly on the PDP and confirmation. Keep the `_proof` as your record of what was
  approved.
- **Seasonal curation:** swap the catalogue (cut-outs + `catalog.json`) and re-deploy
  to launch new collections; the three tiers (Statement / Feature / Filler) keep
  designs balanced automatically.

---

## 7. Go-live checklist

- [ ] Base products + variants created, priced, templated.
- [ ] Charm products/variants exist, priced, inventory tracked.
- [ ] Charm cut-outs uploaded; catalogue updated.
- [ ] App deployed; customizer block added; **variant map** filled in.
- [ ] (Optional) Proof uploader deployed; endpoint set on the block.
- [ ] Flow rule tags custom orders; lead time shown on PDP + confirmation.
- [ ] Test order placed end-to-end; proof + `_layout` verified on the order.

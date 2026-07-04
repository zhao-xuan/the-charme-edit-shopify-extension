# Storing merchant / user assets in Shopify (no self-managed database)

> Goal: when this app ships to the Shopify App Store, **do not run our own
> database**. Store every merchant's uploaded phone-case photos, charm cut-outs,
> prices, sizes and saved layouts inside **their own Shopify store**, using
> Shopify-native storage. This gives per-merchant isolation, backups, GDPR and
> data-residency **for free**.

---

## 1. Where we are today (Cloudflare) vs. where we're going (Shopify)

Today the catalogue lives in Cloudflare and is **globally shared** (one dataset
serving `thecharmeedit.com`):

| Data | Today (Cloudflare) | Defined in |
|------|--------------------|------------|
| Charm / product **metadata** (name, price, size, tier, category…) | D1 SQL tables `charms`, `products`, `presets`, `overrides` | [schema.sql](../schema.sql) |
| **Images** (case photos, charm cut-out PNGs) | KV, keyed `img:<imageKey>` | [functions/api/image/[key].js](../functions/api/image/%5Bkey%5D.js) |
| Read API for the storefront widget | `GET /api/catalog`, `GET /api/image/<key>` | [functions/api/catalog.js](../functions/api/catalog.js) |
| Write API (admin) | `POST/PATCH/DELETE /api/admin/*` | [functions/api/admin/](../functions/api/admin) |

For the App Store version this must become **per-shop** and **Shopify-hosted**:

| Data | Shopify-native replacement | API |
|------|----------------------------|-----|
| Images (case photos, charm cut-outs) | **Files API** → hosted on `cdn.shopify.com` | `stagedUploadsCreate` + `fileCreate` (Admin GraphQL) |
| Charm / product-config / preset **metadata** | **Metaobjects** (one definition per entity type) | `metaobjectDefinitionCreate`, `metaobjectCreate/Update/Delete` |
| Small per-shop flags / app config | **App-owned metafields** (app-data / app-reserved namespace) | `metafieldsSet` |
| Actually sellable SKUs (the physical case/tote/frame) | **Products / Variants** | `productCreate`, `productVariantsBulkCreate` |

---

## 2. The two Shopify storage primitives

### 2.1 Files API — images
- Upload flow (Admin GraphQL):
  1. `stagedUploadsCreate` → returns a signed upload target (S3-style URL + params).
  2. `PUT`/`POST` the image bytes to that target.
  3. `fileCreate` with the returned `resourceUrl` → Shopify ingests it and, once
     `fileStatus = READY`, exposes a permanent `image.url` on `cdn.shopify.com`.
- Result: replaces our KV `img:<key>` store. Instead of `/api/image/<key>` we
  store the Shopify CDN URL (or the File GID) on the metaobject.
- Good fit: charm cut-out PNGs (transparent), case body photos, generated proof
  PNGs. Fast global CDN, no egress cost to us.

### 2.2 Metaobjects — structured catalogue
Think of a **metaobject definition** as a table and each **metaobject entry** as
a row. Suggested definitions (per shop):

**`charme_charm`** (one per charm)
| field | type | notes |
|-------|------|-------|
| `name` | single_line_text | |
| `image` | file_reference | → Files API image |
| `category` | single_line_text (enum) | gold / silver / colourful / unique |
| `tier` | single_line_text (enum) | grande / midi / mini |
| `type` | integer | 1 fixed / 2 size / 3 scatter |
| `price` | number_decimal | |
| `width_mm` / `height_mm` | number_decimal | physical size (the "ruler") |
| `px_w` / `px_h` | integer | source pixel dims |
| `hidden` | boolean | |
| `bundle` / `bundle_max` | boolean / integer | flat-price multi-pick |
| `source` | single_line_text | uploaded / ai-split / imported |

**`charme_product`** (customizable base: case / tote / frame / …)
| field | type | notes |
|-------|------|-------|
| `name` | single_line_text | |
| `kind` | single_line_text (enum) | phone / tote / frame / … (see admin-ui-design.md) |
| `body_image` | file_reference | |
| `base_price` | number_decimal | |
| `width_mm` / `height_mm` | number_decimal | print/keep-out geometry |
| `keepouts` | json | camera/lens/handle exclusion rects |
| `shopify_product` | product_reference | link to the real sellable Product |
| `colour_label` | single_line_text | |

**`charme_preset`** (a saved / digitised design → auto-load)
| field | type | notes |
|-------|------|-------|
| `handle` | single_line_text | Shopify product handle it belongs to |
| `title` | single_line_text | |
| `layout` | json | full arrangement (see below) |
| `active` | boolean | |

**`charme_design`** (optional: a customer's saved in-progress design)
- Same `layout` json; can be attached to a **draft order** / **order** as a
  metafield instead, so it travels with the purchase.

> The `layout` JSON is the same shape used today (see the `presets` comment in
> [schema.sql](../schema.sql)): `{ productId, caseColourId, gelColourId,
> charms:[{charmId, cxMm, cyMm, wMm, hMm, rot, …}] }`.

---

## 3. Field size & quota limits (design around these)

> ⚠️ Shopify changes limits over time — **verify against the current docs before
> relying on exact numbers.** Approximate at time of writing:

- **Metaobject definitions per shop**: limited (order of a couple hundred) — we
  only need ~4, so fine.
- **Metaobject entries**: large (tens of thousands per definition) — a merchant's
  few hundred charms is comfortable.
- **Metafield / metaobject field value size**: text/JSON fields cap out in the
  low-MB range; a single field is **not** meant to hold a whole image. Our
  `layout` JSON (historically < 4 KB) fits easily. If a layout ever grows large,
  store it as a **file** and keep a `file_reference` instead.
- **Images**: always via Files API (never base64 in a field).
- **Admin API rate limits**: GraphQL uses a calculated-cost leaky bucket. Bulk
  imports (a merchant uploading 300 charms) must be **throttled / queued** and
  ideally use `bulkOperationRunMutation` for large writes.

---

## 4. Read paths (storefront widget)

The customer-facing widget must read the catalogue without an admin token:

- **Storefront API**: mark the metaobject definitions as *storefront-visible* and
  query them with a Storefront access token. Charm images come back as
  `cdn.shopify.com` URLs.
- **or App Proxy**: expose `/apps/charme/catalog` → our thin Cloudflare/Worker
  function calls the Admin API server-side and returns JSON (keeps tokens off the
  client, lets us cache).

Either way we keep a **very thin** Functions layer (CORS, response shaping, draft
orders, AI split) — it just stops being the **database**.

---

## 5. Auth model

- Writes (admin) use the app's **Admin GraphQL** access token, obtained via the
  session-token → token-exchange flow (we already run the `client_credentials`
  variant for draft orders — see repo notes). The embedded admin page mints an
  App Bridge **session token**; the backend exchanges/verifies it per shop.
- No shared secret, no shared DB: each shop's token only touches that shop's
  metaobjects & files.

---

## 6. Migration plan (incremental, low-risk)

1. **Define** the metaobject definitions + Files usage via a one-time
   `metaobjectDefinitionCreate` run on app install (`app/uninstalled` cleans up if
   needed).
2. **Dual-write**: change [functions/api/admin/](../functions/api/admin) writes to
   also create Files + metaobjects (keep D1 as a fallback during transition).
3. **Read switch**: change [functions/api/catalog.js](../functions/api/catalog.js)
   (or an App Proxy) to read metaobjects; keep the same JSON response shape so the
   widget ([src/lib/catalog.js](../src/lib/catalog.js)) is untouched.
4. **Seed**: on install, optionally seed a default charm set into the merchant's
   store (import their existing products/charms — see admin-ui-design.md §1).
5. **Retire** D1/KV once every merchant is on metaobjects. `thecharmeedit.com`
   itself just becomes "merchant #1".

---

## 7. What stays on our side

- The **AI charm-split** service (vision model calls) and heavy image processing —
  Shopify won't do that. It runs in our Functions/Worker, then the *results*
  (cut-outs + metadata) are written into the merchant's Shopify store.
- Ephemeral compute, caching, the widget bundle on CDN.

**Bottom line:** images → **Files API**, structured catalogue → **Metaobjects**,
sellable items → **Products**. No self-managed database; per-merchant isolation is
automatic. The only thing we host is stateless compute (widget, AI split, proxy).

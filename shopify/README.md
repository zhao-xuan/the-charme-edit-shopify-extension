# Charmé Customizer — Shopify deployment

The customizer drops onto any Online Store 2.0 theme as a **single Liquid
section**. Everything — the widget code, all 379 charms, every case / gel render
and the live catalogue — is served from your **Cloudflare Pages** deployment
(`charme-customizer.pages.dev`), so this is genuinely one file to paste.

**Checkout stays 100% native Shopify.** The widget runs on your storefront page
(not an iframe), so "Add to bag" posts to `/cart/add.js` — the cart, checkout,
payment, taxes and the order in Shopify Admin are all handled by Shopify. The
CDN only serves code + art; it never touches money or orders.

```
shopify/
  snippets/charme-customizer.liquid        ← the drop-in snippet (paste this)
  widget/
    entry.jsx                 mounts the customizer, loads the live catalogue, wires the cart
    shopifyCart.js            /cart/add.js integration + variant map
    variant-map.template.json id → Shopify variant map (generated; fill it in)
  app/upload-proof.js         optional serverless proof-image uploader
  test-harness.html           local sanity check (no store needed)
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

### Price confirmation
Cart/editor prices come from Shopify's contextual variant pricing, including
pricing-group variants and tote patches, rather than stored catalogue prices or
rounded exchange-rate estimates. Product variant resolution matches the cart;
quotes refresh after a minute and on focus. Missing prices or request failures
show a browser-recovery dialog and keep unconfirmed orders blocked. Retry keeps
the design in place. Advise customers to save their design link before clearing
site data or changing browsers, because local drafts do not transfer.

---

## 1. Publish the widget to your Cloudflare Pages CDN

The widget is hosted on the same Pages project that already serves the catalogue
and charm art.

```bash
# from the repo root
npm install
npm run build:shopify   # bundles the widget → public/widget/charme-customizer.{js,css}
npm run build           # copies public/ → dist/
npx wrangler pages deploy dist --project-name charme-customizer --branch production
```

> `--branch production` is required — it targets the live domain. A plain
> `wrangler pages deploy` (or `npm run deploy`) publishes to the **Preview**
> environment (`main.charme-customizer.pages.dev`), not the production domain.

This serves the bundle at
`https://charme-customizer.pages.dev/widget/charme-customizer.js` (+ `.css`).

## 2. Add the app block to your theme (recommended)

The app now includes a Theme App Extension block:

- `extensions/charme-customizer-theme/blocks/charme-customizer.liquid`

Install/deploy the app, then in Shopify Theme Editor:

1. Open a product template.
2. Add block -> Apps -> **Charme customizer**.
3. Configure the block settings (API base, order mode, variant map JSON).

This is the preferred path for App Store distribution because merchants do not
need to copy or edit theme code manually.

## 3. Add the snippet to your theme (legacy/manual)

1. **Online Store → Themes → ⋯ → Edit code**.
2. Under **Snippets**, *Add a new snippet* → name it `charme-customizer` → paste
   all of [`snippets/charme-customizer.liquid`](snippets/charme-customizer.liquid) → **Save**.
3. In the **theme editor**, add a **Custom Liquid** block where you want it and
   put `{% render 'charme-customizer' %}` (e.g. on a “Build your own case” page).

## 4. Connect orders + payment

The section's **Order method** setting has two options.

### A) Add to cart / drawer (default)

The design drops into the native Shopify **cart / cart drawer** (so the customer
can keep shopping), then checks out through Shopify's normal cart. It's added
with `/cart/add.js` and the drawer is re-rendered via the Section Rendering API
(works out of the box on Dawn / OS 2.0 drawers; falls back to the cart page).

Design-proof uploads have no client-side timeout for any product (phone case,
tote or frame), including both tote sides and the standalone editor cart flow.
The upload progress stays visible while the request is pending, and cart items
are prepared only after the uploads are confirmed. Network errors, interrupted
uploads and invalid server responses still surface a retry message.

To price it, Shopify needs real variants — but only a handful thanks to the
**price-point map**. Paste a **Variant map (JSON)** into the section (start from
[`widget/variant-map.template.json`](widget/variant-map.template.json)):

```json
{
  "products":     { "iphone-16-pro:white": 4711, "iphone-16-pro:black": 4712 },
  "charmByPrice": { "2": 5002, "3": 5003, "5": 5005 }
}
```

- **`products`** — one variant per case model + finish; key is
  `"<modelId>:<white|black>"` (a bare `"<modelId>"` also works). Add-to-bag adds
  1 of this at the case base price, carrying the design (proof + layout).
- **`charmByPrice`** — the easy path: create just a few generic "Charm" products
  (there are only **3 charm prices: £2, £3, £5**) and map each price → its
  variant id. Every charm at that price uses it (quantities merged). Each charm's
  name/position rides in the base line's `_layout` for the maker.
- **`charms`** *(optional)* — map a specific charm id → its own variant to
  override the price-point map for that charm.

### B) Draft order → hosted checkout (no variants)

Set **Order method → Draft order**. The widget POSTs the design to the Pages
Function [`functions/api/shopify/draft-order.js`](../functions/api/shopify/draft-order.js),
which recomputes prices from your D1 catalogue, creates a Shopify **Draft Order**
(one line per charm + the case, proof + layout attached) and returns the hosted
**checkout URL** the customer is redirected to. The order appears in **Admin →
Orders**. No variants needed, but it goes straight to checkout (not the cart).

One-time setup (on the machine with your Cloudflare/Shopify access):

1. **Create a Shopify custom app** — Admin → **Settings → Apps and sales channels
   → Develop apps → Create an app**.
2. **Configure Admin API scopes** → add **`write_draft_orders`** → Save.
3. **Install app** → **Reveal / copy the Admin API access token** (`shpat_…`).
4. **Set the Cloudflare Pages secrets** (from the repo root):
   ```bash
   npx wrangler pages secret put SHOPIFY_STORE --project-name charme-customizer
   #  → e.g. thecharmeedit.myshopify.com
   npx wrangler pages secret put SHOPIFY_ADMIN_TOKEN --project-name charme-customizer
   #  → paste the shpat_… token
   ```
5. **Verify**:
   ```bash
   curl -X POST https://charme-customizer.pages.dev/api/shopify/draft-order \
     -H 'content-type: application/json' \
     -d '{"product":{"id":"iphone-17-pro","name":"iPhone 17 Pro","kind":"phone","color":"White"},"charms":[{"charmId":"2075d4e3-c7dd-4c32-bbd0-38bc5ddfcf9b-05","name":"Gold Letter A","price":3}]}'
   ```
   Expect `{"invoiceUrl":"https://…/invoices/…", …}`. Before the secrets are set
   it returns `503 Shopify backend not configured` — that's expected. Server-side
   base prices: phone £26, tote £16, frame £24; charm prices come from D1.

## 4b. Show it on several products

The section can go on as many product pages as you like — the same widget, once
per page:

1. In the **theme editor**, open each product (or a shared product template) and
   **Add section → “Charmé Customizer”**. Four products → add it to those four
   templates.
2. Optionally set **Start on category / Start on model** per placement so each
   product opens the customizer on a relevant device (e.g. the iPhone 16 Pro
   product page starts on `iphone-16-pro`, the tote page on `tote-tj`). Model ids
   are the `products` keys in the template (without the `:white/:black`).

Each placement gets a unique mount id automatically, so nothing collides. Cart /
order settings are shared per placement, so you can even mix modes per product.

Other section settings: **After add to bag** (drawer / cart / stay), **Widget
height**, and **Advanced → Widget CDN / API base**
(defaults to `https://charme-customizer.pages.dev`, no trailing slash).

## 4c. Customizer analytics

The widget automatically uploads privacy-safe session summaries to the private
Shopify metaobject type `charme_analytics_session`. The Admin **Analytics** tab
reports the customizer funnel, active decoration time, product/device splits,
popular decorations, and aggregate interaction counts. No customer identity,
pointer coordinates, design previews, IP addresses, or full page URLs are stored.

“Shopify handoff” means that the cart or draft-order handler accepted the design;
it does not mean the order was paid. Cart confirmation, paid orders and sources are
covered in the next section.

## 4d. Tracking & attribution

The designer runs on its own domain (`design.thecharmeedit.com`), so a shopper who
arrives from an ad, designs a case and buys it used to lose the ad as the sale's
source. This section joins the two ends. It is consent-gated and stores no
customer data (no names, addresses, e-mail, phone or customer ids).

### How a sale is traced

1. The `charme-cart-group` snippet decorates the product page's “Start designing”
   link with `ca` / `cm` (the visitor's analytics / marketing consent, read from
   Shopify's Customer Privacy API) and, only with marketing consent, `attr`: the
   last non-direct source seen on the store (UTM source / medium / campaign, the
   *names* of ad click-id parameters, referrer host and landing path; never click-id
   values). The designer's own domains never overwrite it.
2. The designer records its session with that source. Without an analytics
   signal, or if the visitor declined, it records nothing.
3. On “Add to bag” the shopper is sent to `/cart` with the session id. The snippet
   checks that the designed items really are in the cart and tells the designer
   (`POST /api/analytics/confirm`). That is the **Cart confirmed** step.
4. The `orders/paid` webhook stores a non-personal summary of designer orders only
   (order id, total, currency, test flag, Shopify's own source fields, the design
   tokens). The report joins order → design token → session → source.

**Admin → Analytics** adds the *Cart confirmed* and *Paid order* funnel steps, a
*Funnel by source* table, and *Paid orders as Shopify records them*, which shows
what Shopify itself credits so the two views can be compared.

### Deploy order

1. Update the theme's `snippets/charme-cart-group.liquid` from this repo. It is
   rendered once before `</body>` in `layout/theme.liquid` (see the install note at
   the top of the snippet).
2. Then deploy the Pages project (see the repo root).

The other way round, the new designer finds no consent signal on the old links and
records nothing. The new snippet with the old designer is harmless.

### Turning on paid orders (needs your decision)

Sources and cart confirmations work without this. Paid orders need the
`read_orders` scope and an `orders/paid` subscription. In `shopify.app.toml`:

```toml
[access_scopes]
scopes = "read_products,read_orders"

[[webhooks.subscriptions]]
uri = "/webhooks/shopify"
topics = ["orders/paid"]
```

Then run `shopify app deploy` and approve the new permission on the store. The app
is public, so Shopify may review the scope and require protected-customer-data
access first; check the Partner Dashboard before submitting a version. Until it is
active the Analytics tab says “Paid orders are not connected yet”. Webhooks are
verified with `SHOPIFY_CLIENT_SECRET`, as for the existing topics. Test-gateway
orders are excluded from the report and only counted.

### Storage and privacy

- Two D1 tables, created on first use (no migration step): `analytics_design_links`
  (design token → session) and `analytics_orders` (order summary), plus a one-row-
  per-day counter, `analytics_link_budget`. Rows older than 400 days (counters: two
  days) are purged as cart confirmations arrive.
- `shop/redact` erases both tables; `customers/redact` removes the listed orders.
- `POST /api/analytics/confirm` is a public write, so it is bounded: allowed
  origins only (a script outside a browser can still fake the header), 8 KB body,
  at most 20 design tokens per request, 30 requests per minute per IP, and a daily
  budget of 2,000 tokens shared by every caller (`DAILY_LINK_BUDGET` in
  `functions/api/_analytics-store.js`; a shop confirms a few dozen a day). Once the
  budget is used the endpoint answers 429 until the next UTC day, so a flood costs
  some attribution rather than the shared D1 write quota. It does not check that
  the session exists.
- Source fields are sanitised in the browser and again on the server, so a forged
  link cannot store anything beyond the bounded fields above.

### Referrer policy

The designer sends `Referrer-Policy: same-origin` on `/`, `/editor`, `/studio` (via
`public/_headers`) and adds the same `<meta name="referrer">` in the customer
editor. The hop back to the store then no longer carries the designer's address,
which Shopify otherwise credits as a “design.thecharmeedit.com / referral” source.
The admin and Shopify-embedded pages keep the default policy.

### Behaviour changes and limits

- **Only consenting visitors are counted.** Direct designer visits, saved-design
  links, visitors who declined, and visitors arriving through an old theme snippet
  are not recorded, so totals will be lower than before. Analytics-only consent
  appears as “(direct / unknown)”. To count visitors when no consent signal exists,
  flip `DEFAULT_ANALYTICS_WITHOUT_SIGNAL` in `src/lib/trackingContext.js`.
- A report reads about 11,000 session records (44 pages × 250). Longer periods show
  a warning that only the newest sessions are included; choose a shorter period.
  The same warning appears if Shopify throttles or stops answering part-way: the
  pages already read (the newest) are kept instead of failing the report. If the
  very first page fails the report returns an error.
  It also reads at most 20,000 cart confirmations and 5,000 orders.
- Revenue is the gross order total (refunds and cancellations are not netted).
- Orders from the draft-order flow carry the design token but no cart confirmation,
  so they appear as “not matched”.
- Shopify's `landing_site` / `referring_site` fields in the `orders/paid` payload
  are used when present; without them the order shows as “(direct / none)”.
- Whether the referrer policy makes Shopify credit the ad rather than the designer
  can only be confirmed with a real ad-click purchase after deployment.
- Not included: GA4 / Meta Pixel / server-side event forwarding.

## 5. (Optional) Proof image on cart-mode orders

In **Draft order** mode the proof PNG is stored automatically (on your Pages KV,
linked from the order). For **Native cart** mode you can additionally deploy
`app/upload-proof.js` (a framework-agnostic Node handler) to Vercel, Netlify,
Cloudflare Workers, or your app's backend, with env vars:

```
SHOPIFY_STORE=your-store.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_...           # Admin API token with write_files
ALLOWED_ORIGIN=https://your-storefront.com
```

It stages an upload, pushes the PNG, registers it on **Shopify Files**, and returns
the CDN URL that becomes the line item's `_proof` property. Without it, orders still
carry the `_layout` JSON so the maker can regenerate the proof.

---

## Local sanity check (no store)

```bash
npm run build:shopify
cd shopify && python3 -m http.server 8090
# open http://localhost:8090/test-harness.html
```

`test-harness.html` fakes `window.Shopify` + `/cart/add.js`, loads the local
widget bundle and pulls the catalogue + art from the Pages CDN, so you can design
and “Add to bag” and inspect the resulting line items in `window.__lastCartAdd`.

## Notes

- Updating charms/case art: reseed D1/KV + redeploy the Pages project (see the
  repo root). The section automatically shows the latest — no theme change and no
  re-paste, because it always loads the live catalogue + art from the CDN.
- The widget is ~240 KB gzipped (React + Ant Design bundled). Put the section on
  the dedicated customizer page/template, not every page.
- Add to cart uses `Shopify.routes.root + 'cart/add.js'` — works on all themes.
  `cartRedirect: "drawer"` dispatches `cart:refresh` / `charme:added`; if your
  theme's drawer listens to different events, wire them in `widget/shopifyCart.js`.

See **[MERCHANT-GUIDE.md](MERCHANT-GUIDE.md)** for the day-to-day listing and
fulfilment workflow.

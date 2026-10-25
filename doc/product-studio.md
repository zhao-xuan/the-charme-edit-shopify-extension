# Multi-category product studio

`/studio/` contains 19 editable product templates across seven production processes: physical decoration, patches, flat print, engraving, wrap print, embroidery, and beads. The existing case/tote/frame editor remains at `/editor/`. The merchant configuration and review queue are under `/admin?tab=studio`.

Every template starts **disabled and uncalibrated**. Customers can explore it and save a draft, but cannot submit a production request until a merchant verifies physical measurements, safe zones, keepouts, material, and process notes, then enables it. This is deliberate: seed dimensions and materials are examples, not manufacturer specifications.

The customer editor supports multiple surfaces, movable motifs, text and flattened PNG art where the process allows, undo/redo, local recovery, a downloadable JSON backup, and a review-only SVG/JSON production pack. Server validation checks supported elements, bounds, keepouts, physical-piece collisions, minimum detail, image DPI, and bead length. Saved designs carry a template snapshot and revision. Submission freezes the design; the merchant must review every surface, confirm production capability, and optionally bind a final whole-product Shopify variant. Only a reviewed design with a bound variant receives a contextual Shopify price and native cart handoff, with its design ID in line-item properties.

## Deployment and configuration

The Cloudflare Pages project is `charme-customizer` and uses the existing `DB` D1 binding. Studio tables are created on first request by Pages Functions. Production requires `SHOPIFY_STORE` (a single `*.myshopify.com` shop), the existing Shopify Admin token mechanism, and either the existing `ADMIN_TOKEN` or Shopify App Bridge session credentials. For cross-origin embedding, set `STUDIO_ALLOWED_ORIGINS` to an explicit comma-separated allowlist. The studio is same-origin by default. Do not enable a template before production measurements and fulfillment are ready.

Run `npm test`, `npm run build`, and `npm run build:shopify` before release. `npm run deploy` publishes the Pages build. Confirm `/studio/` and `/api/studio/templates` on the production domain after deployment. The new studio does not change Shopify app extensions or automatically publish Shopify app configuration.

## Remaining production gaps

- 3D product models and curved previews; wrap designs currently use 2D dielines.
- Embroidery stitch digitization (DST/PES), engraving machine paths, outlined fonts, and supplier-certified print files. Downloaded SVG is for **review only**.
- Merchant-certified sizes, print color profiles, material SKUs, stock, labor pricing, and final Shopify variants for each of the 19 templates.
- Automated order-paid webhooks, material reservation, fulfillment, and refunds. The design ID in the Shopify cart lets staff retrieve the approved design manually.
- Multi-store isolation and OAuth installation. This backend is scoped to one configured shop; it is not yet a public App Store application.

Production readiness for a category is achieved by merchant calibration, supplier file validation, complete variant pricing, and an end-to-end checkout and fulfillment rehearsal for that category. Enabling the generic template alone does not satisfy these checks.

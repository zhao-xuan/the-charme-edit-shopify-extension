# Multi-category product studio

`/studio/` starts with five shared editing workflows, then lets the customer choose a product within that workflow. There are 25 product templates across eight production processes. The existing case/tote/frame editor remains at `/editor/`, and merchant configuration and review are under `/admin?tab=studio`.

| Workflow | Editing model | Example products |
| --- | --- | --- |
| Free placement | Move motifs, text or images on a measured design surface | Bags, apparel, pencil cases, decorated frames and cases |
| Typography | Type once per fixed text area; choose font and color | Cards, engraved tags and jewelry |
| 3D jewelry | Add and order beads or pendants; rotate a Three.js parametric preview | Bracelets, necklaces and pendant necklaces |
| Image swap | Replace a fixed, center-cropped picture slot | Photo cards, frames and printed phone cases |
| Component assembly | Choose from allowed parts for each fixed slot | Modular bags and phone cases |

The server enforces the workflow as well as the production process. It ignores client coordinates for fixed text, image and component slots; rejects elements that belong to another workflow; checks component choices against their slots; and validates safe zones, keepouts, image DPI, physical-piece spacing and bead length. Jewelry exports include an ordered parametric model recipe. The SVG and JSON production pack is for review, and the 3D scene is a preview, not a manufacturing mesh.

Every template starts **disabled and uncalibrated**. Customers can explore it and save a draft, but cannot submit a production request until a merchant verifies physical measurements, safe zones, keepouts, material and process notes, then enables it. Seed dimensions and materials are examples, not manufacturer specifications. Saved merchant templates retain their calibrated settings while gaining the canonical workflow and component-slot definitions.

The editor supports multiple surfaces, undo/redo, local recovery, a downloadable JSON backup, and a review-only production pack. Saved designs carry a template snapshot and revision. Submission freezes the design; the merchant reviews every surface, confirms production capability, and may bind a final whole-product Shopify variant. Only a reviewed design with a bound variant receives a contextual Shopify price and native cart handoff, with its design ID in line-item properties.

## Deployment and configuration

The Cloudflare Pages project is `charme-customizer` and uses the existing `DB` D1 binding. Studio tables are created on first request by Pages Functions. Production requires `SHOPIFY_STORE` (a single `*.myshopify.com` shop), the existing Shopify Admin token mechanism, and either the existing `ADMIN_TOKEN` or Shopify App Bridge session credentials. For cross-origin embedding, set `STUDIO_ALLOWED_ORIGINS` to an explicit comma-separated allowlist. The studio is same-origin by default. Do not enable a template before production measurements and fulfillment are ready.

Run `npm test`, `npm run build`, and `npm run build:shopify` before release. `npm run deploy` publishes the Pages build. Confirm `/studio/` and `/api/studio/templates` on the production domain after deployment. The studio does not change Shopify app extensions or automatically publish Shopify app configuration.

## Remaining production gaps

- The jewelry preview and model recipe need supplier-approved geometry, assembly tolerances, clasp sizing and 3D manufacturing output. Cup and bottle wraps still use 2D dielines.
- Embroidery stitch digitization (DST/PES), engraving machine paths, outlined fonts, and supplier-certified print files. Downloaded SVG is for **review only**.
- Merchant-certified sizes, print color profiles, material SKUs, stock, component compatibility, labor pricing, and final Shopify variants for each of the 25 templates.
- Automated order-paid webhooks, material reservation, fulfillment, and refunds. The design ID in the Shopify cart lets staff retrieve the approved design manually.
- Multi-store isolation and OAuth installation. This backend is scoped to one configured shop; it is not yet a public App Store application.

Production readiness for a category requires merchant calibration, supplier file validation, complete variant pricing, and an end-to-end checkout and fulfillment rehearsal. Enabling the generic template alone does not satisfy these checks.

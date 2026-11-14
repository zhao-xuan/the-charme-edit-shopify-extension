# Isolated Shopify staging environment

Staging uses a separate Cloudflare Pages project, D1 database, KV namespace,
and Shopify development app. The production `wrangler.jsonc`, root Shopify app
manifest, Pages project, and production database bindings remain unchanged.

## Cloudflare resources

- Pages: `charme-editor-staging` → `https://main.charme-editor-staging.pages.dev` (separate project; its `main` branch is staging)
- D1: `charme-catalog-staging` (`89697819-e02a-41d4-868c-ed14512dc666`)
- KV: `CHARME_IMAGES_STAGING` (`0235ef639404430082a529cf82978078`)
- Pages branch: `main` (the staging project's primary branch)

Deploy the app with `npm run deploy:staging`. The build uses `--mode staging`
and reads the Shopify API key from the ignored local `.env.staging` file:

```dotenv
VITE_SHOPIFY_API_KEY=the_client_id_from_the_staging_shopify_app
```

Do not put production credentials in `.env.staging` or in Cloudflare's staging
environment.

## Shopify development app

The dedicated Shopify app has been created as `Charm-customiser-staging` and is
configured in `shopify.app.staging.toml`. Its isolated theme extension source
is `extensions/charme-customizer-theme-staging` and uses a staging-only handle.
Its client ID is also in the ignored local `.env.staging` file and the public
staging Pages vars. The app URL is
`https://main.charme-editor-staging.pages.dev/admin`. Keep the production app's
client ID and credentials out of the staging config.

Install this app only on a Shopify development store. In its test theme, set the
Product Studio block's **Studio URL (advanced)** to
`https://main.charme-editor-staging.pages.dev`. Leave production themes on the
default production URL.

## Staging Pages secrets

Set these secrets on the staging Pages project only. Wrangler prompts for each
value without echoing it:

```sh
npx wrangler pages secret put SHOPIFY_CLIENT_SECRET --project-name charme-editor-staging
npx wrangler pages secret put SHOPIFY_TOKEN_KEY --project-name charme-editor-staging
npx wrangler pages secret put TRACKING_CREDENTIALS_KEY --project-name charme-editor-staging
```

Use the staging app's client ID and secret and the development store's
`*.myshopify.com` domain. Generate independent 32-byte base64 keys for
`SHOPIFY_TOKEN_KEY` and `TRACKING_CREDENTIALS_KEY`; never reuse production keys.
The Partner API secrets, production `SHOPIFY_ADMIN_TOKEN`, and production
`ADMIN_TOKEN` are not needed for the embedded staging app and should not be
copied.

Once the staging-only secrets are set, deploy with `npm run deploy:staging`.
Verify the app session endpoint and
`https://main.charme-editor-staging.pages.dev/api/studio/templates?shop=charme-editor-staging.myshopify.com`
before installing into the development store. Do not point a live product theme
at this staging host.

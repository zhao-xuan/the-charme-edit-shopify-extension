# Case-with-gel regeneration — STATUS (2026-07-12)

Regenerating `public/assets/cases/case-with-gel/integrated-<id>-<finish>.png` from the
`case-without-gel/` base shots + the 3 gel style refs, via ChatGPT image generation
(same prompt/method as the 3 example chats: pixel-10-pro glitter/white/black).

## Method (validated, fully working)
Per image: upload IMAGE 1 = `case-without-gel/<id>-<black|white>.png` (black shell for black
gel; white shell for white & glitter) + IMAGE 2 = `reference/memor-gel-ref/ref-gel-{black|sand|glitter}.png`,
with the finish-specific master prompt (see `PROMPTS.md`; iPhone uses "camera module", Pixel "camera bar").
Download the generated image from page resources (authenticated `backend-api/estuary/content` URL,
fetched in-page), then crop to the case with `.gel-staging/crop.mjs` (density-profile case-rect
detection + rounded-rect alpha mask; per-model size-normalised so finishes align).

Raw renders live in `.gel-staging/raw/<id>-<finish>.png`; cropped in `.gel-staging/cropped/`.
`node .gel-staging/check.mjs` lists remaining. `node .gel-staging/finalize.mjs` copies only
COMPLETE-finish models into `case-with-gel/`.

## DONE (18 complete models -> 37 files delivered to case-with-gel)
iPhone: 13-pro, 14, 14-plus, 14-pro, 14-pro-max, 15, 15-plus, 15-pro, 15-pro-max,
        16, 16-plus, 16-pro, 16-pro-max, 17, 17-pro, 17-pro-max, air  (black+white each)
Pixel:  pixel-10-pro (black+white+glitter)   [reused from the 3 example chats]

Also downloaded, held back (only black done, awaiting white): iphone-13, iphone-13-mini
(their raws are in .gel-staging/raw/; finish the white then re-run crop+finalize).

## REMAINING (43 files) — BLOCKED by ChatGPT image rate limit (HTTP 429)
Run `node .gel-staging/check.mjs` for the live list. As of writing:
- iPhone black+white: 7, 7-plus, 8, 8-plus, x, xs, xs-max, 11, 11-pro, 11-pro-max,
  12, 12-mini, 12-pro, 12-pro-max, 13-pro-max
- iPhone white only: 13, 13-mini
- Pixel black+white+glitter: pixel-6-pro, pixel-7-pro, pixel-8-pro, pixel-9-pro

## To resume
The ChatGPT hourly image quota was exhausted (~40 generations). Once it resets, re-run the
same pipeline (details in the session working notes / this folder's scripts). Generations
succeed but new-chat submits get 429-throttled when fired too fast — pace them (small batches,
let each download's ~90s generation wait space out the next submit).

## Not in scope here (no `case-without-gel` base exists)
Galaxy (s22/s23/s24 +plus/ultra), Xiaomi, non-pro Pixels — these would each need a plain
silicone `case-without-gel` base generated first. (Galaxy/Xiaomi *white* with-gel files already
show uncommitted local edits — the user's own in-progress work; left untouched.)

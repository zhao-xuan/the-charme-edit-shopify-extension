# Google Pixel — case inventory & generation checklist

Goal: add every past Google Pixel phone to `public/assets/cases/case-without-gel/`
as a **plain black + white silicone case** back-view shot, matching the existing
iPhone set style (clean case on a white background, camera cut-out revealing the
real Pixel camera bar, side buttons visible).

## Key finding on sourcing
- **Official BARE-phone HD images** (no case) are freely findable for essentially
  every model → Google Store / press kit / **Wikimedia Commons**. These are the
  *reference* we feed to GPT so the model's proportions + camera bar are exact.
- **Official "phone in a PLAIN black/white silicone case" photos do NOT exist** —
  Google's first-party cases are coloured / translucent / patterned, never a plain
  black or white silicone matching our iPhone set. → **The final case image is
  GENERATED for every model** (GPT, grounded on the searchable bare-phone ref).

So the two columns below are: **Ref (bare phone) = searchable?** and
**Final case png = generate?** (the latter is always "generate").

## Legend
- ✅ searchable = official HD bare-phone image is readily available to use as the GPT reference
- 🎨 generate  = produce with GPT from the bare-phone reference
- Priority: **P1** = modern camera-bar design, real case market (do first); **P2** = legacy corner-camera, low market (optional)

## Modern — camera bar / visor (P1)  → do these first
| id | Model | Year | Camera design | Bare-phone ref | Final case png |
| --- | --- | --- | --- | --- | --- |
| pixel-6 | Pixel 6 | 2021 | full-width glossy 2-tone bar | ✅ | 🎨 black + white |
| pixel-6-pro | Pixel 6 Pro | 2021 | full-width bar (3 lens) | ✅ | 🎨 black + white |
| pixel-6a | Pixel 6a | 2022 | full-width bar (2 lens) | ✅ | 🎨 black + white |
| pixel-7 | Pixel 7 | 2022 | metal bar, 2 cut-outs | ✅ | 🎨 black + white |
| pixel-7-pro | Pixel 7 Pro | 2022 | metal bar, pill + circle | ✅ | 🎨 black + white |
| pixel-7a | Pixel 7a | 2023 | metal bar (2 lens) | ✅ | 🎨 black + white |
| pixel-8 | Pixel 8 | 2023 | bar, pill lens housing | ✅ | 🎨 black + white |
| pixel-8-pro | Pixel 8 Pro | 2023 | bar, rectangular housing (3 lens + sensor) | ✅ | 🎨 black + white |
| pixel-8a | Pixel 8a | 2024 | bar, pill housing | ✅ | 🎨 black + white |
| pixel-9 | Pixel 9 | 2024 | detached rounded pill bar | ✅ | 🎨 black + white |
| pixel-9-pro | Pixel 9 Pro | 2024 | detached pill bar (3 lens) | ✅ | 🎨 black + white |
| pixel-9-pro-xl | Pixel 9 Pro XL | 2024 | detached pill bar (3 lens) | ✅ | 🎨 black + white |
| pixel-9a | Pixel 9a | 2025 | near-flush oval camera | ✅ | 🎨 black + white |
| pixel-10 | Pixel 10 | 2025 | detached pill bar (3 lens) | ✅ | 🎨 black + white |
| pixel-10-pro | Pixel 10 Pro | 2025 | detached pill bar (3 lens) | ✅ | 🎨 black + white |
| pixel-10-pro-xl | Pixel 10 Pro XL | 2025 | detached pill bar (3 lens) | ✅ | 🎨 black + white |
| pixel-10a | Pixel 10a | 2026 | oval camera | ✅ | 🎨 black + white |

## Foldables — special form factor (P1/optional)
| id | Model | Year | Note | Bare-phone ref | Final case png |
| --- | --- | --- | --- | --- | --- |
| pixel-fold | Pixel Fold | 2023 | wide folded body, bar camera | ✅ | 🎨 black + white |
| pixel-9-pro-fold | Pixel 9 Pro Fold | 2024 | wide folded body, pill camera | ✅ | 🎨 black + white |
| pixel-10-pro-fold | Pixel 10 Pro Fold | 2025 | wide folded body, pill camera | ✅ | 🎨 black + white |

## Legacy — corner camera, weak case market (P2, optional)
| id | Model | Year | Camera design | Bare-phone ref | Final case png |
| --- | --- | --- | --- | --- | --- |
| pixel | Pixel | 2016 | glass shade + corner lens | ✅ | 🎨 black + white |
| pixel-xl | Pixel XL | 2016 | glass shade + corner lens | ✅ | 🎨 black + white |
| pixel-2 | Pixel 2 | 2017 | corner single lens | ✅ | 🎨 black + white |
| pixel-2-xl | Pixel 2 XL | 2017 | corner single lens | ✅ | 🎨 black + white |
| pixel-3 | Pixel 3 | 2018 | corner single lens | ✅ | 🎨 black + white |
| pixel-3-xl | Pixel 3 XL | 2018 | corner single lens | ✅ | 🎨 black + white |
| pixel-3a | Pixel 3a | 2019 | corner single lens | ✅ | 🎨 black + white |
| pixel-3a-xl | Pixel 3a XL | 2019 | corner single lens | ✅ | 🎨 black + white |
| pixel-4 | Pixel 4 | 2019 | square bump, top-left | ✅ | 🎨 black + white |
| pixel-4-xl | Pixel 4 XL | 2019 | square bump, top-left | ✅ | 🎨 black + white |
| pixel-4a | Pixel 4a | 2020 | square bump, top-left | ✅ | 🎨 black + white |
| pixel-4a-5g | Pixel 4a (5G) | 2020 | square bump, top-left | ✅ | 🎨 black + white |
| pixel-5 | Pixel 5 | 2020 | square bump, top-left | ✅ | 🎨 black + white |
| pixel-5a | Pixel 5a (5G) | 2021 | square bump, top-left | ✅ | 🎨 black + white |

## Totals
- P1 phones: 17 · Foldables: 3 · P2 legacy: 14  →  **34 models × {black, white} = 68 case-without-gel pngs**
- Recommended first pass: **P1 (17)** to validate the Pixel case style, then foldables, then P2.

## Status (update as we go)
- [ ] P1 bare-phone refs downloaded to `reference/gel-regen/pixel-src/`
- [x] **pixel-9-pro** FULLY DONE — case-without-gel (black+white) + case-with-gel
      (black+white+glitter), all matching refs with edge-fit. Verified.
- [ ] rest of P1 case-without-gel + with-gel
- [ ] Foldables generated
- [ ] P2 legacy generated

### Per-model done log
- pixel-9-pro ✅ (without-gel b/w, with-gel b/w/glitter)
- pixel-8-pro ✅ (without-gel b/w, with-gel b/w/glitter) — QA lum black23/white228/glitter232
- pixel-7-pro ✅ (without-gel b/w, with-gel b/w/glitter) — QA passed, visually verified
  (camera designs accurate + glitter matches ref)
- pixel-6-pro ✅ (without-gel b/w, with-gel b/w/glitter) — QA black23/white226/glitter233
- pixel-10-pro ✅ (without-gel b/w, with-gel b/w/glitter) — QA black28/white223/glitter227

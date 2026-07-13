# Gel / case generation prompts

Two prompt families:
1. **without-gel** — put a Pixel (or any bare phone) into a plain black/white silicone case (fills `case-without-gel/`).
2. **with-gel** — take a `case-without-gel` image and pour the gel slab onto the back (fills `case-with-gel/`).

Every generation is **one image at a time** (never batch) to keep HD quality — per prior guidance.

Attach these style references to every with-gel request:
- `reference/memor-gel-ref/ref-gel-black.png` (black gel)
- `reference/memor-gel-ref/ref-gel-sand.png` (white / cream gel)
- `reference/memor-gel-ref/ref-gel-glitter.png` (glitter gel) — **NOT saved yet; user must drop it**

---

## 1) without-gel prompt (Pixel → plain silicone case)

Inputs: one official HD **bare** back-view photo of `{MODEL}` (for exact body + camera-bar geometry).

> Product photograph of a **Google {MODEL}** phone seen from the **back**, fitted inside a
> **plain {COLOR} silicone phone case** (matte-satin soft-touch silicone, no logo, no text,
> no pattern). Keep the phone's real proportions, body size and the exact **{MODEL} camera
> bar / lens layout** — the case has a clean precise cut-out around the camera so the real
> camera module is fully visible. Show the side buttons through the case. The case wraps the
> phone edge-to-edge with a thin even rim. Centered, upright, straight-on rear view on a
> **pure white seamless background**, soft even studio lighting, subtle contact shadow,
> photorealistic, ultra-high-resolution, no hands, no branding, no reflections other than a
> soft sheen on the silicone.

`{COLOR}` = `black` (deep neutral black silicone) or `white` (clean warm white silicone).
Save raw → `/tmp/gen-pixel-<id>-<black|white>.png`, then key/crop into `case-without-gel/`.

---

## 2) with-gel prompt (MASTER — pure GPT, NO compositing; user: "所有请求都通过改进prompt")

Input: `case-without-gel/{id}-{black|white}.png` as **IMAGE 1** (the official shell; black finish →
black shell, white/glitter → 米白 shell). Attach the matching gel sample as **IMAGE 2**.

Baked-in fixes (the 4 user complaints): phone must stay **PIXEL-IDENTICAL** to IMAGE 1 (no
reshape/rescale → kills aspect-ratio drift); gel **hugs the case inner walls** with an almost
invisible even margin ("还有缝"); gel edges are **STRAIGHT** clean rounded-rectangle ("边缘要直");
gel colour is **FIXED** and must NOT warm-shift because the case is 米白 ("颜色变了").

> IMAGE 1 = a {COLOR} phone-in-a-case on pure white. IMAGE 2 = the gel finish to reproduce.
> Add a poured-gel slab to the back of the case, below the camera bar.
>
> ABSOLUTE — keep the phone IDENTICAL to IMAGE 1: same aspect ratio, width, height, size,
> position, camera module, buttons, case colour, framing and pure-white background,
> **PIXEL-FOR-PIXEL**. Do NOT redraw / reshape / rescale / rotate / re-frame the phone. ONLY add
> the gel on the flat back panel; the phone outline must overlay IMAGE 1 exactly.
>
> SHAPE & FIT: a LARGE rounded slab that HUGS the case as TIGHTLY as possible. Its outline is a
> rounded RECTANGLE that follows the STRAIGHT sides of the case (left/right/bottom broadly parallel to
> the case edges) with a corner radius that MATCHES the case's own rounded corners. Extend the gel
> almost ALL THE WAY to the case's inner edge — its puffy rim comes VERY CLOSE to, nearly TOUCHING,
> the left, right and bottom inner walls of the case, leaving only a very thin, even sliver of case
> visible (minimal margin, noticeably closer than a normal border). Top edge just below the camera
> bar. Overall it reads as a neat rounded rectangle — NOT a lopsided blob.
>
> EDGE — THIS IS THE KEY DETAIL, COPY IMAGE 2's EDGE EXACTLY: the whole perimeter is a THICK, PUFFY,
> RAISED, GLOSSY molten BEAD / RIM of gel that gently UNDULATES with soft organic waves all the way
> around, and it catches BRIGHT WHITE SPECULAR HIGHLIGHTS running along that wavy edge (a wet,
> poured-liquid-glass look). It is NOT a flat, thin, hard straight edge — it is a raised, glossy,
> softly-wavy bead exactly like the reference. The corners of this bead follow the case corner radius.
>
> COLOUR (fixed — must NOT change because the case is off-white/米白): **black** = deep pure
> JET-BLACK; **white** = NEUTRAL clean WHITE (never cream/beige/warm, even on an off-white case);
> **glitter** = cool PEARLESCENT / mother-of-pearl white with fine sparkle. Use IMAGE 2's colour exactly.
>
> SURFACE (reproduce IMAGE 2 exactly): wet molten poured-gel. The raised wavy RIM is glossy with the
> bright highlights (above); the CENTRE is calmer/flatter than the rim.
> - **black**: centre is flat DEEP MATTE black with NO big highlight across it; the bright glossy
>   reflections live ONLY on the raised wavy rim.
> - **white**: centre is a smooth, calm, soft-sheen NEUTRAL white; the raised wavy rim is glossier.
> - **glitter**: the whole slab is PACKED with countless TINY, FINE, DENSE, EVEN pearlescent sparkle
>   flecks, with subtle molten wave ridges flowing across, plus the puffy glossy wavy rim. NO marble
>   swirls / S-curves / streaks / big shapes — just fine dense sparkle + the wavy molten rim.
>
> Photorealistic, ultra-high-resolution, same soft studio lighting and pure white background as IMAGE 1.

Save raw → `/tmp/gel-<id>-<finish>.png`, then crop to the shell window (crop only — **no compositing**).

### Review checklist (run after each generation)
- [ ] Gel top edge flat & level, just below camera
- [ ] Gel hugs left / right / bottom case rim (tight, even margin) ← the fix
- [ ] Texture matches the reference finish (black molten / white sheen / glitter shimmer)
- [ ] Phone body, camera, buttons, proportions and background unchanged
- [ ] Bottom corners follow the case radius; no background bleed inside the gel

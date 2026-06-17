#!/usr/bin/env python3
"""
Derive a WHITE / cream iPhone case from the real Apple BLACK (Midnight) silicone
photo, while keeping the camera module (titanium plateau + glass lenses + flash)
exactly as shot.

The Charmé Edit sells these cases in White / Black gel. Apple never made a white
silicone for most models, so we recolour the real black Apple photo:

  * The whole case BODY (every non-transparent pixel outside the camera island)
    is re-mapped from its own luminance onto a clean warm-white ramp, so the
    midnight silicone — including its sheen and the etched Apple logo — becomes a
    bright beige/white that still looks 3-D.
  * The CAMERA ISLAND is detected as the largest bright (titanium) blob near the
    top of the photo; every pixel inside its bounding box is left untouched, so
    the dark glass lenses stay dark instead of being tinted cream.

Output: public/assets/cases/{model}-white.png for every {model}-black.png.
"""
import sys
from collections import deque
from pathlib import Path

try:
    from PIL import Image
except Exception:
    print("Pillow required: pip3 install Pillow", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parents[1]
CASE_DIR = ROOT / "public" / "assets" / "cases"

# Clean warm-white gel ramp: dark body -> soft beige shadow, sheen -> near white.
SHADOW = (224, 217, 202)   # darkest body becomes a soft beige (米色)
HILIGHT = (253, 251, 246)  # body sheen becomes near-pure white (纯白)
L_LO, L_HI = 24, 178       # midnight-body luminance span to stretch across the ramp

# Every model derives its white from the black photo (incl. the 17 family, whose
# stock "Vanilla" reads beige rather than white).
HAVE_REAL_WHITE = set()


def find_camera_mask(im):
    """Mask of the camera HARDWARE only (titanium plateau + the enclosed glass
    lenses), so the dark silicone rim around it is still recoloured white.

    Strategy: the largest bright blob near the top is the metal plateau; the
    lenses are dark *holes* fully enclosed by it. We return plateau ∪ holes at a
    downscaled resolution, plus the downscale factor. Returns (mask, ds) or
    (None, ds) when there is no exposed metal camera (frosted silicone cameras
    look fine fully recoloured)."""
    W, H = im.size
    ds = max(1, min(W, H) // 460)          # fine mask so the plateau edge is smooth
    sw, sh = W // ds, H // ds
    small = im.resize((sw, sh)).convert("RGBA")
    px = small.load()
    limit_y = int(sh * 0.55)

    bright = [[False] * sw for _ in range(sh)]
    for y in range(limit_y):
        row = bright[y]
        for x in range(sw):
            r, g, b, a = px[x, y]
            if a > 60 and (r + g + b) / 3.0 > 132:
                row[x] = True

    seen = [[False] * sw for _ in range(sh)]
    best_cells = None
    best = None
    best_area = 0
    for y in range(limit_y):
        for x in range(sw):
            if not bright[y][x] or seen[y][x]:
                continue
            q = deque([(x, y)])
            seen[y][x] = True
            cells = []
            minx = maxx = x
            miny = maxy = y
            while q:
                cx, cy = q.popleft()
                cells.append((cx, cy))
                if cx < minx: minx = cx
                if cx > maxx: maxx = cx
                if cy < miny: miny = cy
                if cy > maxy: maxy = cy
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < sw and 0 <= ny < limit_y and bright[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if len(cells) > best_area:
                best_area = len(cells)
                best_cells = cells
                best = (minx, miny, maxx, maxy)

    if not best or best_area < (sw * sh) * 0.003:
        return None, ds

    # island mask = the plateau cells, then fill the enclosed dark holes (lenses)
    island = [[False] * sw for _ in range(sh)]
    for (cx, cy) in best_cells:
        island[cy][cx] = True
    x0, y0, x1, y1 = best
    x0 = max(0, x0 - 1); y0 = max(0, y0 - 1)
    x1 = min(sw - 1, x1 + 1); y1 = min(sh - 1, y1 + 1)
    # flood the "outside" (non-plateau) from the plateau bbox border
    outside = [[False] * sw for _ in range(sh)]
    stack = []
    for x in range(x0, x1 + 1):
        for yy in (y0, y1):
            if not island[yy][x] and not outside[yy][x]:
                outside[yy][x] = True; stack.append((x, yy))
    for y in range(y0, y1 + 1):
        for xx in (x0, x1):
            if not island[y][xx] and not outside[y][xx]:
                outside[y][xx] = True; stack.append((xx, y))
    while stack:
        cx, cy = stack.pop()
        for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
            if x0 <= nx <= x1 and y0 <= ny <= y1 and not island[ny][nx] and not outside[ny][nx]:
                outside[ny][nx] = True; stack.append((nx, ny))
    # any non-plateau cell inside the bbox not reachable from the border = lens hole
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if not outside[y][x]:
                island[y][x] = True
    return island, ds


def recolor(src_path: Path, dst_path: Path):
    im = Image.open(src_path).convert("RGBA")
    W, H = im.size
    island, ds = find_camera_mask(im)
    sh = len(island) if island is not None else 0
    sw = len(island[0]) if island else 0
    px = im.load()
    span = float(L_HI - L_LO)

    for y in range(H):
        my = min(y // ds, sh - 1) if island is not None else 0
        for x in range(W):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            if island is not None and island[my][min(x // ds, sw - 1)]:
                continue  # camera hardware (plateau + lenses) — keep exactly
            lum = (r + g + b) / 3.0
            n = (lum - L_LO) / span
            if n < 0.0:
                n = 0.0
            elif n > 1.0:
                n = 1.0
            nr = round(SHADOW[0] + (HILIGHT[0] - SHADOW[0]) * n)
            ng = round(SHADOW[1] + (HILIGHT[1] - SHADOW[1]) * n)
            nb = round(SHADOW[2] + (HILIGHT[2] - SHADOW[2]) * n)
            # faint glitter sparkle (kept subtle so the body still reads clean)
            if ((x * 73 + y * 31) % 37) == 0:
                nr = min(255, nr + 6)
                ng = min(255, ng + 6)
                nb = min(255, nb + 6)
            px[x, y] = (nr, ng, nb, a)

    im.save(dst_path)
    return W, H, island


def main():
    made = 0
    for blk in sorted(CASE_DIR.glob("*-black.png")):
        model = blk.name[: -len("-black.png")]
        if model in HAVE_REAL_WHITE:
            continue
        dst = CASE_DIR / f"{model}-white.png"
        w, h, island = recolor(blk, dst)
        cam = "metal camera kept" if island else "frosted camera (full recolor)"
        made += 1
        print(f"· {model}: white derived  {w}x{h}  ({cam})")
    print(f"\nDerived {made} clean white cases → public/assets/cases")


main()

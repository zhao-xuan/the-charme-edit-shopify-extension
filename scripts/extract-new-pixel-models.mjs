// Segments the Porcelain (white) + Obsidian (black) front-view silhouettes out of
// Google's marketing spec-sheet renders in ~/Downloads and saves transparent PNG
// cutouts for review, mirroring the case-without-gel cutout convention.
import sharp from 'sharp';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DOWNLOADS = path.join(os.homedir(), 'Downloads');
const OUT_DIR = path.resolve('reference/new-phone-models-cutouts');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SOURCES = [
  { file: 'Pixel 9 Pro XL.png', model: 'pixel-9-pro-xl' },
  { file: 'Pixel 9 Pro Fold.png', model: 'pixel-9-pro-fold' },
  { file: 'Pixel 10 Pro.png', model: 'pixel-10-pro' },
  { file: 'Pixel 10 Pro XL.png', model: 'pixel-10-pro-xl' },
  { file: 'Pixel 10 Pro Fold.png', model: 'pixel-10-pro-fold' },
  { file: 'Pixel 11.png', model: 'pixel-11' },
  { file: 'Pixel 11 Pro.png', model: 'pixel-11-pro' },
  { file: 'Pixel 11 Pro XL.png', model: 'pixel-11-pro-xl' },
  { file: 'Pixel 11 Pro Fold.png', model: 'pixel-11-pro-fold' },
];

const PAD = 6; // px padding kept around the tight bbox

async function loadRaw(imgPath) {
  const img = sharp(imgPath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function lumAt(data, w, channels, x, y) {
  const i = (y * w + x) * channels;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

// Sample the background luminance/colour from the four corners of a region.
function sampleBg(data, w, h, channels, x0, y0, x1, y1) {
  const pts = [
    [x0 + 2, y0 + 2],
    [x1 - 2, y0 + 2],
    [x0 + 2, y1 - 2],
    [x1 - 2, y1 - 2],
  ];
  let sum = 0;
  for (const [x, y] of pts) sum += lumAt(data, w, channels, clamp(x, x0, x1), clamp(y, y0, y1));
  return sum / pts.length;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Find a horizontal "gap row" (near-uniform background) that separates the main
// front-view comparison row from any bottom/top-view row beneath it.
function findRowGap(data, w, h, channels, bgLum) {
  for (let y = Math.floor(h * 0.55); y < h - 5; y++) {
    let allBg = true;
    for (let x = 0; x < w; x += 4) {
      if (Math.abs(lumAt(data, w, channels, x, y) - bgLum) > 10) {
        allBg = false;
        break;
      }
    }
    if (allBg) {
      // confirm the next ~15px stay background too (avoid a thin gap between glyphs)
      let stable = true;
      for (let dy = 1; dy <= 15 && y + dy < h; dy++) {
        for (let x = 0; x < w; x += 8) {
          if (Math.abs(lumAt(data, w, channels, x, y + dy) - bgLum) > 10) {
            stable = false;
            break;
          }
        }
        if (!stable) break;
      }
      if (stable) return y;
    }
  }
  return h;
}

// Connected-component labelling (4-connectivity) over a foreground mask.
function labelComponents(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!mask[idx] || labels[idx] !== -1) continue;
      const id = comps.length;
      let minX = x, maxX = x, minY = y, maxY = y, area = 0;
      stack.push(idx);
      labels[idx] = id;
      while (stack.length) {
        const cur = stack.pop();
        const cy = (cur / w) | 0;
        const cx = cur % w;
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        const neigh = [
          [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1],
        ];
        for (const [nx, ny] of neigh) {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nidx = ny * w + nx;
          if (mask[nidx] && labels[nidx] === -1) {
            labels[nidx] = id;
            stack.push(nidx);
          }
        }
      }
      comps.push({ id, minX, maxX, minY, maxY, area });
    }
  }
  return { labels, comps };
}

// A near-white (Porcelain) body against a near-white background has ~0 lum
// diff in its INTERIOR, so a plain diff-threshold alpha leaves the middle
// transparent. Instead: detect the visible RIM (edge/shadow/camera contrast),
// close small gaps, flood-fill background from the crop border, and treat any
// enclosed (unreached) region as solid body — then feather only the true edge.
function buildFilledAlphaMask(data, width, channels, x0, y0, cw, ch, localBg) {
  const rim = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const l = lumAt(data, width, channels, x0 + x, y0 + y);
      if (Math.abs(l - localBg) > 8) rim[y * cw + x] = 1;
    }
  }

  // morphological close (dilate then erode) with radius r to bridge rim gaps
  const r = 3;
  const dilated = boxMorph(rim, cw, ch, r, true);
  const closed = boxMorph(dilated, cw, ch, r, false);

  // flood-fill background reachable from the crop border (4-connectivity)
  const reached = new Uint8Array(cw * ch);
  const stack = [];
  for (let x = 0; x < cw; x++) {
    pushIfBg(closed, reached, stack, x, 0, cw, ch);
    pushIfBg(closed, reached, stack, x, ch - 1, cw, ch);
  }
  for (let y = 0; y < ch; y++) {
    pushIfBg(closed, reached, stack, 0, y, cw, ch);
    pushIfBg(closed, reached, stack, cw - 1, y, cw, ch);
  }
  while (stack.length) {
    const idx = stack.pop();
    const cy = (idx / cw) | 0;
    const cx = idx % cw;
    const neigh = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
    for (const [nx, ny] of neigh) {
      if (nx < 0 || nx >= cw || ny < 0 || ny >= ch) continue;
      pushIfBg(closed, reached, stack, nx, ny, cw, ch);
    }
  }

  // solid mask: rim pixels OR pixels not reached by the background flood-fill
  const solid = new Uint8Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) solid[i] = closed[i] || !reached[i] ? 1 : 0;

  // The band near the silhouette edge is contaminated by the source photo's
  // own anti-aliasing/soft-shadow blend (body colour → background), which can
  // land on near-pure-white/near-black pixels and get marked fully opaque —
  // producing a visible halo once composited on a page background that
  // differs from the photo's own backdrop. The contaminated band's width
  // varies (wider on rounded corners with a soft shadow), so measure it with a
  // multi-source BFS DISTANCE TRANSFORM from the background rather than a
  // fixed erosion radius, and return it for colour decontamination in the caller.
  const dist = new Int32Array(cw * ch).fill(-1);
  const distQueue = [];
  let qHead = 0;
  for (let i = 0; i < cw * ch; i++) {
    if (!solid[i]) { dist[i] = 0; distQueue.push(i); }
  }
  while (qHead < distQueue.length) {
    const idx = distQueue[qHead++];
    const cy = (idx / cw) | 0;
    const cx = idx % cw;
    const d = dist[idx] + 1;
    const neigh = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
    for (const [nx, ny] of neigh) {
      if (nx < 0 || nx >= cw || ny < 0 || ny >= ch) continue;
      const nidx = ny * cw + nx;
      if (dist[nidx] === -1) { dist[nidx] = d; distQueue.push(nidx); }
    }
  }

  // feather: alpha = 255 * (fraction of solid pixels in a small neighbourhood)
  const feather = 1;
  const alpha = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -feather; dy <= feather; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= ch) continue;
        for (let dx = -feather; dx <= feather; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= cw) continue;
          sum += solid[ny * cw + nx];
          cnt++;
        }
      }
      alpha[y * cw + x] = Math.round((sum / cnt) * 255);
    }
  }
  return { alpha, solid, dist };
}

function pushIfBg(mask, reached, stack, x, y, w, h) {
  const idx = y * w + x;
  if (mask[idx] === 0 && reached[idx] === 0) {
    reached[idx] = 1;
    stack.push(idx);
  }
}

// dilate (grow=true) or erode (grow=false) a binary mask by radius r (box structuring element)
function boxMorph(mask, w, h, r, grow) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let any = false, all = true;
      for (let dy = -r; dy <= r && (any || all); dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) { if (!grow) all = false; continue; }
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const v = (nx < 0 || nx >= w) ? 0 : mask[ny * w + nx];
          if (v) any = true; else all = false;
        }
      }
      out[y * w + x] = grow ? (any ? 1 : 0) : (all ? 1 : 0);
    }
  }
  return out;
}

// Median RGB over the pixels flagged in `mask` (a crop-local binary mask),
// used as a contamination-free reference colour for the body.
function medianColor(data, width, channels, x0, y0, cw, ch, mask) {
  const rs = [], gs = [], bs = [];
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (!mask[y * cw + x]) continue;
      const si = ((y0 + y) * width + (x0 + x)) * channels;
      rs.push(data[si]); gs.push(data[si + 1]); bs.push(data[si + 2]);
    }
  }
  if (!rs.length) return null;
  const mid = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  return [mid(rs), mid(gs), mid(bs)];
}

async function extractOne({ file, model }) {
  const srcPath = path.join(DOWNLOADS, file);
  if (!fs.existsSync(srcPath)) {
    console.warn('MISSING', srcPath);
    return;
  }
  const { data, width, height, channels } = await loadRaw(srcPath);
  const bgLum = sampleBg(data, width, height, channels, 0, 0, width - 1, height - 1);
  const gapY = findRowGap(data, width, height, channels, bgLum);
  const mainH = gapY; // main comparison row (front-view pair, optional side view)

  // Build foreground mask within the main row: pixel differs from bg by lum OR
  // saturation (colour), with a margin to survive anti-aliased edges/soft shadow.
  const mask = new Uint8Array(width * mainH);
  for (let y = 0; y < mainH; y++) {
    for (let x = 0; x < width; x++) {
      const l = lumAt(data, width, channels, x, y);
      if (Math.abs(l - bgLum) > 14) mask[y * width + x] = 1;
    }
  }
  const { comps } = labelComponents(mask, width, mainH);
  const minArea = width * mainH * 0.01; // drop text/labels/small noise
  const big = comps.filter((c) => c.area > minArea).sort((a, b) => b.minX - a.minX ? a.minX - b.minX : 0);
  big.sort((a, b) => a.minX - b.minX);

  // Keep the two widest/tallest blobs as the White (left) + Black (right) bodies;
  // an optional 3rd (side view) is ignored.
  const bodies = big
    .map((c) => ({ ...c, h: c.maxY - c.minY, w: c.maxX - c.minX }))
    .filter((c) => c.h > mainH * 0.25) // tall enough to be a phone, not a caption
    .sort((a, b) => b.area - a.area)
    .slice(0, 2)
    .sort((a, b) => a.minX - b.minX);

  const labelsForCount = { 1: ['single'], 2: ['white', 'black'] };
  const names = labelsForCount[bodies.length] || bodies.map((_, i) => `part${i}`);

  for (let i = 0; i < bodies.length; i++) {
    const c = bodies[i];
    const x0 = clamp(c.minX - PAD, 0, width - 1);
    const y0 = clamp(c.minY - PAD, 0, mainH - 1);
    const x1 = clamp(c.maxX + PAD, 0, width - 1);
    const y1 = clamp(c.maxY + PAD, 0, mainH - 1);
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;

    // Local bg sample around this crop for a cleaner per-body alpha matte.
    const localBg = sampleBg(data, width, height, channels, x0, y0, x1, y1);
    const { alpha: alphaMask, solid, dist } = buildFilledAlphaMask(data, width, channels, x0, y0, cw, ch, localBg);

    // Robust interior colour (median RGB over pixels far from the edge, i.e.
    // guaranteed past the contaminated anti-aliasing/shadow band) used to
    // decontaminate that band — its raw pixels are a body→background blend
    // that can read as a bright halo once alpha is applied on a page
    // background that differs from the photo's own backdrop.
    const DECONTAM_DEPTH = 14; // px; the contaminated band can be this wide on rounded/shadowed corners
    const deepMask = new Uint8Array(cw * ch);
    for (let idx = 0; idx < cw * ch; idx++) deepMask[idx] = solid[idx] && dist[idx] >= DECONTAM_DEPTH ? 1 : 0;
    const fgColor = medianColor(data, width, channels, x0, y0, cw, ch, deepMask)
      || medianColor(data, width, channels, x0, y0, cw, ch, solid);

    const outBuf = Buffer.alloc(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const sx = x0 + x, sy = y0 + y;
        const si = (sy * width + sx) * channels;
        const di = (y * cw + x) * 4;
        const idx = y * cw + x;
        // Blend from decontaminated fgColor (at/near the edge) to the raw
        // pixel (deep interior, e.g. camera lens detail) over DECONTAM_DEPTH px.
        const w = fgColor ? Math.min(1, Math.max(0, dist[idx] / DECONTAM_DEPTH)) : 1;
        outBuf[di] = Math.round(data[si] * w + (fgColor ? fgColor[0] : 0) * (1 - w));
        outBuf[di + 1] = Math.round(data[si + 1] * w + (fgColor ? fgColor[1] : 0) * (1 - w));
        outBuf[di + 2] = Math.round(data[si + 2] * w + (fgColor ? fgColor[2] : 0) * (1 - w));
        outBuf[di + 3] = alphaMask[idx];
      }
    }

    const outName = `${model}-${names[i]}.png`;
    await sharp(outBuf, { raw: { width: cw, height: ch, channels: 4 } })
      .png()
      .toFile(path.join(OUT_DIR, outName));
    console.log('wrote', outName, `${cw}x${ch}`);
  }
}

for (const s of SOURCES) {
  const only = process.argv.slice(2).find((a) => a.startsWith('--only='))?.slice('--only='.length);
  if (only && s.model !== only) continue;
  await extractOne(s);
}
console.log('Done. Review cutouts in', OUT_DIR);

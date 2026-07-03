import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const P = 'public/assets/cases';
const OUT = 'reference/_verify/_white_transp';
fs.mkdirSync(OUT, { recursive: true });

const whites = fs.readdirSync(P).filter((f) => f.endsWith('-white.png')).sort();
const models = whites.map((f) => f.replace(/^iphone-|-white\.png$/g, ''));

async function makeTransparent(model) {
  const white = sharp(`${P}/iphone-${model}-white.png`);
  const wm = await white.metadata();
  const W = wm.width, H = wm.height;
  const blackAlpha = await sharp(`${P}/iphone-${model}-black.png`)
    .resize(W, H, { fit: 'fill' })
    .extractChannel(3)
    .raw()
    .toBuffer();
  const wrgb = await white.removeAlpha().raw().toBuffer();
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = wrgb[i * 3];
    out[i * 4 + 1] = wrgb[i * 3 + 1];
    out[i * 4 + 2] = wrgb[i * 3 + 2];
    out[i * 4 + 3] = blackAlpha[i];
  }
  return { buf: out, W, H };
}

const CELL = 150, COLS = 6;
const rows = Math.ceil(models.length / COLS);
const GAP = 8;
const cellH = Math.round(CELL * 2.0);
const canvasW = COLS * CELL + (COLS + 1) * GAP;
const canvasH = rows * cellH + (rows + 1) * GAP;

const layers = [];
for (let idx = 0; idx < models.length; idx++) {
  const model = models[idx];
  const { buf, W, H } = await makeTransparent(model);
  fs.writeFileSync(`${OUT}/iphone-${model}-white.png`, await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer());
  const scale = Math.min(CELL / W, cellH / H);
  const rw = Math.round(W * scale), rh = Math.round(H * scale);
  const thumb = await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).resize(rw, rh).png().toBuffer();
  const col = idx % COLS, row = Math.floor(idx / COLS);
  const left = GAP + col * (CELL + GAP) + Math.round((CELL - rw) / 2);
  const top = GAP + row * (cellH + GAP) + Math.round((cellH - rh) / 2);
  layers.push({ input: thumb, left, top });
}

await sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: '#ff00ff' } })
  .composite(layers)
  .png()
  .toFile('reference/_verify/_white_transp_montage.png');

console.log('wrote', models.length, 'transparent whites + montage');
console.log('models:', models.join(', '));

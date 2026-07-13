// Crop a pure-GPT render (phone on white bg) to a transparent-background asset.
// NO warping/resize — keeps GPT's proportions. Detects the phone body (ignoring the
// faint contact shadow) and applies a rounded-rectangle alpha so corners are transparent.
//
// Usage: node scripts/crop-gpt.mjs <inputRaw> <outPath> [cornerFrac=0.09]

import sharp from "sharp";

const [, , inPath, outPath, cornerArg] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node scripts/crop-gpt.mjs <in> <out> [cornerFrac]");
  process.exit(1);
}
const cornerFrac = cornerArg ? parseFloat(cornerArg) : 0.09;

async function main() {
  const base = sharp(inPath).flatten({ background: "#ffffff" });
  const meta = await base.metadata();
  const W = meta.width, H = meta.height;
  const { data } = await base.clone().greyscale().raw().toBuffer({ resolveWithObject: true });

  // Row/col profiles: a row/col is "phone" if it has enough clearly-non-white pixels
  // (threshold 235 keeps 米白 body ~220 but drops faint shadow ~245 and pure-white bg).
  const THR = 235;
  const colCount = new Int32Array(W);
  const rowCount = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[y * W + x] < THR) { colCount[x]++; rowCount[y]++; }
    }
  }
  const colMin = Math.floor(W * 0.04), rowMin = Math.floor(H * 0.04);
  let left = 0, right = W - 1, top = 0, bottom = H - 1;
  while (left < W && colCount[left] < colMin) left++;
  while (right > 0 && colCount[right] < colMin) right--;
  while (top < H && rowCount[top] < rowMin) top++;
  while (bottom > 0 && rowCount[bottom] < rowMin) bottom--;

  const bw = right - left + 1, bh = bottom - top + 1;
  if (bw < 20 || bh < 20) throw new Error("phone bbox not found: " + bw + "x" + bh);

  const r = Math.round(bw * cornerFrac);
  const maskSvg = Buffer.from(
    `<svg width="${bw}" height="${bh}"><rect x="0" y="0" width="${bw}" height="${bh}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
  );
  const alpha = await sharp(maskSvg).blur(1.2).extractChannel(0).toBuffer();

  const cropped = await base
    .extract({ left, top, width: bw, height: bh })
    .ensureAlpha()
    .joinChannel(alpha)
    .png()
    .toBuffer();

  await sharp(cropped).toFile(outPath);
  console.log(`crop-gpt ${inPath.split("/").pop()} ${W}x${H} -> bbox ${bw}x${bh}@(${left},${top}) -> ${outPath.split("/").pop()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

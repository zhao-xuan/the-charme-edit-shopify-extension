// Compose a molten gel pad from a GPT render onto the OFFICIAL case-without-gel shell.
// The shell (correct proportions, user-approved) is NEVER redrawn. We feather-crop the
// gel region out of the GPT render and drop it into a fixed rounded-rect region inside
// the official shell. Because gel colour matches shell colour (black gel on black shell,
// light gel on white shell), the feathered seam is hidden.
//
// Usage: node scripts/compose-gel.mjs <model> <finish> [outPath] [gelSrcModel]
//   finish      = black | white | glitter
//   shell       = case-without-gel/<model>-<black|white>.png  (black finish->black shell)
//   gelsrc      = /tmp/gel-<gelSrcModel|model>-<finish>.png  (GPT render, reusable across models)

import sharp from "sharp";

const [, , model, finish, outArg, gelSrcModel] = process.argv;
if (!model || !finish) {
  console.error("usage: node scripts/compose-gel.mjs <model> <finish> [out] [gelSrcModel]");
  process.exit(1);
}

const shellFinish = finish === "black" ? "black" : "white";
const shellPath = `public/assets/cases/case-without-gel/${model}-${shellFinish}.png`;
// Gel texture source = a GPT molten render where gel fills the shell (reusable across models).
// 5th arg optionally overrides the source model (name) or an absolute path.
const gelPath = !gelSrcModel
  ? `/tmp/gel-${model}-${finish}.png`
  : gelSrcModel.startsWith("/")
    ? gelSrcModel
    : `/tmp/gel-${gelSrcModel}-${finish}.png`;
const outPath =
  outArg || `public/assets/cases/case-with-gel/integrated-${model}-${finish}.png`;

// ---- tunables (ratios) ----
// Target gel rect inside the shell bbox — hug the inner walls, thin even margin, straight edges.
const T = {
  x: 0.03, // hug left inner wall
  w: 0.94, // width -> right edge ~0.97 (thin even margin)
  top: 0.235, // just below camera bar
  bottom: 0.985, // hug bottom inner wall
  corner: 0.05, // small radius -> straighter edges
  feather: 0.0025, // tiny feather -> crisp straight edge
};
// Source gel rect inside the GPT render's phone bbox (gel fills most of it there).
const S = { x: 0.03, w: 0.94, top: 0.30, bottom: 0.995 };

async function bboxNonTransparent(img) {
  const { data, info } = await img
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = data[(y * W + x) * C + 3];
      if (a > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// Detect the phone bbox in a GPT render on a near-white background.
async function bboxOnWhite(path) {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  let minX = W, minY = H, maxX = 0, maxY = 0;
  const thr = 244; // anything darker than this counts as "phone"
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[y * W + x] < thr) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX) return { left: 0, top: 0, width: W, height: H };
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function roundedRectSvg(w, h, r) {
  return Buffer.from(
    `<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
  );
}

async function main() {
  const shellImg = sharp(shellPath);
  const shellMeta = await shellImg.metadata();
  const SW = shellMeta.width, SH = shellMeta.height;
  const sb = await bboxNonTransparent(sharp(shellPath));

  // Target gel rect (absolute px in shell canvas)
  const gx = Math.round(sb.left + sb.width * T.x);
  const gw = Math.round(sb.width * T.w);
  const gy = Math.round(sb.top + sb.height * T.top);
  const gyb = Math.round(sb.top + sb.height * T.bottom);
  const gh = gyb - gy;
  const corner = Math.round(gw * T.corner);
  const feather = Math.max(2, Math.round(SH * T.feather));

  // Source gel rect from the GPT render (gel fills the shell there).
  const gpt = await bboxOnWhite(gelPath);
  const gm = await sharp(gelPath).metadata();
  let sx = Math.round(gpt.left + gpt.width * S.x);
  let sw = Math.round(gpt.width * S.w);
  let sy = Math.round(gpt.top + gpt.height * S.top);
  let sh = Math.round(gpt.height * (S.bottom - S.top));
  sx = Math.max(0, sx); sy = Math.max(0, sy);
  if (sx + sw > gm.width) sw = gm.width - sx;
  if (sy + sh > gm.height) sh = gm.height - sy;

  let srcPatch = await sharp(gelPath)
    .removeAlpha()
    .extract({ left: sx, top: sy, width: sw, height: sh })
    .resize(gw, gh, { fit: "fill" })
    .toBuffer();
  // Neutralise warm cast for light finishes so gel colour never shifts with the 米白 shell.
  if (finish !== "black") {
    const stt = await sharp(srcPatch).stats();
    const rM = stt.channels[0].mean, gM = stt.channels[1].mean, bM = stt.channels[2].mean;
    const gray = (rM + gM + bM) / 3;
    srcPatch = await sharp(srcPatch)
      .linear([gray / rM, gray / gM, gray / bM], [0, 0, 0])
      .toBuffer();
  }

  // Feathered rounded-rect alpha
  const alpha = await sharp(roundedRectSvg(gw, gh, corner))
    .blur(feather)
    .extractChannel(0)
    .toBuffer();

  const gelRGBA = await sharp(srcPatch)
    .ensureAlpha()
    .joinChannel(alpha)
    .png()
    .toBuffer();

  // Soft contact shadow under the gel for depth (slightly larger, dark, blurred)
  const shColor = shellFinish === "black" ? 0 : 60;
  const shadow = await sharp({
    create: { width: gw, height: gh, channels: 4, background: { r: shColor, g: shColor, b: shColor, alpha: 1 } },
  })
    .composite([{ input: await sharp(roundedRectSvg(gw, gh, corner)).blur(feather * 1.6).extractChannel(0).toBuffer(), blend: "dest-in" }])
    .png()
    .toBuffer();

  const composed = await sharp(shellPath)
    .ensureAlpha()
    .composite([
      { input: shadow, left: gx, top: gy + Math.round(feather * 0.8), blend: "over" },
      { input: gelRGBA, left: gx, top: gy, blend: "over" },
    ])
    .png()
    .toBuffer();

  await sharp(composed).toFile(outPath);
  console.log(
    `compose ${model} ${finish}: shellBbox=${sb.width}x${sb.height} gelRect=${gw}x${gh}@(${gx},${gy}) src=${sw}x${sh}@(${sx},${sy}) -> ${outPath.split("/").pop()}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

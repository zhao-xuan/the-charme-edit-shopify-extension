// Build generation bases for a model from its case-without-gel crops.
// Usage: node scripts/make-base.mjs <id> [mx-frac] [my-frac]
// Writes /tmp/base-<id>-black.png and /tmp/base-<id>-white.png (case composited
// onto a white canvas with margin), which are uploaded to ChatGPT as IMAGE 1.
import sharp from "sharp";

const id = process.argv[2];
if (!id) { console.error("usage: make-base.mjs <id> [mxFrac] [myFrac]"); process.exit(1); }
const mxFrac = parseFloat(process.argv[3] || "0.16");
const myFrac = parseFloat(process.argv[4] || "0.10");

for (const finish of ["black", "white"]) {
  const src = `public/assets/cases/case-without-gel/${id}-${finish}.png`;
  try {
    const im = sharp(src);
    const m = await im.metadata();
    const buf = await im.png().toBuffer();
    const mx = Math.round(m.width * mxFrac);
    const my = Math.round(m.height * myFrac);
    const W = m.width + mx * 2;
    const H = m.height + my * 2;
    const out = `/tmp/base-${id}-${finish}.png`;
    await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
      .composite([{ input: buf, left: mx, top: my }])
      .png()
      .toFile(out);
    console.log(`base ${finish} ${W}x${H} -> ${out}`);
  } catch (e) {
    console.error(`SKIP ${finish}: ${e.message}`);
  }
}

// Decode a base64 image returned by run_playwright_code (wrapped in B64START..B64END,
// saved to the tool's content.txt) into a PNG on disk — without loading it into the agent context.
// Usage: node scripts/_decode-b64.mjs <content.txt path> <out.png>
import fs from 'node:fs'

const [ct, out] = process.argv.slice(2)
if (!ct || !out) {
  console.error('usage: node scripts/_decode-b64.mjs <content.txt> <out.png>')
  process.exit(2)
}
const t = fs.readFileSync(ct, 'utf8')
const s = t.indexOf('B64START')
const e = t.indexOf('B64END')
if (s < 0 || e < 0) {
  console.error('B64START/B64END markers not found in', ct)
  process.exit(1)
}
const buf = Buffer.from(t.slice(s + 8, e), 'base64')
fs.writeFileSync(out, buf)
console.log('wrote', out, buf.length, 'bytes')

import sharp from 'sharp'
import { getRecord, saveRecord, TYPES } from '../functions/api/_shopify-store.js'
import { uploadImageFile } from '../functions/api/_lib.js'

const env = {
  SHOPIFY_STORE: process.env.SHOPIFY_STORE,
  SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
}

if (!env.SHOPIFY_STORE || !env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) {
  throw new Error('Set SHOPIFY_STORE, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET before running this script.')
}

const catalog = await fetch('https://charme-customizer.pages.dev/api/catalog').then((response) => {
  if (!response.ok) throw new Error(`Could not load catalog: ${response.status}`)
  return response.json()
})
const phone = catalog.products.find((product) => product.id === 'iphone-16-pro-max')
if (!phone?.srcBlack) throw new Error('The black iPhone 16 Pro Max Shopify render is unavailable.')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f6efe2"/><stop offset="1" stop-color="#e9ddca"/></linearGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#4a4a47"/><stop offset=".42" stop-color="#151515"/><stop offset="1" stop-color="#060606"/></linearGradient>
    <linearGradient id="photo" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#d8e0da"/><stop offset=".5" stop-color="#a4b8a8"/><stop offset="1" stop-color="#657a69"/></linearGradient>
  </defs>
  <rect width="1000" height="1000" fill="url(#bg)"/>
  <rect x="220" y="80" width="560" height="840" rx="22" fill="#201f1e" opacity=".16" transform="translate(18 20)"/>
  <rect x="220" y="80" width="560" height="840" rx="22" fill="url(#frame)"/>
  <rect x="245" y="105" width="510" height="790" rx="12" fill="none" stroke="#6e6d69" stroke-opacity=".62" stroke-width="7"/>
  <rect x="305" y="175" width="390" height="650" rx="8" fill="#0b0b0b"/>
  <rect x="326" y="196" width="348" height="608" rx="3" fill="url(#photo)"/>
  <path d="M326 665 L445 540 L520 612 L581 505 L674 620 V804 H326Z" fill="#546d5d" opacity=".92"/>
  <circle cx="585" cy="330" r="62" fill="#f2d59e" opacity=".9"/>
  <path d="M326 755 C421 680 532 712 674 620 V804 H326Z" fill="#3f594b"/>
  <path d="M250 105 L305 175 M750 105 L695 175 M250 895 L305 825 M750 895 L695 825" stroke="#a09e98" stroke-opacity=".45" stroke-width="8"/>
</svg>`
const framePng = await sharp(Buffer.from(svg)).png().toBuffer()
const uploaded = await uploadImageFile(env, framePng, {
  filename: 'charme-cross-sell-black-photo-frame.png',
  alt: 'Black Charmé photo frame',
})
if (!uploaded.url) throw new Error('Shopify did not finish processing the black frame image.')

const current = (await getRecord(env, TYPES.override, 'app-settings')) || {}
const options = current.crossSell?.options || []
const upsertOption = (label, patch) => {
  const index = options.findIndex((option) => option.label === label)
  const base = index === -1 ? { label, ...patch } : { ...options[index], ...patch }
  if (index === -1) options.push(base)
  else options[index] = base
}

upsertOption('Phone case', {
  buttonLabel: 'Customise phone case',
  image: phone.srcBlack,
  group: 'apple',
  productId: 'iphone-16-pro-max',
})
upsertOption('Photo frame', {
  buttonLabel: 'Customise photo frame',
  image: uploaded.url,
  group: 'frame',
  productId: 'frame-5x7',
})

await saveRecord(env, TYPES.override, 'app-settings', {
  ...current,
  scope: 'settings',
  crossSell: { ...(current.crossSell || {}), options },
})

console.log(JSON.stringify({ phoneImage: phone.srcBlack, frameImage: uploaded.url, options }, null, 2))
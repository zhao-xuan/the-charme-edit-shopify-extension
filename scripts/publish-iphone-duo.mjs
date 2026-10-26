#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { shopifyAdmin } from '../functions/api/_lib.js'

const apply = process.argv.includes('--apply')
const verify = process.argv.includes('--verify')
if (apply && verify) throw new Error('Pass --apply or --verify, not both')
const directory = 'reference/case-history/generated/iphone-duo'
const provenance = JSON.parse(await readFile(`${directory}/source-provenance.json`, 'utf8'))
if (provenance.widthMm !== 84.1 || provenance.heightMm !== 117.8 || provenance.configuration !== 'folded') {
  throw new Error('Duo must use the reviewed Apple folded dimensions')
}
const args = ['scripts/publish-shopify-iphone-without-gel-images.mjs']
for (const finish of ['white', 'black']) {
  args.push('--derived-source', `iphone-duo:${finish}:public/assets/cases/case-without-gel/iphone-duo-${finish}.png`)
}
args.push('--create-target', 'iphone-duo:iPhone Duo:84.1:117.8', '--preserve-canvas', '--report', `${directory}/shopify-upload-report.json`)
if (apply) args.push('--apply')
if (verify) args.push('--verify')
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Image publisher failed: ${signal || code}`)))
})

const variants = []
let after = null
do {
  const data = await shopifyAdmin(process.env, `
    query($after: String) {
      productByHandle(handle: "custom-charm-phone-case") {
        variants(first: 250, after: $after) {
          nodes { id price availableForSale selectedOptions { name value } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`, { after })
  const connection = data.productByHandle?.variants
  if (!connection) throw new Error('Sellable phone-case product not found')
  variants.push(...connection.nodes.filter((variant) => variant.selectedOptions.some((option) => option.name === 'Phone Model' && option.value === 'iPhone Duo')))
  after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
} while (after)
const baseVariants = variants.filter((variant) => variant.availableForSale && variant.selectedOptions
  .filter((option) => !['Phone Model', 'Case & Gel Colour'].includes(option.name))
  .every((option) => /^(no|none|without)\b/i.test(option.value)))
const target = baseVariants.find((variant) => variant.selectedOptions.some((option) => option.name === 'Case & Gel Colour' && option.value === 'White (Glitter Gel)'))
if (!target) throw new Error('No available base iPhone Duo White (Glitter Gel) variant; refusing a substitute')
if (!baseVariants.some((variant) => variant.selectedOptions.some((option) => option.name === 'Case & Gel Colour' && /^Black\b/.test(option.value)))) {
  throw new Error('No available black iPhone Duo base variant')
}
const variantId = target.id.split('/').pop()
const data = await shopifyAdmin(process.env, `query {
  metaobjectByHandle(handle: { type: "charme_product", handle: "iphone-duo" }) {
    id fields { key value }
  }
}`)
const record = data.metaobjectByHandle
if (!record) {
  if (apply || verify) throw new Error('Duo customizer record not found after publication')
  console.log(`DRY RUN: bind Duo to ${variantId} at ${target.price}`)
  process.exit(0)
}
const fields = Object.fromEntries(record.fields.map(({ key, value }) => [key, value]))
if (Number(fields.width_mm) !== 84.1 || Number(fields.height_mm) !== 117.8) throw new Error('Live Duo dimensions differ from reviewed dimensions')
if (apply) {
  const updated = await shopifyAdmin(process.env, `
    mutation($id: ID!, $fields: [MetaobjectFieldInput!]!) {
      metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
        metaobject { id fields { key value } } userErrors { field message }
      }
    }`, {
    id: record.id,
    fields: [
      { key: 'shopify_variant_id', value: variantId },
      { key: 'base_price', value: target.price },
    ],
  })
  const result = updated.metaobjectUpdate
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors))
  const saved = Object.fromEntries((result.metaobject?.fields || []).map(({ key, value }) => [key, value]))
  if (saved.shopify_variant_id !== variantId || Number(saved.base_price) !== Number(target.price)) throw new Error('Shopify did not confirm Duo binding')
} else if (verify && (fields.shopify_variant_id !== variantId || Number(fields.base_price) !== Number(target.price))) {
  throw new Error('Duo price or Shopify variant binding does not match the sellable variant')
}
const report = { mode: apply ? 'apply' : verify ? 'verify' : 'dry-run', modelId: 'iphone-duo', variantId, price: target.price, baseVariants }
if (apply) await writeFile(`${directory}/shopify-binding-report.json`, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))

#!/usr/bin/env node
import { getCaseProduct, deleteModelVariants } from '../functions/api/_case-variants.js'

const TARGET_MODELS = Object.freeze([
  'Pixel 10 Pro XL',
  'Pixel 9 Pro XL',
  'Galaxy Z Fold 6',
])
const APPLY = process.argv.includes('--apply')
const env = process.env

for (const key of ['SHOPIFY_STORE', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET']) {
  if (!env[key]) throw new Error(`Missing ${key}`)
}

const targetNames = new Set(TARGET_MODELS)
const before = await getCaseProduct(env)
if (!before) throw new Error('custom-charm-phone-case was not found')

const targetVariants = before.variants.filter((variant) => targetNames.has(variant.model))
for (const model of TARGET_MODELS) {
  const count = targetVariants.filter((variant) => variant.model === model).length
  if (!count) throw new Error(`Target model is missing from Shopify: ${model}`)
  console.log(`${APPLY ? 'delist' : 'would delist'}: ${model} (${count} variants)`)
}

if (!APPLY) {
  console.log(`dry run: ${targetVariants.length} target variants; ${before.variants.length - targetVariants.length} unchanged`)
  process.exit(0)
}

const untouchedBefore = new Set(
  before.variants.filter((variant) => !targetNames.has(variant.model)).map((variant) => variant.id),
)
let deleted = 0
for (const model of TARGET_MODELS) {
  const current = await getCaseProduct(env)
  deleted += await deleteModelVariants(env, current, model)
}

const after = await getCaseProduct(env)
const remainingTargets = after.variants.filter((variant) => targetNames.has(variant.model))
const untouchedAfter = new Set(after.variants.map((variant) => variant.id))
const missingUntouched = [...untouchedBefore].filter((id) => !untouchedAfter.has(id))
const unexpectedNew = after.variants.filter(
  (variant) => !targetNames.has(variant.model) && !untouchedBefore.has(variant.id),
)

if (remainingTargets.length) throw new Error(`${remainingTargets.length} target variants remain`)
if (missingUntouched.length || unexpectedNew.length) {
  throw new Error(`Non-target variants changed: ${missingUntouched.length} missing, ${unexpectedNew.length} new`)
}
if (deleted !== targetVariants.length) {
  throw new Error(`Expected to delete ${targetVariants.length} variants, deleted ${deleted}`)
}

console.log(`verified: deleted ${deleted}; preserved ${untouchedBefore.size} non-target variants`)
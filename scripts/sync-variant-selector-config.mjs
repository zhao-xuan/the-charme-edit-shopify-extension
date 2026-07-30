import { getCaseProduct } from '../functions/api/_case-variants.js'
import { getRecord, saveRecord, TYPES } from '../functions/api/_shopify-store.js'

const APPLY = process.argv.includes('--apply')
const SETTINGS_HANDLE = 'app-settings'
const GROUP_ORDER = ['iPhone', 'Samsung', 'Pixel', 'Other']

const env = {
  SHOPIFY_STORE: process.env.SHOPIFY_STORE,
  SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
  SHOPIFY_ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN,
}

if (!env.SHOPIFY_STORE || (!(env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET) && !env.SHOPIFY_ADMIN_TOKEN)) {
  throw new Error('Set SHOPIFY_STORE and Shopify Admin API credentials before running this script.')
}

function brandOf(model) {
  const value = String(model || '').toLowerCase()
  if (/iphone|ipad/.test(value)) return 'iPhone'
  if (/galaxy|samsung/.test(value)) return 'Samsung'
  if (/pixel/.test(value)) return 'Pixel'
  return 'Other'
}

function buildTree(models) {
  const groups = Object.fromEntries(GROUP_ORDER.map((label) => [label, []]))
  for (const model of models) groups[brandOf(model)].push(model)
  return GROUP_ORDER.filter((label) => groups[label].length).map((label) => ({
    id: `brand-${label.toLowerCase()}`,
    label,
    children: [],
    models: groups[label],
  }))
}

function treeModels(tree) {
  const result = []
  const visit = (nodes) => {
    for (const node of nodes || []) {
      result.push(...(node.models || []))
      visit(node.children || [])
    }
  }
  visit(tree)
  return result
}

const product = await getCaseProduct(env)
if (!product) throw new Error('Shopify product custom-charm-phone-case was not found.')

const models = product.modelValues.map((value) => value.name).filter(Boolean)
if (!models.length) throw new Error(`Shopify option "${product.modelOptionName}" has no values.`)
if (new Set(models).size !== models.length) throw new Error('Shopify Phone Model option contains duplicate values.')

const current = (await getRecord(env, TYPES.override, SETTINGS_HANDLE)) || {}
const tree = buildTree(models)
const variantSelector = {
  enabled: true,
  style: {
    ...(current.variantSelector?.style || {}),
    accent: '#3d3530',
    accentInk: '#f7f0df',
    buttonBg: '#f7f0df',
    buttonInk: '#3d3530',
    border: '#3d3530',
    radius: 24,
    layout: 'buttons',
    brandLabel: 'Phone Model',
    modelLabel: '',
    showPrice: false,
    heading: 'Step 1: Select your phone model and gel',
  },
  tree,
}

const summary = {
  mode: APPLY ? 'apply' : 'dry-run',
  product: product.handle,
  option: product.modelOptionName,
  modelCount: models.length,
  variantCount: product.variants.length,
  groups: Object.fromEntries(tree.map((node) => [node.label, node.models.length])),
  heading: variantSelector.style.heading,
}

if (APPLY) {
  await saveRecord(env, TYPES.override, SETTINGS_HANDLE, {
    ...current,
    scope: 'settings',
    variantSelector,
  })
  const saved = await getRecord(env, TYPES.override, SETTINGS_HANDLE)
  const savedModels = treeModels(saved?.variantSelector?.tree)
  if (saved?.variantSelector?.enabled !== true || savedModels.length !== models.length) {
    throw new Error('Saved variant selector config did not verify.')
  }
  if (savedModels.some((model, index) => model !== models[index])) {
    throw new Error('Saved variant selector model order does not match Shopify.')
  }
  summary.verified = true
}

console.log(JSON.stringify(summary, null, 2))
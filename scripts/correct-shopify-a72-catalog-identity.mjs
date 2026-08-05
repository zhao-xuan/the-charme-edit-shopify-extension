#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { shopifyAdmin } from '../functions/api/_lib.js'

const CASE_HANDLE = 'custom-charm-phone-case'
const OLD_NAME = 'Galaxy A72 4G / 5G'
const NEW_NAME = 'Galaxy A72 4G'
const EXPECTED_VARIANTS = 6
const REPORT_PATH = 'reference/case-history/generated/all-phone-real-image-completion/shopify-a72-catalog-identity-correction-report.json'
const apply = process.argv.includes('--apply')
const verify = process.argv.includes('--verify')
const env = {
  SHOPIFY_STORE: process.env.SHOPIFY_STORE,
  SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
  SHOPIFY_ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN,
}

if (apply && verify) throw new Error('Pass either --verify or --apply, not both')

function requireCredentials() {
  const hasClientCredentials = env.SHOPIFY_STORE && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET
  const hasAdminToken = env.SHOPIFY_STORE && env.SHOPIFY_ADMIN_TOKEN
  if (!hasClientCredentials && !hasAdminToken) throw new Error('Missing Shopify credentials')
}

const Q_PRODUCT = `
  query($query: String!, $after: String) {
    products(first: 1, query: $query) {
      nodes {
        id handle title
        options { id name optionValues { id name } }
        variants(first: 100, after: $after) {
          nodes { id selectedOptions { name value } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }`

const M_RENAME_OPTION_VALUE = `
  mutation($productId: ID!, $option: OptionUpdateInput!, $updates: [OptionValueUpdateInput!]) {
    productOptionUpdate(
      productId: $productId
      option: $option
      optionValuesToUpdate: $updates
    ) {
      product { id }
      userErrors { field message code }
    }
  }`

async function productState() {
  let product = null
  let after = null
  const variants = []
  do {
    const data = await shopifyAdmin(env, Q_PRODUCT, { query: `handle:${CASE_HANDLE}`, after })
    const pageProduct = data.products.nodes[0]
    if (!pageProduct || pageProduct.handle !== CASE_HANDLE) throw new Error(`Shopify product ${CASE_HANDLE} was not found`)
    product ||= pageProduct
    variants.push(...pageProduct.variants.nodes)
    after = pageProduct.variants.pageInfo.hasNextPage ? pageProduct.variants.pageInfo.endCursor : null
  } while (after)

  const modelOption = product.options.find((option) => /model|phone|device/i.test(option.name))
  if (!modelOption) throw new Error('Could not identify the Shopify phone-model option')
  const oldValue = modelOption.optionValues.find((value) => value.name === OLD_NAME) || null
  const newValue = modelOption.optionValues.find((value) => value.name === NEW_NAME) || null
  const selectedValue = (variant) => variant.selectedOptions.find((option) => option.name === modelOption.name)?.value
  const oldVariantIds = variants.filter((variant) => selectedValue(variant) === OLD_NAME).map((variant) => variant.id)
  const newVariantIds = variants.filter((variant) => selectedValue(variant) === NEW_NAME).map((variant) => variant.id)

  if (oldValue && newValue) throw new Error(`Both ${OLD_NAME} and ${NEW_NAME} exist; refusing to merge option values`)
  if (!oldValue && !newValue) throw new Error(`Neither ${OLD_NAME} nor ${NEW_NAME} exists`)
  const activeVariantIds = oldValue ? oldVariantIds : newVariantIds
  if (activeVariantIds.length !== EXPECTED_VARIANTS) {
    throw new Error(`Expected ${EXPECTED_VARIANTS} A72 variants, found ${activeVariantIds.length}`)
  }
  if (oldValue && newVariantIds.length) throw new Error(`${NEW_NAME} has variants before its option value exists`)
  if (newValue && oldVariantIds.length) throw new Error(`${OLD_NAME} has variants after its option value was removed`)

  return {
    product: { id: product.id, handle: product.handle, title: product.title },
    option: { id: modelOption.id, name: modelOption.name },
    value: oldValue || newValue,
    state: oldValue ? 'rename-required' : 'already-correct',
    variantIds: activeVariantIds,
  }
}

async function main() {
  requireCredentials()
  const before = await productState()
  console.log(`${apply ? 'APPLY' : verify ? 'VERIFY' : 'DRY RUN'}: ${OLD_NAME} -> ${NEW_NAME}`)
  console.log(`Current state: ${before.state}; ${before.variantIds.length} variants`)
  if (!apply) return

  let status = 'already-current'
  if (before.state === 'rename-required') {
    const data = await shopifyAdmin(env, M_RENAME_OPTION_VALUE, {
      productId: before.product.id,
      option: { id: before.option.id },
      updates: [{ id: before.value.id, name: NEW_NAME }],
    })
    const errors = data.productOptionUpdate.userErrors || []
    if (errors.length) throw new Error(`productOptionUpdate: ${JSON.stringify(errors)}`)
    status = 'updated'
  }

  const after = await productState()
  if (after.state !== 'already-correct') throw new Error(`A72 option rename did not persist: ${after.state}`)
  if (after.value.id !== before.value.id) throw new Error('A72 option value ID changed during rename')
  if (JSON.stringify([...after.variantIds].sort()) !== JSON.stringify([...before.variantIds].sort())) {
    throw new Error('A72 variant membership changed during rename')
  }

  const report = {
    schemaVersion: 1,
    appliedAt: new Date().toISOString(),
    status,
    reason: 'The verified Samsung Galaxy A72 product is LTE/4G; no official Galaxy A72 5G product identity was found.',
    oldName: OLD_NAME,
    newName: NEW_NAME,
    product: after.product,
    option: after.option,
    optionValueId: after.value.id,
    variantIds: after.variantIds,
    invariants: {
      optionValueIdPreserved: true,
      variantMembershipPreserved: true,
      variants: after.variantIds.length,
    },
  }
  await mkdir(path.dirname(REPORT_PATH), { recursive: true })
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ status, reportPath: REPORT_PATH, variants: after.variantIds.length }, null, 2))
}

await main()
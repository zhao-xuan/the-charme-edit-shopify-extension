#!/usr/bin/env node
// Synchronize every image displayed as "With gel" on case-review to Shopify.
// Defaults to a no-write preview. Use --verify to check Shopify targets, then
// --apply only after reviewing its plan.
//
// Usage:
//   SHOPIFY_STORE=... SHOPIFY_CLIENT_ID=... SHOPIFY_CLIENT_SECRET=... \
//   node scripts/sync-case-review-images-to-shopify.mjs [--verify | --apply] [--files-only]
import { createHash } from 'crypto'

const API_VERSION = '2025-01'
const REVIEW_ORIGIN = 'https://charme-customizer.pages.dev'
const CASE_HANDLE = 'custom-charm-phone-case'
const VARIANT_FINISH_VALUES = {
  Black: 'Black (Black Gel)',
  White: 'White (White Gel)',
  Glitter: 'White (Glitter Gel)',
}
const apply = process.argv.includes('--apply')
const verify = process.argv.includes('--verify')
const filesOnly = process.argv.includes('--files-only')
const modelIds = new Set(
  process.argv.flatMap((argument, index) => argument === '--model' ? [process.argv[index + 1]] : [])
    .filter(Boolean),
)
const finishes = new Set(
  process.argv.flatMap((argument, index) => argument === '--finish' ? [process.argv[index + 1]?.toLowerCase()] : [])
    .filter(Boolean),
)
const store = process.env.SHOPIFY_STORE
const clientId = process.env.SHOPIFY_CLIENT_ID
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const productModelName = (value) => titleCase(value.replace(/-/g, ' ')).replace(/^Iphone\b/, 'iPhone')
const titleCase = (value) => value.replace(/\b\w/g, (letter) => letter.toUpperCase())

async function reviewImages() {
  const [inventoryResponse, historyResponse] = await Promise.all([
    fetch(`${REVIEW_ORIGIN}/assets/cases/case-inventory.json`),
    fetch(`${REVIEW_ORIGIN}/api/admin/case-history`),
  ])
  if (!inventoryResponse.ok) throw new Error(`case-review inventory request failed: ${inventoryResponse.status}`)
  if (!historyResponse.ok) throw new Error(`case-review history request failed: ${historyResponse.status}`)
  const [inventory, history] = await Promise.all([inventoryResponse.json(), historyResponse.json()])
  const currentHistory = new Map(
    (history.images || [])
      .filter((image) => image.current && image.imagePath)
      .map((image) => [`${image.modelId}\u0000${image.finish}`, image]),
  )
  const images = new Map()
  for (const model of inventory.models || []) {
    if (modelIds.size && !modelIds.has(model.id)) continue
    for (const finish of ['black', 'white', 'glitter']) {
      if (finishes.size && !finishes.has(finish)) continue
      const historyImage = currentHistory.get(`${model.id}\u0000${finish}`)
      if (!model.withGel?.[finish] && !historyImage) continue
      const title = titleCase(finish)
      const imagePath = historyImage?.imagePath || `/assets/cases/case-with-gel/integrated-${model.id}-${finish}.png`
      images.set(`${model.id}\u0000${title}`, {
        modelId: model.id,
        model: model.name || productModelName(model.id),
        finish: title,
        variantFinish: VARIANT_FINISH_VALUES[title],
        imagePath,
        url: new URL(imagePath, REVIEW_ORIGIN).href,
        sha256: historyImage?.sha256 || '',
      })
    }
  }
  return [...images.values()].sort((left, right) => left.model.localeCompare(right.model) || left.finish.localeCompare(right.finish))
}

async function accessToken() {
  const response = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token) throw new Error('Shopify token exchange failed')
  return body.access_token
}

let token
async function gql(query, variables) {
  const response = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
    body: JSON.stringify({ query, variables }),
  })
  const body = await response.json()
  if (body.errors?.length) throw new Error(JSON.stringify(body.errors))
  return body.data
}

const Q_METAOBJECTS = `
  query($after: String) {
    metaobjects(type: "charme_product", first: 200, after: $after) {
      edges { node { id fields { key value } } }
      pageInfo { hasNextPage endCursor }
    }
  }`
const Q_CASE_PRODUCT = `
  query($query: String!) {
    products(first: 1, query: $query) {
      nodes {
        id
        options { name }
        variants(first: 250) {
          nodes { id selectedOptions { name value } }
        }
      }
    }
  }`
const M_STAGE = `
  mutation($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`
const M_FILE = `
  mutation($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id }
      userErrors { field message }
    }
  }`
const M_METAOBJECT = `
  mutation($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      userErrors { field message }
    }
  }`
const M_MEDIA = `
  mutation($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { ... on MediaImage { id } }
      mediaUserErrors { field message }
    }
  }`
const M_VARIANTS = `
  mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }`

async function loadMetaobjects() {
  const results = new Map()
  let after = null
  do {
    const data = await gql(Q_METAOBJECTS, { after })
    for (const { node } of data.metaobjects.edges) {
      const legacyId = node.fields.find((field) => field.key === 'legacy_id')?.value
      if (legacyId) results.set(legacyId, node)
    }
    after = data.metaobjects.pageInfo.hasNextPage ? data.metaobjects.pageInfo.endCursor : null
  } while (after)
  return results
}

const COLOUR_HINTS = ['colour', 'color', 'gel', 'finish']
const MODEL_HINTS = ['model', 'phone', 'device']
const matchesOption = (name, hints) => hints.some((hint) => String(name || '').toLowerCase().includes(hint))

function productOptionRoles(options) {
  const colour = options.find((option) => matchesOption(option.name, COLOUR_HINTS))
  const model = options.find((option) => option !== colour && matchesOption(option.name, MODEL_HINTS)) ||
    options.find((option) => option !== colour)
  return { colour, model }
}

function optionValue(variant, optionName) {
  return variant.selectedOptions.find((option) => option.name === optionName)?.value || ''
}

async function loadCaseProduct() {
  const data = await gql(Q_CASE_PRODUCT, { query: `handle:${CASE_HANDLE}` })
  const product = data.products.nodes[0]
  if (!product) throw new Error(`Shopify product ${CASE_HANDLE} was not found`)
  const { colour, model } = productOptionRoles(product.options || [])
  if (!colour || !model) throw new Error(`could not identify model and colour options on ${CASE_HANDLE}`)
  const variants = new Map()
  const variantLabels = []
  for (const variant of product.variants.nodes) {
    const modelValue = optionValue(variant, model.name)
    const finish = optionValue(variant, colour.name)
    if (modelValue && finish) {
      const key = `${modelValue}\u0000${finish}`
      variants.set(key, [...(variants.get(key) || []), variant.id])
      variantLabels.push(`${modelValue} / ${finish}`)
    }
  }
  return { id: product.id, variants, optionNames: { model: model.name, colour: colour.name }, variantLabels }
}

function targetCoverage(images, metaobjects, product) {
  const entries = images.map((image) => ({
    image,
    metaobject: metaobjects.get(image.modelId),
    variantIds: image.variantFinish && product.variants.get(`${image.model}\u0000${image.variantFinish}`) || [],
  }))
  const unmatched = entries.filter((entry) => !entry.metaobject && !entry.variantIds.length)
  const metaobjectOnly = entries.filter((entry) => entry.metaobject && !entry.variantIds.length)
  const variantOnly = entries.filter((entry) => !entry.metaobject && entry.variantIds.length)
  if (!entries.some((entry) => entry.metaobject || entry.variantIds.length)) {
    throw new Error('no case-review images have a Shopify metaobject or sellable variant target')
  }
  return { entries, unmatched, metaobjectOnly, variantOnly }
}

async function downloadImage(image) {
  const source = await fetch(image.url)
  if (!source.ok) throw new Error(`image download failed for ${image.url}: ${source.status}`)
  const bytes = new Uint8Array(await source.arrayBuffer())
  const actualHash = createHash('sha256').update(bytes).digest('hex')
  if (image.sha256 && actualHash !== image.sha256) throw new Error(`checksum mismatch for ${image.modelId}/${image.finish}`)
  return bytes
}

async function uploadFile(image) {
  const bytes = await downloadImage(image)
  const filename = `${image.modelId}-${image.finish.toLowerCase()}-case-review.png`
  const staged = await gql(M_STAGE, { input: [{ resource: 'IMAGE', filename, mimeType: 'image/png', httpMethod: 'POST' }] })
  const errors = staged.stagedUploadsCreate.userErrors || []
  if (errors.length) throw new Error(JSON.stringify(errors))
  const target = staged.stagedUploadsCreate.stagedTargets[0]
  const form = new FormData()
  for (const parameter of target.parameters) form.append(parameter.name, parameter.value)
  form.append('file', new Blob([bytes], { type: 'image/png' }), filename)
  const uploaded = await fetch(target.url, { method: 'POST', body: form })
  if (!uploaded.ok) throw new Error(`staged upload failed for ${filename}: ${uploaded.status}`)
  const created = await gql(M_FILE, { files: [{ contentType: 'IMAGE', originalSource: target.resourceUrl, alt: `${image.model} ${image.finish}` }] })
  const createErrors = created.fileCreate.userErrors || []
  if (createErrors.length) throw new Error(JSON.stringify(createErrors))
  const file = created.fileCreate.files[0]
  if (!file?.id) throw new Error(`file creation returned no id for ${filename}`)
  return file.id
}

async function setVariantImage(productId, variantId, image) {
  const media = await gql(M_MEDIA, {
    productId,
    media: [{ originalSource: image.url, mediaContentType: 'IMAGE', alt: `${image.model} ${image.finish}` }],
  })
  const errors = media.productCreateMedia.mediaUserErrors || []
  if (errors.length) throw new Error(JSON.stringify(errors))
  const mediaId = media.productCreateMedia.media[0]?.id
  if (!mediaId) throw new Error(`product media creation returned no id for ${image.model}/${image.finish}`)
  const update = await gql(M_VARIANTS, { productId, variants: [{ id: variantId, mediaId }] })
  const updateErrors = update.productVariantsBulkUpdate.userErrors || []
  if (updateErrors.length) throw new Error(JSON.stringify(updateErrors))
}

async function main() {
  const images = await reviewImages()
  if (!images.length) throw new Error('case-review has no image versions')
  const customizerUpdates = images.filter((image) => image.finish === 'Black' || image.finish === 'White')
  const scope = filesOnly
    ? `${images.length} Shopify Files; no product, variant, or metaobject media updates`
    : `${images.length} case-review variant images, ${customizerUpdates.length} customizer images`
  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${scope}`)
  for (const image of images) {
    console.log(`- ${image.model} / ${image.finish}: ${image.url}`)
  }
  if (!apply && !verify) return

  if (!store || !clientId || !clientSecret) {
    throw new Error('Missing SHOPIFY_STORE / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET')
  }
  token = await accessToken()

  if (filesOnly) {
    if (verify) {
      for (const image of images) await downloadImage(image)
      console.log(`Verified: ${images.length} current image assets match their D1 checksums; Shopify Files credentials are valid.`)
      return
    }
    for (const image of images) {
      const fileId = await uploadFile(image)
      console.log(`Uploaded to Shopify Files: ${image.model} / ${image.finish} -> ${fileId}`)
      await sleep(250)
    }
    console.log(`Completed: ${images.length} Shopify Files uploaded; product, variant, and metaobject media were not changed.`)
    return
  }

  const [metaobjects, product] = await Promise.all([loadMetaobjects(), loadCaseProduct()])
  const coverage = targetCoverage(images, metaobjects, product)
  const targetImages = coverage.entries.filter((entry) => entry.metaobject || entry.variantIds.length)
  const targetCustomizerUpdates = targetImages.filter((entry) => entry.metaobject && (
    entry.image.finish === 'Black' || entry.image.finish === 'White'
  ))
  const targetVariantUpdates = targetImages.filter((entry) => entry.variantIds.length)
  const variantUpdateCount = targetVariantUpdates.reduce((count, entry) => count + entry.variantIds.length, 0)
  console.log(
    `Shopify coverage: ${targetImages.length}/${images.length} image assets, ` +
    `${targetCustomizerUpdates.length} customizer updates, ${variantUpdateCount} variant-media updates.`,
  )
  for (const entry of coverage.unmatched) {
    console.warn(`Skipped (no Shopify target): ${entry.image.model} / ${entry.image.finish}`)
  }
  for (const entry of coverage.metaobjectOnly) {
    console.warn(`Variant unavailable; customizer image will still update: ${entry.image.model} / ${entry.image.finish}`)
  }
  for (const entry of coverage.variantOnly) {
    console.warn(`Customizer record unavailable; variant image will still update: ${entry.image.model} / ${entry.image.finish}`)
  }
  if (verify) {
    console.log('Verified: all available Shopify targets for case-review images can be updated.')
    return
  }

  const files = new Map()
  for (const { image } of targetImages) {
    files.set(`${image.modelId}\u0000${image.finish}`, await uploadFile(image))
    await sleep(250)
  }
  for (const { image, metaobject } of targetCustomizerUpdates) {
    const field = image.finish === 'Black' ? 'body_image_black' : 'body_image_white'
    const result = await gql(M_METAOBJECT, {
      id: metaobject.id,
      metaobject: { fields: [{ key: field, value: files.get(`${image.modelId}\u0000${image.finish}`) }] },
    })
    const errors = result.metaobjectUpdate.userErrors || []
    if (errors.length) throw new Error(JSON.stringify(errors))
  }
  for (const { image, variantIds } of targetVariantUpdates) {
    for (const variantId of variantIds) {
      await setVariantImage(product.id, variantId, image)
      await sleep(250)
    }
  }
  console.log(`Completed: ${variantUpdateCount} Shopify variant images and ${targetCustomizerUpdates.length} customizer metaobject images updated.`)
}

main().catch((error) => {
  console.error(`\nError: ${error.message || error}`)
  process.exit(1)
})
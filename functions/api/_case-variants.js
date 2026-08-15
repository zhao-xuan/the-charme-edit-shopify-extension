// Helpers for the merchant's ONE real sellable phone-case product on Shopify
// (handle `custom-charm-phone-case`). Its variants = "iPhone Model" ×
// "Case & Gel Colour" (e.g. Black / White / Glitter). The admin keeps a SINGLE
// product list (the charme_product metaobjects = the customizer models); adding
// or removing a model, or a colour, cascades to the real variants here so the
// sellable product always matches the customizer. API version 2024-10.
import { shopifyAdmin } from './_lib.js'
import { storeImageToFiles } from './_shopify-store.js'

export const CASE_HANDLE = 'custom-charm-phone-case'
// Seed colours if the product has no colour option values yet (fresh store).
export const DEFAULT_COLOURS = ['Black', 'White', 'Glitter']

const Q_PRODUCT = `
  query($q: String!) {
    products(first: 1, query: $q) {
      edges { node {
        id title handle
        options { id name position optionValues { id name } }
        variants(first: 250) {
          edges { node {
            id title price availableForSale inventoryPolicy
            image { url }
            selectedOptions { name value }
          } }
          pageInfo { hasNextPage endCursor }
        }
      } }
    }
  }`

const Q_VARIANTS_PAGE = `
  query($id: ID!, $after: String!) {
    product: node(id: $id) {
      ... on Product {
        variants(first: 250, after: $after) {
          edges { node {
            id title price availableForSale inventoryPolicy
            image { url }
            selectedOptions { name value }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }`

const M_CREATE = `
  mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
    productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
      productVariants { id }
      userErrors { field message }
    }
  }`

const M_DELETE = `
  mutation($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      product { id }
      userErrors { field message }
    }
  }`

const M_OPTION = `
  mutation($productId: ID!, $option: OptionUpdateInput!, $optionValuesToDelete: [ID!], $variantStrategy: ProductOptionUpdateVariantStrategy) {
    productOptionUpdate(productId: $productId, option: $option, optionValuesToDelete: $optionValuesToDelete, variantStrategy: $variantStrategy) {
      product { id }
      userErrors { field message }
    }
  }`

const COLOUR_HINTS = ['colour', 'color', 'gel', 'finish']
const MODEL_HINTS = ['model', 'phone', 'device']
const matchOpt = (name, hints) => hints.some((h) => String(name || '').toLowerCase().includes(h))

/** Identify which product option is the colour and which is the model. */
function roles(options) {
  const colour = options.find((o) => matchOpt(o.name, COLOUR_HINTS))
  const model = options.find((o) => o !== colour && matchOpt(o.name, MODEL_HINTS)) ||
    options.find((o) => o !== colour)
  return { colour, model }
}

const valueOf = (selected, optName) => {
  const s = (selected || []).find((o) => o.name === optName)
  return s ? s.value : ''
}

/**
 * Load the case product, structured: { productId, colourOptionName/Id,
 * modelOptionName/Id, colours:[{id,name}], modelValues:[{id,name}],
 * models:[{name,variants:[{id,colour,price,available,continueSelling}]}],
 * variants:[…] }. Returns null when the product doesn't exist.
 */
export async function getCaseProduct(env, handle = CASE_HANDLE) {
  const data = await shopifyAdmin(env, Q_PRODUCT, { q: `handle:${handle}` })
  const node = data.products?.edges?.[0]?.node
  if (!node) return null
  const variantEdges = [...(node.variants?.edges || [])]
  let pageInfo = node.variants?.pageInfo
  while (pageInfo?.hasNextPage && pageInfo.endCursor) {
    const page = await shopifyAdmin(env, Q_VARIANTS_PAGE, { id: node.id, after: pageInfo.endCursor })
    const connection = page.product?.variants
    variantEdges.push(...(connection?.edges || []))
    pageInfo = connection?.pageInfo
  }
  const options = node.options || []
  const { colour, model } = roles(options)
  const colourName = colour?.name || 'Case & Gel Colour'
  const modelName = model?.name || 'iPhone Model'
  const variants = variantEdges.map((e) => {
    const v = e.node
    const selectedOptions = v.selectedOptions || []
    const extraOptions = selectedOptions.filter((option) => option.name !== colourName && option.name !== modelName)
    return {
      id: v.id,
      price: v.price != null ? Number(v.price) : null,
      colour: valueOf(selectedOptions, colourName),
      model: valueOf(selectedOptions, modelName),
      isBaseVariant: extraOptions.every((option) => /^(no|none|without)\b/i.test(String(option.value || '').trim())),
      available: !!v.availableForSale,
      continueSelling: v.inventoryPolicy === 'CONTINUE',
      image: v.image?.url || null,
    }
  })
  const colours = (colour?.optionValues || []).map((x) => ({ id: x.id, name: x.name }))
  const modelValues = (model?.optionValues || []).map((x) => ({ id: x.id, name: x.name }))
  const order = modelValues.map((x) => x.name)
  const seen = new Set(variants.map((v) => v.model).filter(Boolean))
  const modelNames = [
    ...order,
    ...[...seen].filter((m) => !order.includes(m)),
  ]
  const models = modelNames.map((m) => ({ name: m, variants: variants.filter((v) => v.model === m) }))
  return {
    productId: node.id,
    handle: node.handle,
    title: node.title,
    colourOptionName: colourName,
    modelOptionName: modelName,
    colourOptionId: colour?.id || null,
    modelOptionId: model?.id || null,
    colours: colours.length ? colours : DEFAULT_COLOURS.map((n) => ({ id: null, name: n })),
    modelValues,
    models,
    variants,
  }
}

const variantInput = (product, colourVal, modelVal, price) => ({
  ...(price != null ? { price: String(price) } : {}),
  optionValues: [
    { optionName: product.colourOptionName, name: colourVal },
    { optionName: product.modelOptionName, name: modelVal },
  ],
})

async function bulkCreate(env, productId, variants) {
  if (!variants.length) return 0
  const res = await shopifyAdmin(env, M_CREATE, { productId, variants, strategy: 'DEFAULT' })
  const errs = res.productVariantsBulkCreate?.userErrors || []
  if (errs.length) throw new Error(JSON.stringify(errs))
  return variants.length
}

async function bulkDelete(env, productId, ids) {
  if (!ids.length) return 0
  const res = await shopifyAdmin(env, M_DELETE, { productId, variantsIds: ids })
  const errs = res.productVariantsBulkDelete?.userErrors || []
  if (errs.length) throw new Error(JSON.stringify(errs))
  return ids.length
}

/** Best-effort removal of a now-empty option value (never throws). */
async function dropOptionValue(env, product, which, valueName) {
  const optId = which === 'colour' ? product.colourOptionId : product.modelOptionId
  const list = which === 'colour' ? product.colours : product.modelValues
  const valId = (list.find((v) => v.name === valueName) || {}).id
  if (!optId || !valId) return
  try {
    await shopifyAdmin(env, M_OPTION, {
      productId: product.productId,
      option: { id: optId },
      optionValuesToDelete: [valId],
      variantStrategy: 'LEAVE_AS_IS',
    })
  } catch {
    /* the value may still be referenced elsewhere — leave it */
  }
}

/** Create one variant per (missing) colour for a model. Returns count created. */
export async function addModelVariants(env, product, modelName, price) {
  const have = new Set(product.variants.filter((v) => v.model === modelName).map((v) => v.colour))
  const variants = product.colours
    .filter((c) => !have.has(c.name))
    .map((c) => variantInput(product, c.name, modelName, price))
  return bulkCreate(env, product.productId, variants)
}

/** Delete every variant of a model + drop its option value. */
export async function deleteModelVariants(env, product, modelName) {
  const ids = product.variants.filter((v) => v.model === modelName).map((v) => v.id)
  const n = await bulkDelete(env, product.productId, ids)
  await dropOptionValue(env, product, 'model', modelName)
  return n
}

/** Create one variant of a new colour for every existing model. */
export async function addColourVariants(env, product, colourName, price) {
  const variants = product.models
    .map((m) => m.name)
    .filter((m) => !product.variants.some((v) => v.model === m && v.colour === colourName))
    .map((m) => variantInput(product, colourName, m, price))
  return bulkCreate(env, product.productId, variants)
}

/** Delete every variant of a colour + drop its option value. */
export async function deleteColourVariants(env, product, colourName) {
  const ids = product.variants.filter((v) => v.colour === colourName).map((v) => v.id)
  const n = await bulkDelete(env, product.productId, ids)
  await dropOptionValue(env, product, 'colour', colourName)
  return n
}

const M_VUPDATE = `
  mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }`

const M_MEDIA_CREATE = `
  mutation($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { ... on MediaImage { id image { url } } }
      mediaUserErrors { field message }
    }
  }`

/** Set the same price on many variants at once (chunked). Returns count. */
export async function setVariantPrices(env, product, variantIds, price) {
  const variants = (variantIds || []).filter(Boolean).map((id) => ({ id, price: String(price) }))
  for (let i = 0; i < variants.length; i += 100) {
    const chunk = variants.slice(i, i + 100)
    if (!chunk.length) continue
    const d = await shopifyAdmin(env, M_VUPDATE, { productId: product.productId, variants: chunk })
    const e = d.productVariantsBulkUpdate?.userErrors || []
    if (e.length) throw new Error(JSON.stringify(e))
  }
  return variants.length
}

/**
 * Upload an image (data URL or http url) and set it as ONE variant's image:
 * store to Files → productCreateMedia → associate the media to the variant.
 * Returns the CDN url.
 */
export async function setVariantImage(env, product, variantId, imageSrc) {
  const { url } = await storeImageToFiles(env, imageSrc, {
    filename: `variant-${Date.now()}.png`,
    alt: 'Variant image',
  })
  if (!url) throw new Error('image upload failed')
  const cm = await shopifyAdmin(env, M_MEDIA_CREATE, {
    productId: product.productId,
    media: [{ originalSource: url, mediaContentType: 'IMAGE', alt: 'Variant image' }],
  })
  const mErrs = cm.productCreateMedia?.mediaUserErrors || []
  if (mErrs.length) throw new Error(JSON.stringify(mErrs))
  const mediaId = cm.productCreateMedia?.media?.[0]?.id
  if (!mediaId) throw new Error('media create returned no id')
  const up = await shopifyAdmin(env, M_VUPDATE, {
    productId: product.productId,
    variants: [{ id: variantId, mediaId }],
  })
  const uErrs = up.productVariantsBulkUpdate?.userErrors || []
  if (uErrs.length) throw new Error(JSON.stringify(uErrs))
  return url
}

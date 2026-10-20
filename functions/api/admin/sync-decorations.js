import { bad, json, requireAdmin, shopifyAdmin } from '../_lib.js'
import { TYPES, shopifyConfigured, listRecords, saveRecord } from '../_shopify-store.js'
import { shopifyVariantBatch, shopifyVariantsByIds } from './shopify-variants.js'
import { applyDecorationSync } from '../../../src/lib/decorationSync.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
  'cache-control': 'no-store',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

async function importImage(env, record) {
  // Typed charm metaobjects require a MediaImage file reference, not just a URL.
  const data = await shopifyAdmin(env, `
    mutation($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id ... on MediaImage { image { url } } }
        userErrors { message }
      }
    }`, { files: [{ contentType: 'IMAGE', originalSource: record.src, alt: record.name }] })
  const errors = data.fileCreate.userErrors
  if (errors.length) throw new Error(errors.map((error) => error.message).join('; '))
  const file = data.fileCreate.files[0]
  if (!file?.id) throw new Error('Shopify did not create the image file')
  if (file.image?.url) return { id: file.id, url: file.image.url }
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 700))
    const result = await shopifyAdmin(env, `
      query($id: ID!) { node(id: $id) { ... on MediaImage { fileStatus image { url } } } }
    `, { id: file.id })
    if (result.node?.fileStatus === 'FAILED') throw new Error('Shopify image processing failed')
    if (result.node?.image?.url) return { id: file.id, url: result.node.image.url }
  }
  throw new Error('Shopify image is still processing; retry this item shortly')
}

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  if (!shopifyConfigured(env)) return bad('Configure Shopify before importing variants', 409)
  const body = await request.json().catch(() => null)
  if (!body || !['charm', 'patch'].includes(body.kind)) return bad('kind must be charm or patch')
  if (!['preview', 'apply'].includes(body.action)) return bad('action must be preview or apply')
  if (body.keyword != null && typeof body.keyword !== 'string') return bad('keyword must be text')
  if (body.after != null && (typeof body.after !== 'string' || !body.after || body.after.length > 4096)) return bad('Invalid scan cursor')
  if (body.action === 'apply' && (
    !Array.isArray(body.variantIds) || !Array.isArray(body.existingIds) ||
    body.variantIds.some((id) => typeof id !== 'string' || !/^\d+$/.test(id)) ||
    body.existingIds.some((id) => typeof id !== 'string' || !id) ||
    body.variantIds.length + body.existingIds.length > 50
  )) return bad('Select at most 50 valid items per request')
  try {
    const type = TYPES[body.kind]
    if (body.action === 'preview') {
      const records = body.after ? null : await listRecords(env, type)
      // Bound each request's Shopify subrequests for large merchant catalogues.
      const { variants, after } = await shopifyVariantBatch(env, body.after || null)
      return json({
        variants,
        ...(records ? { records: records.map(({ _gid, _handle, ...record }) => record) } : {}),
        after,
      }, { headers: cors })
    }
    const records = await listRecords(env, type)
    const selectedRecords = new Set(body.existingIds)
    const variantIds = [
      ...body.variantIds,
      ...records.filter((record) => selectedRecords.has(record.id))
        .map((record) => String(record.shopifyVariantId || ''))
        .filter((id) => /^\d+$/.test(id)),
    ]
    const variants = await shopifyVariantsByIds(env, variantIds)
    const result = await applyDecorationSync({
      kind: body.kind,
      variants,
      records,
      variantIds: body.variantIds,
      existingIds: body.existingIds,
      save: (record, images) => saveRecord(env, type, record.id, record, images),
      storeImage: (record) => importImage(env, record),
    })
    if (result.failed.length) console.warn('decoration_sync_partial_failure', body.kind, result.failed)
    return json({ ok: !result.failed.length, ...result }, { headers: cors })
  } catch (error) {
    console.warn('decoration_sync_failed', error.message)
    return bad(`Shopify sync failed: ${error.message}`, 502)
  }
}

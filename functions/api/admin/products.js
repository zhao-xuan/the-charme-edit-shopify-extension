// Admin product endpoints (require Bearer ADMIN_TOKEN or a Shopify session token).
//   POST   /api/admin/products  { name,kind,basePrice,shopifyVariantId?,widthMm,heightMm,src(dataURL),colourLabel }
//   PATCH  /api/admin/products  { id, basePrice?, name?, shopifyVariantId? }
//   DELETE /api/admin/products  { id }
//
// Storage: Shopify `charme_product` METAOBJECT + Shopify FILES when configured;
// otherwise the legacy Cloudflare D1 + KV fallback.
import { json, bad, requireAdmin, storeImage, makeId, rowToProduct } from '../_lib.js'
import {
  TYPES,
  shopifyConfigured,
  saveRecord,
  getRecord,
  deleteRecord,
  storeImageToFiles,
} from '../_shopify-store.js'
import { getCaseProduct, addModelVariants, deleteModelVariants } from '../_case-variants.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const p = (await request.json().catch(() => null)) || {}
  if (!p.src) return bad('product needs a body image')
  if (
    Object.prototype.hasOwnProperty.call(p, 'shopifyVariantId') &&
    p.shopifyVariantId != null &&
    p.shopifyVariantId !== '' &&
    !/^\d+$/.test(String(p.shopifyVariantId))
  ) {
    return bad('shopifyVariantId must be a Shopify variant ID')
  }
  const id = p.id || makeId('prod', p.name || 'product')

  if (shopifyConfigured(env)) {
    const { url, id: imageId } = await storeImageToFiles(env, p.src, {
      filename: `${id}.png`,
      alt: p.name || 'Product',
    })
    const rec = {
      id,
      name: p.name || 'Custom product',
      kind: p.kind === 'tote' ? 'tote' : 'phone',
      basePrice: p.basePrice ?? 26,
      shopifyVariantId: p.shopifyVariantId ? String(p.shopifyVariantId) : undefined,
      widthMm: p.widthMm || 75,
      heightMm: p.heightMm || 150,
      src: url,
      imageId: imageId || null,
      colourLabel: p.colourLabel || 'Default',
      active: true,
    }
    await saveRecord(env, TYPES.product, id, rec, { image: imageId })
    // Cascade: a phone model must have its real sellable variants (one per
    // colour) on the single custom-charm-phone-case product. Best-effort — a
    // missing write_products scope must not block creating the metaobject.
    let variantNote
    if (rec.kind === 'phone') {
      try {
        const caseProduct = await getCaseProduct(env)
        if (caseProduct && !caseProduct.models.some((m) => m.name === rec.name)) {
          await addModelVariants(env, caseProduct, rec.name, rec.basePrice)
        }
      } catch (e) {
        variantNote = `Product saved, but its Shopify variants weren't created: ${e.message}`
      }
    }
    const { imageId: _drop, active: _a, ...product } = rec
    return json({ ok: true, product, variantNote }, { headers: cors })
  }

  // ---- Legacy Cloudflare D1 + KV fallback ----
  const imageKey = await storeImage(env, id, p.src)
  await env.DB.prepare(
    `INSERT OR REPLACE INTO products
     (id,name,kind,base_price,width_mm,height_mm,image_key,colour_label,active)
     VALUES (?,?,?,?,?,?,?,?,1)`,
  ).bind(
    id, p.name || 'Custom product', p.kind === 'tote' ? 'tote' : 'phone',
    p.basePrice ?? 26, p.widthMm || 75, p.heightMm || 150, imageKey, p.colourLabel || 'Default',
  ).run()
  const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first()
  return json({ ok: true, product: rowToProduct(row) }, { headers: cors })
}

export async function onRequestPatch({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const body = (await request.json().catch(() => ({}))) || {}
  const { id, basePrice, name, widthMm, heightMm, src, shopifyVariantId } = body
  const hasVariantPatch = Object.prototype.hasOwnProperty.call(body, 'shopifyVariantId')
  if (!id) return bad('id required')
  if (
    hasVariantPatch &&
    shopifyVariantId != null &&
    shopifyVariantId !== '' &&
    !/^\d+$/.test(String(shopifyVariantId))
  ) {
    return bad('shopifyVariantId must be a Shopify variant ID')
  }

  if (shopifyConfigured(env)) {
    const rec = await getRecord(env, TYPES.product, id)
    if (!rec) return bad('not found', 404)
    if (basePrice != null) rec.basePrice = basePrice
    if (name != null) rec.name = name
    if (hasVariantPatch) {
      rec.shopifyVariantId = shopifyVariantId ? String(shopifyVariantId) : undefined
    }
    if (widthMm != null) rec.widthMm = widthMm
    if (heightMm != null) rec.heightMm = heightMm
    const imageGids = {}
    if (src && /^data:/.test(src)) {
      const { url, id: imageId } = await storeImageToFiles(env, src, { filename: `${id}.png`, alt: name || rec.name })
      rec.src = url
      imageGids.image = imageId
    }
    await saveRecord(env, TYPES.product, id, rec, imageGids)
    return json({ ok: true }, { headers: cors })
  }

  if (basePrice != null) await env.DB.prepare('UPDATE products SET base_price = ? WHERE id = ?').bind(basePrice, id).run()
  if (name != null) await env.DB.prepare('UPDATE products SET name = ? WHERE id = ?').bind(name, id).run()
  if (widthMm != null) await env.DB.prepare('UPDATE products SET width_mm = ? WHERE id = ?').bind(widthMm, id).run()
  if (heightMm != null) await env.DB.prepare('UPDATE products SET height_mm = ? WHERE id = ?').bind(heightMm, id).run()
  if (src && /^data:/.test(src)) {
    const key = await storeImage(env, id, src)
    await env.DB.prepare('UPDATE products SET image_key = ? WHERE id = ?').bind(key, id).run()
  }
  return json({ ok: true }, { headers: cors })
}

export async function onRequestDelete({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const { id } = (await request.json().catch(() => ({}))) || {}
  if (!id) return bad('id required')

  if (shopifyConfigured(env)) {
    // Read the record first so we know its name (to match the sellable variants)
    // and kind before deleting the metaobject + its Shopify Files image.
    const rec = await getRecord(env, TYPES.product, id)
    await deleteRecord(env, TYPES.product, id, { deleteImages: true })
    let variantNote
    if (rec && rec.kind === 'phone') {
      try {
        const caseProduct = await getCaseProduct(env)
        if (caseProduct) await deleteModelVariants(env, caseProduct, rec.name)
      } catch (e) {
        variantNote = `Product deleted, but its Shopify variants weren't removed: ${e.message}`
      }
    }
    return json({ ok: true, variantNote }, { headers: cors })
  }

  const row = await env.DB.prepare('SELECT image_key FROM products WHERE id = ?').bind(id).first()
  if (row?.image_key) await env.IMAGES.delete(`img:${row.image_key}`)
  await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run()
  return json({ ok: true }, { headers: cors })
}

import {
  route,
  readBody,
  StudioError,
  onStudioOptions,
  studioAdmin,
  studioDb,
} from '../../_studio.js'
import {
  encryptTrackingCredential,
  TrackingCredentialError,
} from '../../_tracking-credentials.js'

const GA4_MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/i
const META_PIXEL_ID = /^\d{5,30}$/
const SECRET = /^[\x21-\x7e]{8,512}$/

export const onRequestOptions = onStudioOptions

function requiredText(value, name, pattern, max = 80) {
  if (typeof value !== 'string') throw new StudioError(`${name} 格式无效。`)
  const result = value.trim()
  if (result && (result.length > max || !pattern.test(result))) throw new StudioError(`${name} 格式无效。`)
  return result
}

function secretInput(body, field, clearField, name) {
  const value = body[field] ?? ''
  if (typeof value !== 'string') throw new StudioError(`${name} 格式无效。`)
  const secret = value.trim()
  if (secret && !SECRET.test(secret)) throw new StudioError(`${name} 格式无效。`)
  if (body[clearField] != null && typeof body[clearField] !== 'boolean') {
    throw new StudioError(`${name} 清除选项无效。`)
  }
  if (body[clearField] && secret) throw new StudioError(`不能同时设置和清除 ${name}。`)
  return { secret, clear: body[clearField] === true }
}

function publicSettings(row) {
  return {
    measurementId: row?.ga_measurement_id || '',
    pixelId: row?.meta_pixel_id || '',
    gaSecretConfigured: !!row?.ga_api_secret_enc,
    metaTokenConfigured: !!row?.meta_access_token_enc,
    updatedAt: row?.updated_at || null,
  }
}

async function getShopSettings(db, shop) {
  return db.prepare(
    `SELECT ga_measurement_id, ga_api_secret_enc, meta_pixel_id,
            meta_access_token_enc, updated_at
     FROM studio_tracking_settings WHERE shop_id=?`,
  ).bind(shop).first()
}

export const onRequestGet = route(async ({ request, env }) => {
  const db = await studioDb(env)
  const shop = await studioAdmin(request, env, db)
  return { settings: publicSettings(await getShopSettings(db, shop)) }
})

export const onRequestPut = route(async ({ request, env }) => {
  const db = await studioDb(env)
  const shop = await studioAdmin(request, env, db)
  const body = await readBody(request, 8_192)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StudioError('设置格式无效。')
  const measurementId = requiredText(body.measurementId ?? '', 'GA4 Measurement ID', GA4_MEASUREMENT_ID, 32)
  const pixelId = requiredText(body.pixelId ?? '', 'Meta Pixel ID', META_PIXEL_ID, 30)
  const gaSecret = secretInput(body, 'gaApiSecret', 'clearGaSecret', 'GA4 API secret')
  const metaToken = secretInput(body, 'metaAccessToken', 'clearMetaToken', 'Meta access token')
  const current = await getShopSettings(db, shop)
  let gaSecretEnc = gaSecret.clear ? null : current?.ga_api_secret_enc || null
  let metaTokenEnc = metaToken.clear ? null : current?.meta_access_token_enc || null

  try {
    if (gaSecret.secret) gaSecretEnc = await encryptTrackingCredential(gaSecret.secret, shop, 'ga4', env)
    if (metaToken.secret) metaTokenEnc = await encryptTrackingCredential(metaToken.secret, shop, 'meta', env)
  } catch (error) {
    if (error instanceof TrackingCredentialError) throw new StudioError(error.message, 503)
    throw error
  }

  const updatedAt = new Date().toISOString()
  await db.prepare(
    `INSERT INTO studio_tracking_settings
       (shop_id, ga_measurement_id, ga_api_secret_enc, meta_pixel_id, meta_access_token_enc, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(shop_id) DO UPDATE SET
       ga_measurement_id=excluded.ga_measurement_id,
       ga_api_secret_enc=excluded.ga_api_secret_enc,
       meta_pixel_id=excluded.meta_pixel_id,
       meta_access_token_enc=excluded.meta_access_token_enc,
       updated_at=excluded.updated_at`,
  ).bind(shop, measurementId, gaSecretEnc, pixelId, metaTokenEnc, updatedAt).run()

  return {
    settings: publicSettings({
      ga_measurement_id: measurementId,
      ga_api_secret_enc: gaSecretEnc,
      meta_pixel_id: pixelId,
      meta_access_token_enc: metaTokenEnc,
      updated_at: updatedAt,
    }),
  }
})

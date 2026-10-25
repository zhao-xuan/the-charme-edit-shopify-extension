import { PRODUCT_TEMPLATES } from '../../src/studio/templates.js'
import { verifyShopifySessionToken } from './_lib.js'

export class StudioError extends Error { constructor(message, status=400) { super(message); this.status=status } }
export const corsHeaders = (request, env) => {
  const origin = request.headers.get('origin')
  const own = new URL(request.url).origin
  const allowed = new Set([own, ...(env.STUDIO_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)])
  if (env.SHOPIFY_STORE) allowed.add(`https://${env.SHOPIFY_STORE}`)
  if (origin && !allowed.has(origin)) throw new StudioError('此来源尚未启用产品工作室。',403)
  return { ...(origin ? {'access-control-allow-origin':origin} : {}), vary:'Origin',
    'access-control-allow-methods':'GET,POST,PATCH,OPTIONS', 'access-control-allow-headers':'authorization,content-type',
    'cache-control':'no-store', 'x-content-type-options':'nosniff' }
}
export const studioJson = (data, status=200, headers={}) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json; charset=utf-8',...headers}})
export function route(fn) {
  return async (context) => {
    let headers = {}
    try {
      headers=corsHeaders(context.request,context.env)
      if (context.request.method==='OPTIONS') return new Response(null,{status:204,headers})
      const data=await fn(context)
      return studioJson(data,200,headers)
    } catch (error) {
      if (!(error instanceof StudioError)) console.error('[studio]',error?.message)
      return studioJson({error:error instanceof StudioError ? error.message : '服务暂不可用，请稍后重试。'},error.status || 500,headers)
    }
  }
}
export const onStudioOptions = route(() => ({}))

export function studioShop(env, request) {
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(env.SHOPIFY_STORE || '')) return env.SHOPIFY_STORE
  if (['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname)) return 'local-development'
  throw new StudioError('尚未配置此商店的工作室后端。',503)
}
export async function studioAdmin(request,env) {
  const auth=request.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) throw new StudioError('请通过商家后台登录。',401)
  const token=auth.slice(7)
  if (env.ADMIN_TOKEN && token===env.ADMIN_TOKEN) return true
  const claims=await verifyShopifySessionToken(token,env)
  const shop=studioShop(env,request)
  if (!claims || !claims.exp || !claims.nbf || claims.aud!==env.SHOPIFY_CLIENT_ID || claims.dest!==`https://${shop}` || claims.iss!==`https://${shop}/admin`) throw new StudioError('商家身份或商店不匹配。',401)
  return true
}
export async function readBody(request,limit=1_000_000) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new StudioError('请求需要 JSON。',415)
  const reader=request.body?.getReader()
  if (!reader) throw new StudioError('请求内容为空。')
  const chunks=[]; let size=0
  try {
    while (true) {
      const {done,value}=await reader.read(); if (done) break
      size+=value.byteLength
      if (size>limit) { await reader.cancel(); throw new StudioError('设计文件过大，请减少图片。',413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes=new Uint8Array(size);let offset=0
  for (const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.byteLength }
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new StudioError('JSON 格式无效。') }
}
export const validated = (fn) => { try { return fn() } catch (error) { throw new StudioError(error.message) } }

export const STUDIO_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS studio_templates (shop_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(shop_id,id))',
  'CREATE TABLE IF NOT EXISTS studio_designs (shop_id TEXT NOT NULL,id TEXT NOT NULL,secret_hash TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,body TEXT NOT NULL,review TEXT NOT NULL DEFAULT \'{}\',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(shop_id,id))',
  'CREATE INDEX IF NOT EXISTS studio_design_queue ON studio_designs(shop_id,state,updated_at)',
  'CREATE TABLE IF NOT EXISTS studio_limits (bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)',
]
export async function studioDb(env) {
  if (!env.DB) throw new StudioError('设计存储尚未配置（需要 D1 DB）。',503)
  await env.DB.batch(STUDIO_SCHEMA.map((sql) => env.DB.prepare(sql)))
  return env.DB
}
export async function digest(value) {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2,'0')).join('')
}
export async function limitWrites(db,request,shop) {
  const now=Date.now(), bucket=await digest(`${shop}:${request.headers.get('CF-Connecting-IP') || 'local'}:${Math.floor(now/60000)}`)
  const result=await db.prepare('INSERT INTO studio_limits(bucket,count,expires) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<30').bind(bucket,now+120000).run()
  if (!result.meta?.changes) throw new StudioError('保存过于频繁，请一分钟后重试。',429)
  await db.prepare('DELETE FROM studio_limits WHERE bucket IN (SELECT bucket FROM studio_limits WHERE expires<? LIMIT 100)').bind(now).run()
}
export async function getTemplates(db,shop) {
  const {results}=await db.prepare('SELECT id,revision,body FROM studio_templates WHERE shop_id=?').bind(shop).all()
  const saved=new Map(results.map((r) => [r.id,{...JSON.parse(r.body),version:r.revision}]))
  return PRODUCT_TEMPLATES.map((t) => saved.get(t.id) || structuredClone(t))
}
export async function getTemplate(db,shop,id) { return (await getTemplates(db,shop)).find((t) => t.id===id) }
export const designId = (id) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id || '')) throw new StudioError('设计编号无效。')
  return id
}
export async function getDesign(db,shop,id) {
  const row=await db.prepare('SELECT * FROM studio_designs WHERE shop_id=? AND id=?').bind(shop,designId(id)).first()
  if (!row) throw new StudioError('未找到设计或没有访问权限。',404)
  return row
}
export async function designAccess(request,env,row) {
  const auth=request.headers.get('authorization') || ''
  if (auth.startsWith('Bearer ')) return studioAdmin(request,env)
  const secret=auth.startsWith('Design ') ? auth.slice(7) : ''
  if (!/^[0-9a-f]{64}$/.test(secret) || await digest(secret)!==row.secret_hash) throw new StudioError('未找到设计或没有访问权限。',404)
}
export function publicDesign(row) {
  return {id:row.id,revision:row.revision,state:row.state,...JSON.parse(row.body),review:JSON.parse(row.review),createdAt:row.created_at,updatedAt:row.updated_at}
}

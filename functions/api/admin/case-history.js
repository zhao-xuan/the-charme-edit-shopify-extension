import { json, bad } from '../_lib.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}

const FINISHES = new Set(['black', 'white', 'glitter'])

export const onRequestOptions = () => new Response(null, { headers: cors })

async function ensureTables(env) {
  if (!env.DB) throw new Error('D1 is not configured')
  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS case_prompt_versions (
        prompt_version_key TEXT PRIMARY KEY,
        review_key         TEXT NOT NULL,
        model_id           TEXT NOT NULL,
        finish             TEXT NOT NULL CHECK (finish IN ('black', 'white', 'glitter')),
        version            INTEGER NOT NULL CHECK (version > 0),
        prompt_text        TEXT NOT NULL,
        reference_images   TEXT NOT NULL DEFAULT '[]',
        generator          TEXT NOT NULL DEFAULT 'ChatGPT',
        conversation_url   TEXT NOT NULL DEFAULT '',
        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (review_key, version)
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS case_image_versions (
        image_version_key  TEXT PRIMARY KEY,
        review_key         TEXT NOT NULL,
        model_id           TEXT NOT NULL,
        finish             TEXT NOT NULL CHECK (finish IN ('black', 'white', 'glitter')),
        version            INTEGER NOT NULL CHECK (version > 0),
        image_path         TEXT NOT NULL,
        sha256             TEXT NOT NULL DEFAULT '',
        width_px           INTEGER,
        height_px          INTEGER,
        source_url         TEXT NOT NULL DEFAULT '',
        prompt_version_key TEXT NOT NULL,
        is_current         INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (review_key, version),
        FOREIGN KEY (prompt_version_key) REFERENCES case_prompt_versions(prompt_version_key)
      )
    `),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_case_prompts_review ON case_prompt_versions (review_key, version DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_case_images_review ON case_image_versions (review_key, version DESC)'),
  ])
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function cleanIdentity(value) {
  const modelId = String(value?.modelId || '').trim().toLowerCase()
  const finish = String(value?.finish || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(modelId)) throw new Error(`invalid modelId "${modelId}"`)
  if (!FINISHES.has(finish)) throw new Error(`invalid finish "${finish}"`)
  return { modelId, finish, reviewKey: `${modelId}:${finish}` }
}

function cleanCreate(value) {
  const identity = cleanIdentity(value)
  const promptText = String(value.promptText || '').trim()
  const imagePath = String(value.imagePath || '').trim()
  if (!promptText || promptText.length > 30000) throw new Error('promptText must be 1-30000 characters')
  if (imagePath && !/^\/assets\/cases\/case-history\/[a-z0-9/_-]+\.png$/i.test(imagePath)) {
    throw new Error('imagePath must be an immutable PNG under /assets/cases/case-history/')
  }
  const referenceImages = Array.isArray(value.referenceImages)
    ? [...new Set(value.referenceImages.map((item) => String(item).trim()).filter(Boolean))].slice(0, 20)
    : []
  const widthPx = value.widthPx == null ? null : Number(value.widthPx)
  const heightPx = value.heightPx == null ? null : Number(value.heightPx)
  if (widthPx != null && (!Number.isInteger(widthPx) || widthPx <= 0)) throw new Error('widthPx must be a positive integer')
  if (heightPx != null && (!Number.isInteger(heightPx) || heightPx <= 0)) throw new Error('heightPx must be a positive integer')
  return {
    ...identity,
    promptText,
    imagePath,
    referenceImages,
    generator: String(value.generator || 'ChatGPT').trim().slice(0, 100),
    conversationUrl: String(value.conversationUrl || '').trim().slice(0, 1000),
    sourceUrl: String(value.sourceUrl || '').trim().slice(0, 2000),
    sha256: String(value.sha256 || '').trim().toLowerCase().slice(0, 128),
    widthPx,
    heightPx,
    setCurrent: value.setCurrent !== false,
  }
}

function toPrompt(row) {
  return {
    key: row.prompt_version_key,
    modelId: row.model_id,
    finish: row.finish,
    version: row.version,
    promptText: row.prompt_text,
    referenceImages: parseJsonArray(row.reference_images),
    generator: row.generator,
    conversationUrl: row.conversation_url || '',
    createdAt: row.created_at,
  }
}

function toImage(row) {
  return {
    key: row.image_version_key,
    modelId: row.model_id,
    finish: row.finish,
    version: row.version,
    imagePath: row.image_path,
    sha256: row.sha256 || '',
    widthPx: row.width_px,
    heightPx: row.height_px,
    sourceUrl: row.source_url || '',
    promptVersionKey: row.prompt_version_key,
    current: Boolean(row.is_current),
    createdAt: row.created_at,
  }
}

async function listHistory(env, identity = null) {
  const where = identity ? ' WHERE review_key = ?' : ''
  const binding = identity ? [identity.reviewKey] : []
  const [promptResult, imageResult] = await Promise.all([
    env.DB.prepare(`
      SELECT prompt_version_key, model_id, finish, version, prompt_text,
             reference_images, generator, conversation_url, created_at
      FROM case_prompt_versions${where}
      ORDER BY model_id, finish, version DESC
    `).bind(...binding).all(),
    env.DB.prepare(`
      SELECT image_version_key, model_id, finish, version, image_path, sha256,
             width_px, height_px, source_url, prompt_version_key, is_current, created_at
      FROM case_image_versions${where}
      ORDER BY model_id, finish, version DESC
    `).bind(...binding).all(),
  ])
  return {
    prompts: (promptResult.results || []).map(toPrompt),
    images: (imageResult.results || []).map(toImage),
  }
}

export async function onRequestGet({ request, env }) {
  try {
    await ensureTables(env)
    const url = new URL(request.url)
    const hasFilter = url.searchParams.has('modelId') || url.searchParams.has('finish')
    const identity = hasFilter
      ? cleanIdentity({ modelId: url.searchParams.get('modelId'), finish: url.searchParams.get('finish') })
      : null
    return json(await listHistory(env, identity), { headers: cors })
  } catch (error) {
    return bad(`Could not load case history: ${error.message}`, 500)
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null)
  let entry
  try {
    entry = cleanCreate(body)
  } catch (error) {
    return bad(error.message)
  }

  try {
    await ensureTables(env)
    const versions = await env.DB.prepare(`
      SELECT
        COALESCE((SELECT MAX(version) FROM case_prompt_versions WHERE review_key = ?), 0) AS prompt_version,
        COALESCE((SELECT MAX(version) FROM case_image_versions WHERE review_key = ?), 0) AS image_version
    `).bind(entry.reviewKey, entry.reviewKey).first()
    const promptVersion = Number(versions?.prompt_version || 0) + 1
    const imageVersion = Number(versions?.image_version || 0) + 1
    const promptKey = `${entry.reviewKey}:prompt:v${promptVersion}`
    const imageKey = `${entry.reviewKey}:image:v${imageVersion}`
    const statements = [
      env.DB.prepare(`
        INSERT INTO case_prompt_versions
          (prompt_version_key, review_key, model_id, finish, version, prompt_text,
           reference_images, generator, conversation_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        promptKey,
        entry.reviewKey,
        entry.modelId,
        entry.finish,
        promptVersion,
        entry.promptText,
        JSON.stringify(entry.referenceImages),
        entry.generator,
        entry.conversationUrl,
      ),
    ]
    if (entry.imagePath) {
      if (entry.setCurrent) {
        statements.push(env.DB.prepare(
          'UPDATE case_image_versions SET is_current = 0 WHERE review_key = ?',
        ).bind(entry.reviewKey))
      }
      statements.push(env.DB.prepare(`
        INSERT INTO case_image_versions
          (image_version_key, review_key, model_id, finish, version, image_path,
           sha256, width_px, height_px, source_url, prompt_version_key, is_current)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        imageKey,
        entry.reviewKey,
        entry.modelId,
        entry.finish,
        imageVersion,
        entry.imagePath,
        entry.sha256,
        entry.widthPx,
        entry.heightPx,
        entry.sourceUrl,
        promptKey,
        entry.setCurrent ? 1 : 0,
      ))
    }
    await env.DB.batch(statements)
    return json(await listHistory(env, entry), { status: 201, headers: cors })
  } catch (error) {
    return bad(`Could not create case history: ${error.message}`, 500)
  }
}
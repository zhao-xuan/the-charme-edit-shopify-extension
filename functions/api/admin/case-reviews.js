// Public review-board persistence for generated case assets.
//   GET /api/admin/case-reviews → { reviews: [...] }
//   PUT /api/admin/case-reviews { reviews: [...] } → saved review rows
import { json, bad } from '../_lib.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}

const FINISHES = new Set(['black', 'white', 'glitter'])
const STATUSES = new Set(['checking', 'approved', 'changes'])

export const onRequestOptions = () => new Response(null, { headers: cors })

async function ensureTable(env) {
  if (!env.DB) throw new Error('D1 is not configured')
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS case_asset_reviews (
      review_key TEXT PRIMARY KEY,
      model_id   TEXT NOT NULL,
      finish     TEXT NOT NULL CHECK (finish IN ('black', 'white', 'glitter')),
      status     TEXT NOT NULL DEFAULT 'checking'
                 CHECK (status IN ('checking', 'approved', 'changes')),
      comment    TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      issues     TEXT NOT NULL DEFAULT '[]',
      UNIQUE (model_id, finish)
    )
  `).run()
}

function parseIssues(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function toReview(row) {
  return {
    modelId: row.model_id,
    finish: row.finish,
    status: row.status,
    comment: row.comment || '',
    issues: parseIssues(row.issues),
    updatedAt: row.updated_at,
  }
}

async function listReviews(env) {
  const { results = [] } = await env.DB.prepare(`
    SELECT model_id, finish, status, comment, issues, updated_at
    FROM case_asset_reviews
    ORDER BY model_id, finish
  `).all()
  return results.map(toReview)
}

export async function onRequestGet({ env }) {
  try {
    await ensureTable(env)
    return json({ reviews: await listReviews(env) }, { headers: cors })
  } catch (e) {
    return bad(`Could not load case reviews: ${e.message}`, 500)
  }
}

function cleanReview(value) {
  if (!value || typeof value !== 'object') throw new Error('each review must be an object')
  const modelId = String(value.modelId || '').trim()
  const finish = String(value.finish || '').trim().toLowerCase()
  const status = String(value.status || 'checking').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(modelId)) throw new Error(`invalid modelId "${modelId}"`)
  if (!FINISHES.has(finish)) throw new Error(`invalid finish "${finish}"`)
  if (!STATUSES.has(status)) throw new Error(`invalid status "${status}"`)
  const comment = String(value.comment || '').slice(0, 4000)
  const issues = Array.isArray(value.issues)
    ? [...new Set(value.issues.map((issue) => String(issue).trim()).filter(Boolean))].slice(0, 20)
    : []
  return { reviewKey: `${modelId}:${finish}`, modelId, finish, status, comment, issues }
}

export async function onRequestPut({ request, env }) {
  const body = (await request.json().catch(() => null)) || {}
  if (!Array.isArray(body.reviews)) return bad('reviews must be an array')

  let reviews
  try {
    const unique = new Map(body.reviews.map((value) => {
      const review = cleanReview(value)
      return [review.reviewKey, review]
    }))
    reviews = [...unique.values()]
  } catch (e) {
    return bad(e.message)
  }

  if (!reviews.length) return json({ reviews: [] }, { headers: cors })
  if (reviews.length > 250) return bad('at most 250 reviews can be saved at once')

  try {
    await ensureTable(env)
    const upsert = env.DB.prepare(`
      INSERT INTO case_asset_reviews
        (review_key, model_id, finish, status, comment, issues, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(review_key) DO UPDATE SET
        model_id = excluded.model_id,
        finish = excluded.finish,
        status = excluded.status,
        comment = excluded.comment,
        issues = excluded.issues,
        updated_at = datetime('now')
    `)
    await env.DB.batch(reviews.map((review) => upsert.bind(
      review.reviewKey,
      review.modelId,
      review.finish,
      review.status,
      review.comment,
      JSON.stringify(review.issues),
    )))
    const savedKeys = new Set(reviews.map((review) => review.reviewKey))
    const saved = (await listReviews(env)).filter(
      (review) => savedKeys.has(`${review.modelId}:${review.finish}`),
    )
    return json({ reviews: saved }, { headers: cors })
  } catch (e) {
    return bad(`Could not save case reviews: ${e.message}`, 500)
  }
}
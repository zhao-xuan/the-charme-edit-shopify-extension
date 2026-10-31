// D1 tables that connect a designer session to the cart that confirmed its
// designs and to the paid order that bought them. They hold design tokens, order
// ids and totals only: no customer data.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS analytics_design_links (
    design_token TEXT PRIMARY KEY, session_id TEXT NOT NULL, confirmed_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS analytics_design_links_confirmed ON analytics_design_links(confirmed_at)',
  `CREATE TABLE IF NOT EXISTS analytics_orders (
    order_id TEXT PRIMARY KEY, paid_at TEXT NOT NULL, data TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS analytics_orders_paid ON analytics_orders(paid_at)',
  'CREATE TABLE IF NOT EXISTS analytics_link_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL)',
]

export const RETENTION_MS = 400 * 86_400_000
export const LINKS_LIMIT = 20_000
export const ORDERS_LIMIT = 5_000
// Design tokens the public confirm endpoint accepts per UTC day, for everyone
// together. A shop confirms a few dozen a day, so this only stops a flood from
// using up the shared D1 write quota or pushing real links out of the read window.
export const DAILY_LINK_BUDGET = 2_000
const BUDGET_KEEP_MS = 2 * 86_400_000
// D1 allows 100 bound parameters per statement.
const LINKS_PER_STATEMENT = 30 // three parameters per row
const ORDERS_PER_REDACTION = 90 // one parameter per order id

const prepared = new WeakSet()

/** The D1 binding with the attribution tables in place, or null without D1. */
export async function analyticsDb(env) {
  const db = env?.DB
  if (!db) return null
  if (!prepared.has(db)) {
    await db.batch(SCHEMA.map((sql) => db.prepare(sql)))
    prepared.add(db)
  }
  return db
}

/**
 * Claims room for `count` design tokens in today's budget. One atomic upsert, so
 * concurrent requests cannot overshoot, and a refused claim writes nothing.
 */
export async function reserveLinkBudget(db, count, now = Date.now(), budget = DAILY_LINK_BUDGET) {
  if (!(count > 0) || count > budget) return false
  const day = new Date(now).toISOString().slice(0, 10)
  const result = await db.prepare(
    'INSERT INTO analytics_link_budget (day, used) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET used = used + excluded.used WHERE used + excluded.used <= ?',
  ).bind(day, count, budget).run()
  return (result.meta?.changes || 0) > 0
}

/** The first confirmation of a design token wins; repeats are ignored. */
export async function recordDesignLinks(db, sessionId, tokens, now = Date.now()) {
  const confirmedAt = new Date(now).toISOString()
  const statements = []
  for (let index = 0; index < tokens.length; index += LINKS_PER_STATEMENT) {
    const chunk = tokens.slice(index, index + LINKS_PER_STATEMENT)
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO analytics_design_links (design_token, session_id, confirmed_at) VALUES ${chunk.map(() => '(?, ?, ?)').join(', ')}`,
      ).bind(...chunk.flatMap((token) => [token, sessionId, confirmedAt])),
    )
  }
  if (statements.length) await db.batch(statements)
}

const linksQuery = (db, sinceIso, limit) => db.prepare(
  'SELECT design_token, session_id, confirmed_at FROM analytics_design_links WHERE confirmed_at >= ? ORDER BY confirmed_at DESC LIMIT ?',
).bind(sinceIso, limit)
const ordersQuery = (db, sinceIso, limit) => db.prepare(
  'SELECT data FROM analytics_orders WHERE paid_at >= ? ORDER BY paid_at DESC LIMIT ?',
).bind(sinceIso, limit)
const anyOrderQuery = (db) => db.prepare('SELECT 1 AS present FROM analytics_orders LIMIT 1')

const toLinks = (rows) => (rows || []).map((row) => ({ designToken: row.design_token, sessionId: row.session_id, confirmedAt: row.confirmed_at }))
const toOrders = (rows) => (rows || []).map((row) => {
  try { return JSON.parse(row.data) } catch { return null }
}).filter(Boolean)

/** Newest first, so a capped read drops the oldest rows like the session read does. */
export async function listDesignLinks(db, sinceIso, limit = LINKS_LIMIT) {
  const { results } = await linksQuery(db, sinceIso, limit).all()
  return toLinks(results)
}

/** One row per paid order; Shopify retries and repeated deliveries are ignored. */
export async function recordOrder(db, summary) {
  await db.prepare('INSERT OR IGNORE INTO analytics_orders (order_id, paid_at, data) VALUES (?, ?, ?)')
    .bind(summary.orderId, summary.paidAt, JSON.stringify(summary)).run()
}

export async function listOrders(db, sinceIso, limit = ORDERS_LIMIT) {
  const { results } = await ordersQuery(db, sinceIso, limit).all()
  return toOrders(results)
}

/** True once at least one paid designer order has been received. */
export async function ordersConnected(db) {
  return !!(await anyOrderQuery(db).first())
}

/**
 * Everything the attribution report reads, in one D1 round trip because the
 * report also pages through Shopify and Pages Functions cap subrequests.
 */
export async function readAttributionData(db, sinceIso, limits = {}) {
  const linksLimit = limits.links || LINKS_LIMIT
  const ordersLimit = limits.orders || ORDERS_LIMIT
  const [linkResult, orderResult, anyOrder] = await db.batch([
    linksQuery(db, sinceIso, linksLimit),
    ordersQuery(db, sinceIso, ordersLimit),
    anyOrderQuery(db),
  ])
  return {
    links: toLinks(linkResult.results),
    orders: toOrders(orderResult.results),
    ordersConnected: (anyOrder.results || []).length > 0,
    truncated: (linkResult.results || []).length >= linksLimit || (orderResult.results || []).length >= ordersLimit,
  }
}

export async function purgeExpired(db, now = Date.now()) {
  const before = new Date(now - RETENTION_MS).toISOString()
  await db.batch([
    db.prepare('DELETE FROM analytics_design_links WHERE confirmed_at < ?').bind(before),
    db.prepare('DELETE FROM analytics_orders WHERE paid_at < ?').bind(before),
    db.prepare('DELETE FROM analytics_link_budget WHERE day < ?').bind(new Date(now - BUDGET_KEEP_MS).toISOString().slice(0, 10)),
  ])
}

/** For a `shop/redact` request: forget every stored link and order. */
export async function eraseAnalyticsJoins(db) {
  await db.batch([
    db.prepare('DELETE FROM analytics_design_links'),
    db.prepare('DELETE FROM analytics_orders'),
  ])
}

/** For a `customers/redact` request: drop the listed orders. */
export async function redactOrders(db, orderIds) {
  const ids = [...new Set((Array.isArray(orderIds) ? orderIds : []).map(String).filter((id) => /^\d{1,20}$/.test(id)))]
  const statements = []
  for (let index = 0; index < ids.length; index += ORDERS_PER_REDACTION) {
    const chunk = ids.slice(index, index + ORDERS_PER_REDACTION)
    statements.push(db.prepare(`DELETE FROM analytics_orders WHERE order_id IN (${chunk.map(() => '?').join(', ')})`).bind(...chunk))
  }
  if (statements.length) await db.batch(statements)
}

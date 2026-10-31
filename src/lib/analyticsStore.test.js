import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RETENTION_MS,
  analyticsDb,
  eraseAnalyticsJoins,
  listDesignLinks,
  listOrders,
  ordersConnected,
  purgeExpired,
  readAttributionData,
  recordDesignLinks,
  recordOrder,
  reserveLinkBudget,
} from '../../functions/api/_analytics-store.js'
import { createSqliteD1 } from './testing/sqliteD1.js'

const d1 = await createSqliteD1()
const sqlTest = d1 ? test : test.skip

const NOW = Date.parse('2026-06-10T12:00:00Z')
const day = (offset) => new Date(NOW + offset * 86_400_000).toISOString()

const order = (id, paidAt, extra = {}) => ({
  orderId: String(id), orderName: `#${id}`, paidAt, currency: 'GBP', total: 30, isTest: false,
  sourceName: 'web', utmSource: '', utmMedium: '', utmCampaign: '', referringHost: '', designTokens: ['t'], ...extra,
})

const budgetDays = async (db) => {
  const { results } = await db.prepare('SELECT day, used FROM analytics_link_budget ORDER BY day').all()
  return results.map((row) => [row.day, row.used])
}

sqlTest('without D1 there is nothing to prepare', async () => {
  assert.equal(await analyticsDb({}), null)
  assert.equal(await analyticsDb(undefined), null)
})

sqlTest('the schema is created once per database and is safe to repeat', async () => {
  const db = await createSqliteD1()
  let batches = 0
  const batch = db.batch
  db.batch = async (statements) => { batches++; return batch(statements) }
  const env = { DB: db }
  assert.equal(await analyticsDb(env), db)
  assert.equal(await analyticsDb(env), db)
  assert.equal(batches, 1)
  const again = await createSqliteD1()
  await analyticsDb({ DB: again })
  await analyticsDb({ DB: again })
})

sqlTest('the first confirmation of a design token wins and repeats change nothing', async () => {
  const db = await analyticsDb({ DB: await createSqliteD1() })
  await recordDesignLinks(db, 'session-aaaaaaaa', ['design-1', 'design-2'], NOW)
  await recordDesignLinks(db, 'session-bbbbbbbb', ['design-2', 'design-3'], NOW + 60_000)
  const links = await listDesignLinks(db, day(-1))
  assert.deepEqual(
    links.map(({ designToken, sessionId }) => [designToken, sessionId]).sort(),
    [['design-1', 'session-aaaaaaaa'], ['design-2', 'session-aaaaaaaa'], ['design-3', 'session-bbbbbbbb']],
  )
  assert.equal(links.find((entry) => entry.designToken === 'design-2').confirmedAt, new Date(NOW).toISOString())
  await recordDesignLinks(db, 'session-cccccccc', [])
  assert.equal((await listDesignLinks(db, day(-1))).length, 3)
})

sqlTest('fifty tokens fit D1 parameter limits by being written in chunks', async () => {
  const db = await analyticsDb({ DB: await createSqliteD1() })
  const statements = []
  const prepare = db.prepare
  db.prepare = (sql) => { statements.push(sql); return prepare(sql) }
  const tokens = Array.from({ length: 50 }, (_, index) => `design-${index}`)
  await recordDesignLinks(db, 'session-aaaaaaaa', tokens, NOW)
  const inserts = statements.filter((sql) => sql.startsWith('INSERT OR IGNORE INTO analytics_design_links'))
  assert.equal(inserts.length, 2)
  for (const sql of inserts) assert.ok((sql.match(/\?/g) || []).length <= 100, 'D1 allows 100 bound parameters')
  assert.equal((await listDesignLinks(db, day(-1))).length, 50)
})

sqlTest('links are listed newest first from the window start only, and a cap keeps the newest', async () => {
  const db = await analyticsDb({ DB: await createSqliteD1() })
  await recordDesignLinks(db, 'session-aaaaaaaa', ['old'], NOW - 40 * 86_400_000)
  await recordDesignLinks(db, 'session-aaaaaaaa', ['b'], NOW - 2 * 86_400_000)
  await recordDesignLinks(db, 'session-aaaaaaaa', ['a'], NOW - 3 * 86_400_000)
  const links = await listDesignLinks(db, day(-7))
  assert.deepEqual(links.map((link) => link.designToken), ['b', 'a'])
  assert.deepEqual((await listDesignLinks(db, day(-7), 1)).map((link) => link.designToken), ['b'])
})

sqlTest('a paid order is stored once and read back as the extracted summary', async () => {
  const db = await analyticsDb({ DB: await createSqliteD1() })
  assert.equal(await ordersConnected(db), false)
  await recordOrder(db, order(1001, day(-1), { total: 47.98, utmSource: 'instagram', designTokens: ['d1', 'd2'] }))
  await recordOrder(db, order(1001, day(-1), { total: 999 }))
  await recordOrder(db, order(1002, day(-20)))
  assert.equal(await ordersConnected(db), true)
  const recent = await listOrders(db, day(-7))
  assert.equal(recent.length, 1)
  assert.deepEqual(recent[0], order(1001, day(-1), { total: 47.98, utmSource: 'instagram', designTokens: ['d1', 'd2'] }))
  assert.deepEqual((await listOrders(db, day(-30))).map((item) => item.orderId), ['1001', '1002'])
  assert.deepEqual((await listOrders(db, day(-30), 1)).map((item) => item.orderId), ['1001'])
})

sqlTest('an unreadable stored order is skipped instead of failing the report', async () => {
  const db = await analyticsDb({ DB: await createSqliteD1() })
  await recordOrder(db, order(1, day(-1)))
  await db.prepare('INSERT INTO analytics_orders (order_id, paid_at, data) VALUES (?, ?, ?)').bind('2', day(-1), '{not json').run()
  assert.equal((await listOrders(db, day(-7))).length, 1)
})

sqlTest('the report data is read in one D1 round trip and flags a capped read', async () => {
  const db = await analyticsDb({ DB: await createSqliteD1() })
  const batches = []
  const batch = db.batch
  db.batch = async (statements) => { batches.push(statements.length); return batch(statements) }

  const empty = await readAttributionData(db, day(-7))
  assert.deepEqual(empty, { links: [], orders: [], ordersConnected: false, truncated: false })
  assert.deepEqual(batches, [3])

  await recordDesignLinks(db, 'session-aaaaaaaa', ['a', 'b'], NOW - 86_400_000)
  await recordOrder(db, order(1, day(-1), { designTokens: ['a'] }))
  await recordOrder(db, order(2, day(-30)))
  const data = await readAttributionData(db, day(-7))
  assert.deepEqual(data.links.map((link) => link.designToken).sort(), ['a', 'b'])
  assert.deepEqual(data.orders.map((item) => item.orderId), ['1'])
  assert.equal(data.ordersConnected, true)
  assert.equal(data.truncated, false)
  assert.equal((await readAttributionData(db, day(-7), { links: 2 })).truncated, true)
  assert.equal((await readAttributionData(db, day(-7), { orders: 1 })).truncated, true)
  assert.equal((await readAttributionData(db, day(-7), { links: 3, orders: 2 })).truncated, false)
})

sqlTest('rows older than the retention period are purged and recent ones kept', async () => {
  const db = await analyticsDb({ DB: await createSqliteD1() })
  await recordDesignLinks(db, 'session-aaaaaaaa', ['ancient'], NOW - RETENTION_MS - 86_400_000)
  await recordDesignLinks(db, 'session-aaaaaaaa', ['recent'], NOW - 86_400_000)
  await recordOrder(db, order(1, new Date(NOW - RETENTION_MS - 86_400_000).toISOString()))
  await recordOrder(db, order(2, day(-1)))
  await reserveLinkBudget(db, 1, NOW - 5 * 86_400_000)
  await reserveLinkBudget(db, 1, NOW - 86_400_000)
  await purgeExpired(db, NOW)
  assert.deepEqual((await listDesignLinks(db, '1970-01-01T00:00:00.000Z')).map((link) => link.designToken), ['recent'])
  assert.deepEqual((await listOrders(db, '1970-01-01T00:00:00.000Z')).map((item) => item.orderId), ['2'])
  assert.deepEqual(await budgetDays(db), [['2026-06-09', 1]], 'budget counters older than two days are dropped')
})

sqlTest('the daily budget admits whole requests until it is used up and starts afresh each UTC day', async () => {
  const db = await analyticsDb({ DB: await createSqliteD1() })
  assert.equal(await reserveLinkBudget(db, 3, NOW, 5), true)
  assert.equal(await reserveLinkBudget(db, 2, NOW, 5), true)
  assert.equal(await reserveLinkBudget(db, 1, NOW, 5), false, 'five of five are used')
  assert.equal(await reserveLinkBudget(db, 1, NOW + 3_600_000, 5), false, 'an hour later is still the same day')
  assert.equal(await reserveLinkBudget(db, 5, NOW + 86_400_000, 5), true)
  assert.equal(await reserveLinkBudget(db, 6, NOW + 2 * 86_400_000, 5), false, 'more than a whole day is never admitted, even on an empty day')
  assert.equal(await reserveLinkBudget(db, 0, NOW + 2 * 86_400_000, 5), false)
  assert.deepEqual(await budgetDays(db), [['2026-06-10', 5], ['2026-06-11', 5]], 'refused claims leave the counters untouched')
})

sqlTest('erasing for a shop redaction empties both tables', async () => {
  const db = await analyticsDb({ DB: await createSqliteD1() })
  await recordDesignLinks(db, 'session-aaaaaaaa', ['d1'], NOW)
  await recordOrder(db, order(1, day(-1)))
  await eraseAnalyticsJoins(db)
  assert.equal((await listDesignLinks(db, '1970-01-01T00:00:00.000Z')).length, 0)
  assert.equal(await ordersConnected(db), false)
})

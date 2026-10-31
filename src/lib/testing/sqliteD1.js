// A D1-shaped wrapper over node:sqlite so tests run the real SQL the Pages
// Functions send to Cloudflare D1. `null` where this Node has no node:sqlite.
export async function createSqliteD1() {
  let DatabaseSync
  try {
    ({ DatabaseSync } = await import('node:sqlite'))
  } catch {
    return null
  }
  const sqlite = new DatabaseSync(':memory:')
  const plain = (row) => (row ? { ...row } : null)
  const statement = (sql, args = []) => {
    const rows = () => sqlite.prepare(sql).all(...args).map(plain)
    return {
      bind: (...values) => statement(sql, values),
      async run() {
        // Like D1, running a SELECT returns its rows.
        if (/^\s*select\b/i.test(sql)) return { success: true, results: rows(), meta: {} }
        const info = sqlite.prepare(sql).run(...args)
        return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }
      },
      async first() { return plain(sqlite.prepare(sql).get(...args)) },
      async all() { return { success: true, results: rows() } },
    }
  }
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const item of statements) results.push(await item.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
}

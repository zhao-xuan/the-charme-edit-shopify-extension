const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0

const percentage = (numerator, denominator) =>
  denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0

const average = (values) =>
  values.length ? values.reduce((sum, value) => sum + finite(value), 0) / values.length : 0

export function aggregateAnalytics(records) {
  const sessions = (records || []).filter((record) => record && record.startedAt)
  const purchaseClicks = sessions.filter((record) => record.purchaseClicked).length
  const checkoutSuccesses = sessions.filter((record) => record.checkoutSucceeded).length
  const summaryViews = sessions.filter((record) => finite(record.summaryViews) > 0).length
  const decorated = sessions.filter((record) => finite(record.decorationStartedAt) > 0)

  const byDay = new Map()
  const byKind = new Map()
  const devices = new Map()
  const decorations = new Map()
  const interactions = {
    productSelections: 0,
    finishChanges: 0,
    categoryChanges: 0,
    decorationAdds: 0,
    decorationRemoves: 0,
    decorationMoves: 0,
    undoCount: 0,
    clearCount: 0,
    zoomActions: 0,
    trayExpansions: 0,
    sideSwitches: 0,
    blockedOrderAttempts: 0,
  }

  for (const record of sessions) {
    const day = String(record.startedAt).slice(0, 10)
    const daily = byDay.get(day) || { date: day, sessions: 0, purchaseClicks: 0, checkoutSuccesses: 0 }
    daily.sessions += 1
    daily.purchaseClicks += record.purchaseClicked ? 1 : 0
    daily.checkoutSuccesses += record.checkoutSucceeded ? 1 : 0
    byDay.set(day, daily)

    const kind = record.productKind || 'unknown'
    const kindRow = byKind.get(kind) || { kind, sessions: 0, checkoutSuccesses: 0 }
    kindRow.sessions += 1
    kindRow.checkoutSuccesses += record.checkoutSucceeded ? 1 : 0
    byKind.set(kind, kindRow)

    const device = record.device || 'unknown'
    devices.set(device, (devices.get(device) || 0) + 1)

    for (const key of Object.keys(interactions)) interactions[key] += finite(record[key])

    for (const [id, count] of Object.entries(record.decorationSelections || {})) {
      const current = decorations.get(id) || { id, name: id, adds: 0 }
      current.name = record.decorationNames?.[id] || current.name
      current.adds += finite(count)
      decorations.set(id, current)
    }
  }

  return {
    totals: {
      sessions: sessions.length,
      decoratedSessions: decorated.length,
      summaryViews,
      purchaseClicks,
      checkoutSuccesses,
      purchaseClickRate: percentage(purchaseClicks, sessions.length),
      conversionRate: percentage(checkoutSuccesses, sessions.length),
      checkoutCompletionRate: percentage(checkoutSuccesses, purchaseClicks),
      averageSessionSeconds: Math.round(average(sessions.map((record) => finite(record.activeMs))) / 1000),
      averageDecorationSeconds: Math.round(average(decorated.map((record) => finite(record.decorationActiveMs))) / 1000),
      averageFinalDecorations: Math.round(average(sessions.map((record) => finite(record.finalDecorationCount))) * 10) / 10,
    },
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byKind: [...byKind.values()]
      .map((row) => ({ ...row, conversionRate: percentage(row.checkoutSuccesses, row.sessions) }))
      .sort((a, b) => b.sessions - a.sessions),
    devices: [...devices.entries()]
      .map(([device, count]) => ({ device, count, share: percentage(count, sessions.length) }))
      .sort((a, b) => b.count - a.count),
    interactions,
    topDecorations: [...decorations.values()].sort((a, b) => b.adds - a.adds).slice(0, 10),
  }
}

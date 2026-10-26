import { resolveApiBase } from './apiBase.js'

const sessionId = () =>
  (typeof globalThis.crypto?.randomUUID === 'function' && globalThis.crypto.randomUUID())
  || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`

const deviceType = (width) => width <= 760 ? 'mobile' : width <= 1024 ? 'tablet' : 'desktop'

export function createCustomizerAnalytics(options = {}) {
  const now = options.now || Date.now
  const win = options.windowRef || (typeof window !== 'undefined' ? window : null)
  const doc = options.documentRef || (typeof document !== 'undefined' ? document : null)
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const host = win?.location?.hostname || ''
  const enabled = options.enabled ?? (!!win && !['localhost', '127.0.0.1'].includes(host))
  const endpoint = options.endpoint || `${resolveApiBase()}/api/analytics`
  const startedMs = now()
  let visible = doc?.visibilityState !== 'hidden'
  let activeSince = visible ? startedMs : null
  let decorationSince = null
  let activeMs = 0
  let decorationActiveMs = 0
  let dirty = true
  let started = false
  let interval = null
  let lastMoveAt = 0

  const record = {
    sessionId: sessionId(),
    startedAt: new Date(startedMs).toISOString(),
    lastSeenAt: new Date(startedMs).toISOString(),
    activeMs: 0,
    decorationStartedAt: null,
    decorationActiveMs: 0,
    productId: '',
    productName: '',
    productKind: 'unknown',
    finish: '',
    locale: win?.CharmeConfig?.locale || doc?.documentElement?.lang || '',
    currency: win?.CharmeConfig?.currency?.active || win?.Shopify?.currency?.active || 'GBP',
    device: deviceType(win?.innerWidth || 1280),
    entryPoint: win?.CharmeConfig ? 'shopify' : 'standalone',
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
    summaryViews: 0,
    blockedOrderAttempts: 0,
    purchaseClicked: false,
    checkoutSucceeded: false,
    checkoutFailures: 0,
    finalDecorationCount: 0,
    maxDecorationCount: 0,
    decorationSelections: {},
    decorationNames: {},
    lastEvent: 'customizer_opened',
  }

  const syncClock = () => {
    const current = now()
    if (visible && activeSince != null) {
      const elapsed = Math.max(0, current - activeSince)
      activeMs += elapsed
      if (decorationSince != null) decorationActiveMs += elapsed
      activeSince = current
      if (decorationSince != null) decorationSince = current
    }
    record.activeMs = activeMs
    record.decorationActiveMs = decorationActiveMs
    record.lastSeenAt = new Date(current).toISOString()
  }

  const updateContext = (patch) => {
    Object.assign(record, patch)
    record.maxDecorationCount = Math.max(record.maxDecorationCount, Number(record.finalDecorationCount) || 0)
    dirty = true
  }

  const track = (event, detail = {}) => {
    const current = now()
    if (event === 'decoration_move' && current - lastMoveAt < 750) return
    if (event === 'decoration_move') lastMoveAt = current
    if (event === 'decoration_add' && record.decorationStartedAt == null) {
      syncClock()
      record.decorationStartedAt = current
      if (visible) decorationSince = current
    }
    const counters = {
      product_selected: 'productSelections', finish_changed: 'finishChanges',
      category_changed: 'categoryChanges',
      decoration_add: 'decorationAdds', decoration_remove: 'decorationRemoves',
      decoration_move: 'decorationMoves', undo: 'undoCount', clear: 'clearCount',
      zoom: 'zoomActions', tray_expanded: 'trayExpansions',
      tote_side_changed: 'sideSwitches', summary_viewed: 'summaryViews',
      order_blocked: 'blockedOrderAttempts',
    }
    if (counters[event]) record[counters[event]] += 1
    if (event === 'purchase_clicked') record.purchaseClicked = true
    if (event === 'checkout_succeeded') record.checkoutSucceeded = true
    if (event === 'checkout_failed') record.checkoutFailures += 1
    if (event === 'decoration_add' && detail.id) {
      record.decorationSelections[detail.id] = (record.decorationSelections[detail.id] || 0) + 1
      record.decorationNames[detail.id] = detail.name || detail.id
    }
    record.lastEvent = event
    dirty = true
  }

  const snapshot = () => {
    syncClock()
    return JSON.parse(JSON.stringify(record))
  }

  const flush = async (force = false) => {
    if (!enabled || !fetchImpl || (!dirty && !force)) return false
    const body = JSON.stringify(snapshot())
    dirty = false
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      })
      if (!response.ok) throw new Error(`analytics ${response.status}`)
      return true
    } catch {
      dirty = true
      return false
    }
  }

  const onVisibility = () => {
    const nextVisible = doc?.visibilityState !== 'hidden'
    if (nextVisible === visible) return
    syncClock()
    visible = nextVisible
    activeSince = visible ? now() : null
    decorationSince = visible && record.decorationStartedAt != null ? now() : null
    if (!visible) flush()
  }
  const onPageHide = () => { flush(true) }

  const start = (context = {}) => {
    updateContext(context)
    if (started) return
    started = true
    doc?.addEventListener?.('visibilitychange', onVisibility)
    win?.addEventListener?.('pagehide', onPageHide)
    interval = win?.setInterval?.(() => flush(), 30_000) || null
    flush(true)
  }

  const stop = () => {
    if (!started) return
    syncClock()
    doc?.removeEventListener?.('visibilitychange', onVisibility)
    win?.removeEventListener?.('pagehide', onPageHide)
    if (interval) win?.clearInterval?.(interval)
    interval = null
    started = false
    flush(true)
  }

  return { start, stop, track, updateContext, snapshot, flush }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, App, Segmented, Select } from 'antd'
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  UndoOutlined,
  WarningFilled,
  CloseOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import ProductStage from '../components/ProductStage'
import ProductPicker from '../components/ProductPicker'
import CharmTray from '../components/CharmTray'
import PriceBar from '../components/PriceBar'
import SummaryModal from '../components/SummaryModal'
import { PRODUCT_GROUPS, BRAND_LABELS, findProduct } from '../data/products'
import { trayGroups } from '../lib/catalog'
import { validateLayout, findScatterSpot, charmFootprint, clampCenter } from '../lib/geometry'
import { onMaskReady } from '../lib/charmMask'

function useMedia(query) {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const m = window.matchMedia(query)
    const fn = (e) => setMatch(e.matches)
    m.addEventListener('change', fn)
    setMatch(m.matches)
    return () => m.removeEventListener('change', fn)
  }, [query])
  return match
}

const uid = () =>
  (crypto.randomUUID && crypto.randomUUID()) || `c${Date.now()}${Math.random().toString(16).slice(2)}`

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Suggested charm count for a nicely balanced design.
const REC_MIN = 12
const REC_MAX = 15

/**
 * Fold the chosen case colour + gel colour into a single render-ready colour
 * object (shape unchanged from the old single-finish model, so the stage,
 * canvas and export code keep working). The case colour drives the visible
 * shell + photo lookup; the gel colour adds the glitter sparkle when chosen and
 * is recorded on the order. Totes have a single colourway and no gel.
 */
function deriveColor(product, caseColourId, gelColourId) {
  const caseList = product.caseColours || product.colors
  const base = caseList.find((c) => c.id === caseColourId) || caseList[0]
  const gels = product.gelColours
  const gel = gels ? gels.find((g) => g.id === gelColourId) || gels[0] : null
  return {
    id: base.id,
    label: gel ? `${base.label} case · ${gel.label} gel` : base.label,
    shell: base.shell,
    edge: base.edge,
    glitter: gel ? !!gel.glitter : !!base.glitter,
    caseId: base.id,
    caseLabel: base.label,
    gelId: gel ? gel.id : null,
    gelLabel: gel ? gel.label : null,
  }
}

export default function CustomizerPage({ onPlaceOrder }) {
  const { message } = App.useApp()
  const isMobile = useMedia('(max-width: 760px)')

  const [groupKey, setGroupKey] = useState('apple')
  const [productId, setProductId] = useState('iphone-17-pro')
  const [caseColourId, setCaseColourId] = useState('white')
  const [gelColourId, setGelColourId] = useState('glitter')
  const [placed, setPlaced] = useState([])
  const [selectedUid, setSelectedUid] = useState(null)
  const [zoom, setZoom] = useState(1)

  const [summaryOpen, setSummaryOpen] = useState(false)
  // Set true when the customer taps the order button while charms still overlap
  // or sit outside the craftable area — surfaces a prominent fix-it message next
  // to the case (desktop) and emphasises the Step 2 overlay warning (mobile).
  const [showOverlapWarning, setShowOverlapWarning] = useState(false)
  // Bumped on each blocked order attempt so the mobile overlay warning replays
  // its attention pulse even when the problem count is unchanged.
  const [warnPulse, setWarnPulse] = useState(0)

  // Mobile Step 2 overlay starts expanded so first-time customers read the
  // guidance, then auto-collapses to just the title after a few seconds. Tapping
  // the title toggles it back open.
  const [step2Open, setStep2Open] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setStep2Open(false), 5000)
    return () => clearTimeout(t)
  }, [])

  // Mobile only: the charm tray's share of the screen (% of the shell height).
  // A draggable splitter between the preview and the tray lets the customer
  // trade preview space for browsing space and back.
  const [trayPct, setTrayPct] = useState(42)
  const mobileShellRef = useRef(null)
  const splitDrag = useRef(null)

  const stageApi = useRef(null)

  const product = findProduct(productId)
  const color = useMemo(
    () => deriveColor(product, caseColourId, gelColourId),
    [product, caseColourId, gelColourId],
  )

  // Inline Step 1 dropdowns (mobile header): model list for the active platform
  // (Android sub-grouped by brand), plus case + gel colour lists.
  const modelOptions = useMemo(() => {
    const group = PRODUCT_GROUPS.find((g) => g.key === groupKey) || PRODUCT_GROUPS[0]
    if (group.platform === 'android') {
      const byBrand = new Map()
      for (const p of group.products) {
        if (!byBrand.has(p.brand)) byBrand.set(p.brand, [])
        byBrand.get(p.brand).push(p)
      }
      return Array.from(byBrand, ([brand, items]) => ({
        label: BRAND_LABELS[brand] || brand,
        options: items.map((p) => ({ value: p.id, label: p.name })),
      }))
    }
    return group.products.map((p) => ({ value: p.id, label: p.name }))
  }, [groupKey])
  const caseOptions = (product.caseColours || product.colors).map((c) => ({
    value: c.id,
    label: c.label,
  }))
  const gelOptions = product.gelColours?.map((g) => ({ value: g.id, label: g.label }))
  // Charm shape masks load lazily in the browser; bump this when one arrives so
  // the layout re-validates against the real cut-out shape (not just the OBB).
  const [maskVersion, setMaskVersion] = useState(0)
  useEffect(() => onMaskReady(() => setMaskVersion((v) => v + 1)), [])
  const validation = useMemo(
    () => validateLayout(placed, product),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placed, product, maskVersion],
  )

  // Tray groups for the active product kind (4 categories for phones, 3 types
  // for totes) + the mobile category dropdown selection.
  const groups = useMemo(() => trayGroups(product.kind), [product.kind])
  const [mobileGroupKey, setMobileGroupKey] = useState(() => trayGroups('phone')[0].key)
  useEffect(() => {
    if (!groups.some((g) => g.key === mobileGroupKey)) setMobileGroupKey(groups[0].key)
  }, [groups, mobileGroupKey])

  // keep the case/gel selection valid when switching products
  useEffect(() => {
    const caseList = product.caseColours || product.colors
    if (!caseList.some((c) => c.id === caseColourId)) setCaseColourId(caseList[0].id)
    if (product.gelColours && !product.gelColours.some((g) => g.id === gelColourId)) {
      setGelColourId(product.gelColours[0].id)
    }
  }, [product, caseColourId, gelColourId])

  // ---- undo / recall history ------------------------------------------------
  // A bounded stack of `placed` snapshots. We checkpoint before every discrete
  // change (add / remove / clear) and at the start of a drag or resize gesture,
  // so a single Undo brings back an accidentally-cleared layout or a deleted
  // charm. History is dropped when the base product changes.
  const placedRef = useRef(placed)
  placedRef.current = placed
  const historyRef = useRef([])
  const [histLen, setHistLen] = useState(0)
  const pushHistory = useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-29), placedRef.current]
    setHistLen(historyRef.current.length)
  }, [])
  const resetHistory = useCallback(() => {
    historyRef.current = []
    setHistLen(0)
  }, [])
  const undo = useCallback(() => {
    const h = historyRef.current
    if (!h.length) return
    const prev = h[h.length - 1]
    historyRef.current = h.slice(0, -1)
    setHistLen(historyRef.current.length)
    setPlaced(prev)
    setSelectedUid(null)
  }, [])
  const canUndo = histLen > 0

  const handleGroup = (g) => {
    setGroupKey(g)
    const first = PRODUCT_GROUPS.find((x) => x.key === g).products[0]
    setProductId(first.id)
    setPlaced([])
    setSelectedUid(null)
    resetHistory()
  }
  const handleProduct = (id) => {
    setProductId(id)
    setPlaced([])
    setSelectedUid(null)
    resetHistory()
  }

  const makePlaced = useCallback((charm, pos) => ({
    uid: uid(),
    charmId: charm.id,
    type: charm.type,
    category: charm.category,
    name: charm.name,
    src: charm.src,
    price: charm.price,
    baseWmm: charm.widthMm,
    baseHmm: charm.heightMm,
    minScale: charm.minScale,
    maxScale: charm.maxScale,
    scale: 1,
    rot: pos.rot || 0,
    cxMm: pos.cxMm,
    cyMm: pos.cyMm,
  }), [])

  // Keep a charm's whole footprint inside the printable area (strict boundary).
  const clampToPrintable = useCallback(
    (c) => {
      const { cx, cy } = clampCenter(charmFootprint(c), product.printable)
      return { ...c, cxMm: cx, cyMm: cy }
    },
    [product],
  )

  const addAt = useCallback(
    (charm, mm) => {
      const pc = clampToPrintable(
        makePlaced(charm, { cxMm: mm.xMm, cyMm: mm.yMm, rot: 0 }),
      )
      pushHistory()
      setPlaced((p) => [...p, pc])
      setSelectedUid(pc.uid)
    },
    [clampToPrintable, makePlaced, pushHistory],
  )

  const addAuto = useCallback(
    (charm, { scatterOnly = false } = {}) => {
      const prev = placedRef.current
      const spot = findScatterSpot(product, prev, charm)
      if (!spot && scatterOnly) {
        message.info('No clear gaps left — move or remove a charm to make room.')
        return
      }
      const pc = spot
        ? makePlaced(charm, spot)
        : makePlaced(charm, {
            cxMm: product.widthMm / 2,
            cyMm: product.heightMm * 0.6,
            rot: 0,
          })
      pushHistory()
      setPlaced((p) => [...p, pc])
      setSelectedUid(pc.uid)
    },
    [product, makePlaced, message, pushHistory],
  )

  const activateCharm = useCallback(
    (charm) => {
      if (charm.type === 3) addAuto(charm, { scatterOnly: true })
      else addAuto(charm)
    },
    [addAuto],
  )

  const moveCharm = useCallback(
    (id, patch) => {
      setPlaced((p) =>
        p.map((c) => (c.uid === id ? clampToPrintable({ ...c, ...patch }) : c)),
      )
    },
    [clampToPrintable],
  )
  const transformCharm = moveCharm
  const removeCharm = useCallback(
    (id) => {
      pushHistory()
      setPlaced((p) => p.filter((c) => c.uid !== id))
      setSelectedUid((s) => (s === id ? null : s))
    },
    [pushHistory],
  )
  const clearAll = () => {
    if (placedRef.current.length === 0) return
    pushHistory()
    setPlaced([])
    setSelectedUid(null)
  }

  // ---- tray → stage drag (desktop precise placement) ----
  const [ghost, setGhost] = useState(null)
  const pending = useRef(null)

  const onWinMove = useCallback((e) => {
    const pn = pending.current
    if (!pn) return
    if (!pn.dragging) {
      if (Math.hypot(e.clientX - pn.x0, e.clientY - pn.y0) < 6) return
      pn.dragging = true
      const s = stageApi.current?.getScale?.() || 3
      pn.w = pn.charm.widthMm * s
      pn.h = pn.charm.heightMm * s
    }
    setGhost({ src: pn.charm.src, x: e.clientX, y: e.clientY, w: pn.w, h: pn.h })
  }, [])

  const onWinUp = useCallback(
    (e) => {
      const pn = pending.current
      window.removeEventListener('pointermove', onWinMove)
      window.removeEventListener('pointerup', onWinUp)
      pending.current = null
      setGhost(null)
      if (pn && pn.dragging) {
        pn.suppressClick = true
        const api = stageApi.current
        if (api && api.isInsideDropArea(e.clientX, e.clientY)) {
          const mm = api.clientToMm(e.clientX, e.clientY)
          if (mm) addAt(pn.charm, mm)
        }
        // remember to swallow the click that follows a real drag
        suppressClick.current = true
        setTimeout(() => (suppressClick.current = false), 50)
      }
    },
    [onWinMove, addAt],
  )

  const suppressClick = useRef(false)

  const onTrayPointerDown = useCallback(
    (charm, e) => {
      if (e.button != null && e.button !== 0) return
      pending.current = { charm, x0: e.clientX, y0: e.clientY, dragging: false }
      window.addEventListener('pointermove', onWinMove)
      window.addEventListener('pointerup', onWinUp)
    },
    [onWinMove, onWinUp],
  )

  const onTrayActivate = useCallback(
    (charm) => {
      if (suppressClick.current) return
      activateCharm(charm)
    },
    [activateCharm],
  )

  const stageNode = (
    <ProductStage
      ref={stageApi}
      product={product}
      color={color}
      placed={placed}
      flags={validation.flags}
      selectedUid={selectedUid}
      onSelect={setSelectedUid}
      onMove={moveCharm}
      onTransform={transformCharm}
      onRemove={removeCharm}
      onCheckpoint={pushHistory}
      zoom={zoom}
    />
  )

  const zoomDock = (
    <div className="zoom-dock">
      <Button
        size="small"
        shape="circle"
        icon={<ZoomInOutlined />}
        onClick={() => setZoom((z) => clamp(+(z + 0.15).toFixed(2), 0.6, 2))}
      />
      <Button
        size="small"
        shape="circle"
        icon={<ZoomOutOutlined />}
        onClick={() => setZoom((z) => clamp(+(z - 0.15).toFixed(2), 0.6, 2))}
      />
    </div>
  )

  const tray = (
    <CharmTray
      key={product.kind}
      kind={product.kind}
      compact={isMobile}
      onActivate={onTrayActivate}
      onPointerDown={isMobile ? undefined : onTrayPointerDown}
    />
  )
  // Short labels for the mobile category row (drop the trailing " charms" so all
  // four phone categories fit one row; tote group labels are already short).
  const categoryOptions = groups.map((g) => ({
    value: g.key,
    label: product.kind === 'phone' ? g.label.replace(/ charms$/i, '') : g.label,
  }))
  const mobileTray = (
    <CharmTray
      key={`${product.kind}-${mobileGroupKey}`}
      kind={product.kind}
      compact
      rows
      activeKey={mobileGroupKey}
      onActivate={onTrayActivate}
    />
  )

  // Order CTA handler. If the layout is valid we open the summary; otherwise we
  // surface the prominent overlap message beside the case instead of silently
  // doing nothing — so customers understand why they can't continue.
  const attemptOrder = () => {
    if (validation.ok) {
      setShowOverlapWarning(false)
      setSummaryOpen(true)
    } else {
      setShowOverlapWarning(true)
      setWarnPulse((n) => n + 1)
    }
  }

  // ---- mobile splitter: drag to resize the preview vs. tray split ----
  const onSplitDown = useCallback((e) => {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Some browsers throw if the pointer is no longer active — safe to ignore.
    }
    splitDrag.current = { pointerId: e.pointerId }
  }, [])
  const onSplitMove = useCallback((e) => {
    const d = splitDrag.current
    if (!d || d.pointerId !== e.pointerId) return
    const shell = mobileShellRef.current
    if (!shell) return
    const rect = shell.getBoundingClientRect()
    const pct = ((rect.bottom - e.clientY) / rect.height) * 100
    setTrayPct(clamp(+pct.toFixed(1), 28, 78))
  }, [])
  const onSplitUp = useCallback((e) => {
    const d = splitDrag.current
    if (!d || d.pointerId !== e.pointerId) return
    splitDrag.current = null
  }, [])

  const picker = (
    <ProductPicker
      groupKey={groupKey}
      productId={productId}
      caseColourId={caseColourId}
      gelColourId={gelColourId}
      onGroupChange={handleGroup}
      onProductChange={handleProduct}
      onCaseColourChange={setCaseColourId}
      onGelColourChange={setGelColourId}
    />
  )
  const priceBar = (
    <PriceBar
      product={product}
      placed={placed}
      validation={validation}
      onSubmit={attemptOrder}
      onClear={clearAll}
      canUndo={canUndo}
      onUndo={undo}
    />
  )

  const charmCount = placed.length
  const stepTwoHint = (
    <>
      We recommend {REC_MIN}–{REC_MAX} charms for a balanced look.
      {charmCount > 0 && <strong> {charmCount} added.</strong>}
    </>
  )

  // Order CTA total + noun (case vs. tote) for the Step 3 bar.
  const orderNoun = product.kind === 'tote' ? 'tote' : 'case'
  const orderTotal = (product.basePrice + placed.reduce((s, c) => s + c.price, 0)).toFixed(0)

  // The Step 2 overlay is expanded when the user opened it, or forced open while
  // any charm needs attention (so the warning is never hidden).
  const step2Expanded = step2Open || validation.problems > 0

  // Prominent, fix-it message shown beside the case when the customer tries to
  // order with charms still overlapping or off the craftable area.
  const overlapAlert =
    showOverlapWarning && !validation.ok && placed.length > 0 ? (
      <div className="overlap-alert" role="alert">
        <WarningFilled className="overlap-alert__icon" />
        <p className="overlap-alert__text">
          Some charms are overlapping or placed outside the craftable area. Please adjust the
          highlighted charms until the red outline disappears.
        </p>
        <button
          type="button"
          className="overlap-alert__close"
          aria-label="Dismiss"
          onClick={() => setShowOverlapWarning(false)}
        >
          <CloseOutlined />
        </button>
      </div>
    ) : null

  return (
    <>
      {isMobile ? (
        <>
        <div className="mobile-shell" ref={mobileShellRef}>
          <header className="mobile-head">
            <div className="mobile-head__top">
              <span className="mobile-head__step">Step 1: Select Model</span>
              <Segmented
                className="mobile-head__platform"
                size="small"
                value={groupKey}
                onChange={handleGroup}
                options={PRODUCT_GROUPS.map((g) => ({ label: g.label, value: g.key }))}
              />
            </div>
            <div className="mobile-head__selects">
              <label className="mobile-head__field mobile-head__field--model">
                <span className="mobile-head__label">Model</span>
                <Select
                  className="mobile-head__sel"
                  size="small"
                  value={productId}
                  onChange={handleProduct}
                  options={modelOptions}
                  popupMatchSelectWidth={false}
                  showSearch
                  optionFilterProp="label"
                />
              </label>
              <label className="mobile-head__field">
                <span className="mobile-head__label">Case</span>
                <Select
                  className="mobile-head__sel"
                  size="small"
                  value={caseColourId}
                  onChange={setCaseColourId}
                  options={caseOptions}
                  popupMatchSelectWidth={false}
                />
              </label>
              {gelOptions && (
                <label className="mobile-head__field">
                  <span className="mobile-head__label">Gel</span>
                  <Select
                    className="mobile-head__sel"
                    size="small"
                    value={gelColourId}
                    onChange={setGelColourId}
                    options={gelOptions}
                    popupMatchSelectWidth={false}
                  />
                </label>
              )}
            </div>
          </header>
          <div className="mobile-stage">
            {stageNode}
            {zoomDock}
            <div className="edit-dock">
              <Button
                size="small"
                shape="circle"
                icon={<UndoOutlined />}
                disabled={!canUndo}
                onClick={undo}
                title="Undo"
              />
              <Button
                size="small"
                shape="circle"
                icon={<DeleteOutlined />}
                disabled={placed.length === 0}
                onClick={clearAll}
                title="Clear all"
              />
            </div>
            <div
              className={
                'mobile-step-overlay' +
                (validation.problems > 0 ? ' mobile-step-overlay--warn' : '') +
                (step2Expanded ? ' is-open' : '')
              }
              role={validation.problems > 0 ? 'alert' : undefined}
            >
              <div className="mobile-step-overlay__body">
                {validation.problems > 0 ? (
                  <span
                    key={`warn-${validation.problems}-${warnPulse}`}
                    className="mobile-step-overlay__hint mobile-step-overlay__hint--warn"
                  >
                    <WarningFilled className="mobile-step-overlay__warnicon" />
                    <span>
                      {validation.problems} charm{validation.problems > 1 ? 's' : ''} need attention —
                      nudge the highlighted charms until the red outline disappears.
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="mobile-step-overlay__hint">{stepTwoHint}</span>
                    <span className="mobile-step-overlay__hint">
                      Tap to add charms. Once added, you can move the charms around the case and rotate them.
                    </span>
                  </>
                )}
              </div>
              <div className="mobile-step2-bar">
                <button
                  type="button"
                  className="mobile-step-overlay__title"
                  aria-expanded={step2Expanded}
                  onClick={() => setStep2Open((o) => !o)}
                >
                  <span>Step 2: Add charms</span>
                  <InfoCircleOutlined className="mobile-step-overlay__chevron" />
                </button>
                <div className="mobile-cat-bar">
                  <Segmented
                    block
                    size="small"
                    className="mobile-cat-seg"
                    value={mobileGroupKey}
                    onChange={setMobileGroupKey}
                    options={categoryOptions}
                  />
                </div>
              </div>
            </div>
          </div>
          <div
            className="mobile-splitter"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Drag to resize the preview and charm tray"
            onPointerDown={onSplitDown}
            onPointerMove={onSplitMove}
            onPointerUp={onSplitUp}
            onPointerCancel={onSplitUp}
          >
            <span className="mobile-splitter__grip" />
          </div>
          <div className="mobile-tray" style={{ flexBasis: `${trayPct}%` }}>
            <div className="mobile-tray-body">
              {mobileTray}
            </div>
          </div>

          <button
            type="button"
            className="mobile-order-bar"
            disabled={placed.length === 0}
            onClick={attemptOrder}
          >
            Step 3: Order my {orderNoun} (£{orderTotal})
          </button>
        </div>
        </>
      ) : (
        <div className="studio">
          <div className="panel panel--left">
            {picker}
            <Tips />
          </div>
          <div style={{ position: 'relative', minHeight: 0 }}>
            {stageNode}
            {zoomDock}
            {overlapAlert}
          </div>
          <div className="panel--right">
            <div className="tray-head">
              <p className="eyebrow" style={{ margin: 0 }}>Step 2 · Add your charms</p>
              <p className="hint" style={{ marginTop: 4 }}>{stepTwoHint}</p>
            </div>
            <div className="tray-scroll">{tray}</div>
            <div className="pricebox">{priceBar}</div>
          </div>
        </div>
      )}

      {ghost && (
        <div className="ghost-drag" style={{ left: ghost.x, top: ghost.y, width: ghost.w, height: ghost.h }}>
          <img src={ghost.src} alt="" style={{ width: '100%', height: '100%' }} />
        </div>
      )}

      <SummaryModal
        open={summaryOpen}
        product={product}
        color={color}
        placed={placed}
        onClose={() => setSummaryOpen(false)}
        onPlaceOrder={onPlaceOrder}
      />
    </>
  )
}

function Tips() {
  return (
    <div style={{ marginTop: 22 }}>
      <p className="eyebrow">How it works</p>
      <ol className="hint" style={{ paddingLeft: 16, margin: 0, lineHeight: 1.7 }}>
        <li>Browse charms by <strong>Gold</strong>, <strong>Silver</strong>, <strong>Colourful</strong> &amp; <strong>Natural</strong>.</li>
        <li>Drag a charm onto your case — or tap to drop it in automatically.</li>
        <li>Select a charm to rotate or remove it.</li>
        <li>Changed your mind? <strong>Undo</strong> brings back a cleared or deleted charm.</li>
        <li>Reds mean overlap or off-edge — nudge until all clear.</li>
      </ol>
    </div>
  )
}

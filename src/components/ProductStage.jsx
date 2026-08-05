import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { DeleteOutlined } from '@ant-design/icons'
import ProductCanvas from './ProductCanvas'
import { resolveAsset } from '../lib/assets'
import { clampCenter } from '../lib/geometry'
import { t } from '../lib/i18n'

const PAD = 18
const MIN_ZOOM = 0.6
const MAX_ZOOM = 3
// Minimum touch target (px) for a placed charm — tiny charms get an invisible
// padded hit area so they are still easy to grab on a phone.
const MIN_HIT = 44

/**
 * Interactive design surface. Renders the blank product + placed charms and
 * owns all pointer gestures (move / select). Charm coordinates live in product
 * millimetres; this component converts to pixels using a fit-to-container scale.
 */
const ProductStage = forwardRef(function ProductStage(
  {
    product,
    color,
    placed,
    flags,
    selectedUid,
    onSelect,
    onMove,
    onTransform,
    onRemove,
    onCheckpoint,
    wordGroups = [],
    selectedGroupId,
    confirmGroupId,
    onSelectGroup,
    onMoveGroup,
    onRequestBreak,
    onCancelBreak,
    onBreakGroup,
    zoom = 1,
    onZoomChange,
  },
  ref,
) {
  const wrapRef = useRef(null)
  const stageRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // Pan offset (px) for pinch-to-move on touch devices; reset when zoomed out.
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const gesture = useRef({ pointers: new Map(), mode: null, startDist: 0, startZoom: 1, startPan: { x: 0, y: 0 }, startMid: { x: 0, y: 0 }, startSingle: { x: 0, y: 0 }, moved: false })
  useEffect(() => {
    if (zoom <= 1 && (pan.x !== 0 || pan.y !== 0)) setPan({ x: 0, y: 0 })
  }, [zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }))
    }
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    measure()
    // Safety net for when the widget mounts into a container that only gets its
    // real size a frame or two later (e.g. a modal that just became visible, or
    // a resize nudge from the Shopify drop-in) — otherwise the initial observe
    // can catch 0 and nothing renders until the next reflow.
    const raf1 = requestAnimationFrame(measure)
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(measure))
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      ro?.disconnect()
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [])

  const fitScale =
    size.w && size.h
      ? Math.min(
          (size.w - PAD * 2) / product.widthMm,
          (size.h - PAD * 2) / product.heightMm,
        )
      : 0
  const scale = Math.max(0.1, fitScale * zoom)
  const wPx = product.widthMm * scale
  const hPx = product.heightMm * scale

  useImperativeHandle(
    ref,
    () => ({
      clientToMm(clientX, clientY) {
        const el = stageRef.current
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { xMm: (clientX - rect.left) / scale, yMm: (clientY - rect.top) / scale }
      },
      isInsideDropArea(clientX, clientY) {
        const el = wrapRef.current
        if (!el) return false
        const rect = el.getBoundingClientRect()
        return (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        )
      },
      getScale: () => scale,
    }),
    [scale],
  )

  // ---- drag an existing charm ----
  const drag = useRef(null)

  // Word groups that have been "broken apart" for individual letter editing —
  // their letters drag one-by-one; every other grouped letter drags as a unit.
  const brokenSet = useMemo(
    () => new Set(wordGroups.filter((g) => g.broken).map((g) => g.id)),
    [wordGroups],
  )
  const activeGroupOf = useCallback(
    (charm) => (charm.groupId && !brokenSet.has(charm.groupId) ? charm.groupId : null),
    [brokenSet],
  )

  // Begin dragging a whole (non-broken) word group: capture every member's start
  // centre so onMoveGroup can shift them together and clamp the group's bbox.
  const beginGroupDrag = useCallback(
    (e, groupId) => {
      onSelectGroup?.(groupId)
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // pointer may already be gone
      }
      const starts = new Map()
      for (const c of placed) if (c.groupId === groupId) starts.set(c.uid, { cx: c.cxMm, cy: c.cyMm })
      drag.current = {
        mode: 'group',
        groupId,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        starts,
        checkpointed: false,
      }
    },
    [placed, onSelectGroup],
  )

  const onCharmPointerDown = useCallback(
    (e, charm) => {
      e.stopPropagation()
      const gid = activeGroupOf(charm)
      if (gid) {
        // Part of a live word → drag the whole word as one unit.
        beginGroupDrag(e, gid)
        return
      }
      onSelect(charm.uid)
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = {
        mode: 'single',
        uid: charm.uid,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startCx: charm.cxMm,
        startCy: charm.cyMm,
        // footprint (mm) used to keep the whole charm inside the printable area
        w: charm.baseWmm * (charm.scale || 1),
        h: charm.baseHmm * (charm.scale || 1),
        rot: charm.rot || 0,
        checkpointed: false,
      }
    },
    [onSelect, activeGroupOf, beginGroupDrag],
  )

  const onCharmPointerMove = useCallback(
    (e) => {
      const d = drag.current
      if (!d || d.pointerId !== e.pointerId) return
      // Checkpoint history once, on the first real movement of the gesture, so a
      // drag can be undone without flooding the stack on a plain select-click.
      if (!d.checkpointed && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) >= 2) {
        onCheckpoint?.()
        d.checkpointed = true
      }
      const dxMm = (e.clientX - d.startX) / scale
      const dyMm = (e.clientY - d.startY) / scale
      if (d.mode === 'group') {
        onMoveGroup?.(d.groupId, dxMm, dyMm, d.starts)
        return
      }
      // Hard-clamp the charm so its full footprint stays inside the printable
      // outer region — patterns can never be dragged off the product edge.
      const box = { cx: d.startCx + dxMm, cy: d.startCy + dyMm, w: d.w, h: d.h, rot: d.rot }
      const { cx, cy } = clampCenter(box, product.printable)
      onMove(d.uid, { cxMm: cx, cyMm: cy })
    },
    [scale, product, onMove, onMoveGroup, onCheckpoint],
  )

  const endDrag = useCallback(
    (e) => {
      const d = drag.current
      if (!d || d.pointerId !== e.pointerId) return
      drag.current = null
      // Once a single charm has actually been moved, dismiss its rotate/remove
      // toolbar. Group drags keep the group selected so the box + Confirm button
      // stay put. A plain tap (no real drag) leaves the selection alone.
      if (d.checkpointed && d.mode !== 'group') onSelect(null)
    },
    [onSelect],
  )

  // ---- pinch-to-zoom + pan (touch) / tap-empty to deselect ----
  // Handlers live on the stage wrap. Charms stop propagation on their own
  // pointerdown, so a gesture only starts on empty case / background.
  const onStagePointerDown = useCallback(
    (e) => {
      const g = gesture.current
      g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // ignore — pointer may already be gone
      }
      g.moved = false
      if (g.pointers.size === 2) {
        const pts = [...g.pointers.values()]
        g.mode = 'pinch'
        g.startDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1
        g.startZoom = zoom
        g.startPan = { ...pan }
        g.startMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      } else if (g.pointers.size === 1) {
        g.mode = 'maybe'
        g.startPan = { ...pan }
        g.startSingle = { x: e.clientX, y: e.clientY }
      }
    },
    [zoom, pan],
  )
  const onStagePointerMove = useCallback(
    (e) => {
      const g = gesture.current
      if (!g.pointers.has(e.pointerId)) return
      g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (g.mode === 'pinch' && g.pointers.size >= 2) {
        const pts = [...g.pointers.values()]
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
        const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, g.startZoom * (dist / g.startDist)))
        onZoomChange?.(+nz.toFixed(3))
        setPan({ x: g.startPan.x + (mid.x - g.startMid.x), y: g.startPan.y + (mid.y - g.startMid.y) })
        g.moved = true
      } else if ((g.mode === 'maybe' || g.mode === 'pan') && g.pointers.size === 1) {
        const dx = e.clientX - g.startSingle.x
        const dy = e.clientY - g.startSingle.y
        if (g.mode === 'maybe' && Math.hypot(dx, dy) > 4 && zoom > 1) g.mode = 'pan'
        if (g.mode === 'pan') {
          setPan({ x: g.startPan.x + dx, y: g.startPan.y + dy })
          g.moved = true
        }
      }
    },
    [onZoomChange, zoom],
  )
  const onStagePointerUp = useCallback(
    (e) => {
      const g = gesture.current
      // Only act on pointers this gesture actually started tracking (empty-area
      // gestures). Charm taps stop propagation on down but their up still bubbles
      // here — ignore those so tapping a charm doesn't immediately deselect it.
      if (!g.pointers.has(e.pointerId)) return
      g.pointers.delete(e.pointerId)
      if (g.pointers.size === 0) {
        const tapped = !g.moved && g.mode !== 'pan' && g.mode !== 'pinch'
        g.mode = null
        if (tapped) {
          onSelect(null)
          onSelectGroup?.(null)
        }
      } else if (g.pointers.size === 1) {
        const pt = [...g.pointers.values()][0]
        g.mode = 'pan'
        g.startPan = { ...pan }
        g.startSingle = { x: pt.x, y: pt.y }
      }
    },
    [onSelect, onSelectGroup, pan],
  )

  const selected = placed.find((c) => c.uid === selectedUid)

  // Bounding box (in px) of the currently-selected, still-grouped word — drives
  // the group outline + "Confirm" control. Null when no live group is selected.
  const groupBox = useMemo(() => {
    if (!selectedGroupId || brokenSet.has(selectedGroupId)) return null
    const members = placed.filter((c) => c.groupId === selectedGroupId)
    if (!members.length) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const c of members) {
      const fw = c.baseWmm * (c.scale || 1)
      const fh = c.baseHmm * (c.scale || 1)
      minX = Math.min(minX, c.cxMm - fw / 2)
      maxX = Math.max(maxX, c.cxMm + fw / 2)
      minY = Math.min(minY, c.cyMm - fh / 2)
      maxY = Math.max(maxY, c.cyMm + fh / 2)
    }
    const label = (wordGroups.find((g) => g.id === selectedGroupId) || {}).label || ''
    return {
      left: minX * scale,
      top: minY * scale,
      width: (maxX - minX) * scale,
      height: (maxY - minY) * scale,
      label,
    }
  }, [selectedGroupId, brokenSet, placed, wordGroups, scale])

  // Real product photo (e.g. the Apple iPhone case render) for the chosen finish.
  const blankPhoto = resolveAsset(
    color.imageSrc ||
      (product.blankImage && (product.blankImage[color.id] || product.blankImage.default)) ||
      null,
  )
  const blankPhotoBounds = product.caseImageBounds?.[color.id]
  const blankPhotoCropStyle = blankPhotoBounds ? {
    width: wPx * blankPhotoBounds.sourceWidth / blankPhotoBounds.width,
    height: hPx * blankPhotoBounds.sourceHeight / blankPhotoBounds.height,
    left: -wPx * blankPhotoBounds.left / blankPhotoBounds.width,
    top: -hPx * blankPhotoBounds.top / blankPhotoBounds.height,
    right: 'auto',
    bottom: 'auto',
  } : null

  return (
    <div
      className="stage-wrap"
      ref={wrapRef}
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={onStagePointerUp}
      onPointerCancel={onStagePointerUp}
    >
      {fitScale > 0 && (
        <div
          className="stage"
          ref={stageRef}
          style={{
            width: wPx,
            height: hPx,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
          }}
        >
          {blankPhotoBounds ? (
            <div className="stage-blank-frame">
              <img
                className="stage-blank"
                src={blankPhoto}
                alt={`${product.name} ${color.label}`}
                draggable={false}
                style={blankPhotoCropStyle}
              />
            </div>
          ) : blankPhoto ? (
            <img
              className="stage-blank"
              src={blankPhoto}
              alt={`${product.name} ${color.label}`}
              draggable={false}
              style={{ width: wPx, height: hPx }}
            />
          ) : (
            <ProductCanvas product={product} color={color} scale={scale} />
          )}

          {/* Poured-gel overlay for the chosen gel colour, drawn in register on
              top of the case photo. */}
          {color.gelSrc && (
            <img
              className="stage-gel"
              src={resolveAsset(color.gelSrc)}
              alt=""
              draggable={false}
              style={{ width: wPx, height: hPx }}
            />
          )}

          {/* faint safe-area guide — only for the tote (its logo keep-out).
              Phone cases use real Apple photos where the camera is already
              visible, and the photo frame draws its own moulding, so neither
              needs a dashed overlay. */}
          {product.kind === 'tote' && (
          <svg
            width={wPx}
            height={hPx}
            viewBox={`0 0 ${wPx} ${hPx}`}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <rect
              x={product.printable.outer.xMm * scale}
              y={product.printable.outer.yMm * scale}
              width={product.printable.outer.wMm * scale}
              height={product.printable.outer.hMm * scale}
              rx={product.printable.outer.rMm * scale}
              ry={product.printable.outer.rMm * scale}
              fill="none"
              stroke="rgba(168,82,76,0.28)"
              strokeWidth={1}
              strokeDasharray="5 5"
            />
            {(product.printable.obstacles || []).map((ob, i) =>
              ob.type === 'circle' ? (
                <circle
                  key={i}
                  cx={ob.cxMm * scale}
                  cy={ob.cyMm * scale}
                  r={ob.rMm * scale}
                  fill="rgba(168,82,76,0.06)"
                  stroke="rgba(168,82,76,0.4)"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
              ) : (
                <rect
                  key={i}
                  x={ob.xMm * scale}
                  y={ob.yMm * scale}
                  width={ob.wMm * scale}
                  height={ob.hMm * scale}
                  rx={(ob.rMm || 0) * scale}
                  ry={(ob.rMm || 0) * scale}
                  fill="rgba(168,82,76,0.06)"
                  stroke="rgba(168,82,76,0.4)"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
              ),
            )}
          </svg>
          )}

          {placed.map((charm) => {
            const f = flags?.[charm.uid] || { inside: true, overlap: false }
            const bad = !f.inside || f.overlap
            const w = charm.baseWmm * (charm.scale || 1) * scale
            const h = charm.baseHmm * (charm.scale || 1) * scale
            const left = charm.cxMm * scale - w / 2
            const top = charm.cyMm * scale - h / 2
            const isSel = charm.uid === selectedUid
            // Expand tiny charms' touch target to at least MIN_HIT via a padded
            // transparent ::before (keeps the visual size, easier to grab).
            const hitPad = Math.max(0, (MIN_HIT - Math.min(w, h)) / 2)
            return (
              <div
                key={charm.uid}
                className={`charm${isSel ? ' is-selected' : ''}${bad ? ' is-bad' : ''}`}
                style={{
                  left,
                  top,
                  width: w,
                  height: h,
                  transform: `rotate(${charm.rot || 0}deg)`,
                  zIndex: isSel ? 40 : 10,
                  '--hit-pad': `${hitPad}px`,
                }}
                onPointerDown={(e) => onCharmPointerDown(e, charm)}
                onPointerMove={onCharmPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <img src={charm.src} alt={charm.name} draggable={false} />
              </div>
            )
          })}

          {/* curved rotation dial + remove control for the selected charm */}
          {selected && (
            <RotationDial
              charm={selected}
              scale={scale}
              onTransform={onTransform}
              onRemove={onRemove}
              onCheckpoint={onCheckpoint}
            />
          )}

          {/* Selected word-group outline + "Confirm to edit letters" control.
              The box itself is non-interactive (drag any letter to move the whole
              word); only the confirm button / are-you-sure panel take clicks. */}
          {groupBox && (
            <div
              className="group-box"
              style={{
                left: groupBox.left,
                top: groupBox.top,
                width: groupBox.width,
                height: groupBox.height,
              }}
            >
              {groupBox.label && <span className="group-box__label">{groupBox.label}</span>}
              <div
                className="group-box__tools"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {confirmGroupId === selectedGroupId ? (
                  <div className="group-confirm__ask" role="dialog" aria-label={t('group.confirm')}>
                    <span className="group-confirm__q">{t('group.moveOnOwn')}</span>
                    <button
                      type="button"
                      className="group-confirm__yes"
                      onClick={() => onBreakGroup?.(selectedGroupId)}
                    >
                      {t('group.yes')}
                    </button>
                    <button
                      type="button"
                      className="group-confirm__no"
                      onClick={() => onCancelBreak?.()}
                    >
                      {t('group.no')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="group-confirm"
                    onClick={() => onRequestBreak?.(selectedGroupId)}
                    title={t('group.confirmTip')}
                  >
                    {t('group.confirm')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

function RotationDial({ charm, scale, onTransform, onRemove, onCheckpoint }) {
  const w = charm.baseWmm * (charm.scale || 1) * scale
  const h = charm.baseHmm * (charm.scale || 1) * scale
  const cx = charm.cxMm * scale
  const cy = charm.cyMm * scale
  const rot = charm.rot || 0
  const charmRadius = Math.hypot(w, h) / 2
  const R = charmRadius + 10
  const size = R * 2 + 24
  const c = size / 2
  const svgRef = useRef(null)
  const dragging = useRef(false)

  // Free-degree rotation: the angle from the ring centre to the pointer sets the
  // charm's rotation (0 = upright, i.e. the thumb straight up).
  const angleFrom = (clientX, clientY) => {
    const el = svgRef.current
    if (!el) return rot
    const r = el.getBoundingClientRect()
    const a =
      (Math.atan2(clientY - (r.top + r.height / 2), clientX - (r.left + r.width / 2)) * 180) /
        Math.PI +
      90
    let n = ((a % 360) + 360) % 360
    if (n > 180) n -= 360
    return Math.round(n)
  }
  const start = (e) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    onCheckpoint?.()
    dragging.current = true
    onTransform(charm.uid, { rot: angleFrom(e.clientX, e.clientY) })
  }
  const move = (e) => {
    if (dragging.current) onTransform(charm.uid, { rot: angleFrom(e.clientX, e.clientY) })
  }
  const end = () => {
    dragging.current = false
  }

  const ta = ((rot - 90) * Math.PI) / 180
  const sx = c + (charmRadius + 3) * Math.cos(ta)
  const sy = c + (charmRadius + 3) * Math.sin(ta)
  const tx = c + R * Math.cos(ta)
  const ty = c + R * Math.sin(ta)
  return (
    <div
      className="charm-dial"
      style={{ left: cx, top: cy, width: size, height: size, '--dial-radius': `${R}px` }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <svg
        ref={svgRef}
        className="charm-dial__svg"
        width={size}
        height={size}
        aria-label={t('action.rotate')}
      >
        <circle className="charm-dial__contrast" cx={c} cy={c} r={R} />
        <circle className="charm-dial__track" cx={c} cy={c} r={R} />
        <circle
          className="charm-dial__hit"
          cx={c}
          cy={c}
          r={R}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
        <line className="charm-dial__spoke" x1={sx} y1={sy} x2={tx} y2={ty} />
        <circle className="charm-dial__thumb" cx={tx} cy={ty} r={11} />
      </svg>
      <span className="charm-dial__deg">{Math.round(rot)}°</span>
      <button
        type="button"
        className="charm-dial__remove"
        aria-label={t('action.remove')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onRemove(charm.uid)}
      >
        <DeleteOutlined />
      </button>
    </div>
  )
}

export default ProductStage

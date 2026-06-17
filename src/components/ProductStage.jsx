import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Button, Tooltip } from 'antd'
import {
  DeleteOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
} from '@ant-design/icons'
import ProductCanvas from './ProductCanvas'
import { resolveAsset } from '../lib/assets'
import { clampCenter } from '../lib/geometry'

const PAD = 36

// Reusable glitter-gel sparkle texture (masked to each case silhouette).
const glitterTexture = resolveAsset('/assets/cases/glitter.png')

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
    zoom = 1,
  },
  ref,
) {
  const wrapRef = useRef(null)
  const stageRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
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

  const onCharmPointerDown = useCallback(
    (e, charm) => {
      e.stopPropagation()
      onSelect(charm.uid)
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = {
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
    [onSelect],
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
      // Hard-clamp the charm so its full footprint stays inside the printable
      // outer region — patterns can never be dragged off the product edge.
      const box = { cx: d.startCx + dxMm, cy: d.startCy + dyMm, w: d.w, h: d.h, rot: d.rot }
      const { cx, cy } = clampCenter(box, product.printable)
      onMove(d.uid, { cxMm: cx, cyMm: cy })
    },
    [scale, product, onMove, onCheckpoint],
  )

  const endDrag = useCallback((e) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
  }, [])

  const selected = placed.find((c) => c.uid === selectedUid)

  // Real product photo (e.g. the Apple iPhone case render) for the chosen finish.
  const blankPhoto = resolveAsset(
    (product.blankImage && (product.blankImage[color.id] || product.blankImage.default)) || null,
  )

  return (
    <div className="stage-wrap" ref={wrapRef} onPointerDown={() => onSelect(null)}>
      {fitScale > 0 && (
        <div
          className="stage"
          ref={stageRef}
          style={{ width: wPx, height: hPx }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {blankPhoto ? (
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

          {/* Glitter-gel finish over a real case PHOTO: a sparkle texture masked
              to the case silhouette (using the photo's own alpha) so the sparkle
              only lands on the silicone. The SVG gel render handles its own
              glitter, so this is only for the photo branch. */}
          {blankPhoto && color.glitter && (
            <div
              className="stage-glitter"
              style={{
                width: wPx,
                height: hPx,
                backgroundImage: `url(${glitterTexture})`,
                backgroundSize: `${wPx}px ${hPx}px`,
                WebkitMaskImage: `url(${blankPhoto})`,
                maskImage: `url(${blankPhoto})`,
                WebkitMaskSize: `${wPx}px ${hPx}px`,
                maskSize: `${wPx}px ${hPx}px`,
              }}
            />
          )}

          {/* faint safe-area guide — only for products without a real photo
              (e.g. the tote's logo keep-out). Phone cases use real Apple photos
              where the camera is already visible, so no dashed overlay. */}
          {product.kind !== 'phone' && (
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

          {/* selection toolbar */}
          {selected && (
            <SelectionToolbar
              charm={selected}
              scale={scale}
              onTransform={onTransform}
              onRemove={onRemove}
              onCheckpoint={onCheckpoint}
            />
          )}
        </div>
      )}
    </div>
  )
})

function SelectionToolbar({ charm, scale, onTransform, onRemove, onCheckpoint }) {
  const h = charm.baseHmm * (charm.scale || 1) * scale
  const left = charm.cxMm * scale
  const top = charm.cyMm * scale - h / 2 - 14
  const rotate = (deg) => {
    onCheckpoint?.()
    onTransform(charm.uid, { rot: (charm.rot || 0) + deg })
  }
  return (
    <div
      className="charm-tools"
      style={{
        left,
        top,
        transform: 'translate(-50%, -100%)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Tooltip title="Rotate left">
        <Button
          size="small"
          shape="circle"
          icon={<RotateLeftOutlined />}
          onClick={() => rotate(-15)}
        />
      </Tooltip>
      <Tooltip title="Rotate right">
        <Button
          size="small"
          shape="circle"
          icon={<RotateRightOutlined />}
          onClick={() => rotate(15)}
        />
      </Tooltip>
      <Tooltip title="Remove">
        <Button
          size="small"
          shape="circle"
          danger
          icon={<DeleteOutlined />}
          onClick={() => onRemove(charm.uid)}
        />
      </Tooltip>
    </div>
  )
}

export default ProductStage

import { useMemo } from 'react'

/* ---- colour helpers: mix a hex toward white (lighten) / black (darken) ---- */
const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)))
function parseHex(hex) {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)]
}
const toHex = (rgb) => '#' + rgb.map((v) => clampByte(v).toString(16).padStart(2, '0')).join('')
function lighten(hex, amt) {
  const [r, g, b] = parseHex(hex)
  return toHex([r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt])
}
function darken(hex, amt) {
  const [r, g, b] = parseHex(hex)
  return toHex([r * (1 - amt), g * (1 - amt), b * (1 - amt)])
}
const toteBodyTop = (product, scale) => product.printable.outer.yMm * scale - scale * 16

/**
 * Blank product artwork rendered as crisp, photoreal SVG so it scales to any
 * zoom. Coordinates are in product millimetres multiplied by `scale` (px per mm),
 * matching the coordinate space the customizer uses to place charms.
 *
 * A merchant can also supply `product.blankImage` (a real product photo). When
 * present it is drawn instead of the vector shell; charm placement + boundary
 * maths are unchanged because they work purely in millimetres.
 */
export default function ProductCanvas({ product, color, scale }) {
  const wPx = product.widthMm * scale
  const hPx = product.heightMm * scale
  const mm = (v) => v * scale
  const uid = `${product.id}-${color.id}`
  const isDark = color.id === 'black'

  const glitterDots = useMemo(() => {
    if (!color.glitter) return []
    const dots = []
    for (let i = 0; i < 240; i++) {
      const big = Math.random() < 0.1
      dots.push({
        x: Math.random() * product.widthMm,
        y: Math.random() * product.heightMm,
        r: big ? 0.45 + Math.random() * 0.5 : 0.1 + Math.random() * 0.2,
        o: big ? 0.55 + Math.random() * 0.45 : 0.16 + Math.random() * 0.4,
        big,
      })
    }
    return dots
    // regenerate only when product/colour changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, color.id])

  // Optional real photo for the chosen colour (or a default blank image).
  const photo =
    (product.blankImage && (product.blankImage[color.id] || product.blankImage.default)) || null

  return (
    <svg
      width={wPx}
      height={hPx}
      viewBox={`0 0 ${wPx} ${hPx}`}
      style={{ display: 'block' }}
      aria-label={`${product.name} blank`}
    >
      <defs>
        {/* body fill with a soft diagonal sheen */}
        <linearGradient id={`shell-${uid}`} x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor={lighten(color.shell, isDark ? 0.16 : 0.06)} />
          <stop offset="42%" stopColor={color.shell} />
          <stop offset="100%" stopColor={color.edge} />
        </linearGradient>
        {/* outer rim bevel */}
        <linearGradient id={`bevel-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={lighten(color.edge, 0.22)} />
          <stop offset="50%" stopColor={color.edge} />
          <stop offset="100%" stopColor={darken(color.edge, 0.28)} />
        </linearGradient>
        {/* glossy diagonal highlight sweep */}
        <linearGradient id={`gloss-${uid}`} x1="0" y1="0" x2="1" y2="1.5">
          <stop offset="0%" stopColor="#fff" stopOpacity={isDark ? 0.2 : 0.5} />
          <stop offset="20%" stopColor="#fff" stopOpacity="0" />
          <stop offset="80%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#fff" stopOpacity={isDark ? 0.05 : 0.16} />
        </linearGradient>
        <radialGradient id={`topglow-${uid}`} cx="50%" cy="14%" r="72%">
          <stop offset="0%" stopColor="#fff" stopOpacity={isDark ? 0.1 : 0.42} />
          <stop offset="55%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        {/* camera island metal + lens glass */}
        <linearGradient id={`island-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3c3f45" />
          <stop offset="45%" stopColor="#222428" />
          <stop offset="100%" stopColor="#0d0e11" />
        </linearGradient>
        <radialGradient id={`lens-${uid}`} cx="38%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#6b7785" />
          <stop offset="34%" stopColor="#2a2f37" />
          <stop offset="100%" stopColor="#040507" />
        </radialGradient>
        {/* tote side-volume shading */}
        <linearGradient id={`totevol-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.12" />
          <stop offset="16%" stopColor="#fff" stopOpacity="0" />
          <stop offset="84%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.16" />
        </linearGradient>
        {/* woven canvas speckle */}
        <filter id={`canvas-${uid}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="turbulence" baseFrequency="0.12 0.22" numOctaves="2" seed="11" />
          <feColorMatrix
            type="matrix"
            values={
              isDark
                ? '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0'
                : '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.6 0'
            }
          />
        </filter>
        <clipPath id={`shellclip-${uid}`}>
          {product.kind === 'phone' ? (
            <rect
              x={mm(1.7)}
              y={mm(1.7)}
              width={wPx - mm(3.4)}
              height={hPx - mm(3.4)}
              rx={product.radiusMm * scale - mm(1.7)}
              ry={product.radiusMm * scale - mm(1.7)}
            />
          ) : (
            <rect
              x="0"
              y={toteBodyTop(product, scale)}
              width={wPx}
              height={hPx - toteBodyTop(product, scale)}
              rx={product.radiusMm * scale}
              ry={product.radiusMm * scale}
            />
          )}
        </clipPath>
      </defs>

      {photo ? (
        <image href={photo} x="0" y="0" width={wPx} height={hPx} preserveAspectRatio="xMidYMid meet" />
      ) : product.kind === 'phone' ? (
        <PhoneShell product={product} color={color} scale={scale} uid={uid} isDark={isDark} />
      ) : (
        <ToteShell product={product} color={color} scale={scale} uid={uid} isDark={isDark} />
      )}

      {/* glitter speckle, clipped to the body */}
      {!photo && glitterDots.length > 0 && (
        <g clipPath={`url(#shellclip-${uid})`}>
          {glitterDots.map((d, i) =>
            d.big ? (
              <g key={i} opacity={d.o}>
                <circle cx={mm(d.x)} cy={mm(d.y)} r={mm(d.r) * 2.6} fill="#fff" opacity={0.16} />
                <circle cx={mm(d.x)} cy={mm(d.y)} r={mm(d.r)} fill="#fff" />
              </g>
            ) : (
              <circle key={i} cx={mm(d.x)} cy={mm(d.y)} r={mm(d.r)} fill="#fff" opacity={d.o} />
            ),
          )}
        </g>
      )}
    </svg>
  )
}

/**
 * Charmé soft gel phone case. A glossy moulded gel body (white glitter or black
 * gel) with a raised rim, top sheen and a camera island whose layout matches the
 * model generation: a horizontal plateau (17 series), a triple-lens square (Pro
 * 13–16) or a dual-lens square (non-Pro 13–16). Renders crisply at any zoom.
 */
function PhoneShell({ product, color, scale, uid, isDark }) {
  const W = product.widthMm * scale
  const H = product.heightMm * scale
  const r = product.radiusMm * scale
  const cam = product.camera
  const rim = scale * 2.2
  return (
    <g>
      {/* moulded gel rim */}
      <rect x="0" y="0" width={W} height={H} rx={r} ry={r} fill={`url(#bevel-${uid})`} />
      {/* gel body */}
      <rect
        x={rim}
        y={rim}
        width={W - rim * 2}
        height={H - rim * 2}
        rx={r - rim}
        ry={r - rim}
        fill={`url(#shell-${uid})`}
      />
      {/* inner rim highlight (raised glossy gel edge) */}
      <rect
        x={rim}
        y={rim}
        width={W - rim * 2}
        height={H - rim * 2}
        rx={r - rim}
        ry={r - rim}
        fill="none"
        stroke={isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.7)'}
        strokeWidth={Math.max(0.75, scale * 0.6)}
      />
      {/* top glow + diagonal gloss sweep */}
      <rect x="0" y="0" width={W} height={H} rx={r} ry={r} fill={`url(#topglow-${uid})`} pointerEvents="none" />
      <rect x="0" y="0" width={W} height={H} rx={r} ry={r} fill={`url(#gloss-${uid})`} pointerEvents="none" />

      {cam && <CameraIsland cam={cam} scale={scale} uid={uid} isDark={isDark} />}
    </g>
  )
}

/** Render the camera island + lenses for the model's camera kind. */
function CameraIsland({ cam, scale, uid, isDark }) {
  const x = cam.xMm * scale
  const y = cam.yMm * scale
  const w = cam.wMm * scale
  const h = cam.hMm * scale
  const rr = (cam.rMm || 10) * scale
  // The island is a slightly frosted plateau; lenses are dark glass.
  const plateau = isDark ? '#0c0b0a' : '#efe9da'
  const plateauStroke = isDark ? '#000' : 'rgba(120,110,90,0.45)'

  const lens = (cx, cy, lr, key) => (
    <g key={key}>
      <circle cx={cx} cy={cy} r={lr * 1.4} fill={isDark ? '#222' : '#cfc7b4'} />
      <circle cx={cx} cy={cy} r={lr} fill={`url(#lens-${uid})`} />
      <circle cx={cx - lr * 0.3} cy={cy - lr * 0.32} r={lr * 0.28} fill="#9fb0c0" opacity={0.55} />
    </g>
  )

  // Samsung Galaxy — a floating vertical column of lenses, no raised island.
  if (cam.kind === 'samsungV3' || cam.kind === 'samsungV4') {
    const count = cam.kind === 'samsungV4' ? 4 : 3
    const cx = x + w * 0.5
    const lr = w * 0.36
    const top = y + lr * 1.25
    const span = h - lr * 2.5
    const els = []
    for (let i = 0; i < count; i++) {
      els.push(lens(cx, top + (span * i) / (count - 1), lr, `s${i}`))
    }
    // flash pip beside the top lens
    els.push(<circle key="flash" cx={x + w * 1.05} cy={top} r={lr * 0.3} fill={isDark ? '#d9dde0' : '#b9b09a'} opacity={0.85} />)
    return <g>{els}</g>
  }

  // Huawei — large round camera island with a ring of lenses.
  if (cam.kind === 'circle') {
    const ccx = x + w / 2
    const ccy = y + h / 2
    const R = w / 2
    const lr = R * 0.2
    return (
      <g>
        <circle cx={ccx} cy={ccy} r={R} fill={plateau} stroke={plateauStroke} strokeWidth={Math.max(0.75, scale * 0.6)} />
        <circle cx={ccx} cy={ccy} r={R * 0.97} fill="none" stroke={isDark ? '#222' : '#cfc7b4'} strokeWidth={Math.max(0.5, scale * 0.5)} />
        {lens(ccx, ccy - R * 0.46, lr, 'a')}
        {lens(ccx - R * 0.42, ccy + R * 0.26, lr, 'b')}
        {lens(ccx + R * 0.42, ccy + R * 0.26, lr, 'c')}
        <circle cx={ccx} cy={ccy} r={lr * 0.8} fill={isDark ? '#26282b' : '#9a9079'} />
        <circle key="flash" cx={ccx + R * 0.66} cy={ccy - R * 0.5} r={R * 0.1} fill={isDark ? '#d9dde0' : '#b9b09a'} opacity={0.85} />
      </g>
    )
  }

  let lenses = []
  if (cam.kind === 'bar') {
    // two lenses + flash laid horizontally along the plateau
    const cy = y + h / 2
    const lr = h * 0.3
    const x1 = x + w * 0.16
    const x2 = x + w * 0.4
    lenses = [lens(x1, cy, lr, 'a'), lens(x2, cy, lr, 'b')]
    lenses.push(<circle key="flash" cx={x + w * 0.6} cy={cy} r={h * 0.12} fill={isDark ? '#d9dde0' : '#b9b09a'} opacity={0.9} />)
    lenses.push(<rect key="mic" x={x + w * 0.74} y={cy - h * 0.06} width={w * 0.14} height={h * 0.12} rx={h * 0.05} fill={isDark ? '#2a2c2f' : '#a59c86'} />)
  } else if (cam.kind === 'squareTriple') {
    const lr = w * 0.15
    const cxL = x + w * 0.32
    const cxR = x + w * 0.62
    const cyT = y + h * 0.3
    const cyB = y + h * 0.68
    lenses = [lens(cxL, cyT, lr, 'a'), lens(cxL, cyB, lr, 'b'), lens(cxR, (cyT + cyB) / 2, lr, 'c')]
    lenses.push(<circle key="flash" cx={x + w * 0.8} cy={y + h * 0.3} r={w * 0.07} fill={isDark ? '#d9dde0' : '#b9b09a'} opacity={0.9} />)
    lenses.push(<circle key="lidar" cx={x + w * 0.8} cy={y + h * 0.68} r={w * 0.06} fill={isDark ? '#26282b' : '#9a9079'} />)
  } else if (cam.kind === 'squareLarge') {
    // Xiaomi — big island with three stacked lenses + a flash pip
    const lr = w * 0.17
    const cxL = x + w * 0.33
    lenses = [
      lens(cxL, y + h * 0.27, lr, 'a'),
      lens(cxL, y + h * 0.55, lr, 'b'),
      lens(cxL, y + h * 0.82, lr * 0.82, 'c'),
    ]
    lenses.push(<circle key="flash" cx={x + w * 0.72} cy={y + h * 0.27} r={w * 0.06} fill={isDark ? '#d9dde0' : '#b9b09a'} opacity={0.9} />)
    lenses.push(<rect key="leica" x={x + w * 0.58} y={y + h * 0.6} width={w * 0.3} height={h * 0.16} rx={h * 0.07} fill={isDark ? '#2a2c2f' : '#a59c86'} opacity={0.8} />)
  } else {
    // squareDual — two lenses on a diagonal
    const lr = w * 0.17
    lenses = [lens(x + w * 0.34, y + h * 0.32, lr, 'a'), lens(x + w * 0.62, y + h * 0.64, lr, 'b')]
    lenses.push(<circle key="flash" cx={x + w * 0.66} cy={y + h * 0.28} r={w * 0.08} fill={isDark ? '#d9dde0' : '#b9b09a'} opacity={0.9} />)
  }

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={rr} ry={rr} fill={plateau} stroke={plateauStroke} strokeWidth={Math.max(0.75, scale * 0.5)} />
      {lenses}
    </g>
  )
}

/**
 * Photoreal canvas tote: woven cotton body with side-volume shading, a turned
 * top hem with a stitch line, and two cotton-webbing handles with end-bar
 * stitching. Rendered as crisp SVG so it scales to any zoom.
 */
function ToteShell({ product, color, scale, uid, isDark }) {
  const W = product.widthMm * scale
  const H = product.heightMm * scale
  const r = product.radiusMm * scale
  const bodyTop = toteBodyTop(product, scale)
  const bodyH = H - bodyTop
  const stitch = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(120,98,60,0.55)'
  const webbing = darken(color.shell, isDark ? -0.15 : 0.06)

  // handle geometry — two straps rising from the body, looping above
  const lOut = W * 0.26
  const lIn = W * 0.4
  const rIn = W * 0.6
  const rOut = W * 0.74
  const strapTop = scale * 8
  const strapW = scale * 9
  const anchor = bodyTop + scale * 6
  const handle = (x1, x2) =>
    `M ${x1} ${anchor} C ${x1} ${strapTop + (anchor - strapTop) * 0.15}, ${x2} ${strapTop + (anchor - strapTop) * 0.15}, ${x2} ${anchor}`

  return (
    <g>
      {/* handles behind the body */}
      <g fill="none" stroke={webbing} strokeWidth={strapW} strokeLinecap="round">
        <path d={handle(lOut, rOut)} />
        <path d={handle(lIn, rIn)} />
      </g>
      <g fill="none" stroke={stitch} strokeWidth={Math.max(0.5, scale * 0.5)} strokeDasharray={`${scale * 1.4} ${scale * 1.1}`} strokeLinecap="round" opacity="0.7">
        <path d={handle(lOut, rOut)} />
        <path d={handle(lIn, rIn)} />
      </g>

      {/* body */}
      <rect x="0" y={bodyTop} width={W} height={bodyH} rx={r} ry={r} fill={`url(#shell-${uid})`} />
      {/* woven canvas texture */}
      <g clipPath={`url(#shellclip-${uid})`}>
        <rect x="0" y={bodyTop} width={W} height={bodyH} filter={`url(#canvas-${uid})`} opacity={isDark ? 0.22 : 0.4} />
        <rect x="0" y={bodyTop} width={W} height={bodyH} fill={`url(#totevol-${uid})`} />
      </g>

      {/* turned top hem + double stitch line */}
      <rect x="0" y={bodyTop} width={W} height={scale * 12} fill={darken(color.shell, 0.05)} opacity={0.5} />
      <line x1={scale * 3} x2={W - scale * 3} y1={bodyTop + scale * 12} y2={bodyTop + scale * 12} stroke={stitch} strokeWidth={Math.max(0.5, scale * 0.4)} strokeDasharray={`${scale * 1.4} ${scale}`} />

      {/* handle end-bar stitch boxes where straps meet the body */}
      {[lOut, lIn, rIn, rOut].map((x, i) => (
        <rect
          key={i}
          x={x - strapW / 2}
          y={anchor - scale * 2}
          width={strapW}
          height={scale * 9}
          rx={scale * 1}
          fill="none"
          stroke={stitch}
          strokeWidth={Math.max(0.5, scale * 0.4)}
        />
      ))}
    </g>
  )
}



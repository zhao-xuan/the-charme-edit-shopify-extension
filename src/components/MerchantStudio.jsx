import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  InputNumber,
  Input,
  Select,
  Slider,
  Upload,
  Statistic,
  Row,
  Col,
  Divider,
  App,
  Empty,
} from 'antd'
import { InboxOutlined, DownloadOutlined, ScissorOutlined } from '@ant-design/icons'

/**
 * Merchant Studio (runtime version of the asset pipeline).
 *
 * Upload a product/artwork photo shot on a plain background, tell us the real
 * width it spans, and the studio:
 *   • knocks out the background (corner-seeded flood fill),
 *   • measures the artwork's bounding box → real-world size + % of the frame,
 *   • produces a transparent cut-out you can download,
 *   • emits a catalogue JSON entry (cut-out + relative size) for the customizer.
 */

const MAX_DIM = 1000

const TIERS = {
  grande: { type: 1, price: 3, label: 'Statement · Grande (fixed)' },
  midi: { type: 2, price: 2, label: 'Feature · Midi (resizable)' },
  mini: { type: 3, price: 2, label: 'Filler · Mini (scatter)' },
}

function knockout(data, w, h, tolerance, feather) {
  const n = w * h
  const visited = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, (n - 1) * 4]
  let sr = 0, sg = 0, sb = 0
  for (const c of corners) {
    sr += data[c]; sg += data[c + 1]; sb += data[c + 2]
  }
  sr /= 4; sg /= 4; sb /= 4
  const tol2 = tolerance * tolerance
  const fth2 = (tolerance + feather) * (tolerance + feather)
  for (const c of corners) {
    const p = c / 4
    if (!visited[p]) { visited[p] = 1; stack[sp++] = p }
  }
  while (sp > 0) {
    const p = stack[--sp]
    const i = p * 4
    const dr = data[i] - sr, dg = data[i + 1] - sg, db = data[i + 2] - sb
    const d2 = dr * dr + dg * dg + db * db
    if (d2 > fth2) continue
    if (d2 <= tol2) data[i + 3] = 0
    else data[i + 3] = Math.round(((Math.sqrt(d2) - tolerance) / feather) * 255)
    const x = p % w
    const y = (p / w) | 0
    if (x > 0 && !visited[p - 1]) { visited[p - 1] = 1; stack[sp++] = p - 1 }
    if (x < w - 1 && !visited[p + 1]) { visited[p + 1] = 1; stack[sp++] = p + 1 }
    if (y > 0 && !visited[p - w]) { visited[p - w] = 1; stack[sp++] = p - w }
    if (y < h - 1 && !visited[p + w]) { visited[p + w] = 1; stack[sp++] = p + w }
  }
}

function contentBounds(data, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export default function MerchantStudio() {
  const { message } = App.useApp()
  const [imgEl, setImgEl] = useState(null)
  const [tolerance, setTolerance] = useState(38)
  const [feather, setFeather] = useState(60)
  const [refWidthMm, setRefWidthMm] = useState(60)
  const [tier, setTier] = useState('midi')
  const [name, setName] = useState('New charm')
  const [collection, setCollection] = useState('Custom')
  const [price, setPrice] = useState(2)
  const [dragOver, setDragOver] = useState(false)

  const srcCanvasRef = useRef(null)
  const cutCanvasRef = useRef(null)
  const [result, setResult] = useState(null)

  const onFile = useCallback((file) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      setImgEl(img)
      URL.revokeObjectURL(url)
    }
    img.onerror = () => message.error('Could not read that image.')
    img.src = url
    return false
  }, [])

  // run the cut-out whenever inputs change
  useEffect(() => {
    if (!imgEl) return
    const scale = Math.min(1, MAX_DIM / Math.max(imgEl.width, imgEl.height))
    const w = Math.round(imgEl.width * scale)
    const h = Math.round(imgEl.height * scale)

    const src = srcCanvasRef.current
    src.width = w
    src.height = h
    const sctx = src.getContext('2d', { willReadFrequently: true })
    sctx.clearRect(0, 0, w, h)
    sctx.drawImage(imgEl, 0, 0, w, h)

    const imageData = sctx.getImageData(0, 0, w, h)
    knockout(imageData.data, w, h, tolerance, feather)
    const box = contentBounds(imageData.data, w, h)

    // draw original + bbox overlay
    sctx.drawImage(imgEl, 0, 0, w, h)
    if (box) {
      sctx.strokeStyle = '#a8524c'
      sctx.lineWidth = 2
      sctx.setLineDash([6, 4])
      sctx.strokeRect(box.x, box.y, box.w, box.h)
    }

    // cut-out canvas
    const cut = cutCanvasRef.current
    if (box) {
      cut.width = box.w
      cut.height = box.h
      const cctx = cut.getContext('2d')
      const cropped = cctx.createImageData(box.w, box.h)
      for (let y = 0; y < box.h; y++) {
        for (let x = 0; x < box.w; x++) {
          const si = ((y + box.y) * w + (x + box.x)) * 4
          const di = (y * box.w + x) * 4
          cropped.data[di] = imageData.data[si]
          cropped.data[di + 1] = imageData.data[si + 1]
          cropped.data[di + 2] = imageData.data[si + 2]
          cropped.data[di + 3] = imageData.data[si + 3]
        }
      }
      cctx.putImageData(cropped, 0, 0)

      const mmPerPx = refWidthMm / w
      const widthMm = +(box.w * mmPerPx).toFixed(1)
      const heightMm = +(box.h * mmPerPx).toFixed(1)
      setResult({
        box,
        frameW: w,
        frameH: h,
        widthMm,
        heightMm,
        pctW: Math.round((box.w / w) * 100),
        pctH: Math.round((box.h / h) * 100),
      })
    } else {
      setResult(null)
    }
  }, [imgEl, tolerance, feather, refWidthMm])

  useEffect(() => {
    setPrice(TIERS[tier].price)
  }, [tier])

  const exportEntry = () => {
    if (!result) return
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'charm'
    const entry = {
      id,
      name,
      collection,
      tier,
      type: TIERS[tier].type,
      price: Number(price),
      src: `/assets/charms/${id}.png`,
      pxW: result.box.w,
      pxH: result.box.h,
      widthMm: result.widthMm,
      heightMm: result.heightMm,
      minScale: tier === 'grande' ? 1 : tier === 'midi' ? 0.75 : 0.9,
      maxScale: tier === 'grande' ? 1 : tier === 'midi' ? 1.6 : 1.25,
    }
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${id}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    message.success('Catalogue entry exported.')
  }

  const exportPng = () => {
    if (!result) return
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'charm'
    const a = document.createElement('a')
    a.href = cutCanvasRef.current.toDataURL('image/png')
    a.download = `${id}.png`
    a.click()
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '24px clamp(16px, 5vw, 56px)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <p className="eyebrow">Merchant studio</p>
        <h2 className="section-title" style={{ fontSize: 30, marginBottom: 4 }}>
          Charm intake &amp; auto-measure
        </h2>
        <p className="hint" style={{ maxWidth: 680 }}>
          Drop a charm photo shot on a plain backdrop. We remove the background, measure the piece
          against the real width you provide, and archive its cut-out and relative size — exactly the
          data the customer studio consumes.
        </p>

        <Row gutter={[28, 28]} style={{ marginTop: 18 }}>
          <Col xs={24} lg={9}>
            <Upload.Dragger
              accept="image/*"
              showUploadList={false}
              beforeUpload={onFile}
              className={dragOver ? 'drag' : ''}
              onDragEnter={() => setDragOver(true)}
              onDragLeave={() => setDragOver(false)}
              onDrop={() => setDragOver(false)}
              style={{ borderRadius: 14, background: '#fffdf9' }}
            >
              <p style={{ fontSize: 30, color: 'var(--rouge)', margin: 0 }}>
                <InboxOutlined />
              </p>
              <p style={{ margin: '6px 0 2px' }}>Drop a charm / artwork photo</p>
              <p className="hint" style={{ margin: 0 }}>
                Plain white or solid background works best
              </p>
            </Upload.Dragger>

            <Divider>Measurement</Divider>
            <label className="eyebrow">Real width of the photo frame</label>
            <InputNumber
              value={refWidthMm}
              min={5}
              max={1000}
              formatter={(v) => `${v} mm`}
              parser={(v) => (v || '').replace(/[^\d.]/g, '')}
              onChange={(v) => setRefWidthMm(v || 1)}
              style={{ width: '100%', marginBottom: 14 }}
            />

            <label className="eyebrow">Background removal tolerance</label>
            <Slider min={8} max={90} value={tolerance} onChange={setTolerance} />
            <label className="eyebrow">Edge feather</label>
            <Slider min={0} max={120} value={feather} onChange={setFeather} />

            <Divider>Catalogue details</Divider>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Charm name" style={{ marginBottom: 10 }} />
            <Input value={collection} onChange={(e) => setCollection(e.target.value)} placeholder="Collection" style={{ marginBottom: 10 }} />
            <Select
              value={tier}
              onChange={setTier}
              style={{ width: '100%', marginBottom: 10 }}
              options={Object.entries(TIERS).map(([k, v]) => ({ value: k, label: v.label }))}
            />
            <InputNumber
              prefix="£"
              value={price}
              min={0}
              step={0.5}
              onChange={(v) => setPrice(v ?? 0)}
              style={{ width: '100%' }}
            />
          </Col>

          <Col xs={24} lg={15}>
            <Row gutter={[20, 20]}>
              <Col xs={24} md={14}>
                <p className="eyebrow">Detected artwork</p>
                <div style={{ display: imgEl ? 'block' : 'none' }}>
                  <canvas ref={srcCanvasRef} className="measure-canvas" />
                </div>
                {!imgEl && (
                  <div className="measure-canvas" style={{ display: 'grid', placeItems: 'center', minHeight: 220 }}>
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No image yet" />
                  </div>
                )}
              </Col>
              <Col xs={24} md={10}>
                <p className="eyebrow">Cut-out</p>
                <div
                  style={{
                    background:
                      'repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 18px 18px',
                    borderRadius: 12,
                    border: '1px solid var(--line)',
                    padding: 12,
                    display: 'grid',
                    placeItems: 'center',
                    minHeight: 180,
                  }}
                >
                  <canvas
                    ref={cutCanvasRef}
                    style={{ maxWidth: '100%', maxHeight: 220, display: result ? 'block' : 'none' }}
                  />
                  {!result && <span className="hint">cut-out preview</span>}
                </div>
              </Col>
            </Row>

            {result && (
              <>
                <Divider />
                <Row gutter={16}>
                  <Col span={8}>
                    <Statistic title="Width" value={(result.widthMm / 10).toFixed(1)} suffix="cm" />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Height" value={(result.heightMm / 10).toFixed(1)} suffix="cm" />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Frame coverage" value={Math.max(result.pctW, result.pctH)} suffix="%" />
                  </Col>
                </Row>
                <div style={{ display: 'flex', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
                  <Button type="primary" icon={<ScissorOutlined />} onClick={exportPng}>
                    Download cut-out PNG
                  </Button>
                  <Button icon={<DownloadOutlined />} onClick={exportEntry}>
                    Export catalogue entry (JSON)
                  </Button>
                </div>
                <p className="hint" style={{ marginTop: 12 }}>
                  Save the PNG to <code>public/assets/charms/</code> and add the JSON entry to{' '}
                  <code>src/data/catalog.json</code> — or wire both into the build pipeline.
                </p>
              </>
            )}
          </Col>
        </Row>
      </div>
    </div>
  )
}

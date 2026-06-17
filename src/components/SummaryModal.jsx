import { useEffect, useMemo, useState } from 'react'
import { Modal, Button, Spin, Divider, App } from 'antd'
import { DownloadOutlined, ShoppingOutlined } from '@ant-design/icons'
import { renderPreview } from '../lib/exportImage'
import { PHONE_CATEGORIES } from '../lib/catalog'

const TOTE_TYPE_LABEL = { 1: 'Statement', 2: 'Feature', 3: 'Filler' }
const UNIQUE_NOTE = 'Natural charms may vary slightly in size, shape, colour and pattern.'

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

function downloadDataUrl(url, name) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export default function SummaryModal({ open, product, color, placed, onClose, onPlaceOrder }) {
  const { message } = App.useApp()
  const isMobile = useMedia('(max-width: 760px)')
  const [loading, setLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Charms whose final look is only indicative → red dashed outline + disclaimer.
  // Fillers (type 3) are arranged by hand; unique charms vary by nature.
  const variableUids = useMemo(
    () => placed.filter((c) => c.type === 3 || c.category === 'unique').map((c) => c.uid),
    [placed],
  )
  const hasUnique = useMemo(() => placed.some((c) => c.category === 'unique'), [placed])
  const hasFiller = useMemo(() => placed.some((c) => c.type === 3), [placed])

  useEffect(() => {
    let alive = true
    if (open) {
      setLoading(true)
      setPreviewUrl(null)
      renderPreview(product, color, placed, variableUids)
        .then((url) => alive && (setPreviewUrl(url), setLoading(false)))
        .catch(() => alive && setLoading(false))
    }
    return () => {
      alive = false
    }
  }, [open, product, color, placed, variableUids])

  const charmTotal = placed.reduce((s, c) => s + c.price, 0)
  const total = product.basePrice + charmTotal
  const noun = product.kind === 'tote' ? 'tote' : 'case'

  // Group charms by browsing category (phone) or interaction type (tote).
  const grouped = useMemo(() => {
    if (product.kind === 'phone') {
      return PHONE_CATEGORIES.map((c) => ({
        key: c.key,
        label: c.label,
        items: placed.filter((p) => p.category === c.key),
      })).filter((g) => g.items.length)
    }
    return [1, 2, 3]
      .map((t) => ({ key: t, label: TOTE_TYPE_LABEL[t], items: placed.filter((p) => p.type === t) }))
      .filter((g) => g.items.length)
  }, [product.kind, placed])

  const placeOrder = async () => {
    const payload = {
      product: {
        id: product.id,
        name: product.name,
        kind: product.kind,
        colorId: color.caseId || color.id,
        color: color.label,
        caseColour: { id: color.caseId || color.id, label: color.caseLabel || color.label },
        gelColour: color.gelId ? { id: color.gelId, label: color.gelLabel } : null,
        basePrice: product.basePrice,
      },
      charms: placed.map((c) => ({
        charmId: c.charmId,
        type: c.type,
        category: c.category,
        name: c.name,
        price: c.price,
        xMm: +c.cxMm.toFixed(1),
        yMm: +c.cyMm.toFixed(1),
        scale: +(c.scale || 1).toFixed(2),
        rotDeg: c.rot || 0,
      })),
      total,
      preview: previewUrl,
      // Legacy proof shape kept so the Shopify cart handler keeps working.
      proofs: { placeholderUrl: previewUrl, sampleUrl: previewUrl },
    }

    // The host app decides what to do with the finished design. The Shopify
    // build wires this into a cart line-item; the standalone build just logs it.
    if (onPlaceOrder) {
      try {
        setSubmitting(true)
        await onPlaceOrder(payload)
        onClose()
      } catch (err) {
        message.error(err?.message || 'Could not add to bag, please try again.')
      } finally {
        setSubmitting(false)
      }
      return
    }

    console.log('ORDER PAYLOAD', payload)
    message.success('Design saved — added to bag! (demo)')
    onClose()
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={isMobile ? '100%' : 720}
      centered={!isMobile}
      style={isMobile ? { top: 8, maxWidth: 'calc(100vw - 16px)', paddingBottom: 0 } : undefined}
      styles={isMobile ? { body: { maxHeight: 'calc(100dvh - 150px)', overflowY: 'auto' } } : undefined}
      footer={null}
      title={<span className="display" style={{ fontSize: isMobile ? 18 : 22 }}>Your one-of-a-kind {product.name}</span>}
    >
      {loading || !previewUrl ? (
        <div style={{ height: 360, display: 'grid', placeItems: 'center', gap: 14 }}>
          <Spin size="large" />
          <span className="hint">Rendering your design…</span>
        </div>
      ) : (
        <div className="summary-layout">
          <div className="summary-preview">
            <p className="eyebrow" style={{ marginTop: 4 }}>Your design</p>
            <div
              style={{
                background: 'radial-gradient(120% 100% at 50% 0%, #fffdf9, #f3ead9)',
                borderRadius: 12,
                padding: 12,
                border: '1px solid var(--line)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <img
                src={previewUrl}
                alt="Your design preview"
                className="proof-img"
                style={{ filter: 'drop-shadow(0 16px 24px rgba(46,42,38,0.22))' }}
              />
            </div>
            {(hasFiller || hasUnique) && (
              <p className="hint preview-note" style={{ marginTop: 8 }}>
                <span className="red-key" /> Charms outlined in red are indicative.
                {hasFiller && ' Filler charms are arranged by hand.'}
                {hasUnique && ` ${UNIQUE_NOTE}`}
              </p>
            )}
            <Button
              size="small"
              icon={<DownloadOutlined />}
              style={{ marginTop: 8 }}
              onClick={() => downloadDataUrl(previewUrl, `${product.id}-design.png`)}
            >
              Download
            </Button>
          </div>
          <div className="summary-order">
            <p className="eyebrow" style={{ marginTop: 4 }}>Order summary</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span>{product.name}</span>
              <span>£{product.basePrice.toFixed(2)}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 8 }}>{color.label}</div>
            {grouped.map((g) => (
              <div key={g.key} style={{ marginBottom: 6 }}>
                <div className="eyebrow" style={{ marginBottom: 2 }}>
                  {g.label} × {g.items.length}
                </div>
                {g.items.map((c) => (
                  <div
                    key={c.uid}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, color: 'var(--ink-soft)' }}
                  >
                    <span>{c.name}</span>
                    <span style={{ whiteSpace: 'nowrap' }}>£{c.price.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            ))}
            <Divider style={{ margin: '10px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span>Total</span>
              <span className="display" style={{ fontSize: 26 }}>£{total.toFixed(2)}</span>
            </div>
            <Button
              type="primary"
              size="large"
              block
              loading={submitting}
              icon={<ShoppingOutlined />}
              style={{ marginTop: 12 }}
              onClick={placeOrder}
            >
              Order my custom {noun} (£{total.toFixed(0)})
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

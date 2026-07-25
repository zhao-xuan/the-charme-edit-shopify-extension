import { useEffect, useMemo, useState } from 'react'
import { Modal, Button, Spin, Divider, App } from 'antd'
import { DownloadOutlined, ShoppingOutlined } from '@ant-design/icons'
import { renderPreview } from '../lib/exportImage'
import { categoryLabel, placedCharmsTotal } from '../lib/catalog'
import { charmChargeLines } from '../lib/charmPricing'
import { settings } from '../lib/settings'
import { formatMoney } from '../lib/money'
import { t } from '../lib/i18n'
import { observeMediaQuery } from '../lib/mediaQuery'

const TOTE_TYPE_LABEL = { 1: 'Statement', 2: 'Feature', 3: 'Filler' }
const UNIQUE_NOTE = 'Natural charms may vary slightly in size, shape, colour and pattern.'

/**
 * Collapse placed charms into priced summary rows. Shared pricing groups show
 * the selected piece count and number of charged blocks; legacy bundles still
 * fold into one row charged once.
 */
function summaryRows(items) {
  return charmChargeLines(items, settings().charmPricingGroups).map((line, index) => {
    const first = line.items[0]
    if (line.kind === 'group') {
      return {
        key: `group-${line.rule.id}`,
        name: line.rule.label,
        price: line.total,
        count: line.items.length,
        blocks: line.quantity,
        category: first.category || 'gold',
        type: first.type,
      }
    }
    return {
      key: first.uid || `${line.key}-${index}`,
      name: first.name,
      price: line.total,
      count: line.kind === 'legacy-bundle' ? line.items.length : 1,
      blocks: null,
      category: first.category || 'gold',
      type: first.type,
    }
  })
}

function useMedia(query) {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const m = window.matchMedia(query)
    const fn = (e) => setMatch(e.matches)
    const stop = observeMediaQuery(m, fn)
    setMatch(m.matches)
    return stop
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

  const charmTotal = placedCharmsTotal(placed)
  const total = product.basePrice + charmTotal
  const noun = t(product.kind === 'tote' ? 'noun.tote' : product.kind === 'frame' ? 'noun.frame' : 'noun.case')

  // Price globally before arranging rows into visual sections. This preserves
  // one shared allowance even if matching styles have different browse labels.
  const pricedRows = useMemo(() => summaryRows(placed), [placed])

  // Group priced rows by browsing category (phone) or interaction type (tote).
  const grouped = useMemo(() => {
    if (product.kind !== 'tote') {
      // Group by each charm's ACTUAL category (backend-driven; includes custom
      // categories), first-seen order, labelled to match the customizer tabs.
      const order = []
      const byCat = new Map()
      for (const row of pricedRows) {
        const key = row.category
        if (!byCat.has(key)) { byCat.set(key, []); order.push(key) }
        byCat.get(key).push(row)
      }
      return order.map((key) => {
        const rows = byCat.get(key)
        return { key, label: categoryLabel(key), count: rows.reduce((sum, row) => sum + row.count, 0), rows }
      })
    }
    return [1, 2, 3]
      .map((type) => {
        const rows = pricedRows.filter((row) => row.type === type)
        return { key: type, label: TOTE_TYPE_LABEL[type], count: rows.reduce((sum, row) => sum + row.count, 0), rows }
      })
      .filter((group) => group.rows.length)
  }, [product.kind, pricedRows])

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
        gelId: color.gelId || null,
        basePrice: product.basePrice,
      },
      charms: placed.map((c) => ({
        charmId: c.charmId,
        shopifyVariantId: c.shopifyVariantId || null,
        src: c.src,
        wMm: c.baseWmm,
        hMm: c.baseHmm,
        type: c.type,
        category: c.category,
        collection: c.collection,
        name: c.name,
        price: c.price,
        bundle: !!c.bundle,
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
      zIndex={2147483600}
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
                alt={t('summary.previewAlt')}
                className="proof-img"
                style={{
                  width: 'auto',
                  height: 'auto',
                  maxHeight: 300,
                  maxWidth: '100%',
                  objectFit: 'contain',
                  filter: 'drop-shadow(0 16px 24px rgba(46,42,38,0.22))',
                }}
              />
            </div>
            {(hasFiller || hasUnique) && (
              <p className="hint preview-note" style={{ marginTop: 8 }}>
                <span className="red-key" /> {t('summary.indicative')}
                {hasFiller && t('summary.fillerNote')}
                {hasUnique && ` ${UNIQUE_NOTE}`}
              </p>
            )}
            <Button
              size="small"
              icon={<DownloadOutlined />}
              style={{ marginTop: 8 }}
              onClick={() => downloadDataUrl(previewUrl, `${product.id}-design.png`)}
            >
              {t('summary.download')}
            </Button>
          </div>
          <div className="summary-order">
            <p className="eyebrow" style={{ marginTop: 4 }}>{t('price.orderSummary')}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span>{product.name}</span>
              <span>{formatMoney(product.basePrice)}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 8 }}>{color.label}</div>
            {grouped.map((g) => (
              <div key={g.key} style={{ marginBottom: 6 }}>
                <div className="eyebrow" style={{ marginBottom: 2 }}>
                  {g.label} × {g.count}
                </div>
                {g.rows.map((r) => (
                  <div
                    key={r.key}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, color: 'var(--ink-soft)' }}
                  >
                    <span>
                      {r.name}{r.count > 1 || r.blocks ? ` × ${r.count}` : ''}
                      {r.blocks ? ` (${r.blocks} ${r.blocks === 1 ? 'block' : 'blocks'})` : ''}
                    </span>
                    <span style={{ whiteSpace: 'nowrap' }}>{formatMoney(r.price)}</span>
                  </div>
                ))}
              </div>
            ))}
            <Divider style={{ margin: '10px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span>{t('price.total')}</span>
              <span className="display" style={{ fontSize: 26 }}>{formatMoney(total)}</span>
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
              {t('cta.addToCart', { noun, price: formatMoney(total, { whole: true }) })}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

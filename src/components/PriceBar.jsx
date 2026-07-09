import { Button } from 'antd'
import { CheckCircleFilled, WarningFilled } from '@ant-design/icons'
import { MIN_CHARMS, MAX_CHARMS, REC_MIN, REC_MAX, placedCharmsTotal } from '../lib/catalog'

export default function PriceBar({ product, placed, validation, onSubmit, crossSellHint }) {
  const charmTotal = placedCharmsTotal(placed)
  const total = product.basePrice + charmTotal
  const n = placed.length
  const ok = validation.ok
  const problems = validation.problems
  const noun = product.kind === 'tote' ? 'tote' : product.kind === 'frame' ? 'frame' : 'case'

  // Why the order isn't ready yet (count first, then geometry).
  let warnLabel
  if (validation.tooFew) warnLabel = `Add at least ${MIN_CHARMS} charms`
  else if (validation.tooMany) warnLabel = `Use at most ${MAX_CHARMS} charms`
  else warnLabel = `${problems} charm${problems > 1 ? 's' : ''} need attention`

  return (
    <div className="pricebar">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
        {ok ? (
          <span className="pill pill--ok">
            <CheckCircleFilled /> Ready to order
          </span>
        ) : (
          <span className="pill pill--warn">
            <WarningFilled />
            {warnLabel}
          </span>
        )}
        <span className="hint">
          {n} charm{n === 1 ? '' : 's'}
          {n > 0 && n < REC_MIN ? ` · aim for ${REC_MIN}–${REC_MAX}` : ''}
        </span>
      </div>

      <div className="price-row" style={{ marginBottom: 4 }}>
        <span className="hint">
          {product.name} base · £{product.basePrice.toFixed(2)}
          {charmTotal > 0 && <> &nbsp;+&nbsp; charms £{charmTotal.toFixed(2)}</>}
        </span>
      </div>
      <div className="price-row" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Estimated total</span>
        <span className="total">£{total.toFixed(2)}</span>
      </div>

      <Button block type="primary" size="large" disabled={n === 0} onClick={onSubmit}>
        Add my custom {noun} to cart (£{total.toFixed(0)})
      </Button>
      {crossSellHint && <p className="cross-sell-hint">{crossSellHint}</p>}
    </div>
  )
}


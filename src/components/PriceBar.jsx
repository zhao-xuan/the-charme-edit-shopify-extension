import { Button } from 'antd'
import { CheckCircleFilled, WarningFilled, UndoOutlined } from '@ant-design/icons'

const REC_MIN = 12
const REC_MAX = 15

export default function PriceBar({ product, placed, validation, onSubmit, onClear, canUndo, onUndo }) {
  const charmTotal = placed.reduce((s, c) => s + c.price, 0)
  const total = product.basePrice + charmTotal
  const n = placed.length
  const ok = validation.ok
  const problems = validation.problems
  const noun = product.kind === 'tote' ? 'tote' : 'case'

  return (
    <div className="pricebar">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        {ok ? (
          <span className="pill pill--ok">
            <CheckCircleFilled /> Ready to order
          </span>
        ) : (
          <span className="pill pill--warn">
            <WarningFilled />
            {n === 0 ? 'Add at least one charm' : `${problems} charm${problems > 1 ? 's' : ''} need attention`}
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
      <div className="price-row" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Estimated total</span>
        <span className="total">£{total.toFixed(2)}</span>
      </div>

      <Button block type="primary" size="large" disabled={n === 0} onClick={onSubmit}>
        Order my custom {noun} (£{total.toFixed(0)})
      </Button>
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <Button block icon={<UndoOutlined />} disabled={!canUndo} onClick={onUndo}>
          Undo
        </Button>
        {n > 0 && (
          <Button block onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}


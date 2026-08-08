import { Button } from 'antd'
import { CheckCircleFilled, WarningFilled } from '@ant-design/icons'
import { MIN_CHARMS, MAX_CHARMS, REC_MIN, REC_MAX, placedCharmsTotal } from '../lib/catalog'
import { convert, formatMoney, formatPresentmentMoney } from '../lib/money'
import { t, tn } from '../lib/i18n'

export default function PriceBar({ product, placed, validation, onSubmit, crossSellHint, compact }) {
  const charmTotal = placedCharmsTotal(placed)
  const hasPresentmentCasePrice = Number(product.presentmentPrice) > 0
  const casePrice = hasPresentmentCasePrice ? Number(product.presentmentPrice) : product.basePrice
  const total = hasPresentmentCasePrice ? casePrice + convert(charmTotal) : casePrice + charmTotal
  const formatCasePrice = hasPresentmentCasePrice ? formatPresentmentMoney : formatMoney
  const formatTotal = hasPresentmentCasePrice ? formatPresentmentMoney : formatMoney
  const n = placed.length
  const ok = validation.ok
  const problems = validation.problems
  const noun = t(product.kind === 'tote' ? 'noun.tote' : product.kind === 'frame' ? 'noun.frame' : 'noun.case')

  // Keep count and placement problems visible together: a layout can be both
  // short of charms and have overlapping charms that still need fixing.
  const warnings = []
  if (validation.tooFew) warnings.push(t('price.addAtLeast', { n: MIN_CHARMS }))
  if (validation.tooMany) warnings.push(t('price.useAtMost', { n: MAX_CHARMS }))
  if (problems > 0) warnings.push(tn('price.needAttention', problems))

  return (
    <div className="pricebar">
      {/* Compact mode (enlarged charm picker): keep ONLY the add-to-cart button —
          the status pill, count, base + charms breakdown and estimated total are
          hidden to leave the maximum room to browse charms. */}
      {!compact && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
            {ok ? (
              <span className="pill pill--ok">
                <CheckCircleFilled /> {t('price.ready')}
              </span>
            ) : (
              <div className="pricebar__warnings">
                {warnings.map((warning) => (
                  <span key={warning} className="pill pill--warn">
                    <WarningFilled />
                    {warning}
                  </span>
                ))}
              </div>
            )}
            <span className="hint">
              {tn('price.charmCount', n)}
              {n > 0 && n < REC_MIN ? t('price.aimFor', { min: REC_MIN, max: REC_MAX }) : ''}
            </span>
          </div>

          <div className="price-row" style={{ marginBottom: 4 }}>
            <span className="hint">
              {t('price.base', { name: product.name, price: formatCasePrice(casePrice) })}
              {charmTotal > 0 && <> &nbsp;+&nbsp; {t('price.plusCharms', { price: formatMoney(charmTotal) })}</>}
            </span>
          </div>
          <div className="price-row" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{t('price.estimatedTotal')}</span>
            <span className="total">{formatTotal(total)}</span>
          </div>
        </>
      )}

      <Button block type="primary" size="large" disabled={n === 0} onClick={onSubmit}>
        {t('cta.addToCart', { noun, price: formatTotal(total, { whole: true }) })}
      </Button>
      {crossSellHint && !compact && <p className="cross-sell-hint">{crossSellHint}</p>}
    </div>
  )
}


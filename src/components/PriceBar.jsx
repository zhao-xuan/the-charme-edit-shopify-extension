import { Button } from 'antd'
import { CheckCircleFilled, WarningFilled } from '@ant-design/icons'
import { MIN_CHARMS, MAX_CHARMS, REC_MIN, REC_MAX, TOTE_MIN_PATCHES, placedCharmsTotal, toteDiscountRate } from '../lib/catalog'
import { convert, formatMoney, formatPresentmentMoney } from '../lib/money'
import { t, tn } from '../lib/i18n'

export default function PriceBar({ product, placed, validation, onSubmit, compact, isSecondProduct, priceNotice }) {
  const rawCharmTotal = placedCharmsTotal(placed)
  const isTote = product.kind === 'tote'
  const discountRate = isTote ? toteDiscountRate(placed.length) : 0
  const discountAmount = discountRate ? +(rawCharmTotal * discountRate).toFixed(2) : 0
  const charmTotal = +(rawCharmTotal - discountAmount).toFixed(2)
  const hasPresentmentCasePrice = Number(product.presentmentPrice) > 0
  const casePrice = hasPresentmentCasePrice ? Number(product.presentmentPrice) : product.basePrice
  const total = hasPresentmentCasePrice ? casePrice + convert(charmTotal) : casePrice + charmTotal
  const formatCasePrice = hasPresentmentCasePrice ? formatPresentmentMoney : formatMoney
  const formatTotal = hasPresentmentCasePrice ? formatPresentmentMoney : formatMoney
  const n = placed.length
  const ok = validation.ok
  const problems = validation.problems
  const noun = t(product.kind === 'tote' ? 'noun.tote' : product.kind === 'frame' ? 'noun.frame' : 'noun.case')
  const minRequired = product.kind === 'tote' ? TOTE_MIN_PATCHES : MIN_CHARMS
  const pieceNoun = t(product.kind === 'tote' ? 'patches.label' : 'charms.label').toLowerCase()

  // Keep count and placement problems visible together: a layout can be both
  // short of charms and have overlapping charms that still need fixing.
  const warnings = []
  if (validation.tooFew) warnings.push(t('price.addAtLeast', { n: minRequired, noun: pieceNoun }))
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
              {tn(isTote ? 'price.patchCount' : 'price.charmCount', n)}
              {n > 0 && n < REC_MIN ? t('price.aimFor', { min: REC_MIN, max: REC_MAX }) : ''}
            </span>
          </div>

          <div className="price-row" style={{ marginBottom: 4 }}>
            <span className="hint">
              {t('price.base', { name: product.name, price: formatCasePrice(casePrice) })}
              {rawCharmTotal > 0 && (
                <>
                  &nbsp; {t(isTote ? 'price.plusPatches' : 'price.plusCharms', { price: formatMoney(rawCharmTotal) })}
                </>
              )}
            </span>
          </div>
          {discountRate > 0 && (
            <div className="price-row" style={{ marginBottom: 4 }}>
              <span className="hint" style={{ color: 'var(--accent, #b35b5b)' }}>
                {t('price.patchDiscount', { pct: Math.round(discountRate * 100) })}
              </span>
              <span style={{ color: 'var(--accent, #b35b5b)' }}>
                −{formatMoney(discountAmount)}
              </span>
            </div>
          )}
          <div className="price-row" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{t('price.estimatedTotal')}</span>
            <span className="total">{formatTotal(total)}</span>
          </div>
        </>
      )}

      {compact && !ok && <div className="pricebar__warnings" role="status">{warnings.join(' · ')}</div>}
      {priceNotice && <p className="hint" role="status">{priceNotice}</p>}
      <Button block type="primary" size="large" disabled={!ok} onClick={onSubmit}>
        {isSecondProduct
          ? t('cta.addSecondProduct', { price: formatTotal(total, { whole: true }) })
          : t('cta.addToCart', { noun, price: formatTotal(total, { whole: true }) })}
      </Button>
    </div>
  )
}


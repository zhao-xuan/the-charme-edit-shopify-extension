import { Select, Space } from 'antd'
import { AppleFilled, AndroidFilled, ShoppingOutlined, PictureOutlined } from '@ant-design/icons'
import { productGroups, hasCaseImage, productsByAvailability } from '../data/products'
import { formatMoney, formatPresentmentMoney } from '../lib/money'
import { t } from '../lib/i18n'

// Representative icon per base platform, shown on the Step 1 selector cards.
const BASE_ICONS = {
  apple: <AppleFilled />,
  android: <AndroidFilled />,
  tote: <ShoppingOutlined />,
  frame: <PictureOutlined />,
}

const swatch = (c) => ({
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: c.shell,
  border: '1px solid rgba(0,0,0,0.15)',
  display: 'inline-block',
  boxShadow: c.glitter ? 'inset 0 0 4px rgba(191,161,95,0.9)' : 'none',
})

const toOption = (p) => ({
  value: p.id,
  name: p.name,
  price: p.basePrice,
  kind: p.kind,
  label: p.name,
  disabled: !hasCaseImage(p),
})

/**
 * Build the model dropdown options for a platform group. Android launch models
 * are listed first; every unavailable model follows in one disabled section.
 */
function buildOptions(group) {
  if (group.platform === 'android') {
    const { available, comingSoon } = productsByAvailability(group.products)
    return [
      { label: t('picker.availableNow'), options: available.map(toOption) },
      { label: t('picker.comingSoon'), options: comingSoon.map(toOption) },
    ].filter((section) => section.options.length)
  }
  return group.products.map(toOption)
}

function ColourGroup({ title, colours, value, onChange }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p className="eyebrow">{title}</p>
      <Space wrap size={[8, 8]}>
        {colours.map((c) => {
          const active = c.id === value
          return (
            <button
              key={c.id}
              disabled={c.disabled}
              onClick={() => onChange(c.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 999,
                cursor: c.disabled ? 'not-allowed' : 'pointer',
                opacity: c.disabled ? 0.38 : 1,
                filter: c.disabled ? 'grayscale(1)' : 'none',
                background: active ? '#fff' : 'transparent',
                border: `1.5px solid ${active ? 'var(--rouge)' : 'var(--line)'}`,
              }}
            >
              <span style={swatch(c)} />
              <span style={{ fontSize: 12 }}>{c.label}</span>
            </button>
          )
        })}
      </Space>
    </div>
  )
}

export default function ProductPicker({
  groupKey,
  productId,
  caseColourId,
  gelColourId,
  onGroupChange,
  onProductChange,
  onCaseColourChange,
  onGelColourChange,
  presentmentPrice,
}) {
  const PRODUCT_GROUPS = productGroups()
  const group = PRODUCT_GROUPS.find((g) => g.key === groupKey) || PRODUCT_GROUPS[0]
  const product = group.products.find((p) => p.id === productId) || group.products[0]

  const caseColours = product.caseColours || product.colors
  const gelColours = product.gelColours

  const options = buildOptions(group)
  const formatProductPrice = (candidate) =>
    candidate.kind === 'phone' && Number(presentmentPrice) > 0
      ? formatPresentmentMoney(presentmentPrice, { whole: true })
      : formatMoney(candidate.price ?? candidate.basePrice, { whole: true })

  return (
    <div>
      <p className="eyebrow">{t('picker.step1')}</p>
      <div className="base-grid">
        {PRODUCT_GROUPS.filter((g) => g.key !== 'tote').map((g) => (
          <button
            key={g.key}
            type="button"
            className={`base-card${g.key === groupKey ? ' is-active' : ''}`}
            onClick={() => onGroupChange(g.key)}
          >
            <span className="base-card__icon">{BASE_ICONS[g.key] || <ShoppingOutlined />}</span>
            <span className="base-card__label">{g.label}</span>
          </button>
        ))}
      </div>

      <Select
        value={productId}
        onChange={onProductChange}
        showSearch
        filterOption={(input, option) =>
          `${option?.name || ''} ${option?.label || ''}`.toLowerCase().includes(input.trim().toLowerCase())
        }
        placeholder="Search phone models"
        size="large"
        style={{ width: '100%', marginBottom: 18 }}
        popupMatchSelectWidth
        listHeight={360}
        options={options}
        labelRender={({ value }) => {
          const p = group.products.find((x) => x.id === value) || product
          return (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <strong>{p.name}</strong>
              <span style={{ fontSize: 17 }}>{formatProductPrice(p)}</span>
            </span>
          )
        }}
        optionRender={(opt) => (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            color: opt.data.disabled ? 'var(--muted)' : 'inherit',
            filter: opt.data.disabled ? 'grayscale(1)' : 'none',
          }}>
            <strong>{opt.data.name}</strong>
            <span style={{ fontSize: opt.data.disabled ? 14 : 18 }}>
              {opt.data.disabled ? t('picker.comingSoon') : formatProductPrice(opt.data)}
            </span>
          </div>
        )}
      />

      {gelColours ? (
        <ColourGroup
          title={t('picker.gelColour')}
          colours={gelColours}
          value={gelColourId}
          onChange={onGelColourChange}
        />
      ) : (
        <ColourGroup
          title={t('picker.colour')}
          colours={caseColours}
          value={caseColourId}
          onChange={onCaseColourChange}
        />
      )}
    </div>
  )
}


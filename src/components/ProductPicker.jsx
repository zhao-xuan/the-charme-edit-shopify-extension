import { Select, Space } from 'antd'
import { AppleFilled, AndroidFilled, ShoppingOutlined, PictureOutlined } from '@ant-design/icons'
import { PRODUCT_GROUPS, BRAND_LABELS } from '../data/products'

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
  label: `${p.name} · £${p.basePrice}`,
})

/**
 * Build the model dropdown options for a platform group. Android is sub-grouped
 * by brand (Samsung / Xiaomi / Huawei) using Select option groups; Apple & Totes
 * are a flat list.
 */
function buildOptions(group) {
  if (group.platform === 'android') {
    const byBrand = new Map()
    for (const p of group.products) {
      if (!byBrand.has(p.brand)) byBrand.set(p.brand, [])
      byBrand.get(p.brand).push(p)
    }
    return Array.from(byBrand, ([brand, items]) => ({
      label: BRAND_LABELS[brand] || brand,
      title: BRAND_LABELS[brand] || brand,
      options: items.map(toOption),
    }))
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
              onClick={() => onChange(c.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 999,
                cursor: 'pointer',
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
}) {
  const group = PRODUCT_GROUPS.find((g) => g.key === groupKey) || PRODUCT_GROUPS[0]
  const product = group.products.find((p) => p.id === productId) || group.products[0]

  const caseColours = product.caseColours || product.colors
  const gelColours = product.gelColours

  const options = buildOptions(group)

  return (
    <div>
      <p className="eyebrow">Step 1 · Choose your base</p>
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
        size="large"
        showSearch
        optionFilterProp="name"
        filterOption={(input, option) =>
          option?.name ? option.name.toLowerCase().includes(input.toLowerCase()) : false
        }
        style={{ width: '100%', marginBottom: 18 }}
        popupMatchSelectWidth
        listHeight={360}
        options={options}
        labelRender={({ value }) => {
          const p = group.products.find((x) => x.id === value) || product
          return (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <strong>{p.name}</strong>
              <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17 }}>£{p.basePrice}</span>
            </span>
          )
        }}
        optionRender={(opt) => (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <strong>{opt.data.name}</strong>
            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18 }}>
              £{opt.data.price}
            </span>
          </div>
        )}
      />

      {gelColours ? (
        <>
          {/* Integrated-gel models bake the gel onto the case, so the gel colour
              alone drives the finish — the separate case-colour control would be
              redundant and is hidden for them. */}
          {!product.gelRender && (
            <ColourGroup
              title="Case colour"
              colours={caseColours}
              value={caseColourId}
              onChange={onCaseColourChange}
            />
          )}
          <ColourGroup
            title="Gel colour"
            colours={gelColours}
            value={gelColourId}
            onChange={onGelColourChange}
          />
        </>
      ) : (
        <ColourGroup
          title="Colour"
          colours={caseColours}
          value={caseColourId}
          onChange={onCaseColourChange}
        />
      )}
    </div>
  )
}


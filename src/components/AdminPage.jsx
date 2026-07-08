import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Divider,
  Empty,
  Image,
  Input,
  InputNumber,
  Select,
  Slider,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Upload,
} from 'antd'
import {
  AppstoreAddOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  ScissorOutlined,
  ShopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import charmData from '../data/catalog.json'
import { ALL_PRODUCTS } from '../data/products'
import { charmCategory, MAX_CHARMS } from '../lib/catalog'
import { resolveAsset } from '../lib/assets'
import { loadAdmin, saveAdmin } from '../lib/adminStore'
import { extractPieces, loadImageData } from '../lib/segment'
import {
  addCharms,
  addProduct,
  deleteCharm,
  deleteProduct,
  fetchCatalog,
  getToken,
  isShopifyEmbedded,
  patchCharm,
  setToken,
} from '../lib/adminApi'

const slug = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'item'
const rid = () => Math.random().toString(36).slice(2, 7)

const CAT_OPTS = [
  { value: 'gold', label: 'Gold' },
  { value: 'silver', label: 'Silver' },
  { value: 'colourful', label: 'Colourful' },
  { value: 'unique', label: 'Natural' },
]
const TIER_OPTS = [
  { value: 'grande', label: 'Statement · Grande (fixed)', type: 1, price: 3 },
  { value: 'midi', label: 'Feature · Midi', type: 2, price: 2 },
  { value: 'mini', label: 'Filler · Mini (scatter)', type: 3, price: 2 },
]

/** Read a file, downscale to <=900px, and return a PNG data URL + dimensions. */
function readImageFile(file, maxDim = 900) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new window.Image()
      img.onload = () => {
        const ratio = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * ratio))
        const h = Math.max(1, Math.round(img.height * ratio))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve({ src: canvas.toDataURL('image/png'), w, h })
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Drop zone that yields a downscaled PNG data URL + natural dimensions. */
function ImageDrop({ value, onChange, hint, maxDim = 900 }) {
  const { message } = App.useApp()
  return (
    <Upload.Dragger
      accept="image/*"
      multiple={false}
      showUploadList={false}
      beforeUpload={async (file) => {
        try {
          const out = await readImageFile(file, maxDim)
          onChange(out)
        } catch {
          message.error('Could not read that image.')
        }
        return false
      }}
      style={{ padding: 4 }}
    >
      {value?.src ? (
        <img
          src={value.src}
          alt=""
          style={{ maxHeight: 120, maxWidth: '100%', objectFit: 'contain' }}
        />
      ) : (
        <p style={{ margin: 0, padding: '14px 8px' }}>
          <InboxOutlined style={{ fontSize: 22, color: 'var(--rouge)' }} />
          <br />
          {hint || 'Click or drop an image (PNG with transparency preferred)'}
        </p>
      )}
    </Upload.Dragger>
  )
}

// ---------------------------------------------------------------------------
// Visual Size studio — stand a piece on a real product (iPhone / tote / …) and
// drag a slider to size it. The scale (1 = catalogue default) is saved to
// draft.charmSizes[id] and applied to the piece's real-world mm size at
// storefront load (lib/catalog.js), so every placed piece renders at this size.
// ---------------------------------------------------------------------------
const SIZE_MIN = 0.5
const SIZE_MAX = 2
const STAGE_MAX_W = 320
const STAGE_MAX_H = 380
const STAGE_PAD = 16

/** Best available background image for a product (any finish). */
function productImage(product) {
  const img = product?.blankImage || {}
  return img.white || img.default || img.natural || img.black || Object.values(img)[0] || null
}

function SizeStudioTab({ draft, set, charm }) {
  const { message } = App.useApp()

  const products = ALL_PRODUCTS
  const [productId, setProductId] = useState('iphone-16-pro-max')
  const product = useMemo(
    () => products.find((p) => p.id === productId) || products[0],
    [products, productId],
  )

  const savedScale = (charm && draft.charmSizes?.[charm.id]) || 1
  const [scale, setScale] = useState(savedScale)
  // Load the selected piece's saved scale whenever the piece changes.
  useEffect(() => {
    setScale((charm && draft.charmSizes?.[charm.id]) || 1)
  }, [charm?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fit the whole product into the stage; the SAME mm→px scale sizes the piece,
  // so it appears at its true real-world proportion on the product.
  const fit = Math.min(
    (STAGE_MAX_W - STAGE_PAD * 2) / product.widthMm,
    (STAGE_MAX_H - STAGE_PAD * 2) / product.heightMm,
  )
  const wPx = product.widthMm * fit
  const hPx = product.heightMm * fit
  const baseW = Number(charm?.widthMm) || 10
  const baseH = Number(charm?.heightMm) || 10
  const cw = baseW * fit * scale
  const ch = baseH * fit * scale
  const bg = resolveAsset(productImage(product))
  const charmSrc = charm ? resolveAsset(charm.src) : null
  const cat = charm ? charm.category || charmCategory(charm) : null
  const dirty = charm && +scale.toFixed(3) !== +savedScale.toFixed(3)

  const save = () => {
    if (!charm) return
    const charmSizes = { ...(draft.charmSizes || {}) }
    if (scale === 1) delete charmSizes[charm.id]
    else charmSizes[charm.id] = +scale.toFixed(3)
    const next = { ...draft, charmSizes }
    set(next)
    saveAdmin(next)
    message.success(
      `Saved “${charm.name}” at ${Math.round(scale * 100)}% (${(baseW * scale).toFixed(1)}×${(baseH * scale).toFixed(1)} mm).`,
    )
  }

  return (
    <Card size="small" title="Size studio" style={{ position: 'sticky', top: 8 }}>
      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ display: 'block', marginBottom: 4, color: 'var(--ink-soft)' }}>Base product</span>
        <Select
          value={productId}
          onChange={setProductId}
          showSearch
          optionFilterProp="label"
          options={products.map((p) => ({ value: p.id, label: p.name }))}
          style={{ width: '100%' }}
        />
      </label>

      {!charm ? (
        <Empty
          style={{ margin: '24px 0' }}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Select a charm on the left to size it against this product"
        />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <img
              src={charmSrc}
              alt=""
              style={{ width: 40, height: 40, objectFit: 'contain', background: '#faf7f2', borderRadius: 8, padding: 4 }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>{charm.name}</div>
              {cat && <Tag style={{ marginTop: 2 }}>{cat}</Tag>}
            </div>
          </div>

          <div
            style={{
              position: 'relative',
              width: wPx + STAGE_PAD * 2,
              height: hPx + STAGE_PAD * 2,
              margin: '0 auto 6px',
              background: '#faf7f2',
              borderRadius: 12,
            }}
          >
            <div style={{ position: 'absolute', left: STAGE_PAD, top: STAGE_PAD, width: wPx, height: hPx }}>
              {bg ? (
                <img
                  src={bg}
                  alt={product.name}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <div style={{ position: 'absolute', inset: 0, background: '#efe7d8', borderRadius: 10 }} />
              )}
              {charmSrc && (
                <img
                  src={charmSrc}
                  alt={charm.name}
                  style={{
                    position: 'absolute',
                    width: cw,
                    height: ch,
                    left: wPx / 2 - cw / 2,
                    top: hPx * 0.56 - ch / 2,
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.28))',
                    transition: 'width .06s linear, height .06s linear, left .06s linear, top .06s linear',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--rouge)' }}>{Math.round(scale * 100)}%</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink-soft)' }}>
              {(baseW * scale).toFixed(1)} × {(baseH * scale).toFixed(1)} mm
            </span>
          </div>
          <Slider
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={0.05}
            value={scale}
            onChange={setScale}
            tooltip={{ formatter: (v) => `${Math.round(v * 100)}%` }}
          />
          <div className="hint" style={{ marginBottom: 12 }}>
            Catalogue default: {baseW}×{baseH} mm (100%).
          </div>
          <Space>
            <Button type="primary" icon={<SaveOutlined />} onClick={save} disabled={!dirty}>
              Save size
            </Button>
            <Button onClick={() => setScale(1)} disabled={scale === 1}>
              Reset
            </Button>
          </Space>
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Custom charms
// ---------------------------------------------------------------------------
function CharmsTab({ draft, set, cloud }) {
  const { message } = App.useApp()
  const [form, setForm] = useState({
    name: '',
    category: 'gold',
    tier: 'midi',
    price: 2,
    widthMm: 16,
    image: null,
    bundle: false,
    bundleMax: 8,
  })
  const [query, setQuery] = useState('')

  const addCharm = () => {
    if (!form.name.trim()) return message.warning('Give the charm a name.')
    if (!form.image?.src) return message.warning('Upload the charm artwork.')
    const tier = TIER_OPTS.find((t) => t.value === form.tier)
    const widthMm = Number(form.widthMm) || 16
    const heightMm = +(widthMm * (form.image.h / form.image.w)).toFixed(1)
    const bundle = !!form.bundle
    const charm = {
      id: `custom-charm-${slug(form.name)}-${rid()}`,
      name: form.name.trim(),
      collection: 'Custom',
      category: form.category,
      tier: tier.value,
      type: tier.type,
      price: Number(form.price) || 0,
      src: form.image.src,
      pxW: form.image.w,
      pxH: form.image.h,
      widthMm,
      heightMm,
      minScale: 1,
      maxScale: 1,
      // Flat-price bundle: customers may pick up to `bundleMax` of this charm for
      // the single `price` above (e.g. little stones). Off → priced per piece.
      bundle,
      bundleMax: bundle ? Math.max(1, Math.min(MAX_CHARMS, Number(form.bundleMax) || 1)) : null,
    }
    set((d) => ({ ...d, customCharms: [charm, ...(d.customCharms || [])] }))
    setForm({ name: '', category: 'gold', tier: 'midi', price: 2, widthMm: 16, image: null, bundle: false, bundleMax: 8 })
    message.success('Charm added — Save changes to publish.')
  }

  // Every charm the merchant can size / re-price / hide: their Shopify-published
  // charms FIRST (370+ once migrated), then any built-in catalogue charm not
  // already in Shopify — deduped by id, filtered by the search box. No cap.
  const baseRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const seen = new Set()
    const all = [...(cloud?.data.charms || []), ...charmData.charms].filter(
      (c) => !seen.has(c.id) && seen.add(c.id),
    )
    return all
      .filter((c) => !q || (c.name || '').toLowerCase().includes(q))
      .map((c) => ({ ...c, category: c.category || charmCategory(c) }))
  }, [query, cloud?.data.charms])

  // Selecting a charm row (in any of the tables below) drives the Size studio
  // panel on the right. Resolve the chosen charm across every source.
  const [selectedCharmId, setSelectedCharmId] = useState(null)
  const selectedCharm = useMemo(() => {
    const src = [...(draft.customCharms || []), ...(cloud?.data.charms || []), ...charmData.charms]
    return src.find((c) => c.id === selectedCharmId) || null
  }, [selectedCharmId, draft.customCharms, cloud])
  const pickRow = (r) => ({ onClick: () => setSelectedCharmId(r.id) })
  const rowCls = (r) => (r.id === selectedCharmId ? 'admin-pick-row is-selected' : 'admin-pick-row')

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <style>{`.admin-pick-row{cursor:pointer}.admin-pick-row.is-selected>td{background:rgba(179,91,91,.10)!important}`}</style>

      {/* Left column — the catalogue list to pick a charm from. */}
      <Space direction="vertical" size={18} style={{ flex: '1 1 520px', minWidth: 0 }}>
        <Card size="small" title={`Charms — re-price, hide or size (${baseRows.length})`}>
          <Input.Search
            allowClear
            placeholder="Search charms by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 360, marginBottom: 12 }}
          />
          <Table
            size="small"
            rowKey="id"
            onRow={pickRow}
            rowClassName={rowCls}
            pagination={{ pageSize: 20, size: 'small', showSizeChanger: true, pageSizeOptions: [20, 50, 100] }}
            dataSource={baseRows}
            columns={[
              { title: 'Art', width: 52, render: (_, r) => <Image src={resolveAsset(r.src)} width={34} height={34} style={{ objectFit: 'contain' }} /> },
              { title: 'Name', dataIndex: 'name', ellipsis: true },
              { title: 'Category', dataIndex: 'category', width: 110, render: (c) => <Tag>{c}</Tag> },
              {
                title: 'Price (£)',
                width: 120,
                render: (_, r) => (
                  <InputNumber
                    size="small"
                    min={0}
                    value={draft.charmPrices[r.id] ?? r.price}
                    onChange={(v) =>
                      set((d) => ({ ...d, charmPrices: { ...d.charmPrices, [r.id]: v } }))
                    }
                    style={{ width: 84 }}
                  />
                ),
              },
              {
                title: 'Hidden',
                width: 90,
                render: (_, r) => (
                  <Switch
                    size="small"
                    checked={!!draft.charmHidden[r.id]}
                    onChange={(on) =>
                      set((d) => {
                        const charmHidden = { ...d.charmHidden }
                        if (on) charmHidden[r.id] = true
                        else delete charmHidden[r.id]
                        return { ...d, charmHidden }
                      })
                    }
                  />
                ),
              },
            ]}
          />
        </Card>
      </Space>

      {/* Right column — size the selected charm + add a charm. */}
      <div style={{ flex: '1 1 360px', minWidth: 300, maxWidth: 460 }}>
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <SizeStudioTab draft={draft} set={set} charm={selectedCharm} />

          <Card size="small" title="Add a custom charm">
            <div className="admin-grid">
              <label>
                <span>Name</span>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Strawberry enamel"
                />
              </label>
              <label>
                <span>Category</span>
                <Select
                  value={form.category}
                  onChange={(v) => setForm((f) => ({ ...f, category: v }))}
                  options={CAT_OPTS}
                  style={{ width: '100%' }}
                />
              </label>
              <label>
                <span>Size tier</span>
                <Select
                  value={form.tier}
                  onChange={(v) => {
                    const t = TIER_OPTS.find((x) => x.value === v)
                    setForm((f) => ({ ...f, tier: v, price: t.price }))
                  }}
                  options={TIER_OPTS}
                  style={{ width: '100%' }}
                />
              </label>
              <label>
                <span>Price (£)</span>
                <InputNumber
                  min={0}
                  value={form.price}
                  onChange={(v) => setForm((f) => ({ ...f, price: v }))}
                  style={{ width: '100%' }}
                />
              </label>
              <label>
                <span>Real width (mm)</span>
                <InputNumber
                  min={2}
                  value={form.widthMm}
                  onChange={(v) => setForm((f) => ({ ...f, widthMm: v }))}
                  style={{ width: '100%' }}
                />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                <span>Artwork (transparent cut-out)</span>
                <ImageDrop value={form.image} onChange={(image) => setForm((f) => ({ ...f, image }))} />
              </label>
              <label className="admin-check" style={{ gridColumn: '1 / -1' }}>
                <Checkbox
                  checked={form.bundle}
                  onChange={(e) => setForm((f) => ({ ...f, bundle: e.target.checked }))}
                >
                  Flat price — customers can pick several of this charm for the same price (e.g. little stones)
                </Checkbox>
              </label>
              {form.bundle && (
                <label>
                  <span>Max picks for the price</span>
                  <InputNumber
                    min={1}
                    max={MAX_CHARMS}
                    value={form.bundleMax}
                    onChange={(v) => setForm((f) => ({ ...f, bundleMax: v }))}
                    style={{ width: '100%' }}
                  />
                </label>
              )}
            </div>
            <p className="hint" style={{ margin: '10px 0 0' }}>
              {form.bundle
                ? `Customers pay £${Number(form.price) || 0} once and may add up to ${form.bundleMax || 1} of this charm.`
                : 'Priced per piece — each one added is charged separately.'}
            </p>
            <Button type="primary" icon={<PlusOutlined />} onClick={addCharm} style={{ marginTop: 12 }}>
              Add charm
            </Button>
          </Card>
        </Space>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
function ProductsTab({ draft, set, cloud }) {
  const { message } = App.useApp()
  const [form, setForm] = useState({
    name: '',
    kind: 'phone',
    basePrice: 26,
    widthMm: 75,
    image: null,
  })
  const [query, setQuery] = useState('')

  const heightMm = form.image ? +(form.widthMm * (form.image.h / form.image.w)).toFixed(1) : null

  const addProduct = () => {
    if (!form.name.trim()) return message.warning('Give the product a name.')
    if (!form.image?.src) return message.warning('Upload the product body photo.')
    const product = {
      id: `custom-prod-${slug(form.name)}-${rid()}`,
      name: form.name.trim(),
      kind: form.kind,
      basePrice: Number(form.basePrice) || 0,
      widthMm: Number(form.widthMm) || 75,
      heightMm,
      src: form.image.src,
      colourLabel: 'Default',
    }
    set((d) => ({ ...d, customProducts: [product, ...(d.customProducts || [])] }))
    setForm({ name: '', kind: 'phone', basePrice: 26, widthMm: 75, image: null })
    message.success('Product added — Save changes to publish.')
  }

  const removeProduct = (id) =>
    set((d) => ({ ...d, customProducts: d.customProducts.filter((p) => p.id !== id) }))

  const baseRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ALL_PRODUCTS.filter((p) => !p.custom).filter(
      (p) => !q || p.name.toLowerCase().includes(q),
    )
  }, [query])

  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <Card size="small" title="Add a custom product">
        <div className="admin-grid">
          <label>
            <span>Name</span>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. MagSafe Wallet"
            />
          </label>
          <label>
            <span>Decoration set</span>
            <Select
              value={form.kind}
              onChange={(v) => setForm((f) => ({ ...f, kind: v }))}
              options={[
                { value: 'phone', label: 'Charms' },
                { value: 'tote', label: 'Patches' },
              ]}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            <span>Base price (£)</span>
            <InputNumber
              min={0}
              value={form.basePrice}
              onChange={(v) => setForm((f) => ({ ...f, basePrice: v }))}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            <span>Real width (mm)</span>
            <InputNumber
              min={10}
              value={form.widthMm}
              onChange={(v) => setForm((f) => ({ ...f, widthMm: v }))}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            <span>Height (auto from photo)</span>
            <Input value={heightMm ? `${heightMm} mm` : '—'} disabled />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span>Product body photo</span>
            <ImageDrop
              value={form.image}
              onChange={(image) => setForm((f) => ({ ...f, image }))}
              hint="Click or drop the product photo on a clean background"
            />
          </label>
        </div>
        <Button
          type="primary"
          icon={<AppstoreAddOutlined />}
          onClick={addProduct}
          style={{ marginTop: 12 }}
        >
          Add product
        </Button>
      </Card>

      <Card
        size="small"
        title={`Live products on Shopify (${cloud?.data.products.length || 0})`}
        extra={<Button size="small" icon={<ReloadOutlined />} onClick={cloud?.refresh} loading={cloud?.loading}>Refresh</Button>}
      >
        {cloud?.data.products.length ? (
          <Table
            size="small" rowKey="id" pagination={false} dataSource={cloud.data.products}
            columns={[
              { title: 'Photo', dataIndex: 'src', width: 64, render: (s) => <Image src={s} width={40} height={40} style={{ objectFit: 'contain' }} /> },
              { title: 'Name', dataIndex: 'name', ellipsis: true },
              { title: 'Type', dataIndex: 'kind', width: 90, render: (k) => <Tag>{k === 'tote' ? 'Patches' : 'Charms'}</Tag> },
              { title: 'Size', width: 120, render: (_, r) => `${r.widthMm}×${r.heightMm} mm` },
              { title: 'Price', dataIndex: 'basePrice', width: 80, render: (p) => `£${p}` },
              { title: '', width: 48, render: (_, r) => <Button type="text" danger icon={<DeleteOutlined />} onClick={() => cloud.removeProduct(r)} /> },
            ]}
          />
        ) : (
          <Empty description="No products published to Shopify yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Card>

      <Card size="small" title={`Your custom products (${draft.customProducts?.length || 0})`}>
        {draft.customProducts?.length ? (
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={draft.customProducts}
            columns={[
              {
                title: 'Photo',
                dataIndex: 'src',
                width: 64,
                render: (src) => <Image src={src} width={40} height={40} style={{ objectFit: 'contain' }} />,
              },
              { title: 'Name', dataIndex: 'name' },
              {
                title: 'Type',
                dataIndex: 'kind',
                render: (k) => <Tag>{k === 'tote' ? 'Patches' : 'Charms'}</Tag>,
              },
              { title: 'Size', render: (_, r) => `${r.widthMm}×${r.heightMm} mm` },
              { title: 'Price', dataIndex: 'basePrice', render: (p) => `£${p}` },
              {
                title: '',
                width: 48,
                render: (_, r) => (
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeProduct(r.id)}
                  />
                ),
              },
            ]}
          />
        ) : (
          <Empty description="No custom products yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Card>

      <Card size="small" title="Re-price catalogue models">
        <Input.Search
          allowClear
          placeholder="Search models…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 360, marginBottom: 12 }}
        />
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 10, size: 'small' }}
          dataSource={baseRows}
          columns={[
            { title: 'Model', dataIndex: 'name', ellipsis: true },
            { title: 'Kind', dataIndex: 'kind', width: 90, render: (k) => <Tag>{k}</Tag> },
            {
              title: 'Base price (£)',
              width: 140,
              render: (_, r) => (
                <InputNumber
                  size="small"
                  min={0}
                  value={draft.productPrices[r.id] ?? r.basePrice}
                  onChange={(v) =>
                    set((d) => ({ ...d, productPrices: { ...d.productPrices, [r.id]: v } }))
                  }
                  style={{ width: 96 }}
                />
              ),
            },
          ]}
        />
      </Card>
    </Space>
  )
}

// ---------------------------------------------------------------------------
// Batch extract — auto-cut many charms from one product photo + auto-size them
// ---------------------------------------------------------------------------
function BatchExtractTab({ draft, set }) {
  const { message } = App.useApp()
  const [photo, setPhoto] = useState(null) // group shot: charms laid on the product
  const [body, setBody] = useState(null) // blank product body (becomes the product)
  const [form, setForm] = useState({
    productName: '',
    kind: 'phone',
    widthMm: 81,
    heightMm: 167,
    category: 'gold',
    makeProduct: true,
  })
  const [tune, setTune] = useState({ pieceTol: 58, minPieceMm: 5, warmOnly: false })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { overlay, mmPerPx, product }
  const [pieces, setPieces] = useState([]) // editable extracted pieces
  const runSeq = useRef(0)

  // Derive product height from the body image aspect when one is supplied.
  const onBody = (img) => {
    setBody(img)
    if (img) setForm((f) => ({ ...f, heightMm: +(f.widthMm * (img.h / img.w)).toFixed(0) }))
  }

  const detect = async () => {
    if (!photo?.src) return message.warning('Upload the charms-on-product photo first.')
    const widthMm = Number(form.widthMm) || 0
    const heightMm = Number(form.heightMm) || 0
    if (!widthMm || !heightMm) return message.warning('Enter the product width and height in mm.')
    const seq = ++runSeq.current
    setBusy(true)
    try {
      const imageData = await loadImageData(photo.src, 1200)
      const out = extractPieces(imageData, {
        productLongMm: Math.max(widthMm, heightMm),
        pieceTol: tune.pieceTol,
        minPieceMm: tune.minPieceMm,
        warmOnly: tune.warmOnly,
      })
      if (seq !== runSeq.current) return // a newer run superseded this one
      setResult({ overlay: out.overlay, mmPerPx: out.mmPerPx, product: out.product })
      setPieces(
        out.pieces.map((p, i) => ({
          ...p,
          include: true,
          name: `${form.productName.trim() || 'Charm'} ${i + 1}`,
          category: form.category,
        })),
      )
      if (!out.pieces.length) message.info('No pieces detected — try raising piece sensitivity or lowering the min size.')
      else message.success(`Detected ${out.pieces.length} pieces.`)
    } catch (e) {
      message.error('Could not process that photo.')
    } finally {
      if (seq === runSeq.current) setBusy(false)
    }
  }

  const patchPiece = (idx, patch) =>
    setPieces((ps) => ps.map((p, i) => (i === idx ? { ...p, ...patch } : p)))

  const selected = pieces.filter((p) => p.include)

  const commit = () => {
    if (form.makeProduct && !body?.src) return message.warning('Upload the product body photo, or turn off “Also add the product”.')
    if (!selected.length) return message.warning('Select at least one detected piece.')
    const widthMm = Number(form.widthMm) || 81
    const heightMm = Number(form.heightMm) || 167
    const charms = selected.map((p) => ({
      id: `custom-charm-${slug(p.name)}-${rid()}`,
      name: p.name.trim() || 'Charm',
      collection: form.productName.trim() ? `${form.productName.trim()} set` : 'Custom',
      category: p.category,
      tier: p.tier,
      type: p.type,
      price: Number(p.price) || 0,
      src: p.dataUrl,
      pxW: p.pxW,
      pxH: p.pxH,
      widthMm: p.widthMm,
      heightMm: p.heightMm,
      minScale: 1,
      maxScale: 1,
    }))
    set((d) => {
      const next = { ...d, customCharms: [...charms, ...(d.customCharms || [])] }
      if (form.makeProduct && body?.src) {
        const product = {
          id: `custom-prod-${slug(form.productName || 'product')}-${rid()}`,
          name: form.productName.trim() || 'Custom product',
          kind: form.kind,
          basePrice: 26,
          widthMm,
          heightMm,
          src: body.src,
          colourLabel: 'Default',
        }
        next.customProducts = [product, ...(d.customProducts || [])]
      }
      return next
    })
    message.success(
      `Added ${charms.length} charm${charms.length > 1 ? 's' : ''}${form.makeProduct ? ' + 1 product' : ''} — Save changes to publish.`,
    )
    setPieces([])
    setResult(null)
    setPhoto(null)
  }

  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="Auto-extract charms from one photo"
        description="Lay the real charms on the product (like a phone case) and photograph them on a clean, contrasting surface. Upload that photo, tell us the product's real size, and the studio cuts out every piece and works out its true size — no manual cropping."
      />

      <Card size="small" title="1 · Photos & product size">
        <div className="admin-grid">
          <label>
            <span>Charms-on-product photo</span>
            <ImageDrop
              value={photo}
              onChange={setPhoto}
              maxDim={1600}
              hint="Click or drop the photo of charms laid on the product"
            />
          </label>
          <label>
            <span>Product body photo (blank)</span>
            <ImageDrop
              value={body}
              onChange={onBody}
              maxDim={1200}
              hint="Click or drop the bare product photo"
            />
          </label>
          <label>
            <span>Product name</span>
            <Input
              value={form.productName}
              onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))}
              placeholder="e.g. Cottagecore set"
            />
          </label>
          <label>
            <span>Decoration set</span>
            <Select
              value={form.kind}
              onChange={(v) => setForm((f) => ({ ...f, kind: v }))}
              options={[
                { value: 'phone', label: 'Charms' },
                { value: 'tote', label: 'Patches' },
              ]}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            <span>Product real width (mm)</span>
            <InputNumber
              min={10}
              value={form.widthMm}
              onChange={(v) => setForm((f) => ({ ...f, widthMm: v }))}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            <span>Product real height (mm)</span>
            <InputNumber
              min={10}
              value={form.heightMm}
              onChange={(v) => setForm((f) => ({ ...f, heightMm: v }))}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            <span>Default charm category</span>
            <Select
              value={form.category}
              onChange={(v) => setForm((f) => ({ ...f, category: v }))}
              options={CAT_OPTS}
              style={{ width: '100%' }}
            />
          </label>
          <label className="admin-check">
            <Checkbox
              checked={form.makeProduct}
              onChange={(e) => setForm((f) => ({ ...f, makeProduct: e.target.checked }))}
            >
              Also add the product (from the body photo)
            </Checkbox>
          </label>
        </div>

        <Divider style={{ margin: '14px 0' }} />
        <p className="eyebrow" style={{ marginBottom: 10 }}>Detection tuning</p>
        <div className="admin-tune">
          <label>
            <span>Piece sensitivity ({tune.pieceTol})</span>
            <Slider min={25} max={110} value={tune.pieceTol} onChange={(v) => setTune((t) => ({ ...t, pieceTol: v }))} />
          </label>
          <label>
            <span>Min piece size ({tune.minPieceMm} mm)</span>
            <Slider min={2} max={20} value={tune.minPieceMm} onChange={(v) => setTune((t) => ({ ...t, minPieceMm: v }))} />
          </label>
          <label className="admin-check">
            <Checkbox checked={tune.warmOnly} onChange={(e) => setTune((t) => ({ ...t, warmOnly: e.target.checked }))}>
              Metallic only (reject non-gold/silver specks)
            </Checkbox>
          </label>
        </div>
        <Button
          type="primary"
          icon={<ScissorOutlined />}
          loading={busy}
          onClick={detect}
          style={{ marginTop: 14 }}
        >
          Detect & cut pieces
        </Button>
      </Card>

      {result && (
        <Card
          size="small"
          title={`2 · Review (${selected.length}/${pieces.length} selected · ${result.mmPerPx.toFixed(3)} mm/px)`}
        >
          <Spin spinning={busy}>
            <div className="admin-extract">
              <div className="admin-extract__overlay">
                <p className="eyebrow" style={{ marginBottom: 6 }}>Detection preview</p>
                <Image src={result.overlay} alt="detection preview" />
                <p className="hint" style={{ marginTop: 6 }}>
                  Cyan = product outline (the ruler). Magenta = each detected charm.
                </p>
              </div>
              <div className="admin-extract__pieces">
                {pieces.length ? (
                  pieces.map((p, i) => (
                    <div key={i} className={'extract-piece' + (p.include ? '' : ' extract-piece--off')}>
                      <Checkbox
                        checked={p.include}
                        onChange={(e) => patchPiece(i, { include: e.target.checked })}
                      />
                      <div className="extract-piece__thumb">
                        <img src={p.dataUrl} alt="" />
                      </div>
                      <div className="extract-piece__fields">
                        <Input
                          size="small"
                          value={p.name}
                          onChange={(e) => patchPiece(i, { name: e.target.value })}
                        />
                        <Space size={6} wrap>
                          <Select
                            size="small"
                            value={p.category}
                            onChange={(v) => patchPiece(i, { category: v })}
                            options={CAT_OPTS}
                            style={{ width: 100 }}
                          />
                          <Tag>{p.widthMm}×{p.heightMm} mm</Tag>
                          <Tag color="gold">{p.tier}</Tag>
                          <span className="extract-piece__price">
                            £
                            <InputNumber
                              size="small"
                              min={0}
                              value={p.price}
                              onChange={(v) => patchPiece(i, { price: v })}
                              style={{ width: 60 }}
                            />
                          </span>
                        </Space>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty description="No pieces — adjust the tuning and detect again" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </div>
            </div>
          </Spin>
          <Divider style={{ margin: '14px 0' }} />
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={commit} disabled={!selected.length}>
            Add {selected.length} charm{selected.length === 1 ? '' : 's'}
            {form.makeProduct ? ' + product' : ''}
          </Button>
        </Card>
      )}
    </Space>
  )
}

// ---------------------------------------------------------------------------
// Shared Shopify catalogue state (published products + charms) — one fetch,
// shared by the Products and Charms tabs. Publishing pushes local drafts to
// Shopify and always persists local overrides (price / hide / size) to storage.
// ---------------------------------------------------------------------------
function useCloud(draft, set) {
  const { message, modal } = App.useApp()
  const embedded = isShopifyEmbedded()
  const [token, setTokenState] = useState(() => getToken())
  const [loading, setLoading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [data, setData] = useState({ products: [], charms: [] })

  const refresh = async () => {
    setLoading(true)
    try {
      const cat = await fetchCatalog()
      setData({ products: cat.products || [], charms: cat.charms || [] })
    } catch {
      /* offline / no backend in local dev — leave lists empty */
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const saveToken = (t) => { setTokenState(t); setToken(t) }

  const publish = async () => {
    // Always persist local overrides (prices / hidden / sizes) to this browser.
    saveAdmin(draft)
    const charms = draft.customCharms || []
    const products = draft.customProducts || []
    if (!charms.length && !products.length) {
      message.success('Saved. Reload the storefront to see your changes.')
      return
    }
    if (!embedded && !getToken()) return message.warning('Enter the admin token first.')
    setPublishing(true)
    try {
      if (charms.length) await addCharms(charms)
      for (const p of products) await addProduct(p)
      set((d) => ({ ...d, customCharms: [], customProducts: [] }))
      saveAdmin({ ...draft, customCharms: [], customProducts: [] })
      message.success(`Published ${charms.length} charm(s) + ${products.length} product(s) to Shopify.`)
      refresh()
    } catch (e) {
      message.error(`Publish failed: ${e.message}`)
    } finally {
      setPublishing(false)
    }
  }

  const toggleHide = async (c) => {
    try { await patchCharm(c.id, { hidden: !c.hidden }); refresh() }
    catch (e) { message.error(e.message) }
  }
  const removeCharm = (c) => modal.confirm({
    title: `Delete "${c.name}" from Shopify?`,
    okText: 'Delete', okButtonProps: { danger: true },
    onOk: async () => { try { await deleteCharm(c.id); message.success('Deleted.'); refresh() } catch (e) { message.error(e.message) } },
  })
  const repriceCharm = async (c, price) => {
    try { await patchCharm(c.id, { price }) }
    catch (e) { message.error(e.message) }
  }
  const removeProduct = (p) => modal.confirm({
    title: `Delete "${p.name}" from Shopify?`,
    okText: 'Delete', okButtonProps: { danger: true },
    onOk: async () => { try { await deleteProduct(p.id); message.success('Deleted.'); refresh() } catch (e) { message.error(e.message) } },
  })

  return { embedded, token, saveToken, loading, publishing, data, refresh, publish, toggleHide, removeCharm, repriceCharm, removeProduct }
}

export default function AdminPage() {
  const [draft, setDraft] = useState(() => loadAdmin())
  const [tab, setTab] = useState('products')
  const set = (updater) => setDraft((d) => (typeof updater === 'function' ? updater(d) : updater))
  const cloud = useCloud(draft, set)

  // "View storefront" opens the live Shopify store.
  const storefrontUrl =
    'https://thecharmeedit.com/products/celeste-key-gold-custom-charm-phone-case?variant=56637607281018'

  return (
    <div className="admin-page">
      <div className="admin-head">
        <div>
          <h1 className="admin-title">
            <ShopOutlined /> Merchant Admin
          </h1>
          <p className="admin-sub">
            Add products & charms, set pricing, and publish to your storefront.
          </p>
        </div>
        <Space wrap>
          <Button icon={<ShopOutlined />} href={storefrontUrl} target="_blank">
            View storefront
          </Button>
          {!cloud.embedded && (
            <Input.Password
              value={cloud.token}
              onChange={(e) => cloud.saveToken(e.target.value)}
              placeholder="Admin token"
              style={{ width: 200 }}
            />
          )}
          <Button icon={<ReloadOutlined />} onClick={cloud.refresh} loading={cloud.loading}>
            Refresh
          </Button>
          <Button type="primary" icon={<CloudUploadOutlined />} onClick={cloud.publish} loading={cloud.publishing}>
            Publish
          </Button>
        </Space>
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'products', label: 'Products', children: <ProductsTab draft={draft} set={set} cloud={cloud} /> },
          { key: 'charms', label: 'Charms', children: <CharmsTab draft={draft} set={set} cloud={cloud} /> },
          {
            key: 'extract',
            label: (
              <span>
                <ScissorOutlined /> Auto-extract
              </span>
            ),
            children: <BatchExtractTab draft={draft} set={set} />,
          },
        ]}
      />

      <p className="admin-note">
        Products, charms, images and prices are stored in your own Shopify store (Metaobjects +
        Files) and load on the storefront automatically. <strong>Publish</strong> pushes any charms
        or products you added here up to Shopify.
      </p>
    </div>
  )
}

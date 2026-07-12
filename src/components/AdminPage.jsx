import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Divider,
  Empty,
  Image,
  Input,
  InputNumber,
  Popover,
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
  AppstoreOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  InboxOutlined,
  PlusOutlined,
  PercentageOutlined,
  OrderedListOutlined,
  ReloadOutlined,
  SaveOutlined,
  ScissorOutlined,
  ShopOutlined,
  TagsOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { allProducts, productGroups } from '../data/products'
import { charmCategory, MAX_CHARMS } from '../lib/catalog'
import { DEFAULT_SETTINGS } from '../lib/settings'
import { resolveAsset } from '../lib/assets'
import { loadAdmin, saveAdmin } from '../lib/adminStore'
import { extractPieces, loadImageData } from '../lib/segment'
import {
  addCharms,
  addProduct,
  deleteCharm,
  deleteProduct,
  fetchCatalog,
  fetchSettings,
  getToken,
  isShopifyEmbedded,
  patchCharm,
  patchProduct,
  renameTaxonomy,
  saveSettings,
  setToken,
  syncDiscounts,
  fetchShopifyProducts,
  fetchShopifyCollections,
  fetchCaseVariants,
  updateCaseVariant,
  caseVariantAction,
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
const STAGE_MAX_W = 300
const STAGE_MAX_H = 360
const STAGE_PAD = 16

/** Best available background image for a product (any finish). */
function productImage(product) {
  const img = product?.blankImage || {}
  return img.white || img.default || img.natural || img.black || Object.values(img)[0] || null
}

function CharmStudioTab({ charm, cloud, categories = [], subcategories = [] }) {
  const { message } = App.useApp()

  const products = allProducts()
  const [productId, setProductId] = useState('iphone-16-pro-max')
  const product = useMemo(
    () => products.find((p) => p.id === productId) || products[0],
    [products, productId],
  )

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [subCategory, setSubCategory] = useState('')
  const [image, setImage] = useState(null) // { src, w, h } when replacing artwork
  const [scale, setScale] = useState(1)
  const [saving, setSaving] = useState(false)
  // Locally-created category / sub-category options (via the "+" popovers). They
  // persist to Shopify on Save and reappear from the server list after a refresh.
  const [localCats, setLocalCats] = useState([])
  const [localSubs, setLocalSubs] = useState([])
  const [catAdd, setCatAdd] = useState('')
  const [subAdd, setSubAdd] = useState('')
  const [catAddOpen, setCatAddOpen] = useState(false)
  const [subAddOpen, setSubAddOpen] = useState(false)

  // Keep the latest form values in a ref so pending edits can be flushed when the
  // user switches to a different charm (before this panel resets its state).
  const formRef = useRef({})
  formRef.current = { name, category, subCategory, scale, image }
  // The charm currently loaded into the form (drives the flush-on-switch).
  const loadedRef = useRef(null)

  // Diff the form against a base charm → the minimal patch (or null if clean).
  const patchFor = (base, st) => {
    if (!base) return null
    const bCat = base.category || charmCategory(base)
    const bSub = base.collection || ''
    const bw = Number(base.widthMm) || 10
    const bh = Number(base.heightMm) || 10
    const patch = {}
    if (st.name.trim() && st.name.trim() !== (base.name || '')) patch.name = st.name.trim()
    if (st.category.trim() && st.category.trim() !== bCat) patch.category = st.category.trim()
    if (st.subCategory.trim() !== bSub) patch.collection = st.subCategory.trim() || 'Custom'
    if (st.scale !== 1) {
      patch.widthMm = +(bw * st.scale).toFixed(1)
      patch.heightMm = +(bh * st.scale).toFixed(1)
    }
    if (st.image?.src) patch.src = st.image.src
    return Object.keys(patch).length ? patch : null
  }

  // Load the selected charm's fields whenever a different piece is selected —
  // flushing any pending edits of the previously-loaded charm FIRST so switching
  // charms never drops an unsaved change.
  useEffect(() => {
    const prev = loadedRef.current
    if (prev && prev.id !== charm?.id) {
      const patch = patchFor(prev, formRef.current)
      if (patch) cloud.updateCharm(prev, patch).catch(() => {})
    }
    loadedRef.current = charm || null
    setName(charm?.name || '')
    setCategory(charm ? charm.category || charmCategory(charm) : '')
    setSubCategory(charm?.collection || '')
    setImage(null)
    setScale(1)
  }, [charm?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save to Shopify: whenever the form is dirty, persist after a short idle
  // debounce so every change (name / category / sub-category / size / artwork) is
  // saved without a manual button press.
  useEffect(() => {
    if (!charm) return
    const patch = patchFor(charm, { name, category, subCategory, scale, image })
    if (!patch) return
    const t = setTimeout(async () => {
      setSaving(true)
      try {
        await cloud.updateCharm(charm, patch)
        // Size / artwork are expressed RELATIVE to the charm's stored values; once
        // saved (and the catalogue refreshed) reset the relative controls so the
        // next debounce doesn't re-apply them on top of the new base values.
        if (scale !== 1) setScale(1)
        if (image) setImage(null)
      } catch (e) {
        message.error(`Could not save: ${e.message}`)
      } finally {
        setSaving(false)
      }
    }, 700)
    return () => clearTimeout(t)
  }, [charm, name, category, subCategory, scale, image]) // eslint-disable-line react-hooks/exhaustive-deps

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
  // Show the replacement artwork if one was dropped, else the charm's Shopify art.
  const charmSrc = image?.src ? image.src : charm ? resolveAsset(charm.src) : null
  const curCat = charm ? charm.category || charmCategory(charm) : ''
  const curSub = charm?.collection || ''
  const dirty =
    !!charm &&
    (scale !== 1 ||
      name.trim() !== (charm.name || '') ||
      category.trim() !== curCat ||
      subCategory.trim() !== curSub ||
      !!image)

  // Dropdown options = server categories + any locally-created ones + the charm's
  // own current value (so it always shows even before a refresh folds it in).
  const catOptions = useMemo(() => {
    const s = new Set([...categories, ...localCats].filter(Boolean))
    if (category) s.add(category)
    return [...s].map((c) => ({ value: c, label: c }))
  }, [categories, localCats, category])
  const subOptions = useMemo(() => {
    const s = new Set([...subcategories, ...localSubs].filter(Boolean))
    if (subCategory) s.add(subCategory)
    return [...s].map((c) => ({ value: c, label: c }))
  }, [subcategories, localSubs, subCategory])
  const addCategory = () => {
    const v = catAdd.trim()
    if (!v) return
    setLocalCats((a) => (a.includes(v) ? a : [...a, v]))
    setCategory(v)
    setCatAdd('')
    setCatAddOpen(false)
  }
  const addSubCategory = () => {
    const v = subAdd.trim()
    if (!v) return
    setLocalSubs((a) => (a.includes(v) ? a : [...a, v]))
    setSubCategory(v)
    setSubAdd('')
    setSubAddOpen(false)
  }
  const lblStyle = { display: 'block', marginBottom: 4, color: 'var(--ink-soft)' }

  return (
    <Card size="small" title="Charm studio" style={{ position: 'sticky', top: 8 }}>
      {!charm ? (
        <Empty
          style={{ margin: '24px 0' }}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Select a charm on the left to edit it"
        />
      ) : (
        <>
          {/* 1 — Size adjuster (top): live preview + slider */}
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
          <div className="hint" style={{ marginBottom: 14 }}>
            Current size: {baseW}×{baseH} mm (100%).
          </div>

          {/* 2 — Preview on | Name (two columns) */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <label style={{ flex: 1, minWidth: 0 }}>
              <span style={lblStyle}>Preview on</span>
              <Select
                value={productId}
                onChange={setProductId}
                showSearch
                optionFilterProp="label"
                options={products.map((p) => ({ value: p.id, label: p.name }))}
                style={{ width: '100%' }}
              />
            </label>
            <label style={{ flex: 1, minWidth: 0 }}>
              <span style={lblStyle}>Name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Charm name" />
            </label>
          </div>

          {/* 3 — Category | Sub-category (two columns; pick existing, or "+" to
              create a new one — no free-typing inside the dropdown itself) */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <label style={{ flex: 1, minWidth: 0 }}>
              <span style={lblStyle}>Category — tab</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Select
                  value={category || undefined}
                  onChange={setCategory}
                  showSearch
                  optionFilterProp="label"
                  options={catOptions}
                  placeholder="Select"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <Popover
                  open={catAddOpen}
                  onOpenChange={setCatAddOpen}
                  trigger="click"
                  title="New category"
                  content={
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Input
                        autoFocus
                        value={catAdd}
                        onChange={(e) => setCatAdd(e.target.value)}
                        onPressEnter={addCategory}
                        placeholder="e.g. seasonal"
                        style={{ width: 150 }}
                      />
                      <Button type="primary" size="small" onClick={addCategory}>Save</Button>
                      <Button size="small" onClick={() => { setCatAdd(''); setCatAddOpen(false) }}>Cancel</Button>
                    </div>
                  }
                >
                  <Button icon={<PlusOutlined />} title="Create a new category" />
                </Popover>
              </div>
            </label>
            <label style={{ flex: 1, minWidth: 0 }}>
              <span style={lblStyle}>Sub-category — section</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Select
                  value={subCategory || undefined}
                  onChange={setSubCategory}
                  showSearch
                  optionFilterProp="label"
                  options={subOptions}
                  placeholder="Select"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <Popover
                  open={subAddOpen}
                  onOpenChange={setSubAddOpen}
                  trigger="click"
                  title="New sub-category"
                  content={
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Input
                        autoFocus
                        value={subAdd}
                        onChange={(e) => setSubAdd(e.target.value)}
                        onPressEnter={addSubCategory}
                        placeholder="e.g. Zodiac"
                        style={{ width: 150 }}
                      />
                      <Button type="primary" size="small" onClick={addSubCategory}>Save</Button>
                      <Button size="small" onClick={() => { setSubAdd(''); setSubAddOpen(false) }}>Cancel</Button>
                    </div>
                  }
                >
                  <Button icon={<PlusOutlined />} title="Create a new sub-category" />
                </Popover>
              </div>
            </label>
          </div>

          {/* 4 — Replace artwork (bottom) */}
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={lblStyle}>Replace artwork (optional)</span>
            <ImageDrop value={image} onChange={setImage} hint="Drop a new transparent PNG to replace the art" />
          </label>

          <Space align="center">
            <span className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {saving ? (
                <>
                  <Spin size="small" /> Saving to Shopify…
                </>
              ) : dirty ? (
                'Saving…'
              ) : (
                'All changes saved to Shopify'
              )}
            </span>
            <Button
              onClick={() => {
                setName(charm.name || '')
                setCategory(curCat)
                setSubCategory(curSub)
                setImage(null)
                setScale(1)
              }}
              disabled={!dirty}
            >
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
    subCategory: '',
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
      collection: form.subCategory.trim() || 'Custom',
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

  // ONLY the merchant's Shopify-stored charms (charme_charm metaobjects) — the
  // bundled catalogue is intentionally excluded.
  const baseRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (cloud?.data.charms || [])
      .filter((c) => !q || (c.name || '').toLowerCase().includes(q))
      .map((c) => ({ ...c, category: c.category || charmCategory(c) }))
  }, [query, cloud?.data.charms])

  // Selecting a charm row (in any of the tables below) drives the Charm studio
  // panel on the right. Resolve the chosen charm across every source.
  const [selectedCharmId, setSelectedCharmId] = useState(null)
  const selectedCharm = useMemo(() => {
    const src = [...(draft.customCharms || []), ...(cloud?.data.charms || [])]
    return src.find((c) => c.id === selectedCharmId) || null
  }, [selectedCharmId, draft.customCharms, cloud])
  const pickRow = (r) => ({ onClick: () => setSelectedCharmId(r.id) })
  const rowCls = (r) => (r.id === selectedCharmId ? 'admin-pick-row is-selected' : 'admin-pick-row')

  // Existing categories (defaults + whatever charms already use) for the studio
  // dropdown; the merchant can also type a brand-new category.
  const categories = useMemo(() => {
    const s = new Set(CAT_OPTS.map((o) => o.value))
    for (const c of cloud?.data.charms || []) {
      const cc = c.category || charmCategory(c)
      if (cc) s.add(cc)
    }
    return [...s]
  }, [cloud?.data.charms])
  // Existing sub-categories (charm `collection` values) for suggestions.
  const subcategories = useMemo(() => {
    const s = new Set()
    for (const c of cloud?.data.charms || []) if (c.collection) s.add(c.collection)
    return [...s].sort()
  }, [cloud?.data.charms])

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
            loading={cloud?.loading}
            onRow={pickRow}
            rowClassName={rowCls}
            pagination={{ defaultPageSize: 20, size: 'small', showSizeChanger: true, pageSizeOptions: [20, 50, 100] }}
            dataSource={baseRows}
            columns={[
              { title: 'Art', width: 52, render: (_, r) => <Image src={resolveAsset(r.src)} width={34} height={34} style={{ objectFit: 'contain' }} /> },
              { title: 'Name', dataIndex: 'name', ellipsis: true },
              { title: 'Category', dataIndex: 'category', width: 100, render: (c) => <Tag>{c}</Tag> },
              { title: 'Size', width: 104, render: (_, r) => `${r.widthMm}×${r.heightMm} mm` },
              {
                title: 'Price (£)',
                width: 96,
                render: (_, r) => (
                  <InputNumber
                    size="small"
                    min={0}
                    defaultValue={r.price}
                    onBlur={(e) => cloud.repriceCharm(r, Number(e.target.value))}
                    style={{ width: 76 }}
                  />
                ),
              },
              {
                title: 'Shown',
                width: 70,
                render: (_, r) => (
                  <Switch size="small" checked={!r.hidden} onChange={() => cloud.toggleHide(r)} />
                ),
              },
              {
                title: '',
                width: 40,
                render: (_, r) => (
                  <Button type="text" danger icon={<DeleteOutlined />} onClick={() => cloud.removeCharm(r)} />
                ),
              },
            ]}
          />
        </Card>
      </Space>

      {/* Right column — size the selected charm + add a charm. */}
      <div style={{ flex: '1 1 360px', minWidth: 300, maxWidth: 460 }}>
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <CharmStudioTab charm={selectedCharm} cloud={cloud} categories={categories} subcategories={subcategories} />

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
                <span>Category — customizer tab</span>
                <AutoComplete
                  value={form.category}
                  onChange={(v) => setForm((f) => ({ ...f, category: v }))}
                  options={categories.map((c) => ({ value: c }))}
                  filterOption={(input, opt) => opt.value.toLowerCase().includes(input.toLowerCase())}
                  placeholder="e.g. gold, seasonal…"
                  style={{ width: '100%' }}
                  allowClear
                />
              </label>
              <label>
                <span>Sub-category — section in the tab</span>
                <AutoComplete
                  value={form.subCategory}
                  onChange={(v) => setForm((f) => ({ ...f, subCategory: v }))}
                  options={subcategories.map((c) => ({ value: c }))}
                  filterOption={(input, opt) => opt.value.toLowerCase().includes(input.toLowerCase())}
                  placeholder="e.g. Zodiac, Charms…"
                  style={{ width: '100%' }}
                  allowClear
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
// ---------------------------------------------------------------------------
// Product studio — edit a product's name / price / real size / photo in Shopify.
// ---------------------------------------------------------------------------
function ProductStudioTab({ product, cloud }) {
  const { message } = App.useApp()
  const [name, setName] = useState('')
  const [basePrice, setBasePrice] = useState(0)
  const [widthMm, setWidthMm] = useState(0)
  const [heightMm, setHeightMm] = useState(0)
  const [image, setImage] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setName(product?.name || '')
    setBasePrice(product?.basePrice ?? 0)
    setWidthMm(product?.widthMm ?? 0)
    setHeightMm(product?.heightMm ?? 0)
    setImage(null)
  }, [product?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const src = image?.src || (product ? resolveAsset(product.src) : null)
  const dirty =
    !!product &&
    (name.trim() !== (product.name || '') ||
      Number(basePrice) !== product.basePrice ||
      Number(widthMm) !== product.widthMm ||
      Number(heightMm) !== product.heightMm ||
      !!image)

  const save = async () => {
    if (!product) return
    const patch = {}
    if (name.trim() && name.trim() !== product.name) patch.name = name.trim()
    if (Number(basePrice) !== product.basePrice) patch.basePrice = Number(basePrice)
    if (Number(widthMm) !== product.widthMm) patch.widthMm = Number(widthMm)
    if (Number(heightMm) !== product.heightMm) patch.heightMm = Number(heightMm)
    if (image?.src) patch.src = image.src
    if (!Object.keys(patch).length) return
    setSaving(true)
    try {
      await cloud.updateProduct(product, patch)
      setImage(null)
      message.success(`Saved “${patch.name || product.name}” to Shopify.`)
    } catch (e) {
      message.error(`Could not save: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card size="small" title="Product studio" style={{ position: 'sticky', top: 8 }}>
      {!product ? (
        <Empty
          style={{ margin: '24px 0' }}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Select a product on the left to edit it"
        />
      ) : (
        <>
          <div style={{ textAlign: 'center', marginBottom: 10 }}>
            <img
              src={src}
              alt={product.name}
              style={{ maxWidth: '75%', maxHeight: 220, objectFit: 'contain', background: '#faf7f2', borderRadius: 12, padding: 8 }}
            />
          </div>
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span style={{ display: 'block', marginBottom: 4, color: 'var(--ink-soft)' }}>Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" />
          </label>
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span style={{ display: 'block', marginBottom: 4, color: 'var(--ink-soft)' }}>Base price (£)</span>
            <InputNumber min={0} value={basePrice} onChange={setBasePrice} style={{ width: '100%' }} />
          </label>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <label style={{ flex: 1 }}>
              <span style={{ display: 'block', marginBottom: 4, color: 'var(--ink-soft)' }}>Width (mm)</span>
              <InputNumber min={1} value={widthMm} onChange={setWidthMm} style={{ width: '100%' }} />
            </label>
            <label style={{ flex: 1 }}>
              <span style={{ display: 'block', marginBottom: 4, color: 'var(--ink-soft)' }}>Height (mm)</span>
              <InputNumber min={1} value={heightMm} onChange={setHeightMm} style={{ width: '100%' }} />
            </label>
          </div>
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span style={{ display: 'block', marginBottom: 4, color: 'var(--ink-soft)' }}>Replace photo (optional)</span>
            <ImageDrop value={image} onChange={setImage} hint="Drop a new product photo to replace it" />
          </label>
          <Space>
            <Button type="primary" icon={<SaveOutlined />} onClick={save} disabled={!dirty} loading={saving}>
              Save to Shopify
            </Button>
            <Button
              onClick={() => {
                setName(product.name || '')
                setBasePrice(product.basePrice ?? 0)
                setWidthMm(product.widthMm ?? 0)
                setHeightMm(product.heightMm ?? 0)
                setImage(null)
              }}
              disabled={!dirty}
            >
              Reset
            </Button>
          </Space>
        </>
      )}
    </Card>
  )
}

function ProductsTab({ draft, set, cloud }) {
  const { message, modal } = App.useApp()
  const [form, setForm] = useState({
    name: '',
    kind: 'phone',
    basePrice: 26,
    widthMm: 75,
    image: null,
  })
  const [selectedProductId, setSelectedProductId] = useState(null)
  const selectedProduct =
    (cloud?.data.products || []).find((p) => p.id === selectedProductId) || null
  const pickRow = (r) => (r.variantOnly ? {} : { onClick: () => setSelectedProductId(r.id) })
  const rowCls = (r) => (r.id === selectedProductId ? 'admin-pick-row is-selected' : 'admin-pick-row')

  // ---- The ONE real sellable product (custom-charm-phone-case) -------------
  // Every phone model has a colour variant (Black/White/Glitter/…) here; the
  // product list below is wired to them so a price edit / add / delete touches
  // the real Shopify variants the customer buys.
  const [caseData, setCaseData] = useState({ productId: null, colours: [], models: [], variants: [] })
  const [caseLoading, setCaseLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newColour, setNewColour] = useState('')

  const loadCase = () => {
    setCaseLoading(true)
    fetchCaseVariants()
      .then((d) => setCaseData(d || { productId: null, colours: [], models: [], variants: [] }))
      .catch((e) => message.error(e.message || 'Could not load Shopify variants.'))
      .finally(() => setCaseLoading(false))
  }
  // Reload the live variants whenever the metaobject product list changes
  // (add / delete cascades server-side, then cloud.refresh updates products).
  useEffect(() => { loadCase() }, [cloud?.data.products]) // eslint-disable-line react-hooks/exhaustive-deps

  const colours = caseData.colours || []
  const variantAt = useMemo(() => {
    const m = {}
    for (const v of caseData.variants || []) (m[v.model] ||= {})[v.colour] = v
    return m
  }, [caseData])

  // Unified rows = metaobject products + any live models without a metaobject.
  const rows = useMemo(() => {
    const products = cloud?.data.products || []
    const names = new Set(products.map((p) => p.name))
    const extras = (caseData.models || [])
      .filter((mm) => !names.has(mm.name))
      .map((mm) => ({ id: `variant:${mm.name}`, name: mm.name, kind: 'phone', variantOnly: true }))
    return [...products, ...extras]
  }, [cloud?.data.products, caseData])

  const saveVariantPrice = async (model, colour, value) => {
    const v = variantAt[model]?.[colour]
    if (!v) return
    const price = Number(value)
    if (value == null || value === '' || Number.isNaN(price) || price === v.price) return
    try {
      await updateCaseVariant({ productId: caseData.productId, variantId: v.id, price })
      setCaseData((d) => ({ ...d, variants: d.variants.map((x) => (x.id === v.id ? { ...x, price } : x)) }))
    } catch (e) {
      message.error(e.message || 'Could not update the variant price.')
    }
  }

  const createVariantsFor = async (model) => {
    setBusy(true)
    try {
      const r = await caseVariantAction({ action: 'addModel', model, price: form.basePrice })
      message.success(`Created ${r.created || 0} variant(s) for “${model}”.`)
      loadCase()
    } catch (e) { message.error(e.message || 'Could not create variants.') }
    finally { setBusy(false) }
  }

  const addColour = async () => {
    const colour = newColour.trim()
    if (!colour) return
    if (colours.some((c) => c.name.toLowerCase() === colour.toLowerCase()))
      return message.warning('That colour already exists.')
    setBusy(true)
    try {
      const r = await caseVariantAction({ action: 'addColour', colour })
      setNewColour('')
      message.success(`Added “${colour}” — created ${r.created || 0} variant(s) across models.`)
      loadCase()
    } catch (e) { message.error(e.message || 'Could not add the colour.') }
    finally { setBusy(false) }
  }

  const removeColour = (name) => modal.confirm({
    title: `Remove “${name}” from every model?`,
    content: 'This deletes that colour’s variant on Shopify for all phone models.',
    okText: 'Remove', okButtonProps: { danger: true },
    onOk: async () => {
      setBusy(true)
      try {
        const r = await caseVariantAction({ action: 'deleteColour', colour: name })
        message.success(`Removed “${name}” — deleted ${r.deleted || 0} variant(s).`)
        loadCase()
      } catch (e) { message.error(e.message || 'Could not remove the colour.') }
      finally { setBusy(false) }
    },
  })

  const enableOversell = async () => {
    setBusy(true)
    try {
      const r = await caseVariantAction({ action: 'sellWhenSoldOut' })
      message.success(`Enabled selling on ${r.updated || 0} sold-out variant(s) — the “- Unavailable” tag will drop.`)
      loadCase()
    } catch (e) { message.error(e.message || 'Could not update the variants.') }
    finally { setBusy(false) }
  }

  const deleteRow = (r) => {
    if (!r.variantOnly) return cloud.removeProduct(r) // cascades metaobject + image + variants
    modal.confirm({
      title: `Delete all variants of “${r.name}”?`,
      content: 'This model has no customizer product — only its Shopify variants will be removed.',
      okText: 'Delete', okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true)
        try {
          const x = await caseVariantAction({ action: 'deleteModel', model: r.name })
          message.success(`Deleted ${x.deleted || 0} variant(s).`)
          loadCase()
        } catch (e) { message.error(e.message || 'Could not delete the variants.') }
        finally { setBusy(false) }
      },
    })
  }

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
    message.success('Product added — Publish to save to Shopify.')
  }

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <style>{`.admin-pick-row{cursor:pointer}.admin-pick-row.is-selected>td{background:rgba(179,91,91,.10)!important}`}</style>

      {/* Left column — the single product list, wired to the real variants. */}
      <Space direction="vertical" size={18} style={{ flex: '1 1 560px', minWidth: 0 }}>
        <Card
          size="small"
          title={`Case colours (variant types) · ${colours.length}`}
          loading={caseLoading}
        >
          <p className="hint" style={{ marginTop: 0 }}>
            Each colour is a variant on <strong>every</strong> phone model. Adding a colour creates it for
            all models; removing it deletes those variants on Shopify.
          </p>
          <Space wrap size={[6, 6]}>
            {colours.length ? (
              colours.map((c) => (
                <Tag
                  key={c.name}
                  closable
                  onClose={(e) => { e.preventDefault(); removeColour(c.name) }}
                  style={{ padding: '2px 8px', fontSize: 13 }}
                >
                  {c.name}
                </Tag>
              ))
            ) : (
              <span className="hint">No colours yet.</span>
            )}
          </Space>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Input
              placeholder="New colour (e.g. Clear)"
              value={newColour}
              onChange={(e) => setNewColour(e.target.value)}
              onPressEnter={addColour}
              style={{ maxWidth: 220 }}
            />
            <Button icon={<PlusOutlined />} loading={busy} onClick={addColour}>Add colour</Button>
          </div>
        </Card>

        <Card
          size="small"
          title={`Products & variants (${rows.length})`}
          extra={
            <Space>
              <Button size="small" icon={<ThunderboltOutlined />} loading={busy} onClick={enableOversell}>
                Sell sold-out models
              </Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => { cloud?.refresh(); loadCase() }} loading={cloud?.loading || caseLoading}>Refresh</Button>
            </Space>
          }
        >
          <p className="hint" style={{ marginTop: 0 }}>
            One list for the customizer models and their sellable Shopify variants. Editing a colour price
            writes to the live variant. Deleting a product removes its metaobject, image and all its variants.
          </p>
          <Table
            size="small"
            rowKey="id"
            loading={cloud?.loading || caseLoading}
            onRow={pickRow}
            rowClassName={rowCls}
            scroll={{ x: 'max-content' }}
            pagination={{ defaultPageSize: 20, size: 'small', showSizeChanger: true, pageSizeOptions: [20, 50, 100] }}
            dataSource={rows}
            locale={{ emptyText: <Empty description="No products yet — add one below, then Publish." image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            columns={[
              { title: 'Photo', dataIndex: 'src', width: 52, render: (s, r) => (r.variantOnly ? <Tag color="blue">live</Tag> : <Image src={resolveAsset(s)} width={36} height={36} style={{ objectFit: 'contain' }} />) },
              { title: 'Model', dataIndex: 'name', ellipsis: true, fixed: 'left', width: 150 },
              ...colours.map((c) => ({
                title: `${c.name} (£)`,
                key: `col-${c.name}`,
                width: 92,
                render: (_, r) => {
                  const v = variantAt[r.name]?.[c.name]
                  return v ? (
                    <InputNumber
                      key={`${v.id}:${v.price}`}
                      size="small"
                      min={0}
                      step={0.5}
                      defaultValue={v.price}
                      onBlur={(e) => saveVariantPrice(r.name, c.name, e.target.value)}
                      style={{ width: 74 }}
                    />
                  ) : (
                    <span style={{ color: '#ccc' }}>—</span>
                  )
                },
              })),
              {
                title: '',
                key: 'sync',
                width: 96,
                render: (_, r) => {
                  const missing = colours.length && colours.some((c) => !variantAt[r.name]?.[c.name])
                  return missing ? (
                    <Button size="small" icon={<PlusOutlined />} loading={busy} onClick={() => createVariantsFor(r.name)}>
                      Variants
                    </Button>
                  ) : null
                },
              },
              { title: '', key: 'del', width: 40, fixed: 'right', render: (_, r) => <Button type="text" danger icon={<DeleteOutlined />} onClick={() => deleteRow(r)} /> },
            ]}
          />
        </Card>
      </Space>

      {/* Right column — edit the selected product + add a new one. */}
      <div style={{ flex: '1 1 360px', minWidth: 300, maxWidth: 460 }}>
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <ProductStudioTab product={selectedProduct} cloud={cloud} />

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
        </Space>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Discount — cross-sell prompt + customizable discount rules & codes
// ---------------------------------------------------------------------------
const RULE_TYPES = [
  { value: 'category', label: 'By category (Shopify collection)' },
  { value: 'product_qty', label: 'By number of products bought' },
  { value: 'item', label: 'By a specific product or charm' },
  { value: 'charm_count', label: 'By number of charms' },
]
const DISC_KINDS = [
  { value: 'percent', label: '% off' },
  { value: 'amount', label: '£ off' },
]
const BUNDLE_LAYOUTS = [
  { value: 'swipe', label: 'Match & swipe (main + swipeable match)' },
  { value: 'volume', label: 'Volume discount' },
  { value: 'mixmatch', label: 'Mix & match' },
  { value: 'pickany', label: 'Pick any (mix quantity)' },
]
const STYLE_DEFAULT = { accent: '#2e2a26', cardBg: '#ffffff', badgeBg: '#f2e7d8', badgeInk: '#8a5a2b', radius: 12 }
const styleOf = (b) => ({ ...STYLE_DEFAULT, ...(b?.style || {}) })
const sideDefault = () => ({ mode: 'products', products: [], collection: null })
const bundleDefault = () => ({
  name: 'New offer',
  blockTitle: 'Bundle & save 15%!',
  claimText: 'Add to basket',
  layout: 'swipe',
  discountKind: 'percent',
  value: 15,
  code: '',
  showVariants: true,
  active: true,
  target: sideDefault(),
  partner: sideDefault(),
  style: { ...STYLE_DEFAULT },
})

/** Migrate any bundle to the anchor-first shape: target (what it's for) + partner (what to bundle with). */
const normalizeBundle = (b) => {
  const target = b.target || b.main || { mode: 'products', products: (b.items || []).filter((x) => x && x.handle), collection: null }
  const partner = b.partner || b.match || sideDefault()
  const out = {
    ...b,
    layout: b.layout === 'fbt' ? 'swipe' : b.layout || 'swipe',
    target: { ...sideDefault(), ...target },
    partner: { ...sideDefault(), ...partner },
    style: styleOf(b),
  }
  delete out.items
  delete out.main
  delete out.match
  return out
}

/** One "side" of a swipe bundle: specific products OR a whole collection. */
function BundleSideEditor({ side, onChange, shopProducts, shopLoading, shopCollections, collLoading }) {
  const s = side || sideDefault()
  const mode = s.mode || 'products'
  return (
    <div style={{ marginBottom: 6 }}>
      <label style={discFieldStyle}>
        <span style={{ color: 'var(--ink-soft)' }}>Source</span>
        <Select
          value={mode}
          onChange={(v) => onChange({ mode: v })}
          options={[
            { value: 'products', label: 'Specific products' },
            { value: 'collection', label: 'Whole collection' },
          ]}
          style={{ width: 200 }}
        />
      </label>
      {mode === 'collection' ? (
        <label style={discFieldStyle}>
          <span style={{ color: 'var(--ink-soft)' }}>Collection</span>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Pick a collection"
            loading={collLoading}
            value={s.collection?.handle || undefined}
            onChange={(v) => {
              const c = shopCollections.find((x) => x.handle === v)
              onChange({ collection: c ? { handle: c.handle, title: c.title } : null })
            }}
            options={shopCollections.map((c) => ({
              value: c.handle,
              label: c.count != null ? `${c.title} · ${c.count}` : c.title,
            }))}
            notFoundContent={collLoading ? 'Loading…' : 'No collections (open inside Shopify Admin, or set an admin token)'}
            style={{ width: 280, maxWidth: '100%' }}
          />
        </label>
      ) : (
        <label style={{ ...discFieldStyle, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--ink-soft)' }}>Products</span>
          <Select
            mode="multiple"
            showSearch
            optionFilterProp="label"
            placeholder="Pick one or more products"
            loading={shopLoading}
            value={(s.products || []).map((p) => p.handle)}
            onChange={(vals) => {
              const items = vals.map((h) => {
                const ex = (s.products || []).find((x) => x.handle === h)
                if (ex) return ex
                const p = shopProducts.find((x) => x.handle === h)
                return { handle: h, label: p?.title || '', image: p?.image || '' }
              })
              onChange({ products: items })
            }}
            options={shopProducts.map((p) => ({ value: p.handle, label: p.title }))}
            notFoundContent={shopLoading ? 'Loading…' : 'No products (open inside Shopify Admin, or set an admin token)'}
            style={{ width: 280, maxWidth: '100%' }}
          />
        </label>
      )}
    </div>
  )
}

/** Structural, layout-aware storefront mock for the admin bundle editor. */
function BundlePreview({ bundle }) {
  const kind = bundle.discountKind || 'percent'
  const val = Number(bundle.value) || 0
  const dealText = kind === 'fixed' ? `£${val} bundle` : `Save ${val}%`
  const layout = bundle.layout || 'swipe'
  const st = styleOf(bundle)
  const styleVars = {
    '--bp-accent': st.accent,
    '--bp-card-bg': st.cardBg,
    '--bp-badge-bg': st.badgeBg,
    '--bp-badge-ink': st.badgeInk,
    '--bp-radius': `${st.radius}px`,
  }
  const sideItems = (side) => (side && side.mode === 'collection' ? [] : (side && side.products) || [])
  const sideLabel = (side, fallback) => {
    const its = sideItems(side)
    if (its[0]) return its[0].label || its[0].handle
    if (side && side.mode === 'collection' && side.collection) return side.collection.title || 'Collection'
    return fallback
  }
  const target = bundle.target || bundle.main || { mode: 'products', products: bundle.items || [] }
  const partner = bundle.partner || bundle.match || { mode: 'products', products: [] }
  // Pool used by the mix/pick previews = anchor(s) + partners.
  const items = [...sideItems(target), ...sideItems(partner)]
  const thumb = (it) =>
    it.image ? <img className="bundle-prev__thumb" src={it.image} alt="" /> : <div className="bundle-prev__thumb" />
  const empty = <span className="hint">Pick products to preview</span>

  let body
  if (layout === 'volume') {
    body = (
      <div className="bundle-prev__vol">
        {[1, 2, 3].map((n) => (
          <div key={n} className={`bundle-prev__voltier${n === 2 ? ' is-active' : ''}`}>
            <strong>{['One', 'Two', 'Three'][n - 1]}</strong>
            <span>{n === 1 ? 'Standard price' : `Save ${val}%`}</span>
          </div>
        ))}
      </div>
    )
  } else if (layout === 'mixmatch') {
    body = (
      <div className="bundle-prev__mix">
        {items.length === 0 && empty}
        {items.map((it, i) => (
          <div key={i} className="bundle-prev__mixcard">
            {thumb(it)}
            <span className="bundle-prev__name">{it.label || it.handle || 'Product'}</span>
            <span className="bundle-prev__step">− 0 +</span>
          </div>
        ))}
      </div>
    )
  } else if (layout === 'pickany') {
    const slots = Math.max(2, items.length || 3)
    body = (
      <div className="bundle-prev__pick">
        {Array.from({ length: slots }).map((_, i) => {
          const it = items[i]
          return (
            <div key={i} className="bundle-prev__slot">
              <span className="bundle-prev__num">{i + 1}</span>
              {it ? thumb(it) : <div className="bundle-prev__thumb bundle-prev__thumb--ph" />}
              <span className={it ? 'bundle-prev__name' : 'bundle-prev__pickph'}>
                {it ? (it.label || it.handle || 'Product') : 'Pick a product…'}
              </span>
            </div>
          )
        })}
      </div>
    )
  } else if (layout === 'swipe') {
    const mainIt = sideItems(target)[0]
    const matchIt = sideItems(partner)[0]
    const mainLabel = sideLabel(target, 'Main product')
    const matchLabel = sideLabel(partner, 'Match product')
    body = (
      <div className="bundle-prev__swipe">
        <div className="bundle-prev__scard">
          <span className="bundle-prev__stag">Your pick</span>
          {mainIt ? thumb(mainIt) : <div className="bundle-prev__thumb bundle-prev__thumb--ph" />}
          <span className="bundle-prev__name">{mainLabel}</span>
        </div>
        <span className="bundle-prev__plus">+</span>
        <div className="bundle-prev__scard">
          <span className="bundle-prev__stag">Match</span>
          {matchIt ? thumb(matchIt) : <div className="bundle-prev__thumb bundle-prev__thumb--ph" />}
          <span className="bundle-prev__name">{matchLabel}</span>
          <div className="bundle-prev__sarrows">
            <span>‹</span>
            <span className="bundle-prev__sdots">
              <i className="is-on" />
              <i />
              <i />
            </span>
            <span>›</span>
          </div>
        </div>
      </div>
    )
  } else {
    body = (
      <div className="bundle-prev__row">
        {items.length === 0 && empty}
        {items.map((it, i) => (
          <div key={i} className="bundle-prev__item">
            {i > 0 && <span className="bundle-prev__plus">+</span>}
            <div className="bundle-prev__card">
              {thumb(it)}
              <span className="bundle-prev__name">{it.label || it.handle || 'Product'}</span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="bundle-prev" style={styleVars}>
      <div className="bundle-prev__title">
        {bundle.blockTitle || 'Bundle & save'} <span className="bundle-prev__badge">{dealText}</span>
      </div>
      {body}
      <button type="button" className="bundle-prev__claim">{bundle.claimText || 'Claim this offer'}</button>
    </div>
  )
}
const discFieldStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }

function DiscountTab({ cloud }) {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [s, setS] = useState(() => JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))
  // Live Shopify products for the bundle product picker.
  const [shopProducts, setShopProducts] = useState([])
  const [shopLoading, setShopLoading] = useState(true)
  // Live Shopify collections for the swipe-bundle "whole collection" picker.
  const [shopCollections, setShopCollections] = useState([])
  const [collLoading, setCollLoading] = useState(true)
  // Which bundle's name is currently being edited (index), or null.
  const [editNameIdx, setEditNameIdx] = useState(null)

  useEffect(() => {
    fetchSettings()
      .then((data) =>
        setS((prev) => {
          const merged = {
            ...prev,
            ...data,
            crossSell: { ...prev.crossSell, ...(data.crossSell || {}) },
            discounts: { ...prev.discounts, ...(data.discounts || {}) },
          }
          merged.discounts.bundles = (merged.discounts.bundles || []).map(normalizeBundle)
          return merged
        }),
      )
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchShopifyProducts()
      .then((r) => setShopProducts(r.products || []))
      .catch(() => {})
      .finally(() => setShopLoading(false))
  }, [])

  useEffect(() => {
    fetchShopifyCollections()
      .then((r) => setShopCollections(r.collections || []))
      .catch(() => {})
      .finally(() => setCollLoading(false))
  }, [])

  const groups = productGroups()
  const models = allProducts()
  const charms = cloud?.data?.charms || []
  const categories = useMemo(() => {
    const set2 = new Set()
    for (const c of charms) {
      const cc = c.category || charmCategory(c)
      if (cc) set2.add(cc)
    }
    return [...set2]
  }, [charms])

  const setCross = (patch) => setS((v) => ({ ...v, crossSell: { ...v.crossSell, ...patch } }))
  const rules = s.discounts?.rules || []
  const codes = s.discounts?.codes || []
  const bundles = s.discounts?.bundles || []
  const setRules = (next) => setS((v) => ({ ...v, discounts: { ...v.discounts, rules: next } }))
  const setCodes = (next) => setS((v) => ({ ...v, discounts: { ...v.discounts, codes: next } }))
  const setBundles = (next) => setS((v) => ({ ...v, discounts: { ...v.discounts, bundles: next } }))
  const updRule = (i, patch) => setRules(rules.map((r, x) => (x === i ? { ...r, ...patch } : r)))
  const updCode = (i, patch) => setCodes(codes.map((c, x) => (x === i ? { ...c, ...patch } : c)))
  const updBundle = (i, patch) => setBundles(bundles.map((b, x) => (x === i ? { ...b, ...patch } : b)))
  const updSide = (bi, side, patch) =>
    updBundle(bi, { [side]: { ...(bundles[bi][side] || sideDefault()), ...patch } })
  const updStyle = (bi, patch) => updBundle(bi, { style: { ...styleOf(bundles[bi]), ...patch } })
  const updOpt = (i, patch) => {
    const o = (s.crossSell.options || []).map((op, x) => (x === i ? { ...op, ...patch } : op))
    setCross({ options: o })
  }

  const save = async () => {
    setSaving(true)
    try {
      await saveSettings(s)
      message.success('Discount settings saved.')
    } catch (e) {
      message.error(`Could not save: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  // Save, then create/update the matching real Shopify discounts (codes +
  // automatic rules) via the Admin API, and fold the returned GIDs back in.
  const saveAndSync = async () => {
    setSyncing(true)
    try {
      await saveSettings(s)
      const res = await syncDiscounts()
      if (res && res.settings) {
        setS((prev) => ({
          ...prev,
          ...res.settings,
          crossSell: { ...prev.crossSell, ...(res.settings.crossSell || {}) },
          discounts: { ...prev.discounts, ...(res.settings.discounts || {}) },
        }))
      }
      const errs = (res?.report || []).filter((r) => r.error)
      if (errs.length) {
        message.warning(`Synced with ${errs.length} issue(s): ${errs.map((e) => `${e.name}: ${e.error}`).join(' · ')}`)
      } else {
        message.success('Discounts synced to Shopify.')
      }
    } catch (e) {
      message.error(`Sync failed: ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>

  const crossSellPanel = (
    <div>
      <label style={discFieldStyle}>
        <span style={{ color: 'var(--ink-soft)' }}>Text under “Add … to cart”</span>
        <Input
          value={s.crossSellHint}
          onChange={(e) => setS((v) => ({ ...v, crossSellHint: e.target.value }))}
          placeholder="Customise your second product for extra 10% off"
          style={{ maxWidth: 460 }}
        />
      </label>
      <label style={discFieldStyle}>
        <span style={{ color: 'var(--ink-soft)' }}>Show cart popup after add-to-cart</span>
        <Switch checked={!!s.crossSell.enabled} onChange={(v) => setCross({ enabled: v })} />
      </label>
      <label style={discFieldStyle}>
        <span style={{ color: 'var(--ink-soft)' }}>Popup title</span>
        <Input value={s.crossSell.title} onChange={(e) => setCross({ title: e.target.value })} style={{ maxWidth: 460 }} />
      </label>
      <label style={discFieldStyle}>
        <span style={{ color: 'var(--ink-soft)' }}>Auto-apply code for the 2nd product</span>
        <Input value={s.crossSell.discountCode} onChange={(e) => setCross({ discountCode: e.target.value.toUpperCase() })} placeholder="e.g. SECOND10" style={{ maxWidth: 460 }} />
      </label>
      <Divider style={{ margin: '10px 0' }}>Popup product options</Divider>
      {(s.crossSell.options || []).map((opt, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input placeholder="Label" value={opt.label} onChange={(e) => updOpt(i, { label: e.target.value })} style={{ width: 150 }} />
          <Select placeholder="Group" value={opt.group || undefined} onChange={(v) => updOpt(i, { group: v, productId: '' })} options={groups.map((g) => ({ value: g.key, label: g.label }))} style={{ width: 150 }} />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Model (optional)"
            value={opt.productId || undefined}
            onChange={(v) => updOpt(i, { productId: v || '' })}
            options={models
              .filter((m) => !opt.group || groups.find((g) => g.key === opt.group)?.products.some((p) => p.id === m.id))
              .map((m) => ({ value: m.id, label: m.name }))}
            style={{ width: 180 }}
          />
          <Button icon={<DeleteOutlined />} onClick={() => setCross({ options: s.crossSell.options.filter((_, x) => x !== i) })} />
        </div>
      ))}
      <Button icon={<PlusOutlined />} onClick={() => setCross({ options: [...(s.crossSell.options || []), { label: '', group: 'apple', productId: '' }] })}>
        Add option
      </Button>
    </div>
  )

  const rulesPanel = (
    <div>
      {rules.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No rules yet — add one below." />}
      {rules.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <Input placeholder="Rule name" value={r.name} onChange={(e) => updRule(i, { name: e.target.value })} style={{ width: 150 }} />
          <Select value={r.type} onChange={(v) => updRule(i, { type: v })} options={RULE_TYPES} style={{ width: 240 }} />
          {r.type === 'category' && (
            <>
              <Select placeholder="Category" value={r.category || undefined} onChange={(v) => updRule(i, { category: v })} options={categories.map((c) => ({ value: c, label: c }))} showSearch style={{ width: 140 }} />
              <Input placeholder="Shopify collection handle" value={r.collection || ''} onChange={(e) => updRule(i, { collection: e.target.value })} style={{ width: 190 }} />
            </>
          )}
          {r.type === 'product_qty' && (
            <>
              <Select value={r.productKind || 'any'} onChange={(v) => updRule(i, { productKind: v })} options={[{ value: 'any', label: 'Any product' }, { value: 'phone', label: 'Phone case' }, { value: 'tote', label: 'Tote' }, { value: 'frame', label: 'Frame' }]} style={{ width: 140 }} />
              <InputNumber min={1} placeholder="Min qty" value={r.minQty} onChange={(v) => updRule(i, { minQty: v })} addonBefore="≥" style={{ width: 110 }} />
            </>
          )}
          {r.type === 'item' && (
            <>
              <Select value={r.itemKind || 'product'} onChange={(v) => updRule(i, { itemKind: v, itemId: '' })} options={[{ value: 'product', label: 'Product' }, { value: 'charm', label: 'Charm' }]} style={{ width: 110 }} />
              <Select showSearch optionFilterProp="label" placeholder="Pick" value={r.itemId || undefined} onChange={(v) => updRule(i, { itemId: v })} options={(r.itemKind === 'charm' ? charms : models).map((x) => ({ value: x.id, label: x.name }))} style={{ width: 190 }} />
            </>
          )}
          {r.type === 'charm_count' && (
            <InputNumber min={1} placeholder="Min charms" value={r.minCharms} onChange={(v) => updRule(i, { minCharms: v })} addonBefore="≥" style={{ width: 130 }} />
          )}
          <InputNumber min={0} value={r.value} onChange={(v) => updRule(i, { value: v })} style={{ width: 80 }} />
          <Select value={r.discountKind || 'percent'} onChange={(v) => updRule(i, { discountKind: v })} options={DISC_KINDS} style={{ width: 88 }} />
          <Switch checkedChildren="On" unCheckedChildren="Off" checked={r.active !== false} onChange={(v) => updRule(i, { active: v })} />
          <Button icon={<DeleteOutlined />} onClick={() => setRules(rules.filter((_, x) => x !== i))} />
        </div>
      ))}
      <Button icon={<PlusOutlined />} style={{ marginTop: 10 }} onClick={() => setRules([...rules, { name: '', type: 'charm_count', discountKind: 'percent', value: 10, active: true }])}>
        Add rule
      </Button>
    </div>
  )

  const codesPanel = (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>Codes customers can enter at the cart; also used by the cross-sell popup.</p>
      {codes.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input placeholder="CODE" value={c.code} onChange={(e) => updCode(i, { code: e.target.value.toUpperCase() })} style={{ width: 160 }} />
          <InputNumber min={0} value={c.value} onChange={(v) => updCode(i, { value: v })} style={{ width: 80 }} />
          <Select value={c.discountKind || 'percent'} onChange={(v) => updCode(i, { discountKind: v })} options={DISC_KINDS} style={{ width: 88 }} />
          <Switch checkedChildren="On" unCheckedChildren="Off" checked={c.active !== false} onChange={(v) => updCode(i, { active: v })} />
          <Button icon={<DeleteOutlined />} onClick={() => setCodes(codes.filter((_, x) => x !== i))} />
        </div>
      ))}
      <Button icon={<PlusOutlined />} onClick={() => setCodes([...codes, { code: '', discountKind: 'percent', value: 10, active: true }])}>
        Add code
      </Button>
    </div>
  )

  const bundlesPanel = (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Build offers <strong>around a product or a category</strong>: pick what the offer is for, then choose the
        “Bundle &amp; save” style to attach. On a <strong>product page</strong> only the offers whose target
        includes the product being viewed are shown; if several match they become a swipeable carousel. Then{' '}
        <strong>Save &amp; sync to Shopify</strong>: with no code we create a product-scoped
        <strong> automatic discount</strong> (recommended — no code box, can’t be shared); set a code only for
        shareable promos.
      </p>
      {bundles.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No offers yet — add one below." />}
      {bundles.map((b, bi) => (
        <Card
          key={bi}
          size="small"
          style={{ marginBottom: 14 }}
          title={
            editNameIdx === bi ? (
              <Input
                autoFocus
                placeholder="Offer name"
                value={b.name}
                onChange={(e) => updBundle(bi, { name: e.target.value })}
                onBlur={() => setEditNameIdx(null)}
                onPressEnter={() => setEditNameIdx(null)}
                style={{ maxWidth: 280 }}
              />
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <strong>{b.name || 'Untitled offer'}</strong>
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditNameIdx(bi)} title="Rename" />
              </span>
            )
          }
          extra={
            <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
              <Switch checkedChildren="Live" unCheckedChildren="Off" checked={b.active !== false} onChange={(v) => updBundle(bi, { active: v })} />
              <Button danger size="small" icon={<DeleteOutlined />} onClick={() => setBundles(bundles.filter((_, x) => x !== bi))} />
            </span>
          }
        >
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {/* editor — anchor-first: pick what it's for, then the offer */}
            <div style={{ flex: '1 1 380px', minWidth: 0 }}>
              <Divider style={{ margin: '2px 0 8px' }} orientation="left">① This offer is for</Divider>
              <p className="hint" style={{ marginTop: 0 }}>
                Pick a specific product or a whole category. The “Bundle &amp; save” block only appears on those product
                pages, with the product being viewed as the main item.
              </p>
              <BundleSideEditor
                side={b.target}
                onChange={(patch) => updSide(bi, 'target', patch)}
                shopProducts={shopProducts}
                shopLoading={shopLoading}
                shopCollections={shopCollections}
                collLoading={collLoading}
              />

              <Divider style={{ margin: '12px 0 8px' }} orientation="left">② The offer</Divider>
              <label style={discFieldStyle}>
                <span style={{ color: 'var(--ink-soft)' }}>Offer style</span>
                <Select value={b.layout || 'swipe'} onChange={(v) => updBundle(bi, { layout: v })} options={BUNDLE_LAYOUTS} style={{ width: 260 }} />
              </label>
              <label style={discFieldStyle}>
                <span style={{ color: 'var(--ink-soft)' }}>Discount</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <Select value={b.discountKind || 'percent'} onChange={(v) => updBundle(bi, { discountKind: v })} options={[{ value: 'percent', label: '% off' }, { value: 'fixed', label: 'Fixed price £' }]} style={{ width: 130 }} />
                  <InputNumber min={0} value={b.value} onChange={(v) => updBundle(bi, { value: v })} style={{ width: 110 }} addonBefore={b.discountKind === 'fixed' ? '£' : undefined} addonAfter={b.discountKind !== 'fixed' ? '%' : undefined} />
                </span>
              </label>
              <label style={discFieldStyle}>
                <span style={{ color: 'var(--ink-soft)' }}>Discount code (optional)</span>
                <Input value={b.code} onChange={(e) => updBundle(bi, { code: e.target.value.toUpperCase() })} placeholder="Leave blank = automatic discount (recommended)" style={{ maxWidth: 300 }} />
              </label>

              {b.layout !== 'volume' && (
                <>
                  <Divider style={{ margin: '12px 0 8px' }} orientation="left">
                    {b.layout === 'swipe' ? '③ Bundle it with — swipe to choose' : '③ Bundle it with'}
                  </Divider>
                  <p className="hint" style={{ marginTop: 0 }}>
                    {b.layout === 'swipe'
                      ? 'The add-ons the customer swipes through. Pick specific products or a whole category.'
                      : 'The add-ons the customer can pick to bundle with. Pick specific products or a whole category.'}
                  </p>
                  <BundleSideEditor
                    side={b.partner}
                    onChange={(patch) => updSide(bi, 'partner', patch)}
                    shopProducts={shopProducts}
                    shopLoading={shopLoading}
                    shopCollections={shopCollections}
                    collLoading={collLoading}
                  />
                </>
              )}

              <Divider style={{ margin: '12px 0 8px' }} orientation="left">Wording &amp; display</Divider>
              <label style={discFieldStyle}>
                <span style={{ color: 'var(--ink-soft)' }}>Block title (storefront + cart)</span>
                <Input value={b.blockTitle} onChange={(e) => updBundle(bi, { blockTitle: e.target.value })} placeholder="Bundle & save 15%!" style={{ maxWidth: 300 }} />
              </label>
              <label style={discFieldStyle}>
                <span style={{ color: 'var(--ink-soft)' }}>Claim button text</span>
                <Input value={b.claimText} onChange={(e) => updBundle(bi, { claimText: e.target.value })} placeholder="Add to basket" style={{ maxWidth: 300 }} />
              </label>
              <label style={discFieldStyle}>
                <span style={{ color: 'var(--ink-soft)' }}>Show variant selectors</span>
                <Switch checked={b.showVariants !== false} onChange={(v) => updBundle(bi, { showVariants: v })} />
              </label>
            </div>
            {/* live structural preview + style controls */}
            <div style={{ flex: '1 1 280px', minWidth: 0 }}>
              <div className="hint" style={{ marginBottom: 6 }}>Preview</div>
              <BundlePreview bundle={b} />
              <Divider style={{ margin: '12px 0 8px' }}>Preview style</Divider>
              <div className="bundle-style">
                <label className="bundle-style__row">
                  <span>Accent &amp; button</span>
                  <input type="color" value={styleOf(b).accent} onChange={(e) => updStyle(bi, { accent: e.target.value })} />
                </label>
                <label className="bundle-style__row">
                  <span>Card background</span>
                  <input type="color" value={styleOf(b).cardBg} onChange={(e) => updStyle(bi, { cardBg: e.target.value })} />
                </label>
                <label className="bundle-style__row">
                  <span>Badge background</span>
                  <input type="color" value={styleOf(b).badgeBg} onChange={(e) => updStyle(bi, { badgeBg: e.target.value })} />
                </label>
                <label className="bundle-style__row">
                  <span>Badge text</span>
                  <input type="color" value={styleOf(b).badgeInk} onChange={(e) => updStyle(bi, { badgeInk: e.target.value })} />
                </label>
                <label className="bundle-style__row">
                  <span>Corner radius</span>
                  <Slider min={0} max={24} value={styleOf(b).radius} onChange={(v) => updStyle(bi, { radius: v })} style={{ flex: 1, marginLeft: 12 }} />
                </label>
                <Button size="small" onClick={() => updBundle(bi, { style: { ...STYLE_DEFAULT } })}>Reset style</Button>
              </div>
            </div>
          </div>
        </Card>
      ))}
      <Button icon={<PlusOutlined />} onClick={() => setBundles([...bundles, bundleDefault()])}>
        Add offer
      </Button>
    </div>
  )

  return (
    <div>
      <Tabs
        tabPosition="left"
        style={{ minHeight: 380 }}
        items={[
          { key: 'crosssell', label: 'Cross-sell prompt', children: crossSellPanel },
          { key: 'rules', label: 'Discount rules', children: rulesPanel },
          { key: 'codes', label: 'Discount codes', children: codesPanel },
          { key: 'bundles', label: 'Bundle up & Save', children: bundlesPanel },
        ]}
      />

      <Divider style={{ margin: '8px 0 16px' }} />
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
        Save discount settings
      </Button>
      <Button icon={<PercentageOutlined />} loading={syncing} onClick={saveAndSync} style={{ marginLeft: 10 }}>
        Save &amp; sync to Shopify
      </Button>
      <p className="hint" style={{ marginTop: 10 }}>
        <strong>Save</strong> stores your settings (the customizer preview + cross-sell popup use them).{' '}
        <strong>Save &amp; sync to Shopify</strong> creates matching real discounts via the Admin API:
        every active <em>code</em> becomes a Shopify code discount, and <em>category</em> / <em>product-quantity</em>{' '}
        rules become automatic discounts. Specific-item / charm-count rules aren’t natively enforceable — issue a
        code for those. (Requires the app’s <code>write_discounts</code> scope — reinstall the app if you just added it.)
      </p>
    </div>
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
    try { await patchCharm(c.id, { price }); refresh() }
    catch (e) { message.error(e.message) }
  }
  const resizeCharm = async (c, widthMm, heightMm) => {
    await patchCharm(c.id, { widthMm, heightMm })
    refresh()
  }
  const updateCharm = async (c, patch) => {
    await patchCharm(c.id, patch)
    refresh()
  }
  const repriceProduct = async (p, basePrice) => {
    try { await patchProduct(p.id, { basePrice }) }
    catch (e) { message.error(e.message) }
  }
  const updateProduct = async (p, patch) => {
    await patchProduct(p.id, patch)
    refresh()
  }
  const removeProduct = (p) => modal.confirm({
    title: `Delete "${p.name}" from Shopify?`,
    okText: 'Delete', okButtonProps: { danger: true },
    onOk: async () => { try { await deleteProduct(p.id); message.success('Deleted.'); refresh() } catch (e) { message.error(e.message) } },
  })

  return { embedded, token, saveToken, loading, publishing, data, refresh, publish, toggleHide, removeCharm, repriceCharm, resizeCharm, updateCharm, repriceProduct, updateProduct, removeProduct }
}

// ---------------------------------------------------------------------------
// Categories & order tab
// ---------------------------------------------------------------------------
/** Return `items` reordered so the ones listed in `order` come first (in that
 *  order), then any not listed keep their natural order. */
function orderList(items, order) {
  const set = new Set(items)
  const head = (order || []).filter((x) => set.has(x))
  const seen = new Set(head)
  return [...head, ...items.filter((x) => !seen.has(x))]
}

const taxRowStyle = { display: 'flex', alignItems: 'center', gap: 6 }
const taxNameBtn = { flex: 1, textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer', padding: '3px 6px', borderRadius: 6, fontFamily: 'inherit', fontSize: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }
const taxNameSel = { background: 'rgba(179,91,91,.12)', fontWeight: 600 }

/**
 * A reusable reorderable list with drag-to-reorder, inline rename, merge-and-
 * delete and add. `items` = [{ key, label?, count?, img? }]. `onReorder(from,to)`,
 * `onRename(key, newName)`, `onDelete(key, targetKey)` and `onAdd(name)` are all
 * optional — the matching control renders only when its handler is provided.
 * Reordering uses native HTML5 drag-and-drop (grab the ⠿ handle or the row).
 */
function TaxonomyList({ title, hint, items, selected, onSelect, onReorder, onRename, onDelete, onAdd, addLabel, mergeLabel }) {
  const [editKey, setEditKey] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [delKey, setDelKey] = useState(null)
  const [delTarget, setDelTarget] = useState(null)
  const [addVal, setAddVal] = useState('')
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)
  const startEdit = (k) => { setDelKey(null); setEditKey(k); setEditVal(k) }
  const saveEdit = () => { const v = editVal.trim(); if (v) onRename(editKey, v); setEditKey(null) }
  const startDel = (k) => { setEditKey(null); setDelKey(k); setDelTarget(null) }
  const confirmDel = () => { if (delTarget) onDelete(delKey, delTarget); setDelKey(null) }
  const doAdd = () => { const v = addVal.trim(); if (v) onAdd(v); setAddVal('') }
  const dropOn = (idx) => { if (dragIdx != null && dragIdx !== idx && onReorder) onReorder(dragIdx, idx); setDragIdx(null); setOverIdx(null) }
  return (
    <Card size="small" title={title} styles={{ body: { padding: 12 } }}>
      {hint && <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>{hint}</p>}
      {!items.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing here yet" />}
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        {items.map((it, idx) => {
          if (editKey === it.key)
            return (
              <div key={it.key} style={taxRowStyle}>
                <Input size="small" autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)} onPressEnter={saveEdit} style={{ flex: 1 }} />
                <Button size="small" type="primary" onClick={saveEdit}>Save</Button>
                <Button size="small" onClick={() => setEditKey(null)}>Cancel</Button>
              </div>
            )
          if (delKey === it.key)
            return (
              <div key={it.key} style={taxRowStyle}>
                <span style={{ color: 'var(--ink-soft)', fontSize: 12, whiteSpace: 'nowrap' }}>{mergeLabel || 'Move to'}</span>
                <Select size="small" value={delTarget} onChange={setDelTarget} placeholder="choose…" style={{ flex: 1, minWidth: 110 }}
                  options={items.filter((x) => x.key !== it.key).map((x) => ({ value: x.key, label: x.label ?? x.key }))} />
                <Button size="small" danger type="primary" disabled={!delTarget} onClick={confirmDel}>Merge</Button>
                <Button size="small" onClick={() => setDelKey(null)}>Cancel</Button>
              </div>
            )
          const nameInner = (
            <>
              {it.img && <img src={it.img} alt="" draggable={false} width={26} height={26} style={{ objectFit: 'contain', borderRadius: 4, background: '#faf5ec', flex: 'none' }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label ?? it.key}</span>
              {it.count != null && <Tag style={{ marginLeft: 2 }}>{it.count}</Tag>}
            </>
          )
          const isOver = overIdx === idx && dragIdx != null && dragIdx !== idx
          return (
            <div
              key={it.key}
              draggable={!!onReorder}
              onDragStart={(e) => { setDragIdx(idx); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)) } catch { /* noop */ } }}
              onDragEnter={(e) => { e.preventDefault(); if (onReorder) setOverIdx(idx) }}
              onDragOver={(e) => { if (onReorder) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
              onDrop={(e) => { e.preventDefault(); dropOn(idx) }}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
              style={{
                ...taxRowStyle,
                borderRadius: 6,
                opacity: dragIdx === idx ? 0.4 : 1,
                background: isOver ? 'rgba(179,91,91,.08)' : 'transparent',
                boxShadow: isOver ? 'inset 0 2px 0 var(--rouge, #b35b5b)' : 'none',
              }}
            >
              {onReorder && <HolderOutlined style={{ cursor: 'grab', color: '#b0a693', flex: 'none' }} />}
              {onSelect ? (
                <button type="button" onClick={() => onSelect(it.key)} style={{ ...taxNameBtn, ...(selected === it.key ? taxNameSel : null) }}>{nameInner}</button>
              ) : (
                <span style={{ ...taxNameBtn, cursor: onReorder ? 'grab' : 'default' }}>{nameInner}</span>
              )}
              {onRename && <Button size="small" icon={<EditOutlined />} onClick={() => startEdit(it.key)} />}
              {onDelete && <Button size="small" danger icon={<DeleteOutlined />} disabled={items.length < 2} onClick={() => startDel(it.key)} />}
            </div>
          )
        })}
      </Space>
      {onAdd && (
        <div style={{ ...taxRowStyle, marginTop: 10 }}>
          <Input size="small" placeholder={addLabel} value={addVal} onChange={(e) => setAddVal(e.target.value)} onPressEnter={doAdd} style={{ flex: 1 }} />
          <Button size="small" icon={<PlusOutlined />} onClick={doAdd}>Add</Button>
        </div>
      )}
    </Card>
  )
}

/**
 * Manage the customizer taxonomy: rename / merge / add charm categories (tabs)
 * and sub-categories (sections), and set the display order of categories,
 * sub-categories and the charms within a section. A rename cascades to every
 * charm (via /api/admin/taxonomy); the order is saved to /api/settings.
 */
function TaxonomyTab({ cloud }) {
  const { message } = App.useApp()
  const charms = cloud?.data?.charms || []
  const [tax, setTax] = useState({ categoryOrder: [], subOrder: {}, charmOrder: {} })
  const [selCat, setSelCat] = useState(null)
  const [selSub, setSelSub] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchSettings()
      .then((d) => { if (d && d.taxonomy) setTax((t) => ({ ...t, ...d.taxonomy })) })
      .catch(() => {})
  }, [])

  const catOf = (c) => c.category || 'gold'
  const subOf = (c) => c.collection || 'Custom'

  const cats = useMemo(() => {
    const seen = []
    const set = new Set()
    for (const c of charms) { const k = catOf(c); if (!set.has(k)) { set.add(k); seen.push(k) } }
    for (const k of tax.categoryOrder || []) if (!set.has(k)) { set.add(k); seen.push(k) }
    return orderList(seen, tax.categoryOrder)
  }, [charms, tax.categoryOrder])

  const subs = useMemo(() => {
    if (!selCat) return []
    const seen = []
    const set = new Set()
    for (const c of charms) if (catOf(c) === selCat) { const k = subOf(c); if (!set.has(k)) { set.add(k); seen.push(k) } }
    for (const k of tax.subOrder[selCat] || []) if (!set.has(k)) { set.add(k); seen.push(k) }
    return orderList(seen, tax.subOrder[selCat])
  }, [charms, selCat, tax.subOrder])

  const charmRows = useMemo(() => {
    if (!selCat || !selSub) return []
    const list = charms.filter((c) => catOf(c) === selCat && subOf(c) === selSub)
    const byId = new Map(list.map((c) => [c.id, c]))
    const ids = orderList(list.map((c) => c.id), tax.charmOrder[`${selCat}::${selSub}`])
    return ids.map((id) => byId.get(id)).filter(Boolean)
  }, [charms, selCat, selSub, tax.charmOrder])

  const catCount = (cat) => charms.filter((c) => catOf(c) === cat).length
  const subCount = (sub) => charms.filter((c) => catOf(c) === selCat && subOf(c) === sub).length

  const persist = async (nextTax) => {
    setTax(nextTax)
    try { await saveSettings({ taxonomy: nextTax }) }
    catch (e) { message.error(`Could not save order: ${e.message}`) }
  }
  // Drag-to-reorder: move the item at `from` to position `to`, then persist the
  // full explicit order.
  const arrayMove = (arr, from, to) => {
    if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return null
    const n = [...arr]
    const [x] = n.splice(from, 1)
    n.splice(to, 0, x)
    return n
  }

  const reorderCat = (from, to) => { const n = arrayMove(cats, from, to); if (n) persist({ ...tax, categoryOrder: n }) }
  const reorderSub = (from, to) => { const n = arrayMove(subs, from, to); if (n) persist({ ...tax, subOrder: { ...tax.subOrder, [selCat]: n } }) }
  const reorderCharm = (from, to) => {
    const n = arrayMove(charmRows.map((c) => c.id), from, to)
    if (n) persist({ ...tax, charmOrder: { ...tax.charmOrder, [`${selCat}::${selSub}`]: n } })
  }

  // Rename / merge a category → cascade to charms, then fix up the order keys.
  const renameCat = async (from, to) => {
    if (!to || to === from) return
    setBusy(true)
    try {
      await renameTaxonomy('category', from, to)
      const next = JSON.parse(JSON.stringify(tax))
      next.categoryOrder = [...new Set(orderList(cats, tax.categoryOrder).map((k) => (k === from ? to : k)))]
      if (next.subOrder[from]) { next.subOrder[to] = [...new Set([...(next.subOrder[to] || []), ...next.subOrder[from]])]; delete next.subOrder[from] }
      for (const key of Object.keys(next.charmOrder)) {
        if (key.startsWith(`${from}::`)) { next.charmOrder[`${to}::${key.slice(from.length + 2)}`] = next.charmOrder[key]; delete next.charmOrder[key] }
      }
      await persist(next)
      await cloud.refresh()
      if (selCat === from) setSelCat(to)
      message.success(`Renamed “${from}” → “${to}” — charms updated.`)
    } catch (e) { message.error(e.message) } finally { setBusy(false) }
  }
  const renameSub = async (from, to) => {
    if (!selCat || !to || to === from) return
    setBusy(true)
    try {
      await renameTaxonomy('subcategory', from, to, selCat)
      const next = JSON.parse(JSON.stringify(tax))
      next.subOrder[selCat] = [...new Set(orderList(subs, tax.subOrder[selCat]).map((k) => (k === from ? to : k)))]
      const ok = `${selCat}::${from}`, nk = `${selCat}::${to}`
      if (next.charmOrder[ok]) { next.charmOrder[nk] = [...new Set([...(next.charmOrder[nk] || []), ...next.charmOrder[ok]])]; delete next.charmOrder[ok] }
      await persist(next)
      await cloud.refresh()
      if (selSub === from) setSelSub(to)
      message.success(`Renamed “${from}” → “${to}” — charms updated.`)
    } catch (e) { message.error(e.message) } finally { setBusy(false) }
  }
  const addCat = (name) => { if (cats.includes(name)) { setSelCat(name); setSelSub(null); return } persist({ ...tax, categoryOrder: [...cats, name] }); setSelCat(name); setSelSub(null) }
  const addSub = (name) => { if (!selCat) return; if (subs.includes(name)) { setSelSub(name); return } persist({ ...tax, subOrder: { ...tax.subOrder, [selCat]: [...subs, name] } }); setSelSub(name) }

  return (
    <Spin spinning={busy}>
      <p className="hint" style={{ marginTop: 0 }}>
        Rename, merge, add and reorder the customizer’s <strong>categories</strong> (the tabs) and{' '}
        <strong>sub-categories</strong> (the sections in a tab), and set the order charms appear in.
        Renames update every affected charm. Charms are assigned to a category / sub-category in the{' '}
        <strong>Charms</strong> tab.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 300px', minWidth: 250 }}>
          <TaxonomyList
            title="Categories · tabs"
            hint="The customizer’s top-level tabs. Drag to reorder; select one to manage its sub-categories."
            items={cats.map((k) => ({ key: k, count: catCount(k) }))}
            selected={selCat}
            onSelect={(k) => { setSelCat(k); setSelSub(null) }}
            onReorder={reorderCat}
            onRename={renameCat}
            onDelete={renameCat}
            onAdd={addCat}
            addLabel="New category name"
            mergeLabel="Move its charms to"
          />
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 250 }}>
          {selCat ? (
            <TaxonomyList
              title={`Sub-categories · sections of “${selCat}”`}
              hint="The sections inside the selected tab. Drag to reorder; select one to reorder its charms."
              items={subs.map((k) => ({ key: k, count: subCount(k) }))}
              selected={selSub}
              onSelect={setSelSub}
              onReorder={reorderSub}
              onRename={renameSub}
              onDelete={renameSub}
              onAdd={addSub}
              addLabel="New sub-category name"
              mergeLabel="Move its charms to"
            />
          ) : (
            <Card size="small"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select a category on the left" /></Card>
          )}
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 250 }}>
          {selCat && selSub ? (
            <TaxonomyList
              title={`Charms · order in “${selSub}”`}
              hint="Drag the charms to set the order they appear in this section."
              items={charmRows.map((c) => ({ key: c.id, label: c.name, img: resolveAsset(c.src) }))}
              onReorder={reorderCharm}
            />
          ) : (
            <Card size="small"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select a sub-category to reorder its charms" /></Card>
          )}
        </div>
      </div>
    </Spin>
  )
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
          {
            key: 'products',
            label: (
              <span>
                <AppstoreOutlined /> Products
              </span>
            ),
            children: <ProductsTab draft={draft} set={set} cloud={cloud} />,
          },
          {
            key: 'charms',
            label: (
              <span>
                <TagsOutlined /> Charms
              </span>
            ),
            children: <CharmsTab draft={draft} set={set} cloud={cloud} />,
          },
          {
            key: 'taxonomy',
            label: (
              <span>
                <OrderedListOutlined /> Categories & order
              </span>
            ),
            children: <TaxonomyTab cloud={cloud} />,
          },
          {
            key: 'discount',
            label: (
              <span>
                <PercentageOutlined /> Discount
              </span>
            ),
            children: <DiscountTab cloud={cloud} />,
          },
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

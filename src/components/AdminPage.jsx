import { useMemo, useRef, useState } from 'react'
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
import { charmCategory } from '../lib/catalog'
import { clearAdmin, defaultAdmin, loadAdmin, saveAdmin } from '../lib/adminStore'
import { extractPieces, loadImageData } from '../lib/segment'

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
// Custom charms
// ---------------------------------------------------------------------------
function CharmsTab({ draft, set }) {
  const { message } = App.useApp()
  const [form, setForm] = useState({
    name: '',
    category: 'gold',
    tier: 'midi',
    price: 2,
    widthMm: 16,
    image: null,
  })
  const [query, setQuery] = useState('')

  const addCharm = () => {
    if (!form.name.trim()) return message.warning('Give the charm a name.')
    if (!form.image?.src) return message.warning('Upload the charm artwork.')
    const tier = TIER_OPTS.find((t) => t.value === form.tier)
    const widthMm = Number(form.widthMm) || 16
    const heightMm = +(widthMm * (form.image.h / form.image.w)).toFixed(1)
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
    }
    set((d) => ({ ...d, customCharms: [charm, ...(d.customCharms || [])] }))
    setForm({ name: '', category: 'gold', tier: 'midi', price: 2, widthMm: 16, image: null })
    message.success('Charm added — Save changes to publish.')
  }

  const removeCustom = (id) =>
    set((d) => ({ ...d, customCharms: d.customCharms.filter((c) => c.id !== id) }))

  // Base catalogue charms with current overrides applied, filtered by search.
  const baseRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return charmData.charms
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 120)
      .map((c) => ({ ...c, category: charmCategory(c) }))
  }, [query])

  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
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
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={addCharm} style={{ marginTop: 12 }}>
          Add charm
        </Button>
      </Card>

      <Card size="small" title={`Your custom charms (${draft.customCharms?.length || 0})`}>
        {draft.customCharms?.length ? (
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={draft.customCharms}
            columns={[
              {
                title: 'Art',
                dataIndex: 'src',
                width: 64,
                render: (src) => <Image src={src} width={40} height={40} style={{ objectFit: 'contain' }} />,
              },
              { title: 'Name', dataIndex: 'name' },
              { title: 'Category', dataIndex: 'category', render: (c) => <Tag>{c}</Tag> },
              { title: 'Size', dataIndex: 'widthMm', render: (w, r) => `${w}×${r.heightMm} mm` },
              { title: 'Price', dataIndex: 'price', render: (p) => `£${p}` },
              {
                title: '',
                width: 48,
                render: (_, r) => (
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeCustom(r.id)}
                  />
                ),
              },
            ]}
          />
        ) : (
          <Empty description="No custom charms yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Card>

      <Card size="small" title="Re-price or hide catalogue charms">
        <Input.Search
          allowClear
          placeholder="Search the 220+ catalogue charms…"
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
  )
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
function ProductsTab({ draft, set }) {
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

export default function AdminPage() {
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState(() => loadAdmin())
  const [tab, setTab] = useState('products')

  // On the dedicated admin subdomain (admin.charme-customizer.pages.dev) the
  // storefront lives on the bare project domain (admin. stripped); elsewhere the
  // customizer is just the site root.
  const storefrontUrl =
    typeof window !== 'undefined' && /^admin\./i.test(window.location.hostname)
      ? `${window.location.protocol}//${window.location.hostname.replace(/^admin\./i, '')}`
      : '/'

  const set = (updater) => setDraft((d) => (typeof updater === 'function' ? updater(d) : updater))

  const save = () => {
    saveAdmin(draft)
    message.success('Saved. Open or reload the storefront to see your changes.')
  }
  const resetAll = () => {
    modal.confirm({
      title: 'Reset all merchant changes?',
      content: 'This removes every custom product, custom charm, price and hide override.',
      okText: 'Reset everything',
      okButtonProps: { danger: true },
      onOk: () => {
        clearAdmin()
        setDraft(defaultAdmin())
        message.success('All overrides cleared.')
      },
    })
  }

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
          <Button icon={<ReloadOutlined />} danger onClick={resetAll}>
            Reset all
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={save}>
            Save changes
          </Button>
        </Space>
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'products', label: 'Products', children: <ProductsTab draft={draft} set={set} /> },
          { key: 'charms', label: 'Charms', children: <CharmsTab draft={draft} set={set} /> },
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
        Changes are saved to this browser and merged into the storefront on its next load. To
        publish to every visitor, persist the same overrides to a shared backend (e.g. Cloudflare
        KV/D1 + R2 for images) — the storefront merge layer stays the same.
      </p>
    </div>
  )
}

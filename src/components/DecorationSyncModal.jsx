import { useState } from 'react'
import { Alert, App, Button, Checkbox, Image, Input, Modal, Space, Steps, Table, Tag } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import { syncDecorations } from '../lib/adminApi'
import { decorationSyncPreview, variantName } from '../lib/decorationSync.js'
import { resolveAsset } from '../lib/assets'
import { prepareDecorationSyncImage } from '../lib/decorationSyncImage.js'

export default function DecorationSyncModal({ kind, onSaved }) {
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState({ missing: [], existing: [] })
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const [completed, setCompleted] = useState(new Set())
  const [reprocessExisting, setReprocessExisting] = useState(false)
  const plural = kind === 'charm' ? 'charms' : 'patches'

  const scan = async () => {
    setBusy(true)
    setError('')
    try {
      const variants = []
      let records = []
      let after = null
      do {
        const data = await syncDecorations({ kind, action: 'preview', keyword, ...(after ? { after } : {}) })
        variants.push(...data.variants)
        if (data.records) records = data.records
        after = data.after
        setProgress(`Scanned ${variants.length} Shopify variants${after ? ' - still scanning...' : '.'}`)
      } while (after)
      setPreview(decorationSyncPreview(variants, records, keyword))
      setSelected([])
      setReprocessExisting(false)
      setCompleted(new Set())
      setQuery('')
      setStep(1)
    } catch (error) {
      setError(error.message)
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const confirm = async () => {
    setBusy(true)
    setError('')
    const failures = []
    let changed = 0
    try {
      for (const [index, key] of selected.entries()) {
        const isNew = key.startsWith('variant:')
        const id = key.slice(isNew ? 8 : 9)
        const images = {}
        if (isNew || reprocessExisting) {
          setStep(2)
          const item = isNew
            ? preview.missing.find((variant) => String(variant.id) === id)
            : preview.existing.find((record) => record.id === id)
          setProgress(`Removing background ${index + 1} of ${selected.length}: ${isNew && item ? variantName(item) : item?.name || id}...`)
          try {
            const src = isNew ? item?.imageUrl : item?.src
            if (!src) throw new Error('No image available for background removal')
            images[key] = await prepareDecorationSyncImage(resolveAsset(src))
          } catch (error) {
            failures.push(`${key}: ${error.message}`)
            continue
          }
        }
        setStep(3)
        setProgress(`Saving ${index + 1} of ${selected.length} to Shopify...`)
        const result = await syncDecorations({
          kind, action: 'apply',
          variantIds: isNew ? [id] : [],
          existingIds: isNew ? [] : [id],
          reprocessExisting,
          images,
        })
        const done = [...result.created, ...result.updated, ...result.skipped]
        const doneSet = new Set(done)
        setCompleted((previous) => new Set([...previous, ...done]))
        setSelected((previous) => previous.filter((key) => !doneSet.has(key)))
        changed += result.created.length + result.updated.length
        failures.push(...result.failed.map((item) => `${item.key}: ${item.error}`))
      }
      if (failures.length) {
        setError(`Some items were not saved. Successful items are kept; retry only the remaining selection. ${failures.join('; ')}`)
      } else {
        message.success(`Shopify sync complete. Saved ${changed} ${plural}. New images${reprocessExisting ? ' and selected existing images' : ''} were processed for transparent backgrounds; already-linked variants were not duplicated.`)
        setOpen(false)
      }
    } catch (error) {
      setError(`Sync interrupted: ${error.message}. Saved items are kept. Retry safely; existing links will be checked again.`)
    } finally {
      setBusy(false)
      setStep(1)
      setProgress('')
      await onSaved()
    }
  }

  const matches = (row) => `${row.name} ${row.variant?.productTitle || ''} ${row.variant?.title || ''} ${row.variant?.id || ''}`.toLowerCase().includes(query.trim().toLowerCase())
  const missing = preview.missing.map((variant) => ({
    key: `variant:${variant.id}`, name: variantName(variant), src: variant.imageUrl, variant,
    disabled: !variant.imageUrl,
  }))
  const existing = preview.existing.map((record) => ({
    ...record, key: `existing:${record.id}`, disabled: !record.variant,
  }))
  const table = (rows) => (
    <Table
      size="small"
      rowKey="key"
      dataSource={rows.filter(matches)}
      scroll={{ x: 650 }}
      pagination={{ defaultPageSize: 10, showSizeChanger: true }}
      rowSelection={{
        selectedRowKeys: selected,
        preserveSelectedRowKeys: true,
        onChange: setSelected,
        getCheckboxProps: (row) => ({ disabled: busy || row.disabled || completed.has(row.key) }),
      }}
      columns={[
        { title: 'Image', width: 64, render: (_, row) => row.src ? <Image src={resolveAsset(row.src)} width={40} height={40} style={{ objectFit: 'contain' }} /> : 'No image' },
        { title: 'Name', dataIndex: 'name' },
        { title: 'Shopify variant', render: (_, row) => row.variant ? `${row.variant.productTitle} / ${row.variant.title} (#${row.variant.id})` : 'Not linked / variant no longer exists' },
        { title: 'Shopify price', width: 100, render: (_, row) => row.variant ? Number(row.variant.price).toFixed(2) : '-' },
        { title: 'Status', width: 120, render: (_, row) => completed.has(row.key) ? <Tag color="green">Saved</Tag> : row.disabled ? <Tag color="orange">{row.variant ? 'Image required' : 'Cannot sync'}</Tag> : row.variant?.available ? <Tag>Available</Tag> : <Tag>Sold out</Tag> },
      ]}
    />
  )

  return (
    <>
      <Button icon={<SyncOutlined />} onClick={() => { setOpen(true); setStep(0); setError(''); setProgress('') }}>
        Import / sync Shopify variants
      </Button>
      <Modal
        title={`Import / sync Shopify ${plural}`}
        open={open}
        width={960}
        onCancel={() => !busy && setOpen(false)}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
        footer={step === 0 ? [
          <Button key="cancel" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>,
          <Button key="scan" type="primary" loading={busy} onClick={scan}>Scan Shopify variants</Button>,
        ] : [
          <Button key="back" disabled={busy} onClick={() => setStep(0)}>Back to naming rule</Button>,
          <Button key="cancel" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>,
          <Button key="confirm" type="primary" loading={busy} disabled={!selected.length} onClick={confirm}>Confirm and save ({selected.length})</Button>,
        ]}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Steps size="small" current={step} items={[{ title: 'Naming rule' }, { title: 'Review and select' }, { title: 'Auto-remove backgrounds' }, { title: 'Save to Shopify' }]} />
          {error && <Alert type="error" showIcon message={error} />}
          {progress && <Alert type="info" showIcon message={progress} />}
          {step === 0 ? (
            <>
              <p>Enter an optional keyword from your Shopify product / variant naming rule, for example "charm", "patch" or "initial". Matching ignores letter case and checks product titles, variant titles and product handles.</p>
              <Input value={keyword} disabled={busy} onChange={(event) => setKeyword(event.target.value)} placeholder="Contains keyword (optional)" aria-label="Shopify naming rule keyword" />
              <Alert type="info" showIcon message="Leave blank to show all Shopify variants, then search and select the items to import. Scanning does not save anything." />
              <Alert type="info" showIcon message="Automatic background removal is included"
                description="After confirmation, new Shopify images are automatically converted into transparent PNGs before saving. Already-transparent images are preserved. You can also opt to reprocess selected existing catalogue images in the next step. Keep this window open until syncing finishes." />
            </>
          ) : (
            <>
              <Alert
                type="info"
                showIcon
                message="Only checked items are saved. Unchecked existing items are not changed or deleted."
                description={`New ${plural} use Shopify names and prices; their images are automatically background-removed and saved as transparent PNGs, with Midi / 16 mm placeholder sizing. Review artwork, category and physical size after import. Checked existing items update their price only unless you enable reprocessing below; names, dimensions and visibility are preserved. Sold-out variants can also be imported. Prices use the Shopify store currency.`}
              />
              <Checkbox checked={reprocessExisting} disabled={busy} onChange={(event) => setReprocessExisting(event.target.checked)}>
                Also remove backgrounds from selected existing catalogue images (replaces their artwork)
              </Checkbox>
              <Alert type="warning" showIcon message="Use one decoration on a clean, plain background"
                description="Background removal runs locally in your browser. If an image cannot be loaded or a single decoration cannot be isolated, that item is not saved; the error is shown so you can fix the artwork and retry. Successful items are kept. Existing-image reprocessing uses the current catalogue artwork, not a replacement Shopify product photo." />
              <Input.Search allowClear value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} placeholder="Search product, variant, name or variant ID" aria-label="Search sync results" />
              <h3>New / missing {plural} ({missing.length})</h3>
              {table(missing)}
              <h3>Existing {plural} ({existing.length})</h3>
              {table(existing)}
            </>
          )}
        </Space>
      </Modal>
    </>
  )
}

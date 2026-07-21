import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Drawer, Empty, Image, Input, Select, Spin, Tag, Typography } from 'antd'
import {
  CloudUploadOutlined,
  DiffOutlined,
  FileImageOutlined,
  HistoryOutlined,
  LinkOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import '../case-review.css'

const FINISHES = ['black', 'white', 'glitter']
const STATUS_OPTIONS = [
  { value: 'checking', label: '待检查' },
  { value: 'approved', label: '已通过' },
  { value: 'changes', label: '需修改' },
]
const ISSUE_OPTIONS = [
  { value: 'edge-gap', label: '胶和壳边缘距离太大了，要近一些' },
  { value: 'wrong-pattern', label: '胶的样式/花纹不对，需要参考 Pixel 10 Pro' },
  { value: 'camera-clearance', label: '胶靠近摄像头的部分不应该包裹摄像头，而是留存一定空间（要有 border radius）' },
  { value: 'incomplete-coverage', label: '胶没有 cover 整个手机壳（有留白）' },
  { value: 'shell-distortion', label: '手机壳有奇怪的缩放，例如摄像头比例不对，或与 without gel 相比有很大变动' },
]

function finishesFor(model, history) {
  return FINISHES.filter((finish) => {
    const hasHistory = (history?.prompts || []).some(
      (prompt) => prompt.modelId === model.id && prompt.finish === finish,
    ) || (history?.images || []).some(
      (image) => image.modelId === model.id && image.finish === finish,
    )
    return finish === 'glitter'
      ? model.withGel?.glitter || model.withGel?.black || model.withGel?.white || hasHistory
      : model.withoutGel?.[finish] || model.withGel?.[finish] || hasHistory
  })
}

function bareFinish(model, finish) {
  if (finish !== 'glitter') return finish
  if (model.withoutGel?.white) return 'white'
  return model.withoutGel?.black ? 'black' : null
}

function reviewKey(modelId, finish) {
  return `${modelId}:${finish}`
}

function currentHistoryImage(history, modelId, finish) {
  const entries = (history?.images || []).filter(
    (image) => image.modelId === modelId && image.finish === finish,
  )
  return entries.find((image) => image.current)?.imagePath || ''
}

function fixedReferenceUrl(referenceImage) {
  const fileName = String(referenceImage || '').replace(/\(\d+\)(?=\.png$)/, '')
  if (fileName.startsWith('gpt-')) return `/assets/cases/gpt-references/${fileName}`
  if (/^iphone-(16|17)-(black|white)\.png$/.test(fileName)) {
    return `/assets/cases/case-without-gel/${fileName}`
  }
  return ''
}

function statusColor(status) {
  if (status === 'approved') return 'success'
  if (status === 'changes') return 'error'
  return 'default'
}

function promptParagraphs(value) {
  return String(value || '').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
}

function diffParagraphs(before, after) {
  const left = promptParagraphs(before)
  const right = promptParagraphs(after)
  const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0))
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      matrix[leftIndex][rightIndex] = left[leftIndex] === right[rightIndex]
        ? matrix[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(matrix[leftIndex + 1][rightIndex], matrix[leftIndex][rightIndex + 1])
    }
  }
  const changes = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length || rightIndex < right.length) {
    if (leftIndex < left.length && rightIndex < right.length && left[leftIndex] === right[rightIndex]) {
      changes.push({ type: 'same', text: left[leftIndex] })
      leftIndex += 1
      rightIndex += 1
    } else if (rightIndex < right.length && (leftIndex === left.length || matrix[leftIndex][rightIndex + 1] >= matrix[leftIndex + 1][rightIndex])) {
      changes.push({ type: 'added', text: right[rightIndex] })
      rightIndex += 1
    } else {
      changes.push({ type: 'removed', text: left[leftIndex] })
      leftIndex += 1
    }
  }
  return changes
}

function HistoryDrawer({ history, target, onClose }) {
  const key = target ? reviewKey(target.model.id, target.finish) : ''
  const prompts = useMemo(
    () => (history.prompts || []).filter((prompt) => reviewKey(prompt.modelId, prompt.finish) === key),
    [history.prompts, key],
  )
  const images = useMemo(
    () => (history.images || []).filter((image) => reviewKey(image.modelId, image.finish) === key),
    [history.images, key],
  )
  const [beforeKey, setBeforeKey] = useState('')
  const [afterKey, setAfterKey] = useState('')

  useEffect(() => {
    setAfterKey(prompts[0]?.key || '')
    setBeforeKey(prompts[1]?.key || prompts[0]?.key || '')
  }, [key, prompts])

  const promptsByKey = useMemo(
    () => Object.fromEntries(prompts.map((prompt) => [prompt.key, prompt])),
    [prompts],
  )
  const latestPrompt = prompts[0]
  const before = promptsByKey[beforeKey]
  const after = promptsByKey[afterKey]
  const diff = useMemo(
    () => diffParagraphs(before?.promptText, after?.promptText),
    [after?.promptText, before?.promptText],
  )
  const versionOptions = prompts.map((prompt) => ({
    value: prompt.key,
    label: `Prompt v${prompt.version} · ${new Date(prompt.createdAt).toLocaleString()}`,
  }))

  return (
    <Drawer
      className="case-history-drawer"
      width={760}
      open={Boolean(target)}
      onClose={onClose}
      title={target ? `${target.model.name} · ${target.finish} 历史` : '生成历史'}
    >
      {!images.length && !prompts.length ? <Empty description="还没有版本记录" /> : (
        <>
          {latestPrompt && (
            <section className="case-history-section case-history-latest">
              <h3><CloudUploadOutlined /> GPT 最新 Prompt</h3>
              <div className="case-history-latest__meta">
                <Tag color="processing">Prompt v{latestPrompt.version}</Tag>
                <Tag>{latestPrompt.generator}</Tag>
                <time>{new Date(latestPrompt.createdAt).toLocaleString()}</time>
                {latestPrompt.conversationUrl && (
                  <a href={latestPrompt.conversationUrl} target="_blank" rel="noreferrer">
                    <LinkOutlined /> 打开生成对话
                  </a>
                )}
              </div>
              <div className="case-history-references">
                <strong>GPT 当前使用的参考图</strong>
                <div className="case-history-references__grid">
                  {latestPrompt.referenceImages.map((referenceImage) => {
                    const imageUrl = fixedReferenceUrl(referenceImage)
                    return (
                      <div className="case-history-reference" key={referenceImage}>
                        {imageUrl
                          ? <Image src={imageUrl} alt={referenceImage} />
                          : <div className="case-history-reference__file"><FileImageOutlined /></div>}
                        <code title={referenceImage}>{referenceImage}</code>
                      </div>
                    )
                  })}
                </div>
              </div>
              <Typography.Paragraph className="case-history-latest__prompt" copyable={{ text: latestPrompt.promptText }}>
                {latestPrompt.promptText}
              </Typography.Paragraph>
            </section>
          )}

          <section className="case-history-section">
            <h3><HistoryOutlined /> 图片历史</h3>
            {!images.length ? (
              <Alert type="info" showIcon message="Prompt 已保存，生成新图后会在这里建立精确关联" />
            ) : (
              <div className="case-history-list">
                {images.map((image) => {
                  const prompt = promptsByKey[image.promptVersionKey]
                  return (
                    <article className="case-history-entry" key={image.key}>
                      <div className="case-history-entry__image">
                        <Image src={image.imagePath} alt={`${target?.model.name} ${target?.finish} v${image.version}`} />
                      </div>
                      <div className="case-history-entry__body">
                        <div className="case-history-entry__meta">
                          <strong>Image v{image.version}</strong>
                          {image.current && <Tag color="processing">当前</Tag>}
                          {prompt && <Tag>Prompt v{prompt.version}</Tag>}
                          <time>{new Date(image.createdAt).toLocaleString()}</time>
                        </div>
                        {image.sha256 && <code>SHA-256 {image.sha256}</code>}
                        {prompt ? (
                          <Typography.Paragraph className="case-history-prompt" copyable={{ text: prompt.promptText }}>
                            {prompt.promptText}
                          </Typography.Paragraph>
                        ) : <Alert type="error" showIcon message="此图片缺少 Prompt 关联" />}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="case-history-section">
            <h3><DiffOutlined /> Prompt Diff</h3>
            {prompts.length < 2 ? <Alert type="info" showIcon message="有两个 Prompt 版本后即可比较差异" /> : (
              <>
                <div className="case-history-diff-selects">
                  <Select value={beforeKey} onChange={setBeforeKey} options={versionOptions} aria-label="较早 Prompt" />
                  <span>对比</span>
                  <Select value={afterKey} onChange={setAfterKey} options={versionOptions} aria-label="较新 Prompt" />
                </div>
                <div className="case-history-diff">
                  {diff.map((change, index) => (
                    <p className={`case-history-diff__${change.type}`} key={`${change.type}-${index}`}>
                      <span>{change.type === 'added' ? '+' : change.type === 'removed' ? '−' : ' '}</span>
                      {change.text}
                    </p>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </Drawer>
  )
}

export default function CaseReviewPage() {
  const [inventory, setInventory] = useState(null)
  const [reviews, setReviews] = useState({})
  const [history, setHistory] = useState({ prompts: [], images: [] })
  const [historyTarget, setHistoryTarget] = useState(null)
  const [query, setQuery] = useState('')
  const [brand, setBrand] = useState('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [inventoryResponse, reviewsResponse, historyResponse] = await Promise.all([
        fetch('/assets/cases/case-inventory.json', { cache: 'no-store' }),
        fetch('/api/admin/case-reviews', { cache: 'no-store' }),
        fetch('/api/admin/case-history', { cache: 'no-store' }),
      ])
      if (!inventoryResponse.ok) throw new Error('Unable to load case inventory')
      if (!reviewsResponse.ok) throw new Error('Unable to load review records')
      const [nextInventory, reviewData] = await Promise.all([
        inventoryResponse.json(),
        reviewsResponse.json(),
      ])
      const historyData = historyResponse.ok
        ? await historyResponse.json()
        : { prompts: [], images: [] }
      setInventory(nextInventory)
      setReviews(Object.fromEntries((reviewData.reviews || []).map((review) => [
        reviewKey(review.modelId, review.finish),
        review,
      ])))
      setHistory(historyData)
      setDirty(false)
    } catch (nextError) {
      setError(nextError.message || 'Unable to load the review board')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const updateReview = useCallback((modelId, finish, patch) => {
    const key = reviewKey(modelId, finish)
    setReviews((current) => ({
      ...current,
      [key]: {
        modelId,
        finish,
        status: 'checking',
        comment: '',
        issues: [],
        ...current[key],
        ...patch,
      },
    }))
    setDirty(true)
  }, [])

  const saveReviews = useCallback(async () => {
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/admin/case-reviews', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reviews: Object.values(reviews) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Unable to save review records')
      setReviews(Object.fromEntries((data.reviews || []).map((review) => [
        reviewKey(review.modelId, review.finish),
        review,
      ])))
      setDirty(false)
    } catch (nextError) {
      setError(nextError.message || 'Unable to save review records')
    } finally {
      setSaving(false)
    }
  }, [reviews])

  const brands = useMemo(() => [...new Set((inventory?.models || []).map((model) => model.brand))], [inventory])
  const models = useMemo(() => (inventory?.models || []).filter((model) => {
    if (brand !== 'all' && model.brand !== brand) return false
    const needle = query.trim().toLowerCase()
    return !needle || model.name.toLowerCase().includes(needle) || model.id.includes(needle)
  }), [brand, inventory, query])

  const totals = useMemo(() => {
    const keys = (inventory?.models || []).flatMap((model) => finishesFor(model, history).map((finish) => reviewKey(model.id, finish)))
    const statuses = keys.map((key) => reviews[key]?.status || 'checking')
    return {
      total: keys.length,
      checking: statuses.filter((status) => status === 'checking').length,
      approved: statuses.filter((status) => status === 'approved').length,
      changes: statuses.filter((status) => status === 'changes').length,
    }
  }, [history, inventory, reviews])

  return (
    <main className="case-review-page">
      <header className="case-review-header">
        <div>
          <div className="case-review-eyebrow">THE CHARMÉ EDIT · ASSET REVIEW</div>
          <h1>手机壳图片审核台</h1>
          <p>对照裸壳与 gel 成品，逐项记录结果与生成历史。</p>
        </div>
        <div className="case-review-cloud"><CloudUploadOutlined /> Cloudflare D1 已连接</div>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={saveReviews}>保存到云端</Button>
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </header>

      <section className="case-review-progress" aria-label="审核进度">
        <span>审核项 <strong>{totals.total}</strong></span>
        <span>待检查 <strong>{totals.checking}</strong></span>
        <span>已通过 <strong>{totals.approved}</strong></span>
        <span>需修改 <strong>{totals.changes}</strong></span>
      </section>

      <section className="case-review-filters">
        <Input prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索型号或 ID" allowClear />
        <Select value={brand} onChange={setBrand} options={[{ value: 'all', label: '全部品牌' }, ...brands.map((value) => ({ value, label: value }))]} />
        <span>显示 {models.length} / {inventory?.models?.length || 0} 个型号</span>
      </section>

      {error && <Alert type="error" showIcon message={error} action={<Button onClick={load}>重新加载</Button>} />}
      {loading ? <div className="case-review-loading"><Spin size="large" /></div> : (
        <section className="case-review-models">
          {models.map((model) => (
            <article className="case-review-model" key={model.id}>
              <div className="case-review-model__head">
                <div><span>{model.brand}</span><h2>{model.name}</h2><code>{model.id}</code></div>
                <Tag>{model.status}</Tag>
              </div>
              <div className="case-review-finishes">
                {finishesFor(model, history).map((finish) => {
                  const shell = bareFinish(model, finish)
                  const key = reviewKey(model.id, finish)
                  const review = reviews[key] || { status: 'checking', comment: '', issues: [] }
                  const promptCount = history.prompts.filter((prompt) => reviewKey(prompt.modelId, prompt.finish) === key).length
                  const imageCount = history.images.filter((image) => reviewKey(image.modelId, image.finish) === key).length
                  const historyImage = currentHistoryImage(history, model.id, finish)
                  const gelImage = historyImage || (model.withGel?.[finish]
                    ? `/assets/cases/case-with-gel/integrated-${model.id}-${finish}.png`
                    : '')
                  const versionCount = Math.max(promptCount, imageCount)
                  return (
                    <section className="case-review-finish" key={finish}>
                      <div className="case-review-finish__title">
                        <strong>{finish[0].toUpperCase() + finish.slice(1)}</strong>
                        <Tag color={statusColor(review.status)}>{STATUS_OPTIONS.find((item) => item.value === review.status)?.label}</Tag>
                      </div>
                      <div className="case-review-images">
                        <figure><figcaption>{finish === 'glitter' ? '裸壳参考' : 'Without gel'}</figcaption>{shell && <Image src={`/assets/cases/case-without-gel/${model.id}-${shell}.png`} alt="Without gel" />}</figure>
                        <figure>
                          <figcaption>With gel</figcaption>
                          {gelImage
                            ? <Image src={gelImage} alt="With gel" />
                            : <div className="case-review-image-missing">尚未生成</div>}
                        </figure>
                      </div>
                      <div className="case-review-controls">
                        <div className="case-review-controls__row">
                          <Select value={review.status} onChange={(status) => updateReview(model.id, finish, { status })} options={STATUS_OPTIONS} aria-label={`${model.name} ${finish} 审核状态`} />
                          <Button icon={<HistoryOutlined />} onClick={() => setHistoryTarget({ model, finish })}>历史 {versionCount || ''}</Button>
                        </div>
                        <Checkbox.Group
                          className="case-review-issues"
                          value={review.issues}
                          options={ISSUE_OPTIONS}
                          onChange={(issues) => updateReview(model.id, finish, { issues })}
                        />
                        <Input.TextArea
                          value={review.comment}
                          onChange={(event) => updateReview(model.id, finish, { comment: event.target.value })}
                          placeholder="留言"
                          autoSize={{ minRows: 2, maxRows: 6 }}
                        />
                      </div>
                    </section>
                  )
                })}
              </div>
            </article>
          ))}
        </section>
      )}
      <HistoryDrawer history={history} target={historyTarget} onClose={() => setHistoryTarget(null)} />
    </main>
  )
}
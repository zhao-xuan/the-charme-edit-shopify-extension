import { useEffect, useState } from 'react'
import { studioApi } from './api.js'
import './studio.css'

export default function TrackingSettingsTab() {
  const [settings, setSettings] = useState(null)
  const [measurementId, setMeasurementId] = useState('')
  const [pixelId, setPixelId] = useState('')
  const [gaSecret, setGaSecret] = useState('')
  const [metaToken, setMetaToken] = useState('')
  const [clearGaSecret, setClearGaSecret] = useState(false)
  const [clearMetaToken, setClearMetaToken] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const result = await studioApi.trackingSettings()
      setSettings(result.settings)
      setMeasurementId(result.settings.measurementId)
      setPixelId(result.settings.pixelId)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const body = {
        measurementId,
        pixelId,
        clearGaSecret,
        clearMetaToken,
      }
      if (gaSecret) body.gaApiSecret = gaSecret
      if (metaToken) body.metaAccessToken = metaToken
      const result = await studioApi.saveTrackingSettings(body)
      setSettings(result.settings)
      setMeasurementId(result.settings.measurementId)
      setPixelId(result.settings.pixelId)
      setGaSecret('')
      setMetaToken('')
      setClearGaSecret(false)
      setClearMetaToken(false)
      setNotice('追踪设置已安全保存。Secret 不会再次显示。')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <section className="studio-app-section"><p>正在读取追踪设置…</p></section>

  return <section className="studio-app-section">
    <span className="studio-eyebrow">TRACKING & ATTRIBUTION</span>
    <h1>Tracking</h1>
    <p>配置商店自己的 GA4 和 Meta 凭证。服务端仅在顾客授予相应同意后转发设计器事件。</p>
    {error && <div className="studio-notice" role="alert">{error}</div>}
    {notice && <div className="studio-notice" role="status">{notice}</div>}
    <form className="studio-panel studio-create-form" onSubmit={save}>
      <h2>Google Analytics 4</h2>
      <label className="studio-field">
        <span>Measurement ID</span>
        <input value={measurementId} onChange={(event) => setMeasurementId(event.target.value)} placeholder="G-XXXXXXXXXX" autoComplete="off" />
      </label>
      <label className="studio-field">
        <span>Measurement Protocol API secret</span>
        <input
          type="password"
          value={gaSecret}
          onChange={(event) => { setGaSecret(event.target.value); setClearGaSecret(false) }}
          placeholder={settings?.gaSecretConfigured ? '已安全保存；留空以保留现有值' : '粘贴 GA4 API secret'}
          autoComplete="new-password"
        />
      </label>
      <div className="studio-card-actions">
        <span className="studio-muted">{settings?.gaSecretConfigured ? 'API secret 已配置' : 'API secret 尚未配置'}</span>
        {settings?.gaSecretConfigured && <button type="button" onClick={() => { setClearGaSecret((value) => !value); setGaSecret('') }}>{clearGaSecret ? '撤销移除' : '移除 API secret'}</button>}
      </div>

      <h2>Meta Conversions API</h2>
      <label className="studio-field">
        <span>Pixel ID</span>
        <input value={pixelId} onChange={(event) => setPixelId(event.target.value)} placeholder="数字 Pixel ID" autoComplete="off" />
      </label>
      <label className="studio-field">
        <span>Conversions API access token</span>
        <input
          type="password"
          value={metaToken}
          onChange={(event) => { setMetaToken(event.target.value); setClearMetaToken(false) }}
          placeholder={settings?.metaTokenConfigured ? '已安全保存；留空以保留现有值' : '粘贴 Meta access token'}
          autoComplete="new-password"
        />
      </label>
      <div className="studio-card-actions">
        <span className="studio-muted">{settings?.metaTokenConfigured ? 'Access token 已配置' : 'Access token 尚未配置'}</span>
        {settings?.metaTokenConfigured && <button type="button" onClick={() => { setClearMetaToken((value) => !value); setMetaToken('') }}>{clearMetaToken ? '撤销移除' : '移除 access token'}</button>}
      </div>

      <p className="studio-muted">凭证由服务端使用专用 AES-GCM 密钥加密后存入 D1。后台不会读取或再次显示 secret；留空不会覆盖已保存的值。Purchase 事件继续由 Shopify 销售渠道管理，避免重复计数。</p>
      <div className="studio-card-actions">
        <button className="studio-primary" type="submit" disabled={saving}>{saving ? '正在保存…' : '保存追踪设置'}</button>
        <button type="button" disabled={saving} onClick={load}>重新加载</button>
      </div>
    </form>
  </section>
}

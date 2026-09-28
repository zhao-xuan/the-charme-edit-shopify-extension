import { useEffect, useState } from 'react'
import { Alert, Button, Card, Empty, Segmented, Space, Spin, Statistic, Table, Tag } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { fetchAnalytics } from '../lib/adminApi'

const duration = (seconds) => {
  const value = Number(seconds) || 0
  if (value < 60) return `${value}s`
  return `${Math.floor(value / 60)}m ${value % 60}s`
}

const kindLabel = { phone: 'Phone cases', tote: 'Totes', frame: 'Frames', unknown: 'Unknown' }
const interactionLabels = {
  productSelections: 'Product changes', finishChanges: 'Finish changes', categoryChanges: 'Category views',
  decorationAdds: 'Decorations added', decorationRemoves: 'Decorations removed', decorationMoves: 'Move gestures',
  undoCount: 'Undo actions', clearCount: 'Clear all actions', zoomActions: 'Zoom actions',
  trayExpansions: 'Tray expansions', sideSwitches: 'Tote side switches', blockedOrderAttempts: 'Blocked purchase attempts',
}

function Metric({ title, value, suffix, note }) {
  return (
    <div className="analytics-metric">
      <Statistic title={title} value={value} suffix={suffix} />
      {note && <span>{note}</span>}
    </div>
  )
}

export default function AnalyticsTab() {
  const [days, setDays] = useState(30)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetchAnalytics(days)
      .then((data) => alive && setReport(data))
      .catch((err) => alive && setError(err?.message || 'Could not load analytics'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [days, reloadKey])

  const totals = report?.totals
  const funnel = totals ? [
    { label: 'Customizer sessions', value: totals.sessions },
    { label: 'Started decorating', value: totals.decoratedSessions },
    { label: 'Viewed order summary', value: totals.summaryViews },
    { label: 'Clicked purchase', value: totals.purchaseClicks },
    { label: 'Sent to Shopify', value: totals.checkoutSuccesses },
  ] : []
  const funnelMax = Math.max(1, totals?.sessions || 0)
  const trendMax = Math.max(1, ...(report?.byDay || []).map((row) => row.sessions))

  return (
    <div className="analytics-page">
      <div className="analytics-toolbar">
        <div>
          <h2>Customizer analytics</h2>
          <p>Privacy-safe session summaries stored in your Shopify metaobjects.</p>
        </div>
        <Space>
          <Segmented value={days} onChange={setDays} options={[{ label: '7 days', value: 7 }, { label: '30 days', value: 30 }, { label: '90 days', value: 90 }]} />
          <Button icon={<ReloadOutlined />} onClick={() => setReloadKey((value) => value + 1)} loading={loading}>
            Refresh
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        message="Conversion means a successful handoff to Shopify cart or checkout. Paid-order conversion requires Shopify order webhooks."
      />
      {error && <Alert type="error" showIcon message="Analytics unavailable" description={error} />}

      <Spin spinning={loading}>
        {!totals ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No analytics data yet" /> : (
          <>
            <div className="analytics-kpis">
              <Metric title="Customizer sessions" value={totals.sessions} note={`${totals.decoratedSessions} started decorating`} />
              <Metric title="Purchase click rate" value={totals.purchaseClickRate} suffix="%" note={`${totals.purchaseClicks} clicks`} />
              <Metric title="Shopify handoff rate" value={totals.conversionRate} suffix="%" note={`${totals.checkoutSuccesses} successful handoffs`} />
              <Metric title="Average decoration time" value={duration(totals.averageDecorationSeconds)} note="Active, visible time after first decoration" />
              <Metric title="Click completion" value={totals.checkoutCompletionRate} suffix="%" note="Successful handoffs after purchase click" />
              <Metric title="Average final decorations" value={totals.averageFinalDecorations} note={`Average session time ${duration(totals.averageSessionSeconds)}`} />
            </div>

            <div className="analytics-grid">
              <Card title="Customizer funnel" size="small">
                <div className="analytics-funnel">
                  {funnel.map((step) => (
                    <div className="analytics-funnel__row" key={step.label}>
                      <span>{step.label}</span>
                      <div><i style={{ width: `${Math.max(2, step.value / funnelMax * 100)}%` }} /></div>
                      <strong>{step.value}</strong>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="Daily activity" size="small">
                {(report.byDay || []).length ? (
                  <div className="analytics-trend" aria-label="Daily customizer sessions">
                    {report.byDay.map((row) => (
                      <div className="analytics-trend__day" key={row.date} title={`${row.date}: ${row.sessions} sessions`}>
                        <strong>{row.sessions}</strong>
                        <i style={{ height: `${Math.max(4, row.sessions / trendMax * 100)}%` }} />
                        <span>{row.date.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No activity in this period" />}
              </Card>
            </div>

            <div className="analytics-grid analytics-grid--tables">
              <Card title="By product type" size="small">
                <Table
                  size="small"
                  pagination={false}
                  rowKey="kind"
                  dataSource={report.byKind || []}
                  columns={[
                    { title: 'Type', dataIndex: 'kind', render: (value) => kindLabel[value] || value },
                    { title: 'Sessions', dataIndex: 'sessions', align: 'right' },
                    { title: 'Handoff rate', dataIndex: 'conversionRate', align: 'right', render: (value) => `${value}%` },
                  ]}
                />
              </Card>
              <Card title="Most selected decorations" size="small">
                <Table
                  size="small"
                  pagination={false}
                  rowKey="id"
                  dataSource={report.topDecorations || []}
                  locale={{ emptyText: 'No decoration selections yet' }}
                  columns={[
                    { title: 'Decoration', dataIndex: 'name', ellipsis: true },
                    { title: 'Adds', dataIndex: 'adds', align: 'right', width: 72 },
                  ]}
                />
              </Card>
            </div>

            <Card title="Devices" size="small">
              <Space wrap>
                {(report.devices || []).map((row) => (
                  <Tag key={row.device}>{row.device}: {row.count} ({row.share}%)</Tag>
                ))}
              </Space>
            </Card>

            <Card title="Customizer activity" size="small">
              <div className="analytics-activity">
                {Object.entries(interactionLabels).map(([key, label]) => (
                  <div key={key}><span>{label}</span><strong>{report.interactions?.[key] || 0}</strong></div>
                ))}
              </div>
            </Card>
          </>
        )}
      </Spin>
    </div>
  )
}
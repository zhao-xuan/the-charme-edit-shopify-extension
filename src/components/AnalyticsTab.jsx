import { useEffect, useState } from 'react'
import { Alert, Button, Card, Empty, Segmented, Space, Spin, Statistic, Table, Tag } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { fetchAnalytics } from '../lib/adminApi'

const duration = (seconds) => {
  const value = Number(seconds) || 0
  if (value < 60) return `${value}s`
  return `${Math.floor(value / 60)}m ${value % 60}s`
}

const money = (revenue) => {
  const parts = Object.entries(revenue || {}).map(([code, amount]) => `${code} ${Number(amount).toFixed(2)}`)
  return parts.length ? parts.join(', ') : '—'
}

const kindLabel = { phone: 'Phone cases', tote: 'Totes', frame: 'Frames', unknown: 'Unknown' }
const interactionLabels = {
  productSelections: 'Product changes', finishChanges: 'Finish changes', categoryChanges: 'Category views',
  decorationAdds: 'Decorations added', decorationRemoves: 'Decorations removed', decorationMoves: 'Move gestures',
  undoCount: 'Undo actions', clearCount: 'Clear all actions', zoomActions: 'Zoom actions',
  trayExpansions: 'Tray expansions', sideSwitches: 'Tote side switches', blockedOrderAttempts: 'Blocked purchase attempts',
}
const studioInteractionLabels = { productSelections:'Product selections', designSaves:'Design saves', productionRequests:'Production requests', quoteRequests:'Shopify quotes', cartHandoffs:'Cart handoffs' }

function Metric({ title, value, suffix, note }) {
  return (
    <div className="analytics-metric">
      <Statistic title={title} value={value} suffix={suffix} />
      {note && <span>{note}</span>}
    </div>
  )
}

export default function AnalyticsTab({ fetchReport = fetchAnalytics, studio = false }) {
  const [days, setDays] = useState(30)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetchReport(days)
      .then((data) => alive && setReport(data))
      .catch((err) => alive && setError(err?.message || 'Could not load analytics'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [days, reloadKey])

  const totals = report?.totals
  const attribution = !studio && report?.attribution && !report.attribution.unavailable ? report.attribution : null
  const ordersConnected = !!attribution?.orders.connected
  const funnel = totals ? [
    { label: 'Customizer sessions', value: totals.sessions },
    { label: 'Started decorating', value: totals.decoratedSessions },
    { label: studio ? 'Submitted for review' : 'Viewed order summary', value: totals.summaryViews },
    { label: studio ? 'Requested Shopify quote' : 'Clicked purchase', value: totals.purchaseClicks },
    { label: 'Sent to Shopify', value: totals.checkoutSuccesses, hint: 'The customer was handed to Shopify. This is not a confirmed cart or a payment.' },
    ...(attribution ? [
      { label: 'Cart confirmed', value: attribution.totals.cartConfirmedSessions, hint: 'The Shopify cart showed the designed items. Needs the updated charme-cart-group theme snippet.' },
      { label: 'Paid order', value: ordersConnected ? attribution.totals.paidOrders : null, hint: 'Orders paid on Shopify and matched to a session by design token. Needs the orders/paid webhook.' },
    ] : []),
  ] : []
  const funnelMax = Math.max(1, totals?.sessions || 0)
  const trendMax = Math.max(1, ...(report?.byDay || []).map((row) => row.sessions))

  return (
    <div className="analytics-page">
      <div className="analytics-toolbar">
        <div>
          <h2>Customizer analytics</h2>
          <p>{studio ? '匿名工作室会话摘要，按商店隔离并存储在应用数据库。' : 'Privacy-safe session summaries stored in your Shopify metaobjects. Visitors who have not accepted analytics cookies are not counted, and sources need marketing consent.'}</p>
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
        message={studio ? '“Shopify handoff”只表示顾客点击进入购物车；实际支付订单需要订单 Webhook 才能确认。' : 'Conversion means a successful handoff to Shopify cart or checkout. Paid-order conversion requires Shopify order webhooks.'}
      />
      {error && <Alert type="error" showIcon message="Analytics unavailable" description={error} />}
      {report?.truncated && (
        <Alert
          type="warning"
          showIcon
          message="This report covers only the most recent sessions"
          description={`The newest ${report.recordsScanned} session records are included and older ones are left out. Either the period holds more records than one report can read, or Shopify stopped answering part-way. Choose a shorter period or try again for complete figures.`}
        />
      )}

      <Spin spinning={loading}>
        {!totals ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No analytics data yet" /> : (
          <>
            <div className="analytics-kpis">
              <Metric title="Customizer sessions" value={totals.sessions} note={`${totals.decoratedSessions} started decorating`} />
              <Metric title={studio ? 'Shopify quote rate' : 'Purchase click rate'} value={totals.purchaseClickRate} suffix="%" note={`${totals.purchaseClicks} ${studio ? 'quotes' : 'clicks'}`} />
              <Metric title="Shopify handoff rate" value={totals.conversionRate} suffix="%" note={`${totals.checkoutSuccesses} successful handoffs`} />
              <Metric title={studio ? 'Time after first save' : 'Average decoration time'} value={duration(totals.averageDecorationSeconds)} note={studio ? 'Approximate elapsed time; not active editing time' : 'Active, visible time after first decoration'} />
              <Metric title={studio ? 'Quote to cart' : 'Click completion'} value={totals.checkoutCompletionRate} suffix="%" note={studio ? 'Cart handoffs after a quote' : 'Successful handoffs after purchase click'} />
              <Metric title="Average final decorations" value={totals.averageFinalDecorations} note={`Average session time ${duration(totals.averageSessionSeconds)}`} />
            </div>

            <div className="analytics-grid">
              <Card title="Customizer funnel" size="small">
                <div className="analytics-funnel">
                  {funnel.map((step) => (
                    <div className="analytics-funnel__row" key={step.label} title={step.hint}>
                      <span>{step.label}</span>
                      <div><i style={{ width: `${step.value == null ? 0 : Math.max(2, step.value / funnelMax * 100)}%` }} /></div>
                      <strong>{step.value ?? '—'}</strong>
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

            {!studio && report.attribution?.unavailable && (
              <Alert type="info" showIcon message="Source attribution is unavailable" description="The attribution tables could not be read. The rest of the report is unaffected." />
            )}
            {attribution && (
              <>
                {!ordersConnected && (
                  <Alert
                    type="info"
                    showIcon
                    message="Paid orders are not connected yet"
                    description="Sources and cart confirmations are recorded already. Paid orders arrive through an orders/paid webhook, which needs the read_orders scope. See shopify/README.md, “Tracking & attribution”."
                  />
                )}
                {attribution.truncated && (
                  <Alert type="warning" showIcon message="Some cart confirmations or orders were not read" description="The period holds more of them than one report can read. Choose a shorter period." />
                )}
                <Card title="Funnel by source" size="small">
                  <Table
                    size="small"
                    pagination={false}
                    rowKey="source"
                    scroll={{ x: 'max-content' }}
                    dataSource={attribution.rows}
                    locale={{ emptyText: 'No sessions in this period' }}
                    columns={[
                      { title: 'Source', dataIndex: 'source', render: (value) => <span className="analytics-source" title={value}>{value}</span> },
                      { title: 'Sessions', dataIndex: 'sessions', align: 'right' },
                      { title: 'Decorated', dataIndex: 'decoratedSessions', align: 'right' },
                      { title: 'Purchase clicks', dataIndex: 'purchaseClicks', align: 'right' },
                      { title: 'Cart confirmed', dataIndex: 'cartConfirmed', align: 'right' },
                      { title: 'Paid orders', dataIndex: 'paidOrders', align: 'right', render: (value) => (ordersConnected ? value : '—') },
                      { title: 'Paid rate', dataIndex: 'paidRate', align: 'right', render: (value) => (ordersConnected ? `${value}%` : '—') },
                      { title: 'Revenue', dataIndex: 'revenue', align: 'right', render: (value) => (ordersConnected ? money(value) : '—') },
                    ]}
                  />
                  {ordersConnected && (
                    <p className="analytics-note">
                      {`${attribution.orders.total} paid designer orders in this period: ${attribution.orders.matched} matched to a tracked session, ${attribution.orders.unmatched} not matched (visitor not tracked, or session outside the period)`}
                      {attribution.orders.testExcluded ? `; ${attribution.orders.testExcluded} test orders excluded` : ''}. Revenue is the gross order total.
                    </p>
                  )}
                </Card>
                {ordersConnected && (
                  <Card title="Paid orders as Shopify records them" size="small">
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="source"
                      dataSource={attribution.orders.shopifySources}
                      locale={{ emptyText: 'No paid designer orders in this period' }}
                      columns={[
                        { title: 'Shopify source', dataIndex: 'source', ellipsis: true },
                        { title: 'Orders', dataIndex: 'orders', align: 'right', width: 80 },
                        { title: 'Revenue', dataIndex: 'revenue', align: 'right', render: money },
                      ]}
                    />
                    <p className="analytics-note">Compare with the table above: orders Shopify credits to the designer domain or to no source are sales whose real source this report can recover.</p>
                  </Card>
                )}
              </>
            )}

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
                {Object.entries(studio ? studioInteractionLabels : interactionLabels).map(([key, label]) => (
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

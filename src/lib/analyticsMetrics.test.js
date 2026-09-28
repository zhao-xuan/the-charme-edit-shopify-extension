import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateAnalytics } from './analyticsMetrics.js'

test('analytics separates purchase intent from successful checkout handoff', () => {
  const report = aggregateAnalytics([
    {
      startedAt: '2026-09-24T10:00:00.000Z', activeMs: 30_000,
      decorationStartedAt: 1, decorationActiveMs: 20_000, finalDecorationCount: 2,
      summaryViews: 1, purchaseClicked: true, checkoutSucceeded: true,
      productKind: 'tote', device: 'mobile',
      decorationSelections: { patch_a: 2 }, decorationNames: { patch_a: 'Patch A' },
    },
    {
      startedAt: '2026-09-24T11:00:00.000Z', activeMs: 10_000,
      decorationStartedAt: 1, decorationActiveMs: 4_000, finalDecorationCount: 1,
      summaryViews: 1, purchaseClicked: true, checkoutSucceeded: false,
      productKind: 'phone', device: 'desktop',
      decorationSelections: { charm_b: 1 }, decorationNames: { charm_b: 'Charm B' },
    },
    {
      startedAt: '2026-09-25T09:00:00.000Z', activeMs: 20_000,
      decorationStartedAt: null, decorationActiveMs: 0, finalDecorationCount: 0,
      summaryViews: 0, purchaseClicked: false, checkoutSucceeded: false,
      productKind: 'phone', device: 'mobile', decorationSelections: {},
    },
  ])

  assert.deepEqual(report.totals, {
    sessions: 3,
    decoratedSessions: 2,
    summaryViews: 2,
    purchaseClicks: 2,
    checkoutSuccesses: 1,
    purchaseClickRate: 66.7,
    conversionRate: 33.3,
    checkoutCompletionRate: 50,
    averageSessionSeconds: 20,
    averageDecorationSeconds: 12,
    averageFinalDecorations: 1,
  })
  assert.deepEqual(report.byDay[0], {
    date: '2026-09-24', sessions: 2, purchaseClicks: 2, checkoutSuccesses: 1,
  })
  assert.deepEqual(report.topDecorations[0], { id: 'patch_a', name: 'Patch A', adds: 2 })
})

test('analytics returns stable zero metrics for an empty period', () => {
  const report = aggregateAnalytics([])
  assert.equal(report.totals.conversionRate, 0)
  assert.equal(report.totals.averageDecorationSeconds, 0)
  assert.deepEqual(report.byDay, [])
})

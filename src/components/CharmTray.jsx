import { useState } from 'react'
import { Tabs, Empty } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { trayGroups, groupByCollection } from '../lib/catalog'
import { formatMoney } from '../lib/money'
import { t } from '../lib/i18n'

function CharmCard({ charm, compact, row, onActivate, onPointerDown }) {
  const unavailable = !!charm.unavailable
  const cls =
    'charm-card' +
    (compact ? ' charm-card--compact' : '') +
    (row ? ' charm-card--row' : '') +
    (unavailable ? ' charm-card--disabled' : '')
  return (
    <div
      className={cls}
      role="button"
      tabIndex={unavailable ? -1 : 0}
      aria-disabled={unavailable || undefined}
      onPointerDown={unavailable ? undefined : (e) => onPointerDown?.(charm, e)}
      onClick={unavailable ? undefined : () => onActivate?.(charm)}
      onKeyDown={(e) =>
        !unavailable && (e.key === 'Enter' || e.key === ' ') && onActivate?.(charm)
      }
      title={
        unavailable
          ? t('charm.tip.unavailable')
          : charm.type === 3
            ? t('charm.tip.scatter')
            : compact
              ? t('charm.tip.tapAdd')
              : t('charm.tip.dragAdd')
      }
    >
      <div className="thumb">
        <img src={charm.src} alt={charm.name} draggable={false} />
      </div>
      {!compact && <div className="name">{charm.name}</div>}
      <div className="meta meta--price">
        <span>{unavailable ? t('charm.unavailable') : formatMoney(charm.price)}</span>
      </div>
    </div>
  )
}

/** Small framed disclaimer shown above a category (used for Unique charms). */
function NoteBox({ text }) {
  return (
    <div className="charm-note">
      <InfoCircleOutlined />
      <span>{text}</span>
    </div>
  )
}

function GroupPanel({ group, compact, rows, onActivate, onPointerDown, onTypeWord, wordGroups = [], selectedGroupId, onSelectGroup }) {
  const charms = group.items || []
  const [wordFor, setWordFor] = useState(null)
  const [wordText, setWordText] = useState('')
  const [wordPlace, setWordPlace] = useState('middle')
  const [wordArc, setWordArc] = useState(false)
  if (!charms.length) return <Empty description={t('charm.empty')} />
  const collections = groupByCollection(charms)
  const submitWord = (collection) => {
    const txt = wordText.trim()
    if (!txt) return
    onTypeWord?.(txt, { collection, category: group.key, placement: wordPlace, arc: wordArc })
    setWordText('')
    setWordFor(null)
  }
  return (
    <div>
      {group.note && <NoteBox text={group.note} />}
      {!rows && group.help && (
        <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
          {group.help}
        </p>
      )}
      {collections.map((g) => (
        <div
          key={g.collection}
          className="charm-collection"
          style={{ marginBottom: compact ? 14 : 18 }}
        >
          <div
            className="eyebrow"
            style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}
          >
            <span>{g.collection}</span>
            <span>{g.items.length}</span>
          </div>
          {onTypeWord && g.collection === 'Letters & initials' && (
            <div className="charm-word">
              {wordFor === g.collection ? (
                <>
                <div className="charm-word__form">
                  <input
                    className="charm-word__input"
                    autoFocus
                    maxLength={14}
                    value={wordText}
                    placeholder={t('charm.wordPlaceholder')}
                    onChange={(e) => setWordText(e.target.value.replace(/[^a-zA-Z0-9 ]/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitWord(g.collection)
                      if (e.key === 'Escape') setWordFor(null)
                    }}
                  />
                  <button
                    type="button"
                    className="charm-word__go"
                    onClick={() => submitWord(g.collection)}
                  >
                    {t('charm.add')}
                  </button>
                  <button
                    type="button"
                    className="charm-word__cancel"
                    aria-label={t('action.cancel')}
                    onClick={() => setWordFor(null)}
                  >
                    ×
                  </button>
                </div>
                <div className="charm-word__opts">
                  <label className="charm-word__opt">
                    {t('charm.position')}
                    <select value={wordPlace} onChange={(e) => setWordPlace(e.target.value)}>
                      <option value="top">{t('charm.position.top')}</option>
                      <option value="middle">{t('charm.position.middle')}</option>
                      <option value="bottom">{t('charm.position.bottom')}</option>
                    </select>
                  </label>
                  <label className="charm-word__opt charm-word__opt--check">
                    <input
                      type="checkbox"
                      checked={wordArc}
                      onChange={(e) => setWordArc(e.target.checked)}
                    />
                    {t('charm.arch')}
                  </label>
                </div>
                <p className="charm-word__hint">{t('charm.wordHint')}</p>
                </>
              ) : (
                <button
                  type="button"
                  className="charm-word__toggle"
                  onClick={() => {
                    setWordFor(g.collection)
                    setWordText('')
                  }}
                >
                  ✎ {t('charm.typeWord')}
                </button>
              )}
              {/* One tag per placed word group (until it's broken apart for
                  individual editing). Tapping a tag selects that word on the
                  case so it can be dragged as a single unit. */}
              {wordGroups.filter((w) => !w.broken).length > 0 && (
                <div className="charm-word-tags">
                  <span className="charm-word-tags__label">{t('charm.yourWords')}</span>
                  {wordGroups
                    .filter((w) => !w.broken)
                    .map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        className={`charm-word-tag${w.id === selectedGroupId ? ' is-active' : ''}`}
                        onClick={() => onSelectGroup?.(w.id)}
                        title={t('charm.selectWord')}
                      >
                        {w.label}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
          <div className={rows ? 'charm-row' : `tray-grid${compact ? ' tray-grid--compact' : ''}`}>
            {g.items.map((charm) => (
              <CharmCard
                key={charm.id}
                charm={charm}
                compact={compact}
                row={rows}
                onActivate={onActivate}
                onPointerDown={onPointerDown}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function CharmTray({
  kind = 'phone',
  compact,
  activeKey,
  rows,
  onActivate,
  onPointerDown,
  onTypeWord,
  wordGroups = [],
  selectedGroupId,
  onSelectGroup,
}) {
  const groups = trayGroups(kind)

  // Controlled single-group view (mobile): the group is chosen by an external
  // dropdown, so we render just that panel — no tab bar.
  if (activeKey) {
    const group = groups.find((g) => g.key === activeKey) || groups[0]
    return (
      <GroupPanel
        group={group}
        compact={compact}
        rows={rows}
        onActivate={onActivate}
        onPointerDown={onPointerDown}
        onTypeWord={onTypeWord}
        wordGroups={wordGroups}
        selectedGroupId={selectedGroupId}
        onSelectGroup={onSelectGroup}
      />
    )
  }

  // Desktop: one tab per group (4 categories for phones, 3 types for totes).
  // Phone category labels drop the trailing " charms" so all four fit the tab bar.
  const items = groups.map((g) => ({
    key: g.key,
    label: kind !== 'tote' ? g.label.replace(/ charms$/i, '') : g.label,
    children: (
      <GroupPanel
        group={g}
        compact={compact}
        onActivate={onActivate}
        onPointerDown={onPointerDown}
        onTypeWord={onTypeWord}
        wordGroups={wordGroups}
        selectedGroupId={selectedGroupId}
        onSelectGroup={onSelectGroup}
      />
    ),
  }))
  return <Tabs defaultActiveKey={groups[0]?.key} items={items} size="small" />
}


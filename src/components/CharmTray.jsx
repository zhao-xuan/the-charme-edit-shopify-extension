import { useState } from 'react'
import { Tabs, Empty } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { trayGroups, groupByCollection } from '../lib/catalog'

// Round a mm value to at most one decimal so tray size labels stay compact
// (e.g. 8.30 → 8.3, 58 → 58).
const fmtMm = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : v
}

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
          ? 'Currently unavailable'
          : charm.type === 3
            ? 'Tap to scatter into the gaps'
            : compact
              ? 'Tap to add — then drag it on your case'
              : 'Drag onto your piece — or click to add'
      }
    >
      <div className="thumb">
        <img src={charm.src} alt={charm.name} draggable={false} />
      </div>
      {!compact && <div className="name">{charm.name}</div>}
      {charm.widthMm != null && charm.heightMm != null && (
        <div className="charm-card__size">
          {fmtMm(charm.widthMm)} × {fmtMm(charm.heightMm)} mm
        </div>
      )}
      <div className="meta meta--price">
        <span>{unavailable ? 'Unavailable' : `£${charm.price.toFixed(2)}`}</span>
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
  if (!charms.length) return <Empty description="Nothing here yet" />
  const collections = groupByCollection(charms)
  const submitWord = (collection) => {
    const t = wordText.trim()
    if (!t) return
    onTypeWord?.(t, { collection, category: group.key, placement: wordPlace, arc: wordArc })
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
                    placeholder="e.g. EMMA 24"
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
                    Add
                  </button>
                  <button
                    type="button"
                    className="charm-word__cancel"
                    aria-label="Cancel"
                    onClick={() => setWordFor(null)}
                  >
                    ×
                  </button>
                </div>
                <div className="charm-word__opts">
                  <label className="charm-word__opt">
                    Position
                    <select value={wordPlace} onChange={(e) => setWordPlace(e.target.value)}>
                      <option value="top">Top</option>
                      <option value="middle">Middle</option>
                      <option value="bottom">Bottom</option>
                    </select>
                  </label>
                  <label className="charm-word__opt charm-word__opt--check">
                    <input
                      type="checkbox"
                      checked={wordArc}
                      onChange={(e) => setWordArc(e.target.checked)}
                    />
                    Arc
                  </label>
                </div>
                <p className="charm-word__hint">Mix letters &amp; numbers, up to 14 characters.</p>
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
                  ✎ Type a word
                </button>
              )}
              {/* One tag per placed word group (until it's broken apart for
                  individual editing). Tapping a tag selects that word on the
                  case so it can be dragged as a single unit. */}
              {wordGroups.filter((w) => !w.broken).length > 0 && (
                <div className="charm-word-tags">
                  <span className="charm-word-tags__label">Your words:</span>
                  {wordGroups
                    .filter((w) => !w.broken)
                    .map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        className={`charm-word-tag${w.id === selectedGroupId ? ' is-active' : ''}`}
                        onClick={() => onSelectGroup?.(w.id)}
                        title="Select this word to move it as one"
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


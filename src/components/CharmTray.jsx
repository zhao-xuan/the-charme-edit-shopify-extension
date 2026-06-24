import { Tabs, Empty } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { trayGroups, groupByCollection } from '../lib/catalog'

function CharmCard({ charm, compact, row, onActivate, onPointerDown }) {
  const cls =
    'charm-card' + (compact ? ' charm-card--compact' : '') + (row ? ' charm-card--row' : '')
  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      onPointerDown={(e) => onPointerDown?.(charm, e)}
      onClick={() => onActivate?.(charm)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onActivate?.(charm)}
      title={
        charm.type === 3
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
      <div className="meta meta--price">
        <span>£{charm.price.toFixed(2)}</span>
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

function GroupPanel({ group, compact, rows, onActivate, onPointerDown }) {
  const charms = group.items || []
  if (!charms.length) return <Empty description="Nothing here yet" />
  const collections = groupByCollection(charms)
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
      />
    ),
  }))
  return <Tabs defaultActiveKey={groups[0]?.key} items={items} size="small" />
}


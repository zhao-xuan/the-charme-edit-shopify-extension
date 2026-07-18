export const DEFAULT_CHARM_PRICING_GROUPS = [
  {
    id: 'filling-stones',
    label: 'Filling Stones',
    enabled: true,
    collection: 'Filling Stones',
    nameEquals: '',
    quantity: 6,
    price: 1.5,
    shopifyVariantId: '56450822701434',
  },
  {
    id: 'mini-stones',
    label: 'Mini Stone',
    enabled: true,
    collection: 'Stones',
    nameEquals: 'Mini Stone',
    quantity: 8,
    price: 2,
    shopifyVariantId: '56450845344122',
  },
  {
    id: 'midi-stones',
    label: 'Midi Stone',
    enabled: true,
    collection: 'Stones',
    nameEquals: 'Midi Stone',
    quantity: 3,
    price: 2,
    shopifyVariantId: '56014395212154',
  },
]

const clean = (value) => String(value || '').trim().toLowerCase()

export function normalizeCharmPricingGroups(groups) {
  if (!Array.isArray(groups) || !groups.length) return DEFAULT_CHARM_PRICING_GROUPS
  const normalized = groups
    .map((group, index) => ({
      ...group,
      id: String(group.id || `pricing-group-${index + 1}`),
      label: String(group.label || group.collection || `Pricing group ${index + 1}`),
      enabled: group.enabled !== false,
      collection: String(group.collection || '').trim(),
      nameEquals: String(group.nameEquals || '').trim(),
      quantity: Math.max(1, Math.round(Number(group.quantity) || 1)),
      price: Math.max(0, Number(group.price) || 0),
      shopifyVariantId: String(group.shopifyVariantId || '').trim(),
    }))
    .filter((group) => group.collection || group.nameEquals)
  return normalized.length ? normalized : DEFAULT_CHARM_PRICING_GROUPS
}

export function charmPricingGroupFor(charm, groups = DEFAULT_CHARM_PRICING_GROUPS) {
  const collection = clean(charm?.collection)
  const name = clean(charm?.name)
  return normalizeCharmPricingGroups(groups).find((group) => {
    if (!group.enabled) return false
    if (group.collection && clean(group.collection) !== collection) return false
    if (group.nameEquals && clean(group.nameEquals) !== name) return false
    return true
  }) || null
}

/**
 * Convert placed charms into charge lines. Grouped lines share their allowance
 * across different charm ids and bill another unit whenever the allowance is
 * exceeded. Legacy bundle charms retain their original bill-once-per-id rule.
 */
export function charmChargeLines(placed, groups = DEFAULT_CHARM_PRICING_GROUPS) {
  const grouped = new Map()
  const regular = []
  const legacyBundles = new Map()

  for (const charm of placed || []) {
    const group = charmPricingGroupFor(charm, groups)
    if (group) {
      const entry = grouped.get(group.id) || { kind: 'group', rule: group, items: [] }
      entry.items.push(charm)
      grouped.set(group.id, entry)
      continue
    }

    if (charm.bundle) {
      const key = String(charm.charmId || charm.id || '')
      if (!legacyBundles.has(key)) {
        legacyBundles.set(key, {
          kind: 'legacy-bundle',
          key,
          items: [charm],
          quantity: 1,
          unitPrice: Number(charm.price) || 0,
          total: Number(charm.price) || 0,
        })
      } else {
        legacyBundles.get(key).items.push(charm)
      }
      continue
    }

    const unitPrice = Number(charm.price) || 0
    regular.push({
      kind: 'item',
      key: String(charm.charmId || charm.id || ''),
      items: [charm],
      quantity: 1,
      unitPrice,
      total: unitPrice,
    })
  }

  const groupLines = Array.from(grouped.values(), (entry) => {
    const quantity = Math.ceil(entry.items.length / entry.rule.quantity)
    return {
      ...entry,
      key: entry.rule.id,
      quantity,
      unitPrice: entry.rule.price,
      total: quantity * entry.rule.price,
    }
  })

  return [...regular, ...legacyBundles.values(), ...groupLines]
}

export function charmPricingTotal(placed, groups = DEFAULT_CHARM_PRICING_GROUPS) {
  return charmChargeLines(placed, groups).reduce((sum, line) => sum + line.total, 0)
}
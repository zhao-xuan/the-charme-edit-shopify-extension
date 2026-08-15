import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, App, Modal, Segmented, Select, Input } from 'antd'
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  UndoOutlined,
  WarningFilled,
  CloseOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  ExpandOutlined,
  CompressOutlined,
  DownOutlined,
  UpOutlined,
  SaveOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons'
import ProductStage from '../components/ProductStage'
import ProductPicker from '../components/ProductPicker'
import CharmTray from '../components/CharmTray'
import PriceBar from '../components/PriceBar'
import SummaryModal from '../components/SummaryModal'
import { productGroups, findProduct, hasCaseImage, productsByAvailability } from '../data/products'
import { trayGroups, placedCharmsTotal, MIN_CHARMS, MAX_CHARMS, REC_MIN, REC_MAX, itemById } from '../lib/catalog'
import { validateLayout, findScatterSpot, charmFootprint, clampCenter, adaptLayoutToProduct } from '../lib/geometry'
import { onMaskReady } from '../lib/charmMask'
import { resolveAsset } from '../lib/assets'
import { settings } from '../lib/settings'
import { crossSellTitle } from '../lib/crossSellTitle'
import { charmPricingGroupFor } from '../lib/charmPricing'
import { convert, formatMoney, formatPresentmentMoney } from '../lib/money'
import { t, tn } from '../lib/i18n'
import { observeMediaQuery } from '../lib/mediaQuery'
import { fetchVariantDetails } from '../lib/shopifyVariant'
import BASE_PRODUCT_VARIANTS from '../../shopify/widget/variantmap-products.generated.json'
import {
  clearRecoveryDraft,
  deleteDesignDraft,
  designSnapshot,
  listDesignDrafts,
  loadRecoveryDraft,
  saveDraft,
  saveRecoveryDraft,
} from '../lib/designDrafts'

function useMedia(query) {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const m = window.matchMedia(query)
    const fn = (e) => setMatch(e.matches)
    const stop = observeMediaQuery(m, fn)
    setMatch(m.matches)
    return stop
  }, [query])
  return match
}

const uid = () =>
  (typeof globalThis.crypto?.randomUUID === 'function' && globalThis.crypto.randomUUID()) ||
  `c${Date.now()}${Math.random().toString(16).slice(2)}`

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function crossSellImage(option, groups) {
  const group = groups.find((item) => item.key === option.group)
  const fallbackId = option.group === 'apple' ? 'iphone-16-pro-max' : group?.products?.[0]?.id
  const product = findProduct(option.productId || fallbackId)
  const blank = product?.blankImage || {}
  return resolveAsset(option.image || blank.white || blank.default || blank.natural || blank.black || null)
}

const MOBILE_SPLITTER_GUIDE_KEY = 'charme.mobileSplitterGuide.v1'

function initialCasePresentmentPrice(initialCasePresentmentPrice) {
  if (typeof window === 'undefined') return null
  if (Number.isFinite(initialCasePresentmentPrice) && initialCasePresentmentPrice > 0) return initialCasePresentmentPrice
  const params = new URLSearchParams(window.location.search)
  const amount = Number(params.get('case_price'))
  return amount > 0 ? amount : null
}

function asVariantId(value) {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  const digits = raw.match(/(\d{8,20})$/)
  return digits ? digits[1] : null
}

function resolveMappedProductVariant(variantMap, productId, caseId, gelId) {
  const products = variantMap?.products || {}
  return (
    products[`${productId}:${gelId}`] ||
    products[`${productId}:${caseId}`] ||
    products[productId] ||
    products[`other:${gelId}`] ||
    null
  )
}

function hasSeenMobileSplitterGuide() {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(MOBILE_SPLITTER_GUIDE_KEY) === '1'
  } catch {
    return false
  }
}

// Built-in phone categories have hand-tuned swatch gradients in styles.css; any
// custom merchant category gets a stable generated hue so its tab still shows a
// coloured dot rather than the neutral fallback.
const BUILTIN_CAT_KEYS = new Set(['gold', 'silver', 'colourful', 'unique'])
function catDotStyle(key) {
  if (BUILTIN_CAT_KEYS.has(key)) return undefined
  let h = 0
  for (let i = 0; i < String(key).length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return {
    background: `radial-gradient(circle at 34% 28%, hsl(${h} 70% 82%) 0%, hsl(${h} 55% 62%) 55%, hsl(${h} 45% 45%) 100%)`,
  }
}

/**
 * Fold the chosen case colour + gel colour into a single render-ready colour
 * object (shape unchanged from the old single-finish model, so the stage,
 * canvas and export code keep working). The case colour drives the visible
 * shell + photo lookup; the gel colour adds the glitter sparkle when chosen and
 * is recorded on the order. Totes have a single colourway and no gel.
 */
function deriveColor(product, caseColourId, gelColourId) {
  const caseList = product.caseColours || product.colors
  const gels = product.gelColours
  const gel = gels ? gels.find((g) => g.id === gelColourId) || gels[0] : null
  // Models without an independent case-colour choice use the gel colour to pick
  // a matching bare shell. The gel remains order metadata but is never drawn in
  // the editor: preview and proof both stay on the Without gel source.
  const effectiveCaseId =
    (product.gelRender || product.linkedFinish) && gel
      ? (gel.id === 'black' ? 'black' : 'white')
      : caseColourId
  const base = caseList.find((c) => c.id === effectiveCaseId) || caseList[0]
  return {
    id: base.id,
    label: gel ? `${base.label} case · ${gel.label} gel` : base.label,
    shell: base.shell,
    edge: base.edge,
    glitter: !!base.glitter,
    caseId: base.id,
    caseLabel: base.label,
    gelId: gel ? gel.id : null,
    gelLabel: gel ? gel.label : null,
    gelSrc: null,
    imageSrc: null,
  }
}

export default function CustomizerPage({
  onPlaceOrder,
  onGoToCart,
  initialGroupKey,
  initialProductId,
  initialLayout,
  initialCaseColourId,
  initialGelColourId,
  initialCasePresentmentPrice: initialCasePrice,
}) {
  const { message } = App.useApp()
  const isMobile = useMedia('(max-width: 760px)')
  // Lazy catalogue accessor (built after the remote catalogue loads — see
  // products.js). Stable memoised array, safe to read every render.
  const PRODUCT_GROUPS = productGroups()
  // Merchant settings (cross-sell prompt + discounts), loaded at startup.
  const appSettings = settings()

  // Optional starting model/category (set per placement by the Shopify section,
  // so the same widget can open on a different product on each product page). A
  // valid model wins and drives its own category; otherwise fall back to the
  // chosen category, then the default.
  const initialProduct = initialProductId && findProduct(initialProductId)
  const startProduct = (hasCaseImage(initialProduct) && initialProductId) || null
  const startGroup =
    (startProduct &&
      PRODUCT_GROUPS.find((g) => g.products.some((p) => p.id === startProduct))?.key) ||
    initialGroupKey ||
    'apple'
  const resolvedProduct =
    startProduct ||
    // Default to the iPhone 16 Pro Max when the Apple group is active (rather than
    // the group's first entry, which is an old model).
    (startGroup === 'apple' && hasCaseImage(findProduct('iphone-16-pro-max')) ? 'iphone-16-pro-max' : null) ||
    (PRODUCT_GROUPS.find((g) => g.key === startGroup) || PRODUCT_GROUPS[0]).products.find((item) => hasCaseImage(item))?.id ||
    PRODUCT_GROUPS.flatMap((group) => group.products).find((item) => hasCaseImage(item))?.id ||
    'iphone-17-pro'

  const [groupKey, setGroupKey] = useState(startGroup)
  const [productId, setProductId] = useState(resolvedProduct)
  const [livePresentmentCasePrice, setLivePresentmentCasePrice] = useState(
    () => initialCasePresentmentPrice(initialCasePrice),
  )
  const [liveProductPrices, setLiveProductPrices] = useState({})
  const priceCacheRef = useRef(new Map())
  const productPricesCacheRef = useRef(new Map())
  // The Shopify product page's variant selection (iPhone model + case/gel colour)
  // seeds the opening finish so the customizer matches what the customer picked.
  const [caseColourId, setCaseColourId] = useState(
    () => (initialCaseColourId === 'black' || initialCaseColourId === 'white' ? initialCaseColourId : 'white'),
  )
  const [gelColourId, setGelColourId] = useState(
    () => (['glitter', 'white', 'black'].includes(initialGelColourId) ? initialGelColourId : 'glitter'),
  )
  const [placed, setPlaced] = useState([])
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [namedDrafts, setNamedDrafts] = useState([])
  const [selectedUid, setSelectedUid] = useState(null)
  // "Type a word" groups. Each placed letter/number that belongs to a typed word
  // carries a `groupId`; `wordGroups` holds the metadata { id, label, broken }.
  // A non-broken group drags as ONE unit and shows a tag by the type-a-word box;
  // once the customer confirms they want to fine-tune it, `broken` flips true so
  // its letters become individually draggable and its tag disappears.
  const [wordGroups, setWordGroups] = useState([])
  const [selectedGroupId, setSelectedGroupId] = useState(null)
  // Group id whose "Are you sure?" break-apart confirmation panel is showing.
  const [confirmGroupId, setConfirmGroupId] = useState(null)
  const [zoom, setZoom] = useState(1)
  // Desktop: enlarge the charm selector (wider tray + bigger cards) and back.
  const [trayExpanded, setTrayExpanded] = useState(false)

  const [summaryOpen, setSummaryOpen] = useState(false)
  // Cross-sell popup shown after a product is added to the cart.
  const [crossSellOpen, setCrossSellOpen] = useState(false)
  const [isSecondProduct, setIsSecondProduct] = useState(false)
  // Set true when the customer taps the order button while charms still overlap
  // or sit outside the craftable area — surfaces a prominent fix-it message next
  // to the case (desktop) and emphasises the Step 2 overlay warning (mobile).
  const [showOverlapWarning, setShowOverlapWarning] = useState(false)
  // Bumped on each blocked order attempt so the mobile overlay warning replays
  // its attention pulse even when the problem count is unchanged.
  const [warnPulse, setWarnPulse] = useState(0)

  // Mobile Step 2 overlay starts expanded so first-time customers read the
  // guidance, then auto-collapses to just the title after a few seconds. Tapping
  // the title toggles it back open.
  const [step2Open, setStep2Open] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => setStep2Open(false), 5000)
    return () => clearTimeout(timer)
  }, [])
  const [mockupNoticeOpen, setMockupNoticeOpen] = useState(false)

  // Mobile only: the charm tray's share of the screen (% of the shell height).
  // A draggable splitter between the preview and the tray lets the customer
  // trade preview space for browsing space and back. Defaults small so the case
  // preview fills ~60% of the screen; drag the splitter up for more browsing.
  const [trayPct, setTrayPct] = useState(14)
  const mobileShellRef = useRef(null)
  const splitDrag = useRef(null)
  const [mobileSplitterGuideOpen, setMobileSplitterGuideOpen] = useState(
    () => !hasSeenMobileSplitterGuide(),
  )
  const dismissMobileSplitterGuide = useCallback(() => {
    setMobileSplitterGuideOpen(false)
    try {
      window.localStorage.setItem(MOBILE_SPLITTER_GUIDE_KEY, '1')
    } catch {
      // Storage can be unavailable in private browsing; dismissal still works.
    }
  }, [])

  // Desktop only: the charm tray column width (px). A draggable divider on its
  // left edge lets the customer widen the tray (more, smaller charm cards per
  // row) or reclaim the space for the preview.
  const [trayWidth, setTrayWidth] = useState(384)
  const studioRef = useRef(null)
  const trayRef = useRef(null)
  const trayDrag = useRef(null)
  // On a too-narrow DESKTOP window the 3-column layout can push the charm tray
  // off-screen. Detect that and surface a top-right "widen the window" hint.
  const [trayClipped, setTrayClipped] = useState(false)
  useEffect(() => {
    if (isMobile) {
      setTrayClipped(false)
      return
    }
    const check = () => {
      const studio = studioRef.current
      const el = trayRef.current
      if (!studio || !el) return
      // Clipped when the 3-column grid overflows its own box (fixed side + tray
      // columns can't fit) or the tray has been squeezed below a usable width.
      const overflow = studio.scrollWidth > studio.clientWidth + 2
      setTrayClipped(overflow || el.getBoundingClientRect().width < 240)
    }
    check()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null
    if (ro && studioRef.current) ro.observe(studioRef.current)
    window.addEventListener('resize', check)
    return () => {
      if (ro) ro.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [isMobile, trayWidth, trayExpanded])

  const stageApi = useRef(null)

  const catalogProduct = findProduct(productId)
  const presentmentCasePrice = livePresentmentCasePrice
  const product = presentmentCasePrice && catalogProduct?.kind === 'phone'
    ? { ...catalogProduct, presentmentPrice: presentmentCasePrice }
    : catalogProduct
  const color = useMemo(
    () => deriveColor(product, caseColourId, gelColourId),
    [product, caseColourId, gelColourId],
  )
  const geometryProduct = useMemo(() => {
    const obstacles = product.printable.obstaclesByCaseColour?.[caseColourId]
    if (!obstacles) return product
    return {
      ...product,
      printable: { ...product.printable, obstacles },
    }
  }, [product, caseColourId])

  // Keep the case base price aligned with the ACTIVE Shopify variant. This runs
  // only for the storefront phone customizer (when variantMap exists), and
  // updates whenever model/finish changes.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!catalogProduct || catalogProduct.kind !== 'phone') {
      setLivePresentmentCasePrice(null)
      return
    }
    const cfg = window.CharmeConfig || {}
    const mapped = resolveMappedProductVariant(
      cfg.variantMap,
      catalogProduct.id,
      color.caseId || color.id,
      color.gelId || color.caseId || color.id,
    ) || BASE_PRODUCT_VARIANTS[`${catalogProduct.id}:${color.gelId || color.caseId || color.id}`]
    const variantId = asVariantId(mapped || cfg.variantId)
    if (!variantId) {
      // A product-page launch already supplies the selected Shopify price in
      // case_price. Do not erase it simply because an optional variant map is
      // not configured for this merchant yet.
      return
    }

    const currency = String(cfg.currency?.active || '').toUpperCase()
    // Links created before the country parameter existed still carry GBP.
    // Those represent the UK storefront, so resolve their real UK price rather
    // than retaining the legacy `case_price` query value.
    const country = String(cfg.country || (currency === 'GBP' ? 'GB' : '')).toUpperCase()
    const apiBase = cfg.apiBase || window.location.origin
    const cacheKey = `${variantId}:${country}:${currency}`
    const cached = priceCacheRef.current.get(cacheKey)
    if (Number.isFinite(cached) && cached > 0) {
      setLivePresentmentCasePrice(cached)
      return
    }

    let cancelled = false
    ;(async () => {
      let amount = null
      if (/^[A-Z]{2}$/.test(country)) {
        try {
          const endpoint = new URL('/api/shopify/contextual-price', apiBase)
          endpoint.searchParams.set('variant', variantId)
          endpoint.searchParams.set('country', country)
          const res = await fetch(endpoint, { headers: { accept: 'application/json' } })
          const data = await res.json().catch(() => ({}))
          const maybe = Number(data.amount)
          if (res.ok && maybe > 0 && (!currency || data.currency === currency)) amount = maybe
        } catch {
          // Fallback below.
        }
      }
      if (!(amount > 0)) {
        const shopifyRoot = window.Shopify?.routes?.root || '/'
        const local = await fetchVariantDetails(`${shopifyRoot}variants/${variantId}.js`)
        const maybeCents = Number(local?.price)
        if (maybeCents > 0) amount = maybeCents / 100
      }
      if (!cancelled) {
        if (amount > 0) {
          priceCacheRef.current.set(cacheKey, amount)
          setLivePresentmentCasePrice(amount)
        } else {
          setLivePresentmentCasePrice(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [catalogProduct, color.caseId, color.id, color.gelId])

  // Load every visible model's real Shopify price in one request so the desktop
  // dropdown never falls back to stale metaobject base prices.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const cfg = window.CharmeConfig || {}
    const currency = String(cfg.currency?.active || '').toUpperCase()
    const country = String(cfg.country || (currency === 'GBP' ? 'GB' : '')).toUpperCase()
    if (!/^[A-Z]{2}$/.test(country)) return

    const entries = Object.entries(BASE_PRODUCT_VARIANTS)
      .filter(([key]) => key.endsWith(`:${gelColourId}`))
    const cacheKey = `${country}:${currency}:${gelColourId}`
    const cached = productPricesCacheRef.current.get(cacheKey)
    if (cached) {
      setLiveProductPrices(cached)
      return
    }

    let cancelled = false
    const apiBase = cfg.apiBase || window.location.origin
    ;(async () => {
      try {
        const response = await fetch(new URL('/api/shopify/contextual-prices', apiBase), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ country, variantIds: entries.map(([, variantId]) => variantId) }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) return
        const prices = {}
        for (const [key, variantId] of entries) {
          const price = data.prices?.[String(variantId)]
          if (Number(price?.amount) > 0 && (!currency || price.currency === currency)) {
            prices[key.slice(0, -(gelColourId.length + 1))] = Number(price.amount)
          }
        }
        if (!cancelled) {
          productPricesCacheRef.current.set(cacheKey, prices)
          setLiveProductPrices(prices)
        }
      } catch {
        // Keep the selected product's independently resolved price available.
      }
    })()
    return () => { cancelled = true }
  }, [gelColourId])

  // Apply a full saved arrangement (product + case/gel finish + placed charms).
  // Shared by the dev/QA seed hook and the production preset auto-loader. `opts`
  // lets the caller override the target phone / finish (e.g. the customer's chosen
  // model on the Shopify page); charms are re-fitted to that phone when it differs
  // from the one the design was authored on.
  const applyLayout = useCallback((layout = {}, opts = {}) => {
    const wantPid = opts.productId && findProduct(opts.productId) ? opts.productId : layout.productId
    if (wantPid) setProductId(wantPid)
    const caseId = opts.caseColourId || layout.caseColourId
    const gelId = opts.gelColourId || layout.gelColourId
    if (caseId) setCaseColourId(caseId)
    if (gelId) setGelColourId(gelId)
    let placed = (layout.charms || []).map((it) => {
      const catalogCharm = itemById(it.charmId)
      return {
        uid: uid(),
        charmId: it.charmId || 'demo',
        shopifyVariantId: catalogCharm?.shopifyVariantId || it.shopifyVariantId,
        type: catalogCharm?.type || it.type || 2,
        category: catalogCharm?.category || it.category || 'gold',
        collection: catalogCharm?.collection || it.collection || '',
        name: catalogCharm?.name || it.name || 'demo',
        src: resolveAsset(catalogCharm?.src || it.src),
        price: catalogCharm?.price ?? it.price ?? 0,
        bundle: !!catalogCharm?.bundle,
        bundleMax: catalogCharm?.bundleMax,
        baseWmm: it.wMm || catalogCharm?.widthMm,
        baseHmm: it.hMm || catalogCharm?.heightMm,
        minScale: catalogCharm?.minScale ?? 0.05,
        maxScale: catalogCharm?.maxScale ?? 20,
        scale: it.scale || 1,
        rot: it.rot || 0,
        cxMm: it.cxMm,
        cyMm: it.cyMm,
        groupId: it.groupId,
        groupLabel: it.groupLabel,
      }
    })
    const fromP = findProduct(layout.productId)
    const toP = findProduct(wantPid)
    if (fromP && toP && fromP !== toP && fromP.kind === 'phone' && toP.kind === 'phone') {
      placed = adaptLayoutToProduct(placed, fromP, toP)
    }
    setPlaced(placed)
    setWordGroups(layout.wordGroups || [])
    setSelectedUid(null)
  }, [])

  const snapshot = useCallback(() => designSnapshot({
    productId,
    caseColourId,
    gelColourId,
    placed,
    wordGroups,
  }), [productId, caseColourId, gelColourId, placed, wordGroups])
  const [draftsReady, setDraftsReady] = useState(false)

  const hasExplicitStartSelection = Boolean(initialProductId || initialCaseColourId || initialGelColourId)

  useEffect(() => {
    const recovery = loadRecoveryDraft()
    setNamedDrafts(listDesignDrafts())
    if (
      recovery?.snapshot?.charms?.length &&
      !initialLayout?.charms?.length &&
      !hasExplicitStartSelection
    ) {
      applyLayout(recovery.snapshot)
    }
    setDraftsReady(true)
  }, [applyLayout, hasExplicitStartSelection, initialLayout])

  useEffect(() => {
    if (!draftsReady) return
    saveRecoveryDraft(snapshot())
  }, [draftsReady, snapshot])

  const refreshNamedDrafts = useCallback(() => setNamedDrafts(listDesignDrafts()), [])
  const saveNamedDraft = useCallback(() => {
    const saved = saveDraft({ name: draftName, snapshot: snapshot() })
    if (!saved) {
      message.error('Could not save this design on this device.')
      return
    }
    setDraftName('')
    refreshNamedDrafts()
    message.success('Design saved')
  }, [draftName, message, refreshNamedDrafts, snapshot])
  const loadNamedDraft = useCallback((draft) => {
    applyLayout(draft.snapshot)
    setDraftsOpen(false)
    message.success(`Loaded ${draft.name}`)
  }, [applyLayout, message])
  const newDesign = useCallback(() => {
    setPlaced([])
    setWordGroups([])
    setSelectedUid(null)
    clearRecoveryDraft()
    setDraftsOpen(false)
  }, [])

  // Production preset auto-load: when the Shopify placement supplies a digitised
  // design (fetched by product handle before the widget mounted), seed it once so
  // the customer opens onto that design and can refine it. Runs a single time.
  const seededPreset = useRef(false)
  useEffect(() => {
    if (seededPreset.current || !initialLayout || !(initialLayout.charms || []).length) return
    seededPreset.current = true
    applyLayout(initialLayout, {
      productId: initialProductId,
      caseColourId: initialCaseColourId,
      gelColourId: initialGelColourId,
    })
  }, [initialLayout, initialProductId, initialCaseColourId, initialGelColourId, applyLayout])

  // Dev/QA layout seeding hook. Lets tooling reproduce an exact arrangement
  // (e.g. a real reference photo) on the live site for screenshot comparison:
  //   window.__charmeSeedLayout({ productId, caseColourId, gelColourId, charms:
  //     [{ src, name, category, cxMm, cyMm, wMm, hMm, rot }] })
  // Available in dev, and in production ONLY when the page URL carries a `?seed`
  // flag (so normal visitors never expose it); otherwise it is inert.
  useEffect(() => {
    const seedEnabled =
      import.meta.env.DEV ||
      (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('seed'))
    if (!seedEnabled || typeof window === 'undefined') return
    window.__charmeSeedLayout = (layout = {}) => applyLayout(layout)
    return () => {
      delete window.__charmeSeedLayout
    }
  }, [applyLayout])

  // Inline Step 1 dropdowns (mobile header), plus case + gel colour lists.
  const modelOptions = useMemo(() => {
    const group = PRODUCT_GROUPS.find((g) => g.key === groupKey) || PRODUCT_GROUPS[0]
    if (group.platform === 'android') {
      const { available, comingSoon } = productsByAvailability(group.products)
      return [
        {
          label: t('picker.availableNow'),
          options: available.map((p) => ({
            value: p.id,
            label: p.name,
          })),
        },
        {
          label: t('picker.comingSoon'),
          options: comingSoon.map((p) => ({
            value: p.id,
            label: `${p.name} · ${t('picker.comingSoon')}`,
            disabled: true,
          })),
        },
      ].filter((section) => section.options.length)
    }
    return group.products.map((p) => ({
      value: p.id,
      label: p.name,
      disabled: !hasCaseImage(p),
    }))
  }, [groupKey])
  const caseOptions = (product.caseColours || product.colors).map((c) => ({
    value: c.id,
    label: c.label,
    disabled: !!c.disabled,
  }))
  const gelOptions = product.gelColours?.map((g) => ({
    value: g.id,
    label: g.label,
    disabled: !!g.disabled,
  }))
  // Charm shape masks load lazily in the browser; bump this when one arrives so
  // the layout re-validates against the real cut-out shape (not just the OBB).
  const [maskVersion, setMaskVersion] = useState(0)
  useEffect(() => onMaskReady(() => setMaskVersion((v) => v + 1)), [])
  const validation = useMemo(
    () => validateLayout(placed, geometryProduct, { minCharms: MIN_CHARMS, maxCharms: MAX_CHARMS }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placed, geometryProduct, maskVersion],
  )

  // Tray groups for the active product kind (4 categories for phones, 3 types
  // for totes) + the mobile category dropdown selection.
  const groups = useMemo(() => trayGroups(product.kind), [product.kind])
  const [catKey, setCatKey] = useState(() => trayGroups('phone')[0].key)
  useEffect(() => {
    if (!groups.some((g) => g.key === catKey)) setCatKey(groups[0].key)
  }, [groups, catKey])

  // keep the case/gel selection valid when switching products
  useEffect(() => {
    const caseList = product.caseColours || product.colors
    const currentCase = caseList.find((c) => c.id === caseColourId)
    if (!currentCase || currentCase.disabled) {
      setCaseColourId((caseList.find((c) => !c.disabled) || caseList[0]).id)
    }
    const currentGel = product.gelColours?.find((g) => g.id === gelColourId)
    if (product.gelColours && (!currentGel || currentGel.disabled)) {
      setGelColourId((product.gelColours.find((g) => !g.disabled) || product.gelColours[0]).id)
    }
  }, [product, caseColourId, gelColourId])

  // Integrated-gel models hide the case-colour control and let the gel colour
  // drive the finish; keep the (now hidden) case-colour state in sync so the
  // recorded order + any downstream consumer still reflect the right case.
  useEffect(() => {
    if (!product.gelRender) return
    const want = gelColourId === 'black' ? 'black' : 'white'
    if (caseColourId !== want) setCaseColourId(want)
  }, [product.gelRender, gelColourId, caseColourId])

  // ---- undo / recall history ------------------------------------------------
  // A bounded stack of `placed` snapshots. We checkpoint before every discrete
  // change (add / remove / clear) and at the start of a drag or resize gesture,
  // so a single Undo brings back an accidentally-cleared layout or a deleted
  // charm. History is dropped when the base product changes.
  const placedRef = useRef(placed)
  placedRef.current = placed
  const historyRef = useRef([])
  const [histLen, setHistLen] = useState(0)
  const pushHistory = useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-29), placedRef.current]
    setHistLen(historyRef.current.length)
  }, [])
  const resetHistory = useCallback(() => {
    historyRef.current = []
    setHistLen(0)
  }, [])
  const undo = useCallback(() => {
    const h = historyRef.current
    if (!h.length) return
    const prev = h[h.length - 1]
    historyRef.current = h.slice(0, -1)
    setHistLen(historyRef.current.length)
    setPlaced(prev)
    setSelectedUid(null)
    setSelectedGroupId(null)
    setConfirmGroupId(null)
  }, [])
  const canUndo = histLen > 0

  const handleGroup = (g) => {
    const from = product
    setGroupKey(g)
    const group = PRODUCT_GROUPS.find((x) => x.key === g)
    // Apple defaults to the iPhone 16 Pro Max rather than the group's oldest model.
    const firstAvailable = group.products.find((item) => hasCaseImage(item)) || group.products[0]
    const firstId =
      g === 'apple' && hasCaseImage(findProduct('iphone-16-pro-max'))
        ? 'iphone-16-pro-max'
        : firstAvailable.id
    const to = findProduct(firstId)
    setProductId(firstId)
    // Carry a design across to the new phone (re-fitted to its footprint + camera)
    // when both sides are phones; otherwise start the new product type fresh.
    setPlaced((prev) =>
      from?.kind === 'phone' && to?.kind === 'phone' ? adaptLayoutToProduct(prev, from, to) : [],
    )
    setSelectedUid(null)
    setSelectedGroupId(null)
    setConfirmGroupId(null)
    resetHistory()
  }
  const handleProduct = (id) => {
    const from = product
    const to = findProduct(id)
    if (!hasCaseImage(to)) return
    setProductId(id)
    setPlaced((prev) =>
      from?.kind === 'phone' && to?.kind === 'phone' ? adaptLayoutToProduct(prev, from, to) : [],
    )
    setSelectedUid(null)
    setSelectedGroupId(null)
    setConfirmGroupId(null)
    resetHistory()
  }

  const makePlaced = useCallback((charm, pos) => ({
    uid: uid(),
    charmId: charm.id,
    shopifyVariantId: charm.shopifyVariantId,
    type: charm.type,
    category: charm.category,
    collection: charm.collection,
    name: charm.name,
    src: charm.src,
    price: charm.price,
    // Flat-price "bundle" charms (e.g. little stones) — pick several of the same
    // piece for one price, up to `bundleMax`. Carried on the placed instance so
    // pricing + the per-charm add cap work without a catalogue lookup.
    bundle: !!charm.bundle,
    bundleMax: charm.bundleMax,
    baseWmm: charm.widthMm,
    baseHmm: charm.heightMm,
    minScale: charm.minScale,
    maxScale: charm.maxScale,
    scale: 1,
    rot: pos.rot || 0,
    cxMm: pos.cxMm,
    cyMm: pos.cyMm,
  }), [])

  // Keep a charm's whole footprint inside the printable area (strict boundary).
  const clampToPrintable = useCallback(
    (c) => {
      const { cx, cy } = clampCenter(charmFootprint(c), geometryProduct.printable)
      return { ...c, cxMm: cx, cyMm: cy }
    },
    [geometryProduct],
  )

  // Gate every add path on the overall cap and a legacy bundle charm's
  // per-piece limit. Shared pricing groups may exceed one block: the next
  // quantity block is simply charged again.
  const canAddMore = useCallback(
    (charm) => {
      if (placedRef.current.length >= MAX_CHARMS) {
        message.warning(t('msg.maxCharms', { n: MAX_CHARMS }))
        return false
      }
      const sharedGroup = charmPricingGroupFor(charm, appSettings.charmPricingGroups)
      if (!sharedGroup && charm.bundle && charm.bundleMax) {
        const have = placedRef.current.filter((c) => c.charmId === charm.id).length
        if (have >= charm.bundleMax) {
          message.info(t('msg.bundleIncluded', { n: charm.bundleMax, name: charm.name }))
          return false
        }
      }
      return true
    },
    [message, appSettings.charmPricingGroups],
  )

  // Commit a built placed-charm, enforcing the hard caps inside the updater so
  // the invariants hold even under rapid taps (before a re-render refreshes the
  // ref `canAddMore` reads): never exceed MAX_CHARMS, never exceed a bundle
  // charm's per-piece limit.
  const commitPlaced = useCallback(
    (pc) => {
      pushHistory()
      setPlaced((p) => {
        if (p.length >= MAX_CHARMS) return p
        const sharedGroup = charmPricingGroupFor(pc, appSettings.charmPricingGroups)
        if (
          !sharedGroup &&
          pc.bundle &&
          pc.bundleMax &&
          p.filter((c) => c.charmId === pc.charmId).length >= pc.bundleMax
        ) {
          return p
        }
        return [...p, pc]
      })
      setSelectedUid(pc.uid)
    },
    [pushHistory, appSettings.charmPricingGroups],
  )

  const addAt = useCallback(
    (charm, mm) => {
      if (!canAddMore(charm)) return
      const pc = clampToPrintable(
        makePlaced(charm, { cxMm: mm.xMm, cyMm: mm.yMm, rot: 0 }),
      )
      commitPlaced(pc)
    },
    [canAddMore, clampToPrintable, makePlaced, commitPlaced],
  )

  // A relaxed "drop it anywhere" position for when the case is already busy:
  // stagger around the centre of the printable area so repeated taps don't
  // perfectly stack, then let clampToPrintable pull the whole footprint inside.
  // Lets the customer pile on every charm they like now and thin it out later.
  const fallbackSpot = useCallback(
    (prev, charm) => {
      const { outer } = product.printable
      const i = prev.length
      const radius = 4 + (i % 6) * 6
      const angle = i * 1.1
      return {
        cxMm: outer.xMm + outer.wMm / 2 + Math.cos(angle) * radius,
        cyMm: outer.yMm + outer.hMm / 2 + Math.sin(angle) * radius,
        rot: charm.type === 3 ? Math.round(Math.random() * 30 - 15) : 0,
      }
    },
    [product],
  )

  const addAuto = useCallback(
    (charm) => {
      if (!canAddMore(charm)) return
      const prev = placedRef.current
      // Prefer a clear, non-overlapping spot — fillers tumble, everything else
      // lands upright. If the case is busy and nothing is clear we still add the
      // charm (lightly staggered, overlap allowed) rather than refusing, so the
      // customer is never blocked from choosing the charms they want. Overlaps
      // are simply flagged for them to tidy before ordering.
      const spot =
        findScatterSpot(geometryProduct, prev, charm, charm.type === 3 ? {} : { rotMaxDeg: 0 }) ||
        fallbackSpot(prev, charm)
      commitPlaced(clampToPrintable(makePlaced(charm, spot)))
    },
    [canAddMore, geometryProduct, makePlaced, commitPlaced, clampToPrintable, fallbackSpot],
  )

  const activateCharm = useCallback((charm) => addAuto(charm), [addAuto])

  const moveCharm = useCallback(
    (id, patch) => {
      setPlaced((p) =>
        p.map((c) => (c.uid === id ? clampToPrintable({ ...c, ...patch }) : c)),
      )
    },
    [clampToPrintable],
  )
  const transformCharm = moveCharm
  const removeCharm = useCallback(
    (id) => {
      pushHistory()
      setPlaced((p) => p.filter((c) => c.uid !== id))
      setSelectedUid((s) => (s === id ? null : s))
    },
    [pushHistory],
  )
  const clearAll = () => {
    if (placedRef.current.length === 0) return
    pushHistory()
    setPlaced([])
    setSelectedUid(null)
    setWordGroups([])
    setSelectedGroupId(null)
    setConfirmGroupId(null)
  }

  // ---- word-group helpers -------------------------------------------------
  // Select a whole typed-word group (via its tag or by tapping any of its
  // letters). Clears the single-charm selection so the group box shows instead
  // of a per-charm rotation dial.
  const selectGroup = useCallback((groupId) => {
    setSelectedGroupId(groupId)
    setSelectedUid(null)
    setConfirmGroupId(null)
  }, [])

  // Move an entire (non-broken) word group by a mm delta, clamping the group's
  // bounding box inside the printable outer so the whole word stays on the case.
  // `starts` is a Map<uid, {cx,cy}> captured at drag start.
  const moveGroup = useCallback(
    (groupId, dxMm, dyMm, starts) => {
      const outer = product.printable.outer
      setPlaced((p) => {
        const members = p.filter((c) => c.groupId === groupId)
        if (!members.length) return p
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const c of members) {
          const s = starts.get(c.uid)
          if (!s) continue
          const fw = c.baseWmm * (c.scale || 1)
          const fh = c.baseHmm * (c.scale || 1)
          minX = Math.min(minX, s.cx - fw / 2)
          maxX = Math.max(maxX, s.cx + fw / 2)
          minY = Math.min(minY, s.cy - fh / 2)
          maxY = Math.max(maxY, s.cy + fh / 2)
        }
        let ddx = dxMm
        let ddy = dyMm
        if (minX + ddx < outer.xMm) ddx = outer.xMm - minX
        if (maxX + ddx > outer.xMm + outer.wMm) ddx = outer.xMm + outer.wMm - maxX
        if (minY + ddy < outer.yMm) ddy = outer.yMm - minY
        if (maxY + ddy > outer.yMm + outer.hMm) ddy = outer.yMm + outer.hMm - maxY
        return p.map((c) => {
          if (c.groupId !== groupId) return c
          const s = starts.get(c.uid)
          return s ? { ...c, cxMm: s.cx + ddx, cyMm: s.cy + ddy } : c
        })
      })
    },
    [product],
  )

  // Break a group apart: its letters become individually draggable and its tag
  // disappears from the type-a-word box. Called after the customer confirms.
  const breakGroup = useCallback((groupId) => {
    setWordGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, broken: true } : g)))
    setConfirmGroupId(null)
    setSelectedGroupId(null)
  }, [])

  // Prune word-group metadata once all of a group's letters have been removed.
  useEffect(() => {
    setWordGroups((gs) => {
      if (!gs.length) return gs
      const live = new Set(placed.map((c) => c.groupId).filter(Boolean))
      const next = gs.filter((g) => live.has(g.id))
      return next.length === gs.length ? gs : next
    })
  }, [placed])

  // ---- tray → stage drag (desktop precise placement) ----
  const [ghost, setGhost] = useState(null)
  const pending = useRef(null)

  const onWinMove = useCallback((e) => {
    const pn = pending.current
    if (!pn) return
    if (!pn.dragging) {
      if (Math.hypot(e.clientX - pn.x0, e.clientY - pn.y0) < 6) return
      pn.dragging = true
      const s = stageApi.current?.getScale?.() || 3
      pn.w = pn.charm.widthMm * s
      pn.h = pn.charm.heightMm * s
    }
    setGhost({ src: pn.charm.src, x: e.clientX, y: e.clientY, w: pn.w, h: pn.h })
  }, [])

  const onWinUp = useCallback(
    (e) => {
      const pn = pending.current
      window.removeEventListener('pointermove', onWinMove)
      window.removeEventListener('pointerup', onWinUp)
      pending.current = null
      setGhost(null)
      if (pn && pn.dragging) {
        pn.suppressClick = true
        const api = stageApi.current
        if (api && api.isInsideDropArea(e.clientX, e.clientY)) {
          const mm = api.clientToMm(e.clientX, e.clientY)
          if (mm) addAt(pn.charm, mm)
        }
        // remember to swallow the click that follows a real drag
        suppressClick.current = true
        setTimeout(() => (suppressClick.current = false), 50)
      }
    },
    [onWinMove, addAt],
  )

  const suppressClick = useRef(false)

  const onTrayPointerDown = useCallback(
    (charm, e) => {
      if (e.button != null && e.button !== 0) return
      pending.current = { charm, x0: e.clientX, y0: e.clientY, dragging: false }
      window.addEventListener('pointermove', onWinMove)
      window.addEventListener('pointerup', onWinUp)
    },
    [onWinMove, onWinUp],
  )

  const onTrayActivate = useCallback(
    (charm) => {
      if (suppressClick.current) return
      activateCharm(charm)
    },
    [activateCharm],
  )

  const zoomDock = (
    <div className="zoom-dock">
      <Button
        size="small"
        shape="circle"
        icon={<UndoOutlined />}
        disabled={!canUndo}
        onClick={undo}
        title={t('action.undo')}
      />
      <Button
        size="small"
        shape="circle"
        icon={<DeleteOutlined />}
        disabled={placed.length === 0}
        onClick={clearAll}
        title={t('action.clearAll')}
      />
      <span className="zoom-dock__sep" />
      <Button
        size="small"
        shape="circle"
        icon={<ZoomInOutlined />}
        onClick={() => setZoom((z) => clamp(+(z + 0.15).toFixed(2), 0.6, 2))}
      />
      <Button
        size="small"
        shape="circle"
        icon={<ZoomOutOutlined />}
        onClick={() => setZoom((z) => clamp(+(z - 0.15).toFixed(2), 0.6, 2))}
      />
    </div>
  )

  const tray = (
    <CharmTray
      key={product.kind}
      kind={product.kind}
      compact={isMobile}
      rows
      activeKey={catKey}
      onActivate={onTrayActivate}
      onPointerDown={isMobile ? undefined : onTrayPointerDown}
      wordGroups={wordGroups}
      selectedGroupId={selectedGroupId}
      onSelectGroup={selectGroup}
    />
  )
  // Short labels for the mobile category row (drop the trailing " charms" so all
  // four phone categories fit one row; tote group labels are already short).
  const categoryOptions = groups.map((g) => ({
    value: g.key,
    label: product.kind !== 'tote' ? g.label.replace(/ charms$/i, '') : g.label,
  }))
  const mobileTray = (
    <CharmTray
      key={`${product.kind}-${catKey}`}
      kind={product.kind}
      compact
      rows
      activeKey={catKey}
      onActivate={onTrayActivate}
      wordGroups={wordGroups}
      selectedGroupId={selectedGroupId}
      onSelectGroup={selectGroup}
    />
  )

  // Order CTA handler. If the layout is valid we open the summary; otherwise we
  // surface the prominent overlap message beside the case instead of silently
  // doing nothing — so customers understand why they can't continue.
  const attemptOrder = () => {
    if (validation.ok) {
      setShowOverlapWarning(false)
      setSummaryOpen(true)
      return
    }
    if (validation.tooFew) {
      message.warning(
        t('msg.addAtLeastHave', { min: MIN_CHARMS, have: placed.length }),
      )
      return
    }
    if (validation.tooMany) {
      message.warning(t('msg.useAtMost', { n: MAX_CHARMS }))
      return
    }
    setShowOverlapWarning(true)
    setWarnPulse((n) => n + 1)
  }

  // ---- cross-sell: after add-to-cart, offer a second product ----
  const crossSell = appSettings.crossSell || {}
  const crossSellOptions = Array.isArray(crossSell.options)
    ? crossSell.options.filter((o) => o && o.label)
    : []
  // Place the order via the host handler; in cart-drawer mode it resolves without
  // navigating away, so we can then surface the cross-sell popup.
  const handlePlaceOrder = async (payload) => {
    // When the cross-sell popup will be shown, tell the cart handler NOT to
    // surface the cart yet (no drawer / no redirect to /cart) — the customer
    // should see the popup first and only go to the cart if they decline it
    // ("No thanks" → goToCart). Otherwise add-to-cart behaves as before.
    const willCrossSell = crossSell.enabled && crossSellOptions.length > 0
    if (onPlaceOrder) await onPlaceOrder(willCrossSell ? { ...payload, deferSurface: true } : payload)
    if (willCrossSell) setCrossSellOpen(true)
  }
  // Pick a cross-sell product: apply the promo code (best-effort) and reopen the
  // customizer on the chosen product so the customer starts their second piece.
  const pickCrossSell = (opt) => {
    setCrossSellOpen(false)
    setIsSecondProduct(true)
    const fallbackProductId = opt.group === 'frame' ? 'frame-5x7' : undefined
    const targetProductId = opt.productId || fallbackProductId
    const code = (crossSell.discountCode || '').trim()
    if (code && typeof fetch !== 'undefined') {
      // /discount/<CODE> applies the code to the current cart session (store origin).
      fetch(`/discount/${encodeURIComponent(code)}`, { mode: 'no-cors' }).catch(() => {})
    }
    if (opt.group) handleGroup(opt.group)
    if (targetProductId) handleProduct(targetProductId)
    // Start the second product on a clean canvas (wins over the switch resets).
    setPlaced([])
    setSelectedUid(null)
    setSelectedGroupId(null)
    setConfirmGroupId(null)
  }
  // Skip the cross-sell and go straight to the cart to check out.
  const goToCart = () => {
    setCrossSellOpen(false)
    if (onGoToCart) {
      onGoToCart()
      return
    }
    if (typeof window !== 'undefined') {
      const cartUrl = (window.CharmeConfig && window.CharmeConfig.cartUrl) || '/cart'
      window.location.href = cartUrl
    }
  }

  // ---- mobile splitter: drag to resize the preview vs. tray split ----
  const onSplitDown = useCallback((e) => {
    e.preventDefault()
    dismissMobileSplitterGuide()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Some browsers throw if the pointer is no longer active — safe to ignore.
    }
    splitDrag.current = { pointerId: e.pointerId }
  }, [dismissMobileSplitterGuide])
  const onSplitMove = useCallback((e) => {
    const d = splitDrag.current
    if (!d || d.pointerId !== e.pointerId) return
    const shell = mobileShellRef.current
    if (!shell) return
    const rect = shell.getBoundingClientRect()
    const pct = ((rect.bottom - e.clientY) / rect.height) * 100
    setTrayPct(clamp(+pct.toFixed(1), 12, 78))
  }, [])
  const onSplitUp = useCallback((e) => {
    const d = splitDrag.current
    if (!d || d.pointerId !== e.pointerId) return
    splitDrag.current = null
  }, [])

  // ---- desktop tray resizer: drag the divider to set the tray column width ----
  const onTrayResizeDown = useCallback((e) => {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Some browsers throw if the pointer is no longer active — safe to ignore.
    }
    trayDrag.current = { pointerId: e.pointerId }
  }, [])
  const onTrayResizeMove = useCallback((e) => {
    const d = trayDrag.current
    if (!d || d.pointerId !== e.pointerId) return
    const studio = studioRef.current
    if (!studio) return
    const rect = studio.getBoundingClientRect()
    setTrayWidth(clamp(Math.round(rect.right - e.clientX), 320, 620))
  }, [])
  const onTrayResizeUp = useCallback((e) => {
    const d = trayDrag.current
    if (!d || d.pointerId !== e.pointerId) return
    trayDrag.current = null
  }, [])

  const picker = (
    <ProductPicker
      groupKey={groupKey}
      productId={productId}
      caseColourId={caseColourId}
      gelColourId={gelColourId}
      presentmentPrice={presentmentCasePrice}
      presentmentPrices={liveProductPrices}
      onGroupChange={handleGroup}
      onProductChange={handleProduct}
      onCaseColourChange={setCaseColourId}
      onGelColourChange={setGelColourId}
    />
  )
  const priceBar = (
    <PriceBar
      product={product}
      placed={placed}
      validation={validation}
      onSubmit={attemptOrder}
      crossSellHint={appSettings.crossSellHint}
      compact={trayExpanded}
      isSecondProduct={isSecondProduct}
    />
  )

  const charmCount = placed.length
  const stepTwoHint = (
    <>
      {t('step2.recommend', { min: REC_MIN, max: REC_MAX })}
      {charmCount > 0 && <strong>{t('step2.added', { n: charmCount })}</strong>}
    </>
  )

  // Order CTA total + noun (case / tote / frame) for the Step 3 bar.
  const orderNoun = t(product.kind === 'tote' ? 'noun.tote' : product.kind === 'frame' ? 'noun.frame' : 'noun.case')
  const charmTotal = placedCharmsTotal(placed)
  const orderTotal = product.presentmentPrice
    ? formatPresentmentMoney(product.presentmentPrice + convert(charmTotal), { whole: true })
    : formatMoney(product.basePrice + charmTotal, { whole: true })

  // The Step 2 overlay is expanded when the user opened it, or forced open while
  // any charm needs attention (so the warning is never hidden).
  const step2Expanded = step2Open || validation.problems > 0

  // Prominent, fix-it message shown beside the case when the customer tries to
  // order with charms still overlapping or off the craftable area.
  const overlapAlert =
    showOverlapWarning && !validation.ok && placed.length > 0 ? (
      <div className="overlap-alert" role="alert">
        <WarningFilled className="overlap-alert__icon" />
        <p className="overlap-alert__text">
          {t('alert.overlap')}
        </p>
        <button
          type="button"
          className="overlap-alert__close"
          aria-label={t('action.dismiss')}
          onClick={() => setShowOverlapWarning(false)}
        >
          <CloseOutlined />
        </button>
      </div>
    ) : null
  const mockupNotice = (
    <button
      type="button"
      className={`mockup-notice${mockupNoticeOpen ? ' is-open' : ''}`}
      aria-expanded={mockupNoticeOpen}
      onClick={() => setMockupNoticeOpen((open) => !open)}
    >
      <InfoCircleOutlined className="mockup-notice__icon" />
      <span className="mockup-notice__label">{t('notice.mockupShort')}</span>
      {mockupNoticeOpen ? <UpOutlined /> : <DownOutlined />}
      {mockupNoticeOpen && (
        <span className="mockup-notice__details">
          <span>{t('notice.mockup')}</span>
          <span>{t('step2.mobileHint')}</span>
          <span>{stepTwoHint}</span>
        </span>
      )}
    </button>
  )

  const stageNode = (
    <ProductStage
      ref={stageApi}
      product={geometryProduct}
      color={color}
      placed={placed}
      flags={validation.flags}
      selectedUid={selectedUid}
      onSelect={setSelectedUid}
      onMove={moveCharm}
      onTransform={transformCharm}
      onRemove={removeCharm}
      onCheckpoint={pushHistory}
      wordGroups={wordGroups}
      selectedGroupId={selectedGroupId}
      confirmGroupId={confirmGroupId}
      onSelectGroup={selectGroup}
      onMoveGroup={moveGroup}
      onRequestBreak={setConfirmGroupId}
      onCancelBreak={() => setConfirmGroupId(null)}
      onBreakGroup={breakGroup}
      zoom={zoom}
      onZoomChange={setZoom}
      fitPadding={isMobile ? 34 : undefined}
      stageOverlay={isMobile ? mockupNotice : null}
    />
  )

  return (
    <>
      {isMobile ? (
        <>
        <div
          className="mobile-shell"
          ref={mobileShellRef}
          onContextMenu={(event) => event.preventDefault()}
          onSelectStart={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
        >
          <header className="mobile-head">
            <div className="mobile-head__top">
              <span className="mobile-head__step">{t('step1.mobile')}</span>
              <Segmented
                className="mobile-head__platform"
                size="small"
                value={groupKey}
                onChange={handleGroup}
                options={PRODUCT_GROUPS.filter((g) => g.key !== 'tote').map((g) => ({ label: g.label, value: g.key }))}
              />
            </div>
            <div className="mobile-head__selects">
              <label className="mobile-head__field mobile-head__field--model">
                <span className="mobile-head__label">{t('picker.model')}</span>
                <Select
                  className="mobile-head__sel"
                  size="small"
                  value={productId}
                  onChange={handleProduct}
                  showSearch
                  filterOption={(input, option) =>
                    String(option?.label || '').toLowerCase().includes(input.trim().toLowerCase())
                  }
                  options={modelOptions}
                  popupMatchSelectWidth={false}
                />
              </label>
              {!product.gelRender && !product.linkedFinish && (
                <label className="mobile-head__field">
                  <span className="mobile-head__label">{t('label.case')}</span>
                  <Select
                    className="mobile-head__sel"
                    size="small"
                    value={caseColourId}
                    onChange={setCaseColourId}
                    options={caseOptions}
                    popupMatchSelectWidth={false}
                  />
                </label>
              )}
              {gelOptions && (
                <label className="mobile-head__field">
                  <span className="mobile-head__label">{t('label.gel')}</span>
                  <Select
                    className="mobile-head__sel"
                    size="small"
                    value={gelColourId}
                    onChange={setGelColourId}
                    options={gelOptions}
                    popupMatchSelectWidth={false}
                  />
                </label>
              )}
            </div>
          </header>
          <div className="mobile-stage">
            {stageNode}
            <Button
              className="mobile-drafts-button"
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={() => setDraftsOpen(true)}
            >
              Design history
            </Button>
            {zoomDock}
            <div
              className={'mobile-step-overlay' + (step2Expanded ? ' is-open' : '')}
            >
              <div className="mobile-step2-bar">
                <button
                  type="button"
                  className="mobile-step-overlay__title"
                  aria-expanded={step2Expanded}
                  onClick={() => setStep2Open((o) => !o)}
                >
                  <span>{t('step2.mobileTitle')}</span>
                  <InfoCircleOutlined className="mobile-step-overlay__chevron" />
                </button>
                <div className="mobile-cat-bar">
                  <Segmented
                    block
                    size="small"
                    className="mobile-cat-seg"
                    value={catKey}
                    onChange={setCatKey}
                    options={categoryOptions}
                  />
                </div>
              </div>
            </div>
          </div>
          <div
            className="mobile-splitter"
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('aria.splitter')}
            onPointerDown={onSplitDown}
            onPointerMove={onSplitMove}
            onPointerUp={onSplitUp}
            onPointerCancel={onSplitUp}
          >
            <span className="mobile-splitter__grip" />
            {mobileSplitterGuideOpen && (
              <div className="mobile-split-guide" role="status" aria-live="polite">
                <div className="mobile-split-guide__card">
                  <InfoCircleOutlined className="mobile-split-guide__info" />
                  <span>
                    <strong>Adjust your workspace</strong>
                    <small>Drag this bar to resize the preview and charm tray. Your design history is in the top-left corner.</small>
                  </span>
                  <button
                    type="button"
                    className="mobile-split-guide__close"
                    aria-label={t('action.dismiss')}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={dismissMobileSplitterGuide}
                  >
                    <CloseOutlined />
                  </button>
                </div>
                <div className="mobile-split-guide__motion" aria-hidden="true">
                  <UpOutlined className="mobile-split-guide__arrow mobile-split-guide__arrow--up" />
                  <span className="mobile-split-guide__track" />
                  <span className="mobile-split-guide__sample-grip" />
                  <DownOutlined className="mobile-split-guide__arrow mobile-split-guide__arrow--down" />
                </div>
              </div>
            )}
          </div>
          <div className="mobile-tray" style={{ flexBasis: `${trayPct}%` }}>
            <div className="mobile-tray-body">
              {mobileTray}
            </div>
          </div>

          <button
            type="button"
            className="mobile-order-bar"
            disabled={placed.length === 0}
            onClick={attemptOrder}
          >
            {isSecondProduct
              ? t('cta.addSecondProduct', { price: orderTotal })
              : t('cta.addToCart', { noun: orderNoun, price: orderTotal })}
          </button>
        </div>
        </>
      ) : (
        <div className="studio" ref={studioRef} style={{ '--tray-w': `${trayWidth}px` }}>
          {trayClipped && (
            <div className="tray-clip-hint" role="status">
              <WarningFilled />
              <span>{t('hint.widen')}</span>
            </div>
          )}
          <div className="panel panel--left">
            <Tips />
            <Button block icon={<FolderOpenOutlined />} style={{ marginTop: 12 }} onClick={() => setDraftsOpen(true)}>
              My design drafts
            </Button>
            <div style={{ marginTop: 22 }}>{picker}</div>
          </div>
          <div style={{ position: 'relative', minHeight: 0 }}>
            {mockupNotice}
            {stageNode}
            {zoomDock}
            {overlapAlert}
          </div>
          <div className={`panel--right${trayExpanded ? ' panel--right--expanded' : ''}`} ref={trayRef}>
            <div
              className="tray-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('aria.trayResizer')}
              onPointerDown={onTrayResizeDown}
              onPointerMove={onTrayResizeMove}
              onPointerUp={onTrayResizeUp}
              onPointerCancel={onTrayResizeUp}
            >
              <span className="tray-resizer__grip" />
            </div>
            <div className="tray-head">
              {/* Enlarged mode = a focused "browse charms" view: hide the Step 2
                  header + the Charms/count bar (the price breakdown is hidden in
                  the PriceBar too), leaving just the category selector, the charm
                  grid and the add-to-cart button. */}
              {!trayExpanded && (
                <>
                  <p className="eyebrow" style={{ margin: 0 }}>{t('step2.desktopTitle')}</p>
                  <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
                    {t('step2.desktopHint', { min: REC_MIN, max: REC_MAX, min2: MIN_CHARMS })}
                  </p>
                  <div className="charms-bar">
                    <span className="charms-bar__title">{t('charms.label')}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <span className="charms-bar__count">{t('charms.selected', { n: placed.length })}</span>
                      <Button
                        size="small"
                        shape="circle"
                        icon={<ExpandOutlined />}
                        onClick={() => setTrayExpanded(true)}
                        title={t('charms.enlarge')}
                      />
                    </span>
                  </div>
                </>
              )}
              <div className="cat-swatches">
                {trayExpanded && (
                  <Button
                    size="small"
                    shape="circle"
                    icon={<CompressOutlined />}
                    onClick={() => setTrayExpanded(false)}
                    title={t('charms.shrink')}
                    style={{ flex: 'none' }}
                  />
                )}
                {groups.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    className={`cat-swatch${g.key === catKey ? ' is-active' : ''}`}
                    onClick={() => setCatKey(g.key)}
                  >
                    <span className={`cat-swatch__dot cat-swatch__dot--${g.key}`} style={catDotStyle(g.key)} />
                    <span className="cat-swatch__label">
                      {product.kind !== 'tote' ? g.label.replace(/ charms$/i, '') : g.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="tray-scroll">{tray}</div>
            <div className="pricebox">{priceBar}</div>
          </div>
        </div>
      )}

      {ghost && (
        <div className="ghost-drag" style={{ left: ghost.x, top: ghost.y, width: ghost.w, height: ghost.h }}>
          <img src={ghost.src} alt="" style={{ width: '100%', height: '100%' }} />
        </div>
      )}

      <SummaryModal
        open={summaryOpen}
        product={product}
        color={color}
        placed={placed}
        onClose={() => setSummaryOpen(false)}
        onPlaceOrder={handlePlaceOrder}
      />

      <Modal open={draftsOpen} title="My design drafts" onCancel={() => setDraftsOpen(false)} footer={null}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Input value={draftName} maxLength={40} placeholder="Name this design" onChange={(event) => setDraftName(event.target.value)} onPressEnter={saveNamedDraft} />
          <Button type="primary" icon={<SaveOutlined />} onClick={saveNamedDraft}>Save</Button>
        </div>
        {namedDrafts.length ? namedDrafts.map((draft) => (
          <div key={draft.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{draft.name}</strong>
              <div className="hint">{new Date(draft.updatedAt).toLocaleString()}</div>
            </div>
            <Button size="small" onClick={() => loadNamedDraft(draft)}>Load</Button>
            <Button size="small" danger icon={<DeleteOutlined />} title="Delete draft" onClick={() => {
              deleteDesignDraft(draft.id)
              refreshNamedDrafts()
            }} />
          </div>
        )) : <p className="hint">Save a named copy of your current design here.</p>}
        <Button block style={{ marginTop: 16 }} onClick={newDesign}>Start a new blank design</Button>
      </Modal>

      <Modal
        open={crossSellOpen}
        onCancel={() => setCrossSellOpen(false)}
        footer={null}
        centered
        title={crossSellTitle(crossSell.title || t('crossSell.title'))}
      >
        <p style={{ marginTop: 0, color: 'var(--ink-soft)' }}>
          {t('crossSell.body')}
        </p>
        <div className="cross-sell-options">
          {crossSellOptions.map((opt, i) => (
            <article className="cross-sell-option" key={i}>
              {crossSellImage(opt, PRODUCT_GROUPS) && (
                <img className="cross-sell-option__image" src={crossSellImage(opt, PRODUCT_GROUPS)} alt="" />
              )}
              <Button type="primary" size="large" onClick={() => pickCrossSell(opt)}>
                {opt.buttonLabel || opt.label}
              </Button>
            </article>
          ))}
        </div>
        <div style={{ marginTop: 18, textAlign: 'center' }}>
          <Button type="link" size="large" onClick={goToCart}>
            {t('crossSell.noThanks')}
          </Button>
        </div>
      </Modal>
    </>
  )
}

function Tips() {
  return (
    <div>
      <p className="eyebrow">{t('tips.title')}</p>
      <ol className="hint" style={{ paddingLeft: 16, margin: 0, lineHeight: 1.7 }}>
        <li>{t('tips.1')}</li>
        <li>{t('tips.2')}</li>
        <li>{t('tips.3')}</li>
        <li>{t('tips.4')}</li>
        <li>{t('tips.5')}</li>
        <li>{t('tips.6')}</li>
      </ol>
    </div>
  )
}

import CustomizerPage from './customizer/CustomizerPage'
import MerchantStudio from './components/MerchantStudio'
import AdminPage from './components/AdminPage'
import CaseReviewPage from './components/CaseReviewPage'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { createStorefrontCartHandler } from '../shopify/widget/shopifyCart'
import { t } from './lib/i18n'

const STOREFRONT_ORIGIN = 'https://thecharmeedit.com'
const STOREFRONT_HOSTS = new Set([
  'thecharmeedit.com',
  'www.thecharmeedit.com',
  '7ftyeu-0m.myshopify.com',
])

function editorCartUrl() {
  const fallback = new URL('/cart', STOREFRONT_ORIGIN)
  if (typeof window === 'undefined') return fallback

  const candidate = new URLSearchParams(window.location.search).get('cart_url')
  if (!candidate) return fallback

  try {
    const url = new URL(candidate, STOREFRONT_ORIGIN)
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    if (
      STOREFRONT_HOSTS.has(url.hostname) &&
      /^https?:$/.test(url.protocol) &&
      pathname === '/cart'
    ) {
      return url
    }
  } catch {
    // Ignore malformed or untrusted cart targets.
  }

  return fallback
}

const editorCartDestination = editorCartUrl()

function decodeEditorLayout(encoded) {
  if (!encoded || encoded.length > 120000) return null
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const saved = JSON.parse(new TextDecoder().decode(bytes))
    const product = saved?.product || {}
    if (!product.id || !Array.isArray(saved?.charms)) return null
    return {
      productId: product.id,
      caseColourId: product.caseColour?.id || product.colorId,
      gelColourId: product.gelId || product.gelColour?.id || undefined,
      charms: saved.charms.map((charm) => ({
        charmId: charm.charmId,
        shopifyVariantId: charm.shopifyVariantId,
        src: charm.src,
        name: charm.name,
        category: charm.category,
        collection: charm.collection,
        type: charm.type,
        price: charm.price,
        bundle: charm.bundle,
        cxMm: charm.xMm,
        cyMm: charm.yMm,
        wMm: charm.wMm,
        hMm: charm.hMm,
        rot: charm.rotDeg,
        scale: charm.scale,
      })),
    }
  } catch {
    return null
  }
}

function editorEditState() {
  if (typeof window === 'undefined') return {}
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const token = params.get('charme_edit_token') || ''
  const layout = decodeEditorLayout(params.get('charme_layout'))
  return {
    layout,
    replaceDesignToken: /^[A-Za-z0-9_-]{1,128}$/.test(token) ? token : undefined,
  }
}

const editorEdit = editorEditState()

function configureEditorCurrency() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const active = String(params.get('currency') || '').trim().toUpperCase()
  const rate = Number(params.get('currency_rate'))
  if (!/^[A-Z]{3}$/.test(active) || !(rate > 0)) return

  const config = window.CharmeConfig || {}
  window.CharmeConfig = {
    ...config,
    ...(params.get('locale') ? { locale: params.get('locale') } : {}),
    currency: {
      base: config.currency?.base || 'GBP',
      active,
      rate,
    },
  }
}

configureEditorCurrency()

const editorCart =
  typeof window === 'undefined'
    ? null
    : createStorefrontCartHandler({
        storeUrl: editorCartDestination.origin,
        cartUrl: editorCartDestination.href,
        cartBridge: new URLSearchParams(window.location.search).get('cart_bridge') === '1',
        replaceDesignToken: editorEdit.replaceDesignToken,
        uploadEndpoint: `${window.location.origin}/api/upload-proof`,
      })

function isCaseReviewView() {
  if (typeof window === 'undefined') return false
  return /^\/case-review\/?$/i.test(window.location.pathname)
}

function editorInitialState() {
  if (typeof window === 'undefined') return {}
  const params = new URLSearchParams(window.location.search)
  const requested = {
    initialProductId: params.get('product') || undefined,
    initialCaseColourId: params.get('case') || undefined,
    initialGelColourId: params.get('gel') || undefined,
    initialCasePresentmentPrice: Number(params.get('case_price')) || undefined,
  }
  if (!editorEdit.layout) return requested
  return {
    initialProductId: editorEdit.layout.productId,
    initialCaseColourId: editorEdit.layout.caseColourId,
    initialGelColourId: editorEdit.layout.gelColourId,
    initialLayout: editorEdit.layout,
  }
}

function editorReturnUrl() {
  if (typeof window === 'undefined') return STOREFRONT_ORIGIN
  const params = new URLSearchParams(window.location.search)
  const candidates = [params.get('return_to'), document.referrer]

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const url = new URL(candidate, STOREFRONT_ORIGIN)
      if (STOREFRONT_HOSTS.has(url.hostname) && /^https?:$/.test(url.protocol)) return url.href
    } catch {
      // Ignore malformed or untrusted return targets.
    }
  }

  return STOREFRONT_ORIGIN
}

function leaveEditor() {
  if (typeof window !== 'undefined') window.location.assign(editorReturnUrl())
}

/**
 * The Merchant Studio is an internal tool. It is reachable only via an explicit
 * URL flag (`?merchant` or `#merchant`) — there is no on-screen switcher on the
 * customer-facing page, so customers never see it. The customer and merchant
 * experiences are completely separate and mutually exclusive.
 */
function isMerchantView() {
  if (typeof window === 'undefined') return false
  const { search, hash } = window.location
  return new URLSearchParams(search).has('merchant') || /merchant/i.test(hash)
}

/** The merchant CMS lives at the `/admin` route (or `?admin` / `#admin`), and
 *  is the default view on the dedicated `admin.` subdomain
 *  (admin.charme-customizer.pages.dev). It is ALSO the view Shopify opens when
 *  the app is embedded in the Shopify Admin (Shopify appends `?host`/`?shop`). */
function isAdminView() {
  if (typeof window === 'undefined') return false
  const { hostname, pathname, search, hash } = window.location
  const params = new URLSearchParams(search)
  return (
    /^admin\./i.test(hostname) ||
    /^\/admin\/?$/i.test(pathname) ||
    params.has('admin') ||
    params.has('host') ||
    params.has('shop') ||
    /admin/i.test(hash)
  )
}

export default function App() {
  if (isCaseReviewView()) return <CaseReviewPage />

  if (isAdminView()) {
    return (
      <div className="app-shell">
        <AdminPage />
      </div>
    )
  }

  if (isMerchantView()) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <span className="mark">The Charmé Edit</span>
            <span className="sub">Merchant Studio</span>
          </div>
        </header>
        <MerchantStudio />
      </div>
    )
  }

  const editorProps = editorInitialState()

  return (
    <div className="app-shell">
      <header className="topbar topbar--editor">
        <button
          type="button"
          className="topbar-back"
          onClick={leaveEditor}
          aria-label={t('action.back')}
          title={t('action.back')}
        >
          <ArrowLeftOutlined aria-hidden="true" />
          <span>{t('action.back')}</span>
        </button>
        <div className="brand brand--editor">
          <img
            className="brand-logo"
            src="/assets/branding/the-charme-edit-logo.png"
            alt="The Charmé Edit"
          />
        </div>
      </header>
      <CustomizerPage
        {...editorProps}
        onPlaceOrder={editorCart?.onPlaceOrder}
        onGoToCart={editorCart?.goToCart}
      />
    </div>
  )
}

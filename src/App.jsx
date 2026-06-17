import CustomizerPage from './customizer/CustomizerPage'
import MerchantStudio from './components/MerchantStudio'
import AdminPage from './components/AdminPage'

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
 *  (admin.charme-customizer.pages.dev). */
function isAdminView() {
  if (typeof window === 'undefined') return false
  const { hostname, pathname, search, hash } = window.location
  return (
    /^admin\./i.test(hostname) ||
    /^\/admin\/?$/i.test(pathname) ||
    new URLSearchParams(search).has('admin') ||
    /admin/i.test(hash)
  )
}

export default function App() {
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark">The Charmé Edit</span>
        </div>
      </header>
      <CustomizerPage />
    </div>
  )
}

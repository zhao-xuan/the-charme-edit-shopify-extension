import CustomizerPage from './customizer/CustomizerPage'
import MerchantStudio from './components/MerchantStudio'

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

export default function App() {
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

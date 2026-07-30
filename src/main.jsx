import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, App as AntApp } from 'antd'
import { theme } from './theme.js'
import './styles.css'
import { loadRemoteCatalog } from './lib/remoteCatalog.js'
import { loadSettings } from './lib/settings.js'
import CustomizerErrorBoundary, {
  CustomizerErrorFallback,
} from './components/CustomizerErrorBoundary.jsx'

// Pull the Cloudflare-backed catalogue (merchant products / charms / overrides)
// BEFORE the app module graph evaluates, so the bundled merge can fold it in on
// first render. Best-effort: falls back to bundled data if the API is absent.
async function boot() {
  const root = document.getElementById('root')
  if (!root) return
  try {
    await Promise.all([loadRemoteCatalog(), loadSettings()])
    const { default: App } = await import('./App.jsx')
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <ConfigProvider theme={theme}>
          <AntApp>
            <CustomizerErrorBoundary>
              <App />
            </CustomizerErrorBoundary>
          </AntApp>
        </ConfigProvider>
      </React.StrictMode>,
    )
  } catch (error) {
    console.error('[Charmé] customizer startup failed', error)
    ReactDOM.createRoot(root).render(<CustomizerErrorFallback />)
  }
}

boot()

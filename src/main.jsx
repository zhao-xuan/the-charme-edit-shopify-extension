import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, App as AntApp } from 'antd'
import { theme } from './theme.js'
import './styles.css'
import { loadRemoteCatalog } from './lib/remoteCatalog.js'

// Pull the Cloudflare-backed catalogue (merchant products / charms / overrides)
// BEFORE the app module graph evaluates, so the bundled merge can fold it in on
// first render. Best-effort: falls back to bundled data if the API is absent.
async function boot() {
  await loadRemoteCatalog()
  const { default: App } = await import('./App.jsx')
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ConfigProvider theme={theme}>
        <AntApp>
          <App />
        </AntApp>
      </ConfigProvider>
    </React.StrictMode>,
  )
}

boot()

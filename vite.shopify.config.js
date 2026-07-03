import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Library build that bundles the customizer into a single self-executing script
 * (+ one CSS file) for the Shopify drop-in section. React and Ant Design are
 * bundled in so the script is drop-in on any storefront. It is emitted into
 * `public/widget/` so the standalone `vite build` copies it into `dist/widget/`
 * and Cloudflare Pages serves it from the CDN:
 *
 *   npm run build:shopify
 *   → public/widget/charme-customizer.js
 *   → public/widget/charme-customizer.css
 *   (then `npm run deploy` publishes them to
 *    https://charme-customizer.pages.dev/widget/charme-customizer.js)
 */
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  // Library build only — don't recurse into the app's public/ dir.
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'public/widget'),
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, 'shopify/widget/entry.jsx'),
      name: 'CharmeCustomizer',
      formats: ['iife'],
      fileName: () => 'charme-customizer.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'charme-customizer.[ext]',
        inlineDynamicImports: true,
      },
    },
  },
})

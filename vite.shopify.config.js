import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Library build that bundles the customizer into a single self-executing script
 * (+ one CSS file) for the Shopify theme app extension. React and Ant Design are
 * bundled in so the script is drop-in on any storefront.
 *
 *   npm run build:shopify
 *   → shopify/extensions/charme-customizer/assets/charme-customizer.js
 *   → shopify/extensions/charme-customizer/assets/charme-customizer.css
 */
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  // Don't copy the standalone app's public/ dir into the extension assets;
  // copy-assets.mjs places the charm PNGs + catalogue there explicitly.
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'shopify/extensions/charme-customizer/assets'),
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

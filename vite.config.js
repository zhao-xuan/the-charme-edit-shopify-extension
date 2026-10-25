import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const editorRoute = {
  name: 'copy-editor-route',
  async closeBundle() {
    const editorDir = resolve(process.cwd(), 'dist/editor')
    await mkdir(editorDir, { recursive: true })
    await copyFile(resolve(process.cwd(), 'dist/index.html'), resolve(editorDir, 'index.html'))
    const studioDir = resolve(process.cwd(), 'dist/studio')
    await mkdir(studioDir, { recursive: true })
    await copyFile(resolve(process.cwd(), 'dist/index.html'), resolve(studioDir, 'index.html'))
    const shopifyDir = resolve(process.cwd(), 'dist/shopify')
    await mkdir(shopifyDir, { recursive: true })
    await copyFile(resolve(process.cwd(), 'dist/index.html'), resolve(shopifyDir, 'index.html'))
  },
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), editorRoute],
  server: {
    host: true,
    port: 5173,
  },
})

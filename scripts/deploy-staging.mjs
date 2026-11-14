import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const deployDir = resolve(root, '.wrangler/staging-pages')
const config = JSON.parse(await readFile(resolve(root, 'wrangler.staging.jsonc'), 'utf8'))
config.$schema = '../../node_modules/wrangler/config-schema.json'

await mkdir(deployDir, { recursive: true })
await writeFile(resolve(deployDir, 'wrangler.jsonc'), `${JSON.stringify(config, null, 2)}\n`)
await rm(resolve(deployDir, 'dist'), { recursive: true, force: true })
await cp(resolve(root, 'dist'), resolve(deployDir, 'dist'), { recursive: true })

const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js')
const child = spawn(process.execPath, [wrangler, '--cwd', deployDir, 'pages', 'deploy', 'dist', '--branch', 'main'], {
  cwd: root,
  stdio: 'inherit',
})
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })

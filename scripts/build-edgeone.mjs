import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const output = new URL('../dist/', import.meta.url)
const edgeFunctions = new URL('../edge-functions/', import.meta.url)

const entryPoints = async directory => {
  const entries = []
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(item.name + (item.isDirectory() ? '/' : ''), directory)
    if (item.isDirectory()) entries.push(...await entryPoints(path))
    else if (item.name.endsWith('.js')) entries.push(fileURLToPath(path))
  }
  return entries
}

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await Promise.all([
  cp(new URL('../public/', import.meta.url), output, { recursive: true }),
  cp(edgeFunctions, new URL('./edge-functions/', output), { recursive: true }),
  cp(new URL('../src/', import.meta.url), new URL('./src/', output), { recursive: true }),
  cp(new URL('../package.json', import.meta.url), new URL('./package.json', output))
])
await build({
  entryPoints: await entryPoints(edgeFunctions),
  outdir: fileURLToPath(new URL('./edge-functions/', output)),
  outbase: fileURLToPath(edgeFunctions),
  entryNames: '[dir]/[name]',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'warning',
})
console.log('EdgeOne output created in dist/')

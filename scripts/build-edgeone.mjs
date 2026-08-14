import { cp, mkdir, rm } from 'node:fs/promises'

const output = new URL('../dist/', import.meta.url)
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await Promise.all([
  cp(new URL('../public/', import.meta.url), output, { recursive: true }),
  cp(new URL('../edge-functions/', import.meta.url), new URL('./edge-functions/', output), { recursive: true }),
  cp(new URL('../src/', import.meta.url), new URL('./src/', output), { recursive: true }),
  cp(new URL('../package.json', import.meta.url), new URL('./package.json', output))
])
console.log('EdgeOne output created in dist/')

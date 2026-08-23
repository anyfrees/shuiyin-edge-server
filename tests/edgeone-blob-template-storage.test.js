import test from 'node:test'
import assert from 'node:assert/strict'
import { EdgeOneBlobTemplateStorage } from '../src/template-package-core.generated.js'

test('template packages remain writable when the EdgeOne Blob namespace was removed', async () => {
  const values = new Map()
  const kv = {
    get: async key => values.get(key) ?? null,
    put: async (key, value) => values.set(key, value),
    delete: async key => values.delete(key),
    list: async ({ prefix }) => ({ keys: [...values.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })), list_complete: true }),
  }
  const removedBlob = new Proxy({}, { get: () => async () => { throw new Error('BLOB_NAMESPACE_NOT_FOUND') } })
  const storage = new EdgeOneBlobTemplateStorage(removedBlob, kv)
  const bytes = new TextEncoder().encode('{"ok":true}')

  assert.equal(await storage.getPackage('tpl_missing', 1), null)
  await storage.putPackage('tpl_recreated', 1, bytes)
  assert.deepEqual(await storage.getPackage('tpl_recreated', 1), bytes)
  assert.equal((await storage.getMetadata('tpl_recreated', 1)).size, bytes.byteLength)
  assert.deepEqual((await storage.listPackages()).map(item => item.objectRef), ['templates/tpl_recreated/v1/package.jltpkg'])
  await storage.deletePackage('tpl_recreated', 1)
  assert.equal(await storage.getPackage('tpl_recreated', 1), null)
})

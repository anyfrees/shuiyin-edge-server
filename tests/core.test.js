import assert from 'node:assert/strict'
import test from 'node:test'
import { handleRequest } from '../src/core.js'

class MemoryKv {
  data = new Map()
  async get(key) { return this.data.get(key) ?? null }
  async put(key, value) { this.data.set(key, String(value)) }
  async list({ prefix = '', limit = 100 } = {}) {
    const keys = [...this.data.keys()].filter(key => key.startsWith(prefix)).slice(0, limit).map(name => ({ name }))
    return { keys, list_complete: true }
  }
}

const hash = character => character.repeat(64)
const marker = 'abcdef123456'
const env = { ALLOWED_ORIGIN: 'https://shuiyin.nnu.cn', WECHAT_APP_ID: 'app', WECHAT_APP_SECRET: 'secret' }
const apiRequest = body => new Request('https://example.com/api/photo-provenance', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: env.ALLOWED_ORIGIN }, body: JSON.stringify(body)
})

test('health endpoint reports edge KV', async () => {
  const response = await handleRequest(new Request('https://example.com/health'), { PLATFORM_NAME: 'test-edge' }, null)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).platform, 'test-edge')
})

test('registers and verifies an exact hash', async t => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ openid: 'owner-openid' })
  t.after(() => { globalThis.fetch = originalFetch })
  const kv = new MemoryKv()
  const registration = await handleRequest(apiRequest({
    action: 'register-hash', hash: hash('a'), loginCode: 'code', blindMarkerId: marker,
    verificationCode: 'ABC123', visualHash: hash('b'), integrityHashes: Array(16).fill(hash('c'))
  }), env, kv)
  assert.equal(registration.status, 200)
  assert.equal((await registration.json()).status, 'registered')

  const verification = await handleRequest(apiRequest({ action: 'verify', hash: hash('a'), blindMarkerId: marker }), env, kv)
  const result = await verification.json()
  assert.equal(result.status, 'verified')
  assert.equal(result.blindWatermark, 'matched')
  assert.equal(result.record.verificationCount, 1)
})

test('rejects malformed requests and unknown routes', async () => {
  const invalid = await handleRequest(new Request('https://example.com/api/photo-provenance', { method: 'POST', body: '{' }), env, new MemoryKv())
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).code, 'INVALID_JSON')
  const missing = await handleRequest(new Request('https://example.com/nope'), env, new MemoryKv())
  assert.equal(missing.status, 404)
})

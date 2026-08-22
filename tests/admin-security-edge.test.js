import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { argon2idAsync } from '@noble/hashes/argon2.js'
import { createEdgeAdminHandler } from '../src/admin-security-edge.js'

class Kv {
  constructor() { this.data = new Map() }
  async get(key) { return this.data.get(key) ?? null }
  async put(key, value) { this.data.set(key, value) }
  async delete(key) { this.data.delete(key) }
  async list({ prefix = '' }) { return { keys: [...this.data.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })), list_complete: true } }
}
const migration = async password => {
  const salt = new Uint8Array(16); crypto.getRandomValues(salt)
  const hash = Buffer.from(await argon2idAsync(password, salt, { t: 1, m: 1024, p: 1, dkLen: 32 })).toString('base64url'), encoded = `$argon2id$v=19$m=1024,t=1,p=1$${Buffer.from(salt).toString('base64url')}$${hash}`
  return JSON.stringify({ schemaVersion: 1, migrationId: 'mig_test', principals: [{ adminId: 'adm_test', username: 'admin', displayName: '管理员', status: 'ACTIVE', authzEpoch: 1, passwordHash: encoded, roles: ['SUPER_ADMIN'], templateScopes: [], groupScopes: [], passkeys: [], recoveryCodes: [], createdAt: 1, updatedAt: 1 }], audits: [] })
}
const invoke = (handler, path, { method = 'GET', body, headers = {} } = {}) => handler(new Request(`https://api.example${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }))

test('signed migration preserves an Argon2 password and issues a CSRF-bound admin session', async () => {
  const kv = new Kv(), env = { ADMIN_MIGRATION_TOKEN: 'migration-secret', ADMIN_WEBAUTHN_RP_ID: 'example', ADMIN_ORIGIN: 'https://example', ENVIRONMENT: 'test' }, handler = createEdgeAdminHandler({ kv, env }), raw = await migration('correct horse battery staple'), signature = createHmac('sha256', env.ADMIN_MIGRATION_TOKEN).update(raw).digest('base64url')
  let response = await invoke(handler, '/admin/v1/console/migration/import', { method: 'POST', body: raw, headers: { 'x-migration-signature': signature } })
  assert.equal(response.status, 201)
  response = await invoke(handler, '/admin/v1/console/auth/password', { method: 'POST', body: { username: 'admin', password: 'correct horse battery staple' } })
  assert.equal(response.status, 200)
  const login = await response.json(), sessionCookie = response.headers.get('set-cookie').split(';')[0]
  response = await invoke(handler, '/admin/v1/console/me', { headers: { cookie: sessionCookie } })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).admin.superAdmin, true)
  response = await invoke(handler, '/admin/v1/console/auth/logout', { method: 'POST', body: {}, headers: { cookie: sessionCookie, 'x-csrf-token': login.csrfToken } })
  assert.equal(response.status, 204)
})

test('migration import fails closed on a bad signature and is idempotent', async () => {
  const kv = new Kv(), env = { ADMIN_MIGRATION_TOKEN: 'migration-secret', ENVIRONMENT: 'test' }, handler = createEdgeAdminHandler({ kv, env }), raw = await migration('correct horse battery staple')
  assert.equal((await invoke(handler, '/admin/v1/console/migration/import', { method: 'POST', body: raw, headers: { 'x-migration-signature': 'bad' } })).status, 403)
  const signature = createHmac('sha256', env.ADMIN_MIGRATION_TOKEN).update(raw).digest('base64url')
  assert.equal((await invoke(handler, '/admin/v1/console/migration/import', { method: 'POST', body: raw, headers: { 'x-migration-signature': signature } })).status, 201)
  const repeat = await invoke(handler, '/admin/v1/console/migration/import', { method: 'POST', body: raw, headers: { 'x-migration-signature': signature } })
  assert.equal(repeat.status, 200); assert.equal((await repeat.json()).alreadyImported, true)
})

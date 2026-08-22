import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { onRequest } from '../edge-functions/[[default]].js'

const emptyBlob = {
  async get() { return null },
  async set() {},
  async delete() {},
  async list() { return { blobs: [] } },
  async getWithHeaders() { return null },
}

const invoke = (path, method = 'POST', body = '{}') => onRequest({
  request: new Request(`https://makers.example${path}`, {
    method,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body }),
    headers: { origin: 'https://shuiyin.nnu.cn', 'content-type': 'application/json' },
  }),
  env: { ALLOWED_ORIGIN: 'https://shuiyin.nnu.cn', PROVENANCE_BLOB: emptyBlob, TEMPLATE_BLOB: emptyBlob },
})

test('Makers root catch-all reaches every current API family instead of returning a routing 404', async () => {
  const routes = [
    ['/v2/auth/wechat', 'POST'],
    ['/v2/auth/logout', 'POST'],
    ['/v1/auth/binding-code', 'POST'],
    ['/v2/location/reverse', 'POST'],
    ['/v2/provenance/verify', 'POST'],
    ['/v3/provenance/verify/prepare', 'POST'],
    ['/v3/provenance/verify', 'POST'],
    ['/v1/templates/catalog', 'POST'],
    ['/v1/templates/detail', 'POST'],
    ['/v1/templates/download-token', 'POST'],
    ['/v1/templates/package/tpl_route_test', 'GET'],
    ['/v1/templates/preview/tpl_route_test', 'GET'],
    ['/v1/templates/lease', 'POST'],
    ['/v1/templates/lease/renew', 'POST'],
    ['/admin/v1/console/templates', 'GET'],
  ]
  for (const [path, method] of routes) {
    const response = await invoke(path, method)
    assert.notEqual(response.status, 404, `${method} ${path} was not routed`)
  }
})

test('Makers catch-all preserves API CORS preflight', async () => {
  const response = await invoke('/v3/provenance/verify/prepare', 'OPTIONS')
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://shuiyin.nnu.cn')
  assert.match(response.headers.get('access-control-allow-headers') || '', /Authorization/)
})

test('EdgeOne build bundles the root multi-level route and runtime dependencies', async () => {
  const build = await readFile(new URL('../scripts/build-edgeone.mjs', import.meta.url), 'utf8')
  const route = await readFile(new URL('../edge-functions/[[default]].js', import.meta.url), 'utf8')
  assert.match(build, /entryPoints: await entryPoints\(edgeFunctions\)/)
  assert.match(build, /bundle: true/)
  assert.match(route, /handleEdgeOneRequest/)
})

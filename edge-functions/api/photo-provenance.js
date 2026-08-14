import { handleRequest } from '../../src/core.js'

export async function onRequest({ request, env }) {
  const bindings = /** @type {any} */ (globalThis)
  return handleRequest(request, { ...env, PLATFORM_NAME: 'edgeone-makers' }, bindings.PROVENANCE_KV || env.PROVENANCE_KV)
}

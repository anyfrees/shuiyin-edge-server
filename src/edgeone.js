import { handleRequest } from './core.js'

const runtimeBinding = (env, bindings, name) => env?.[name] || bindings?.[name]

export const edgeOneEnvironment = (env = {}, bindings = globalThis) => ({
  ...env,
  PLATFORM_NAME: 'edgeone-makers',
  PROVENANCE_BLOB: runtimeBinding(env, bindings, 'PROVENANCE_BLOB'),
  TEMPLATE_BLOB: runtimeBinding(env, bindings, 'TEMPLATE_BLOB'),
})

export const handleEdgeOneRequest = ({ request, env = {} }) => {
  const bindings = /** @type {any} */ (globalThis)
  const runtimeEnv = edgeOneEnvironment(env, bindings)
  const kv = runtimeBinding(env, bindings, 'PROVENANCE_KV')
  return handleRequest(request, runtimeEnv, kv)
}

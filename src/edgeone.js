import { handleRequest } from './core.js'
import { getStore } from '@edgeone/pages-blob'

const runtimeBinding = (env, bindings, name) => env?.[name] || bindings?.[name]

const asArrayBuffer = value => {
  if (!(value instanceof Uint8Array)) return value
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
}

// Makers creates Blob namespaces on the first getStore() call. The SDK reads
// text by default, while the shared storage contracts consume binary objects.
const makersBlob = name => {
  const store = getStore(name)
  return {
    set: (key, value, options) => store.set(key, asArrayBuffer(value), options),
    get: (key, options = {}) => store.get(key, { ...options, type: 'arrayBuffer' }),
    getWithHeaders: (key, options) => store.getWithHeaders(key, options),
    delete: key => store.delete(key),
    list: options => store.list(options),
  }
}

export const edgeOneEnvironment = (env = {}, bindings = globalThis) => {
  const provenanceBinding = runtimeBinding(env, bindings, 'PROVENANCE_BLOB')
  const templateBinding = runtimeBinding(env, bindings, 'TEMPLATE_BLOB')
  return {
    ...env,
    PLATFORM_NAME: 'edgeone-makers',
    PROVENANCE_BLOB: provenanceBinding || makersBlob(env.PROVENANCE_BLOB_STORE || 'jilu-provenance'),
    TEMPLATE_BLOB: templateBinding || makersBlob(env.TEMPLATE_BLOB_STORE || 'jilu-templates'),
  }
}

export const handleEdgeOneRequest = ({ request, env = {} }) => {
  const bindings = /** @type {any} */ (globalThis)
  const runtimeEnv = edgeOneEnvironment(env, bindings)
  const kv = runtimeBinding(env, bindings, 'PROVENANCE_KV')
  return handleRequest(request, runtimeEnv, kv)
}

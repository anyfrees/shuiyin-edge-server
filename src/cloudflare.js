import { handleRequest } from './core.js'

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env, env.PROVENANCE_KV)
    } catch (error) {
      console.error(JSON.stringify({ message: 'unhandled error', error: error instanceof Error ? error.message : String(error), path: new URL(request.url).pathname }))
      return Response.json({ ok: false, code: 'INTERNAL_ERROR' }, { status: 500 })
    }
  }
}

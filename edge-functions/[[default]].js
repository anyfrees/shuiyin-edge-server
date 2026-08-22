import { handleEdgeOneRequest } from '../src/edgeone.js'

// Root multi-level dynamic route. EdgeOne Makers gives exact files priority,
// then sends every remaining API depth (including /v3 and template IDs) here.
export function onRequest(context) {
  return handleEdgeOneRequest(context)
}

import { handleEdgeOneRequest } from '../../../src/edgeone.js'

export function onRequest(context) {
  return handleEdgeOneRequest(context)
}

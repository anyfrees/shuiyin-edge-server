import { healthResponse } from '../src/core.js'

export function onRequest() {
  return healthResponse('edgeone-makers')
}

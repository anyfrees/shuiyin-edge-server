import { WorkLogError } from './core.js'

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null
export const validateProjectGeofenceInput = (input, { partial = false } = {}) => {
  const out = {}
  if (!partial || Object.hasOwn(input || {}, 'enabled')) {
    if (typeof input?.enabled !== 'boolean') throw new WorkLogError('PROJECT_GEOFENCE_ENABLED_INVALID', 400)
    out.enabled = input.enabled
  }
  for (const [key, min, max, code] of [
    ['centerLatitude', -90, 90, 'PROJECT_GEOFENCE_LATITUDE_INVALID'],
    ['centerLongitude', -180, 180, 'PROJECT_GEOFENCE_LONGITUDE_INVALID'],
    ['radiusMeters', 50, 10000, 'PROJECT_GEOFENCE_RADIUS_INVALID'],
    ['priority', -100000, 100000, 'PROJECT_GEOFENCE_PRIORITY_INVALID'],
  ]) {
    if (partial && !Object.hasOwn(input || {}, key)) continue
    const value = finite(input?.[key])
    if (value == null || value < min || value > max || (key !== 'centerLatitude' && key !== 'centerLongitude' && !Number.isInteger(value))) throw new WorkLogError(code, 400)
    out[key] = value
  }
  if (partial && Object.hasOwn(input || {}, 'ifVersion')) {
    const value = finite(input.ifVersion)
    if (!Number.isInteger(value) || value < 1) throw new WorkLogError('PROJECT_GEOFENCE_VERSION_INVALID', 400)
    out.ifVersion = value
  }
  return out
}

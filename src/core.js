const YEAR_MS = 365 * 24 * 60 * 60 * 1000
const VISUAL_MATCH_DISTANCE = 24
const IOS_SHARE_MATCH_DISTANCE = 72
const IOS_SHARE_UNIQUENESS_GAP = 16
const IOS_ALBUM_MATCH_DISTANCE = 64
const IOS_ALBUM_UNIQUENESS_GAP = 16
const WATERMARK_STRICT_DISTANCE = 12
const WATERMARK_MARKER_DISTANCE = 64
const INTEGRITY_BLOCKS = 16
const WATERMARK_INTEGRITY_BLOCKS = 12
const INTEGRITY_BLOCK_DISTANCE = 52
const INTEGRITY_SINGLE_BLOCK_DISTANCE = 80
const RECORD_PREFIX = 'record:'
const MAX_SCAN_RECORDS = 500

const cleanText = (value, max = 120) => String(value || '').replace(/[\u0000-\u001f]/g, '').slice(0, max)
const isHash = value => /^[a-f0-9]{64}$/.test(String(value || '').toLowerCase())
const isMarker = value => /^[a-f0-9]{12}$/.test(String(value || '').toLowerCase())
const isRecordId = value => /^[a-f0-9]{20}$/.test(String(value || '').toLowerCase())
const bitCount = value => { let count = 0; for (let number = value; number; number >>>= 1) count += number & 1; return count }
const hammingDistance = (left, right) => {
  if (!isHash(left) || !isHash(right)) return Infinity
  let distance = 0
  for (let index = 0; index < 64; index += 2) distance += bitCount(parseInt(left.slice(index, index + 2), 16) ^ parseInt(right.slice(index, index + 2), 16))
  return distance
}
const normalizeManifest = (value, size) => Array.isArray(value) && value.length === size && value.every(isHash) ? value.map(hash => String(hash).toLowerCase()) : null
const compareManifest = (stored, supplied, size, moderate = 38, strong = 62) => {
  if (!Array.isArray(stored) || stored.length !== size || !stored.every(isHash) || !Array.isArray(supplied) || supplied.length !== size) return null
  const distances = supplied.map((value, index) => {
    const candidates = (Array.isArray(value) ? value : [value]).map(hash => String(hash || '').toLowerCase()).filter(isHash)
    return candidates.length ? Math.min(...candidates.map(hash => hammingDistance(hash, stored[index]))) : Infinity
  })
  if (distances.some(distance => !Number.isFinite(distance))) return null
  const moderateBlocks = distances.map((distance, index) => distance > moderate ? index : -1).filter(index => index >= 0)
  const strongBlocks = distances.map((distance, index) => distance > strong ? index : -1).filter(index => index >= 0)
  return { distances, changedBlocks: strongBlocks.length ? strongBlocks : moderateBlocks.length >= 2 ? moderateBlocks : [] }
}
const compareIntegrity = (stored, supplied) => compareManifest(stored, supplied, INTEGRITY_BLOCKS, INTEGRITY_BLOCK_DISTANCE, INTEGRITY_SINGLE_BLOCK_DISTANCE)
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers })
const corsHeaders = (request, env) => {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
  const origin = request.headers.get('origin')
  const allowed = env.ALLOWED_ORIGIN || 'https://shuiyin.nnu.cn'
  if (origin === allowed) Object.assign(headers, { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' })
  return headers
}
const parseJson = value => { try { return value ? JSON.parse(value) : null } catch { return null } }
const kvGet = async (kv, key) => parseJson(await kv.get(key))
const kvPut = async (kv, key, value) => kv.put(key, JSON.stringify(value))
const live = record => record && Number(record.expiresAt) > Date.now()
const recordKey = hash => `${RECORD_PREFIX}${hash}`
const getRecord = async (kv, hash) => { const record = await kvGet(kv, recordKey(hash)); return live(record) ? record : null }
const getByIndex = async (kv, prefix, id) => { const hash = await kv.get(`${prefix}:${id}`); return hash ? getRecord(kv, hash) : null }
const saveRecord = async (kv, record) => {
  await kvPut(kv, recordKey(record.hash), record)
  await Promise.all([
    kv.put(`record-id:${record.hash.slice(0, 20)}`, record.hash),
    record.blindMarkerId ? kv.put(`marker:${record.blindMarkerId}`, record.hash) : Promise.resolve()
  ])
}
const listRecords = async kv => {
  const records = []
  let cursor
  while (records.length < MAX_SCAN_RECORDS) {
    const page = await kv.list({ prefix: RECORD_PREFIX, limit: Math.min(100, MAX_SCAN_RECORDS - records.length), ...(cursor ? { cursor } : {}) })
    for (const key of page.keys || []) {
      const record = await kvGet(kv, key.name)
      if (live(record)) records.push(record)
    }
    const complete = page.list_complete === true || page.complete === true
    if (complete || !page.cursor) break
    cursor = page.cursor
  }
  return records
}
const countVerification = async (kv, record) => {
  record.verificationCount = (Number(record.verificationCount) || 0) + 1
  await kvPut(kv, recordKey(record.hash), record)
  return record.verificationCount
}
const sha256 = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(byte => byte.toString(16).padStart(2, '0')).join('')
const resolveOpenId = async (code, env) => {
  if (!code || !env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET) return null
  const query = new URLSearchParams({ appid: env.WECHAT_APP_ID, secret: env.WECHAT_APP_SECRET, js_code: code, grant_type: 'authorization_code' })
  const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`)
  const result = response.ok ? await response.json() : null
  return result && result.openid || null
}
const publicRecord = record => ({
  recordId: record.hash.slice(0, 20), sourceType: record.sourceType, capturedAt: record.capturedAt,
  templateName: record.templateName, verificationCode: record.verificationCode || (record.blindMarkerId || '').toUpperCase(),
  verificationCount: record.verificationCount || 0, expiresAt: record.expiresAt, locationName: record.locationName || '', appName: '迹录相机'
})

export function healthResponse(platform = 'cloudflare-workers') {
  return json({ ok: true, service: 'jilu-photo-provenance-edge', platform, storage: 'edge-kv', verificationVersion: 16, integrityGrid: '4x4', watermarkIntegrityGrid: '4x3', retentionDays: 365, consistency: 'eventual' })
}

export async function handleRequest(request, env, kv) {
  const url = new URL(request.url)
  const headers = corsHeaders(request, env)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (url.pathname === '/health' && request.method === 'GET') {
    const response = healthResponse(env.PLATFORM_NAME || 'edge-runtime')
    const healthHeaders = new Headers(response.headers)
    Object.entries(headers).forEach(([key, value]) => healthHeaders.set(key, value))
    return new Response(response.body, { status: 200, headers: healthHeaders })
  }
  if (url.pathname !== '/api/photo-provenance' || request.method !== 'POST') return json({ ok: false, code: 'NOT_FOUND' }, 404, headers)
  if (!kv) return json({ ok: false, code: 'KV_BINDING_MISSING' }, 503, headers)
  if (Number(request.headers.get('content-length') || 0) > 65_536) return json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413, headers)
  let input
  try { const text = await request.text(); if (text.length > 65_536) throw new Error('large'); input = JSON.parse(text || '{}') } catch { return json({ ok: false, code: 'INVALID_JSON' }, 400, headers) }

  if (input.action === 'register-hash') {
    const hash = String(input.hash || '').toLowerCase()
    if (!isHash(hash)) return json({ ok: false, code: 'INVALID_HASH' }, 400, headers)
    const openid = await resolveOpenId(input.loginCode, env)
    if (!openid) return json({ ok: false, code: 'UNAUTHORIZED' }, 401, headers)
    const existing = await getRecord(kv, hash)
    const now = Date.now()
    const region = input.watermarkRegion
    const safeRegion = region && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(Number(region[key]))) ? Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.max(0, Math.min(1, Number(region[key])))])) : null
    const record = existing || {
      hash, sourceType: input.sourceType === 'album-watermarked' ? 'album-watermarked' : 'live-camera', capturedAt: Number(input.capturedAt) || now,
      templateName: cleanText(input.templateName, 60), ownerHash: await sha256(openid), byteLength: Math.max(0, Number(input.byteLength) || 0),
      createdAt: now, expiresAt: now + YEAR_MS, verificationCode: cleanText(input.verificationCode, 16).toUpperCase(),
      blindMarkerId: isMarker(input.blindMarkerId) ? String(input.blindMarkerId).toLowerCase() : '', locationName: cleanText(input.locationName, 80), verificationCount: 0
    }
    if (isHash(input.visualHash) && !record.visualHash) record.visualHash = String(input.visualHash).toLowerCase()
    if (isHash(input.sceneHash) && isHash(input.watermarkHash) && safeRegion) Object.assign(record, { sceneHash: String(input.sceneHash).toLowerCase(), watermarkHash: String(input.watermarkHash).toLowerCase(), watermarkRegion: safeRegion })
    record.integrityManifest = normalizeManifest(input.integrityHashes, INTEGRITY_BLOCKS) || record.integrityManifest || null
    record.watermarkIntegrityManifest = normalizeManifest(input.watermarkIntegrityHashes, WATERMARK_INTEGRITY_BLOCKS) || record.watermarkIntegrityManifest || null
    await saveRecord(kv, record)
    return json({ ok: true, status: 'registered', recordId: hash.slice(0, 20), hash }, 200, headers)
  }

  if (input.action === 'authorize-wechat-share') {
    const hash = String(input.hash || '').toLowerCase(), marker = String(input.blindMarkerId || '').toLowerCase()
    if (!isHash(hash) || !isMarker(marker)) return json({ ok: false, code: 'INVALID_SHARE_AUTHORIZATION' }, 400, headers)
    const [record, openid] = await Promise.all([getRecord(kv, hash), resolveOpenId(input.loginCode, env)])
    if (!openid) return json({ ok: false, code: 'UNAUTHORIZED' }, 401, headers)
    const authorized = Boolean(record && record.blindMarkerId === marker && record.ownerHash === await sha256(openid))
    if (authorized) { record.wechatShareUntil = Date.now() + 10 * 60_000; await saveRecord(kv, record) }
    return json({ ok: authorized, status: authorized ? 'wechat_share_authorized' : 'share_owner_mismatch' }, authorized ? 200 : 403, headers)
  }

  if (input.action === 'verify-watermark' || input.action === 'verify-watermark-integrity') {
    const recordId = String(input.recordId || '').toLowerCase()
    if (!isRecordId(recordId)) return json({ ok: false, code: 'INVALID_WATERMARK_CHECK' }, 400, headers)
    const record = await getByIndex(kv, 'record-id', recordId)
    if (input.action === 'verify-watermark-integrity') {
      if (!record || !record.watermarkIntegrityManifest) return json({ ok: true, status: 'legacy_record' }, 200, headers)
      const compared = compareManifest(record.watermarkIntegrityManifest, input.watermarkIntegrityHashes, WATERMARK_INTEGRITY_BLOCKS)
      if (!compared) return json({ ok: true, status: 'inconclusive' }, 200, headers)
      const suppliedMarker = isMarker(input.blindMarkerId) ? String(input.blindMarkerId).toLowerCase() : ''
      const shareAuthorized = (!suppliedMarker || suppliedMarker === record.blindMarkerId) && record.wechatShareUntil > Date.now()
      const status = shareAuthorized && compared.changedBlocks.length ? 'wechat_share_inconclusive' : compared.changedBlocks.length ? 'watermark_content_changed' : 'watermark_intact'
      return json({ ok: true, status, integrity: { changedBlocks: compared.changedBlocks, maxDistance: Math.max(...compared.distances) }, record: { verificationCode: publicRecord(record).verificationCode, wechatShare: status === 'wechat_share_inconclusive' } }, 200, headers)
    }
    const watermarkHashes = [...new Set([input.watermarkHash, ...(Array.isArray(input.watermarkHashes) ? input.watermarkHashes.slice(0, 4) : [])].map(value => String(value || '').toLowerCase()).filter(isHash))]
    if (!watermarkHashes.length) return json({ ok: false, code: 'INVALID_WATERMARK_CHECK' }, 400, headers)
    if (!record || !isHash(record.watermarkHash)) return json({ ok: true, status: 'legacy_record' }, 200, headers)
    const distance = Math.min(...watermarkHashes.map(hash => hammingDistance(hash, record.watermarkHash)))
    const suppliedMarker = isMarker(input.blindMarkerId) ? String(input.blindMarkerId).toLowerCase() : ''
    const markerMatched = Boolean(suppliedMarker && suppliedMarker === record.blindMarkerId)
    const shareAuthorized = (!suppliedMarker || markerMatched) && record.wechatShareUntil > Date.now()
    const matches = distance <= (markerMatched ? WATERMARK_MARKER_DISTANCE : WATERMARK_STRICT_DISTANCE)
    const status = matches ? (record.sourceType === 'album-watermarked' ? 'album_watermarked_reencoded' : 'gallery_reencoded') : shareAuthorized ? 'wechat_share_inconclusive' : 'watermark_changed'
    const resultRecord = publicRecord(record); if (status === 'watermark_changed') resultRecord.verificationCode = ''; resultRecord.wechatShare = status === 'wechat_share_inconclusive'
    return json({ ok: true, status, distance, blindWatermark: markerMatched ? 'matched' : 'not_checked', record: resultRecord }, 200, headers)
  }

  if (input.action !== 'verify') return json({ ok: false, code: 'INVALID_ACTION' }, 400, headers)
  const hash = String(input.hash || '').toLowerCase()
  if (!isHash(hash)) return json({ ok: false, code: 'INVALID_HASH' }, 400, headers)
  const exact = await getRecord(kv, hash)
  if (exact) {
    await countVerification(kv, exact)
    const marker = String(input.blindMarkerId || '').toLowerCase()
    return json({ ok: true, status: exact.sourceType === 'album-watermarked' ? 'album_watermarked_reencoded' : 'verified', hash, blindWatermark: exact.blindMarkerId && marker === exact.blindMarkerId ? 'matched' : exact.blindMarkerId ? 'missing' : 'legacy', record: publicRecord(exact) }, 200, headers)
  }
  const marker = isMarker(input.blindMarkerId) ? String(input.blindMarkerId).toLowerCase() : ''
  const markerRecord = marker ? await getByIndex(kv, 'marker', marker) : null
  if (markerRecord) {
    await countVerification(kv, markerRecord)
    const integrity = compareIntegrity(markerRecord.integrityManifest, input.integrityHashes)
    if (integrity && integrity.changedBlocks.length) {
      const shared = markerRecord.wechatShareUntil > Date.now()
      const resultRecord = publicRecord(markerRecord); if (!shared) resultRecord.verificationCode = ''; resultRecord.wechatShare = shared
      return json({ ok: true, status: shared ? 'wechat_share_inconclusive' : 'content_changed', hash, blindWatermark: 'matched', integrity: { changedBlocks: integrity.changedBlocks, maxDistance: Math.max(...integrity.distances) }, record: resultRecord }, 200, headers)
    }
    if (integrity) return json({ ok: true, status: markerRecord.sourceType === 'album-watermarked' ? 'album_watermarked_reencoded' : 'source_verified', hash, blindWatermark: 'matched', integrity: { changedBlocks: [], maxDistance: Math.max(...integrity.distances) }, record: { ...publicRecord(markerRecord), watermarkRegion: markerRecord.watermarkRegion || null, watermarkIntegrityCheck: Boolean(markerRecord.watermarkIntegrityManifest) } }, 200, headers)
  }
  const visualHashes = [...new Set([input.visualHash, ...(Array.isArray(input.visualHashes) ? input.visualHashes.slice(0, 4) : [])].map(value => String(value || '').toLowerCase()).filter(isHash))]
  if (visualHashes.length) {
    const records = markerRecord ? [markerRecord] : await listRecords(kv)
    const matches = records.filter(record => isHash(record.sceneHash || record.visualHash)).map(record => ({ record, distance: Math.min(...visualHashes.map(value => hammingDistance(value, record.sceneHash || record.visualHash))) })).sort((a, b) => a.distance - b.distance)
    const closest = matches[0]
    if (closest && closest.distance <= VISUAL_MATCH_DISTANCE) {
      await countVerification(kv, closest.record)
      if (isHash(closest.record.watermarkHash)) return json({ ok: true, status: 'watermark_check_required', hash, distance: closest.distance, blindWatermark: markerRecord ? 'matched' : 'not_checked', record: { ...publicRecord(closest.record), watermarkRegion: closest.record.watermarkRegion || null } }, 200, headers)
      return json({ ok: true, status: 'visual_match', hash, distance: closest.distance, legacy: true, record: publicRecord(closest.record) }, 200, headers)
    }
    const albums = matches.filter(item => item.record.sourceType === 'album-watermarked')
    if (albums[0] && albums[0].distance <= IOS_ALBUM_MATCH_DISTANCE && (!albums[1] || albums[1].distance - albums[0].distance >= IOS_ALBUM_UNIQUENESS_GAP)) {
      await countVerification(kv, albums[0].record)
      return json({ ok: true, status: 'album_watermarked_reencoded', hash, distance: albums[0].distance, blindWatermark: 'not_recoverable_ios', record: { ...publicRecord(albums[0].record), iosCompatibilityFallback: true } }, 200, headers)
    }
    const active = matches.filter(item => item.record.wechatShareUntil > Date.now())
    if (active[0] && active[0].distance <= IOS_SHARE_MATCH_DISTANCE && (!active[1] || active[1].distance - active[0].distance >= IOS_SHARE_UNIQUENESS_GAP)) {
      await countVerification(kv, active[0].record)
      return json({ ok: true, status: 'wechat_share_inconclusive', hash, distance: active[0].distance, blindWatermark: 'not_recoverable_ios', record: { ...publicRecord(active[0].record), wechatShare: true, iosCompatibilityFallback: true } }, 200, headers)
    }
  }
  if (markerRecord && isHash(markerRecord.watermarkHash)) return json({ ok: true, status: 'watermark_check_required', hash, blindWatermark: 'matched', visualCompatibilityFallback: true, record: { ...publicRecord(markerRecord), watermarkRegion: markerRecord.watermarkRegion || null } }, 200, headers)
  if (markerRecord) return json({ ok: true, status: 'blind_marker_unmatched', hash, blindWatermark: 'detected', record: publicRecord(markerRecord) }, 200, headers)
  return json({ ok: true, status: 'not_found', hash }, 200, headers)
}

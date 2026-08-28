import {
  AuthService,
  EdgeOneIdentityRepository,
  IdentityError,
  WechatIdentityProvider,
} from "./identity-core.generated.js";
import {
  EdgeOneTemplateRepository,
  TemplateEntitlementService,
  createTemplateHttpHandler,
} from "./template-entitlement-core.generated.js";
import {
  TemplateRuntimeService,
  TemplatePublishService,
  createTemplateRuntimeHttpHandler,
  CloudflareR2TemplateStorage,
  EdgeOneBlobTemplateStorage,
} from "./template-package-core.generated.js";
import {
  CaptureTicketRuntimeService,
  ProvenanceRegistrationServiceV2,
  ProvenanceVerificationServiceV2,
  ProvenanceVerificationExchangeServiceV3,
  createProvenanceVerificationExchangeHttpHandler,
  createEdgeCaptureTicketHandler,
  createEdgeProvenanceRegistrationHandler,
  createEsaProvenanceRegistrationHandler,
  createEdgeProvenanceVerificationHandler,
  createEsaProvenanceVerificationHandler,
} from "./provenance-core.generated.js";
import {
  D1ProvenanceCommitRepository,
  EdgeOneBlobProvenanceCommitRepository,
} from "./provenance-repositories.js";
import { createEdgeAdminHandler } from "./admin-security-edge.js";
import { EdgeNotificationService } from "./notification-service-edge.js";
import { D1WorkLogRepository, EdgeOneBlobWorkLogRepository } from "./work-log/repositories.js";
import { workLogEnabled } from "./work-log/core.js";
import { autoDraftEnabled } from "./work-log/auto-draft-core.js";
import { D1AutoDraftAdapter, EdgeOneAutoDraftAdapter } from "./work-log/auto-draft-adapters.js";
import { handleWorkersAIGateway } from "./work-log/workers-ai-provider.js";
import { WorkLogHttpService } from "./work-log/http-service.generated.js";
import { ExportService } from "./work-log/export-core.generated.js";
import { D1ExportRepository, EdgeOneArtifactStore, EdgeOneExportStore, R2ArtifactStore } from "./work-log/export-storage.js";
import { D1SubjectEntitlementRepository, EdgeOneSubjectEntitlementRepository, SubjectEntitlementService } from "./subject-entitlement-core.js";

// Some EdgeOne Edge Function isolates expose the Fetch API without the newer
// Response.json() convenience method. Keep all generated handlers portable.
if (typeof Response.json !== "function") {
  Response.json = (body, init = {}) =>
    new Response(JSON.stringify(body), {
      ...init,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(init.headers || {}),
      },
    });
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const VISUAL_MATCH_DISTANCE = 24;
const IOS_SHARE_MATCH_DISTANCE = 72;
const IOS_SHARE_UNIQUENESS_GAP = 16;
const IOS_ALBUM_MATCH_DISTANCE = 64;
const IOS_ALBUM_UNIQUENESS_GAP = 16;
const WATERMARK_STRICT_DISTANCE = 12;
const WATERMARK_MARKER_DISTANCE = 64;
const INTEGRITY_BLOCKS = 16;
const WATERMARK_INTEGRITY_BLOCKS = 12;
const INTEGRITY_BLOCK_DISTANCE = 52;
const INTEGRITY_SINGLE_BLOCK_DISTANCE = 80;
const RECORD_PREFIX = "record:";
const MAX_SCAN_RECORDS = 500;
const LOCATION_CACHE_PREFIX = "location:reverse:v2:";
const LOCATION_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const LOCATION_RATE_WINDOW_MS = 60_000;
const LOCATION_RATE_LIMIT = 30;
const locationRateClients = new Map();
const authRateClients = new Map();
const templateHandlers = new WeakMap();
const captureHandlers = new WeakMap();
const registrationHandlers = new WeakMap();
const verificationHandlers = new WeakMap();
const verificationExchangeHandlers = new WeakMap();
const parseKeyList = (value) => {
  try {
    return JSON.parse(value || "[]");
  } catch {
    return [];
  }
};
const rateAllowed = (bucket, key, limit, windowMs = 60_000) => {
  const now = Date.now(),
    x = bucket.get(key);
  if (!x || x.resetAt <= now) {
    bucket.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (++x.count > limit) return false;
  return true;
};

const cleanText = (value, max = 120) =>
  String(value || "")
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, max);
const isHash = (value) =>
  /^[a-f0-9]{64}$/.test(String(value || "").toLowerCase());
const isMarker = (value) =>
  /^[a-f0-9]{12}$/.test(String(value || "").toLowerCase());
const isRecordId = (value) =>
  /^[a-f0-9]{20}$/.test(String(value || "").toLowerCase());
const bitCount = (value) => {
  let count = 0;
  for (let number = value; number; number >>>= 1) count += number & 1;
  return count;
};
const hammingDistance = (left, right) => {
  if (!isHash(left) || !isHash(right)) return Infinity;
  let distance = 0;
  for (let index = 0; index < 64; index += 2)
    distance += bitCount(
      parseInt(left.slice(index, index + 2), 16) ^
        parseInt(right.slice(index, index + 2), 16),
    );
  return distance;
};
const normalizeManifest = (value, size) =>
  Array.isArray(value) && value.length === size && value.every(isHash)
    ? value.map((hash) => String(hash).toLowerCase())
    : null;
const compareManifest = (
  stored,
  supplied,
  size,
  moderate = 38,
  strong = 62,
) => {
  if (
    !Array.isArray(stored) ||
    stored.length !== size ||
    !stored.every(isHash) ||
    !Array.isArray(supplied) ||
    supplied.length !== size
  )
    return null;
  const distances = supplied.map((value, index) => {
    const candidates = (Array.isArray(value) ? value : [value])
      .map((hash) => String(hash || "").toLowerCase())
      .filter(isHash);
    return candidates.length
      ? Math.min(
          ...candidates.map((hash) => hammingDistance(hash, stored[index])),
        )
      : Infinity;
  });
  if (distances.some((distance) => !Number.isFinite(distance))) return null;
  const moderateBlocks = distances
    .map((distance, index) => (distance > moderate ? index : -1))
    .filter((index) => index >= 0);
  const strongBlocks = distances
    .map((distance, index) => (distance > strong ? index : -1))
    .filter((index) => index >= 0);
  return {
    distances,
    changedBlocks: strongBlocks.length
      ? strongBlocks
      : moderateBlocks.length >= 2
        ? moderateBlocks
        : [],
  };
};
const compareIntegrity = (stored, supplied) =>
  compareManifest(
    stored,
    supplied,
    INTEGRITY_BLOCKS,
    INTEGRITY_BLOCK_DISTANCE,
    INTEGRITY_SINGLE_BLOCK_DISTANCE,
  );
const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers });
const withHeaders = (response, headers) => {
  const merged = new Headers(response.headers);
  Object.entries(headers).forEach(([key, value]) => merged.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
};
const corsHeaders = (request, env) => {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  const origin = request.headers.get("origin");
  const allowed = String(env.ALLOWED_ORIGIN || "https://shuiyin.nnu.cn")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin))
    Object.assign(headers, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-CSRF-Token, X-Request-Id, X-Bootstrap-Token, X-Bootstrap-Reset, X-Content-Sha256",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    });
  return headers;
};
const parseJson = (value) => {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};
const kvGet = async (kv, key) => parseJson(await kv.get(key));
const kvPut = async (kv, key, value) => kv.put(key, JSON.stringify(value));
const live = (record) => record && Number(record.expiresAt) > Date.now();
const recordKey = (hash) => `${RECORD_PREFIX}${hash}`;
const getRecord = async (kv, hash) => {
  const record = await kvGet(kv, recordKey(hash));
  return live(record) ? record : null;
};
const getByIndex = async (kv, prefix, id) => {
  const hash = await kv.get(`${prefix}:${id}`);
  return hash ? getRecord(kv, hash) : null;
};
const saveRecord = async (kv, record) => {
  await kvPut(kv, recordKey(record.hash), record);
  await Promise.all([
    kv.put(`record-id:${record.hash.slice(0, 20)}`, record.hash),
    record.blindMarkerId
      ? kv.put(`marker:${record.blindMarkerId}`, record.hash)
      : Promise.resolve(),
  ]);
};
const listRecords = async (kv) => {
  const records = [];
  let cursor;
  while (records.length < MAX_SCAN_RECORDS) {
    const page = await kv.list({
      prefix: RECORD_PREFIX,
      limit: Math.min(100, MAX_SCAN_RECORDS - records.length),
      ...(cursor ? { cursor } : {}),
    });
    for (const key of page.keys || []) {
      const record = await kvGet(kv, key.name);
      if (live(record)) records.push(record);
    }
    const complete = page.list_complete === true || page.complete === true;
    if (complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return records;
};
const countVerification = async (kv, record) => {
  record.verificationCount = (Number(record.verificationCount) || 0) + 1;
  await kvPut(kv, recordKey(record.hash), record);
  return record.verificationCount;
};
const sha256 = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

// Tencent Location Service SK signing uses MD5(path + '?' + sorted raw query + SK).
// WebCrypto does not expose MD5 in Workers, so this small compatibility
// implementation is kept server-side and is used only for the optional SK.
export const md5 = (input) => {
  const bytes = new TextEncoder().encode(String(input));
  const length = bytes.length;
  const paddedLength = (((length + 8) >>> 6) + 1) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[length] = 0x80;
  const bitLength = length * 8;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);
  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
    9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
    16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
    15, 21,
  ];
  const constants = Array.from(
    { length: 64 },
    (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0,
  );
  const rotateLeft = (value, shift) =>
    (value << shift) | (value >>> (32 - shift));
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) =>
      view.getUint32(offset + index * 4, true),
    );
    let a = a0,
      b = b0,
      c = c0,
      d = d0;
    for (let index = 0; index < 64; index += 1) {
      let f, g;
      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }
      const next = d;
      d = c;
      c = b;
      b =
        (b +
          rotateLeft(
            (a + f + constants[index] + words[g]) >>> 0,
            shifts[index],
          )) >>>
        0;
      a = next;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map((value) =>
      [0, 8, 16, 24]
        .map((shift) => ((value >>> shift) & 255).toString(16).padStart(2, "0"))
        .join(""),
    )
    .join("");
};

const locationCacheKey = (latitude, longitude) =>
  `${LOCATION_CACHE_PREFIX}${latitude.toFixed(4)},${longitude.toFixed(4)}`;
const locationRateAllowed = (key) => {
  const now = Date.now(),
    current = locationRateClients.get(key);
  if (!current || current.resetAt <= now)
    locationRateClients.set(key, {
      count: 1,
      resetAt: now + LOCATION_RATE_WINDOW_MS,
    });
  else if (++current.count > LOCATION_RATE_LIMIT) return false;
  if (locationRateClients.size > 5000)
    for (const [client, state] of locationRateClients)
      if (state.resetAt <= now) locationRateClients.delete(client);
  return true;
};
const poiDistance = (poi) =>
  Number.isFinite(Number(poi && poi._distance))
    ? Number(poi._distance)
    : 999999;
const pickLocationName = (result) => {
  const pois = Array.isArray(result && result.pois)
    ? result.pois.filter((poi) => poi && poi.title)
    : [];
  const building = pois
    .filter(
      (poi) =>
        /楼宇|大厦|写字楼|商务住宅|住宅区|小区|园区|公司企业|机构团体|学校|医院|酒店/.test(
          String(poi.category || ""),
        ) || /大厦|广场|中心|小区|园区|大楼|号楼|栋$/.test(poi.title),
    )
    .sort((a, b) => poiDistance(a) - poiDistance(b))[0];
  const reference = (result && result.address_reference) || {},
    landmark = reference.landmark_l2;
  const precise =
    building && poiDistance(building) <= 120
      ? building.title
      : landmark && landmark.title && poiDistance(landmark) <= 150
        ? landmark.title
        : "";
  if (precise) return precise;
  const nearest = pois.sort((a, b) => poiDistance(a) - poiDistance(b))[0];
  return (
    (nearest && nearest.title) ||
    (result &&
      result.formatted_addresses &&
      result.formatted_addresses.recommend) ||
    (result && result.address) ||
    ""
  );
};
export const buildTencentMapUrl = (latitude, longitude, key, secret = "") => {
  const path = "/ws/geocoder/v1/";
  const params = {
    get_poi: "1",
    key,
    location: `${latitude},${longitude}`,
    output: "json",
    poi_options: "address_format=short;policy=2;radius=300;page_size=10",
  };
  const entries = Object.entries(params).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const rawQuery = entries.map(([name, value]) => `${name}=${value}`).join("&");
  const encodedQuery = entries
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  const signature = secret ? md5(`${path}?${rawQuery}${secret}`) : "";
  return `https://apis.map.qq.com${path}?${encodedQuery}${signature ? `&sig=${signature}` : ""}`;
};
const bearer = (request) =>
  (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] ||
  "";
const authService = (env, kv) =>
  new AuthService({
    repository: new EdgeOneIdentityRepository(kv),
    identityProvider: new WechatIdentityProvider({
      appId: env.WECHAT_APP_ID,
      appSecret: env.WECHAT_APP_SECRET,
    }),
    hmacKey: env.JILU_IDENTITY_HMAC_KEY,
    subjectDerivationKey: env.JILU_SUBJECT_DERIVATION_KEY,
  });
const authError = (error, headers) =>
  json(
    {
      ok: false,
      code: error instanceof IdentityError ? error.code : "AUTH_FAILED",
    },
    error instanceof IdentityError ? error.status : 500,
    headers,
  );
const locationProviderCode = (body) =>
  /key|鉴权|授权|signature|签名/i.test(String((body && body.message) || ""))
    ? "PROVIDER_AUTH_FAILED"
    : "PROVIDER_ERROR";
const locationDiagnostic = (env, upstream, body) => {
  const environment = String(env.ENVIRONMENT || env.PLATFORM_NAME || "unknown");
  if (environment === "production") return null;
  return {
    provider: "tencent-map",
    backend: "edge",
    environment,
    providerHttpStatus: Number(upstream && upstream.status) || 0,
    providerStatus: Number.isFinite(Number(body && body.status))
      ? Number(body.status)
      : null,
    providerMessage: cleanText(body && body.message, 160),
  };
};
const reverseLocation = async (request, input, env, kv, headers) => {
  const latitude = Number(input.latitude),
    longitude = Number(input.longitude);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  )
    return json({ ok: false, code: "LOCATION_INVALID" }, 400, headers);
  let auth;
  try {
    auth = await authService(env, kv).authenticate(bearer(request));
  } catch (error) {
    return authError(error, headers);
  }
  const clientIp =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";
  const subjectKey = auth.subject.subjectId;
  if (!locationRateAllowed(`${subjectKey}:${clientIp}`))
    return json({ ok: false, code: "RATE_LIMITED" }, 429, {
      ...headers,
      "Retry-After": "60",
    });
  const cacheKey = locationCacheKey(latitude, longitude);
  const cached = kv ? await kvGet(kv, cacheKey) : null;
  if (cached && cached.expiresAt > Date.now() && cached.name)
    return json(
      {
        ok: true,
        name: cached.name,
        address: cached.address || "",
        adcode: cached.adcode || "",
        cached: true,
      },
      200,
      headers,
    );
  if (!env.TENCENT_MAP_KEY)
    return json(
      { ok: false, code: "LOCATION_SERVICE_UNAVAILABLE" },
      503,
      headers,
    );
  let upstream;
  try {
    upstream = await fetch(
      buildTencentMapUrl(
        latitude,
        longitude,
        env.TENCENT_MAP_KEY,
        env.TENCENT_MAP_SECRET || "",
      ),
    );
  } catch {
    return json({ ok: false, code: "UPSTREAM_UNAVAILABLE" }, 502, headers);
  }
  let body;
  try {
    body = await upstream.json();
  } catch {
    body = null;
  }
  const result = body && body.status === 0 && body.result;
  const name = pickLocationName(result);
  if (!result || !name) {
    const diagnostic = locationDiagnostic(env, upstream, body);
    return json(
      {
        ok: false,
        code: locationProviderCode(body),
        ...(diagnostic ? { diagnostic } : {}),
      },
      502,
      headers,
    );
  }
  const value = {
    name: cleanText(name, 160),
    address: cleanText(result.address, 200),
    adcode: cleanText(result.ad_info && result.ad_info.adcode, 20),
    expiresAt: Date.now() + LOCATION_CACHE_MS,
  };
  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify(value), {
        expirationTtl: Math.floor(LOCATION_CACHE_MS / 1000),
      });
    } catch {
      try {
        await kvPut(kv, cacheKey, value);
      } catch {}
    }
  }
  return json(
    {
      ok: true,
      name: value.name,
      address: value.address,
      adcode: value.adcode,
      cached: false,
    },
    200,
    headers,
  );
};
const resolveOpenId = async (code, env) => {
  if (!code || !env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET) return null;
  const query = new URLSearchParams({
    appid: env.WECHAT_APP_ID,
    secret: env.WECHAT_APP_SECRET,
    js_code: code,
    grant_type: "authorization_code",
  });
  const response = await fetch(
    `https://api.weixin.qq.com/sns/jscode2session?${query}`,
  );
  const result = response.ok ? await response.json() : null;
  return (result && result.openid) || null;
};
const publicRecord = (record) => ({
  recordId: record.hash.slice(0, 20),
  sourceType: record.sourceType,
  capturedAt: record.capturedAt,
  templateName: record.templateName,
  verificationCode:
    record.verificationCode || (record.blindMarkerId || "").toUpperCase(),
  verificationCount: record.verificationCount || 0,
  expiresAt: record.expiresAt,
  locationName: record.locationName || "",
  appName: "迹录相机",
});

export function healthResponse(platform = "cloudflare-workers") {
  return json({
    ok: true,
    service: "jilu-photo-provenance-edge",
    serviceVersion: "1.1.0",
    apiVersions: [
      "identity-v2",
      "template-v1",
      "provenance-v2",
      "verification-exchange-v3",
    ],
    platform,
    storage: "edge-kv",
    verificationVersion: 16,
    integrityGrid: "4x4",
    watermarkIntegrityGrid: "4x3",
    retentionDays: 365,
    consistency: "eventual",
  });
}

export async function handleRequest(request, env, kv) {
  const url = new URL(request.url);
  const headers = corsHeaders(request, env);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (url.pathname === "/internal/work-log-ai/refine") return handleWorkersAIGateway(request, env);
  if (/^\/v1\/(?:captures|work-logs|projects|project-match-rules|tags|exports)(?:\/|$)/.test(url.pathname)) {
    const repository = env.PROVENANCE_D1 ? new D1WorkLogRepository(env.PROVENANCE_D1) : env.PROVENANCE_BLOB ? new EdgeOneBlobWorkLogRepository(env.PROVENANCE_BLOB) : null;
    const edgeExportStore = env.PROVENANCE_BLOB ? new EdgeOneExportStore(env.PROVENANCE_BLOB) : null;
    const exportJobs = env.PROVENANCE_D1 ? new D1ExportRepository(env.PROVENANCE_D1) : edgeExportStore;
    const exportArtifacts = env.PROVENANCE_D1 && env.WORK_LOG_EXPORTS ? new R2ArtifactStore(env.WORK_LOG_EXPORTS) : edgeExportStore ? new EdgeOneArtifactStore(edgeExportStore) : null;
    const exportEnabled = workLogEnabled(env) && String(env.WORK_LOG_EXPORT_V1_ENABLED || "").toLowerCase() === "true" && Boolean(exportJobs && exportArtifacts);
    const exportService = exportJobs && exportArtifacts ? new ExportService({repository,jobs:exportJobs,artifacts:exportArtifacts}) : null;
    const entitlementRepository=env.PROVENANCE_D1?new D1SubjectEntitlementRepository(env.PROVENANCE_D1):kv?new EdgeOneSubjectEntitlementRepository(kv):null;
    const subjectEntitlements=entitlementRepository?new SubjectEntitlementService(entitlementRepository):null;
    if (!repository && workLogEnabled(env)) return json({ ok: false, code: "WORK_LOG_STORAGE_NOT_CONFIGURED" }, 503, headers);
    const autoDraftService=autoDraftEnabled(env)?(env.PROVENANCE_D1?new D1AutoDraftAdapter(env.PROVENANCE_D1):repository instanceof EdgeOneBlobWorkLogRepository?new EdgeOneAutoDraftAdapter(repository):null):null;
    const service = new WorkLogHttpService({repository,enabled:workLogEnabled(env),autoDraftService,exportService,exportEnabled,cursorSecret:env.JILU_SUBJECT_DERIVATION_KEY||"work-log-v1-local",authorize:async(subjectId,capability)=>Boolean(subjectEntitlements&&await subjectEntitlements.isGranted(subjectId,capability)),authenticate:async req=>{const token=bearer(req);try{const auth=await authService(env,kv).authenticate(token);return{subjectId:auth.subject.subjectId,authType:"MINI"}}catch(error){if(!kv)throw error;const hash=await sha256(token),session=JSON.parse(await kv.get(`creator:session:${hash}`)||"null");if(session?.subjectId&&session.expiresAt>Date.now())return{subjectId:session.subjectId,authType:"CREATOR"};throw error}},verifyProvenanceOwnership:async(subjectId,recordId)=>{if(env.PROVENANCE_D1)return Boolean(await env.PROVENANCE_D1.prepare("SELECT 1 ok FROM provenance_records WHERE subject_id=? AND record_id=?").bind(subjectId,recordId).first());if(env.PROVENANCE_BLOB){const record=await new EdgeOneBlobProvenanceCommitRepository(env.PROVENANCE_BLOB).getRecordById(recordId);return record?.subjectId===subjectId}return false}}),result=await service.handle(request),merged=new Headers(result.headers);Object.entries(headers).forEach(([key,value])=>merged.set(key,value));return new Response(result.body,{status:result.status,headers:merged});
  }
  if (url.pathname === "/health" && request.method === "GET") {
    const response = healthResponse(env.PLATFORM_NAME || "edge-runtime");
    const healthHeaders = new Headers(response.headers);
    Object.entries(headers).forEach(([key, value]) =>
      healthHeaders.set(key, value),
    );
    return new Response(response.body, { status: 200, headers: healthHeaders });
  }
  if (url.pathname === "/v2/capture-ticket") {
    if (!kv)
      return json(
        { ok: false, code: "PERSISTENT_STORAGE_NOT_CONFIGURED" },
        503,
        headers,
      );
    let handler = captureHandlers.get(env);
    if (!handler) {
      const identities = authService(env, kv);
      const service = new CaptureTicketRuntimeService({
        keys: parseKeyList(env.JILU_CAPTURE_TICKET_KEYS),
      });
      handler = createEdgeCaptureTicketHandler({
        service,
        authenticate: async (req) =>
          (await identities.authenticate(bearer(req))).subject,
      });
      captureHandlers.set(env, handler);
    }
    return handler(request);
  }
  if (url.pathname === "/v2/provenance/register") {
    if (!kv)
      return json(
        { ok: false, code: "PERSISTENT_IDENTITY_STORAGE_NOT_CONFIGURED" },
        503,
        headers,
      );
    let handler = registrationHandlers.get(env);
    if (!handler) {
      const identities = authService(env, kv),
        captureKeys = parseKeyList(env.JILU_CAPTURE_TICKET_KEYS),
        receiptKeys = parseKeyList(env.JILU_PROVENANCE_RECEIPT_KEYS),
        repository = env.PROVENANCE_D1
          ? new D1ProvenanceCommitRepository(env.PROVENANCE_D1)
          : env.PROVENANCE_BLOB
            ? new EdgeOneBlobProvenanceCommitRepository(env.PROVENANCE_BLOB)
            : null;
      if (!repository) {
        try {
          await identities.authenticate(bearer(request));
        } catch (error) {
          return authError(error, headers);
        }
        return createEsaProvenanceRegistrationHandler()();
      }
      const allowRejectedV1 =
          env.PLATFORM_NAME === "test" &&
          env.PROVENANCE_TEST_ALLOW_REJECTED_V1 === "true",
        service = new ProvenanceRegistrationServiceV2({
          repository,
          captureKeys,
          receiptKeys,
          requireIntegrityV2: !allowRejectedV1,
        });
      handler = createEdgeProvenanceRegistrationHandler({
        service,
        authenticate: async (req) =>
          (await identities.authenticate(bearer(req))).subject,
      });
      registrationHandlers.set(env, handler);
    }
    return handler(request);
  }
  if (url.pathname === "/v2/provenance/verify") {
    let handler = verificationHandlers.get(env);
    if (!handler) {
      const repository = env.PROVENANCE_D1
        ? new D1ProvenanceCommitRepository(env.PROVENANCE_D1)
        : env.PROVENANCE_BLOB
          ? new EdgeOneBlobProvenanceCommitRepository(env.PROVENANCE_BLOB)
          : null;
      if (!repository) return createEsaProvenanceVerificationHandler()();
      const service = new ProvenanceVerificationServiceV2({
        repository,
        receiptKeys: parseKeyList(env.JILU_PROVENANCE_RECEIPT_KEYS),
      });
      handler = createEdgeProvenanceVerificationHandler({
        service,
        perMinute: Number(env.PROVENANCE_VERIFY_RATE_LIMIT || 60),
      });
      verificationHandlers.set(env, handler);
    }
    return handler(request);
  }
  if (
    url.pathname === "/v3/provenance/verify/prepare" ||
    url.pathname === "/v3/provenance/verify"
  ) {
    let handler = verificationExchangeHandlers.get(env);
    if (!handler) {
      const repository = env.PROVENANCE_D1
        ? new D1ProvenanceCommitRepository(env.PROVENANCE_D1)
        : env.PROVENANCE_BLOB
          ? new EdgeOneBlobProvenanceCommitRepository(env.PROVENANCE_BLOB)
          : null;
      if (!repository)
        return json(
          { ok: false, code: "PROVENANCE_STORAGE_NOT_CONFIGURED" },
          503,
          { "Cache-Control": "no-store" },
        );
      const service = new ProvenanceVerificationExchangeServiceV3({
        repository,
        receiptKeys: parseKeyList(env.JILU_PROVENANCE_RECEIPT_KEYS),
      });
      handler = createProvenanceVerificationExchangeHttpHandler({
        service,
        perMinute: Number(env.PROVENANCE_VERIFY_RATE_LIMIT || 60),
      });
      verificationExchangeHandlers.set(env, handler);
    }
    return handler(request);
  }
  if (
    url.pathname.startsWith("/v1/templates/") ||
    url.pathname.startsWith("/admin/v1/")
  ) {
    if (!kv)
      return json(
        { ok: false, code: "PERSISTENT_STORAGE_NOT_CONFIGURED" },
        503,
        headers,
      );
    const identities = authService(env, kv),
      repository = new EdgeOneTemplateRepository(kv),
      service = new TemplateEntitlementService({ repository });
    let handlers = templateHandlers.get(env);
    if (!handlers) {
      const parseKeys = (value) => {
          try {
            return JSON.parse(value || "[]");
          } catch {
            return [];
          }
        },
        storage = env.TEMPLATE_OBJECTS
          ? new CloudflareR2TemplateStorage(env.TEMPLATE_OBJECTS)
          : env.TEMPLATE_BLOB
            ? new EdgeOneBlobTemplateStorage(env.TEMPLATE_BLOB, kv)
            : null,
        authenticate = async (req) =>
          (await identities.authenticate(bearer(req))).subject,
        authenticateCatalog = async (req) =>
          bearer(req)
            ? authenticate(req)
            : {
                subjectId: "anonymous",
                status: "active",
                anonymous: true,
                internal: false,
              },
        packageKeys = parseKeys(env.JILU_TEMPLATE_PACKAGE_KEYS),
      publishService = new TemplatePublishService({
        repository,
        storage,
        packageKeys,
        revalidateBuilt: false,
        verifyUploadedPackage: false,
      }),
        identityRepository = new EdgeOneIdentityRepository(kv),
        adminToken = env.ADMIN_TOKEN || `internal-${crypto.randomUUID()}`;
      handlers = {
        adminToken,
        storage,
        entitlement: createTemplateHttpHandler({
          service,
          publishService,
          adminToken,
          authenticate: authenticateCatalog,
          resolveBindingCode: (code, operation) =>
            identities.withBindingCode(code, operation),
          resolveSubjectById: (id) => identityRepository.getSubject(id),
          resolveSubjectByPublicId: (publicId) =>
            identityRepository.getSubjectByPublicId(publicId),
        }),
        runtime: createTemplateRuntimeHttpHandler({
          service: new TemplateRuntimeService({
            entitlementService: service,
            repository,
            storage,
            downloadTokenKey: env.JILU_TEMPLATE_DOWNLOAD_TOKEN_KEY,
            packageKeys,
            leaseKeys: parseKeys(env.JILU_TEMPLATE_LEASE_KEYS),
          }),
          authenticate,
        }),
      };
      templateHandlers.set(env, handlers);
    }
    const runtime =
      /^\/v1\/templates\/(download-token|package\/|preview\/|lease(?:\/renew)?$)/.test(
        url.pathname,
      );
    if (url.pathname.startsWith("/admin/v1/console")) {
      const admin = createEdgeAdminHandler({
        kv,
        env,
        forward: handlers.entitlement,
        forwardToken: handlers.adminToken,
        backupStorage: handlers.storage,
        waitUntil: env.EDGE_WAIT_UNTIL,
        identities: authService(env, kv),
      });
      return withHeaders(await admin(request), headers);
    }
    return (runtime ? handlers.runtime : handlers.entitlement)(request);
  }
  if (url.pathname === "/v2/public-keys") {
    if (!kv)
      return json(
        { ok: false, code: "PERSISTENT_STORAGE_NOT_CONFIGURED" },
        503,
        headers,
      );
    const forwarded = new Request(request);
    forwarded.headers.set(
      "x-forwarded-for",
      request.headers.get("x-forwarded-for") || "unknown",
    );
    let handlers = templateHandlers.get(env);
    if (!handlers) {
      await handleRequest(
        new Request(new URL("/v1/templates/catalog", url), {
          method: "POST",
          headers: { authorization: "Bearer invalid" },
          body: "{}",
        }),
        env,
        kv,
      );
      handlers = templateHandlers.get(env);
    }
    const response = await handlers.runtime(forwarded),
      body = await response.json();
    const captureKeys = new CaptureTicketRuntimeService({
      keys: parseKeyList(env.JILU_CAPTURE_TICKET_KEYS),
    }).publicKeys();
    const receiptKeys =
      env.PROVENANCE_D1 || env.PROVENANCE_BLOB
        ? new ProvenanceRegistrationServiceV2({
            repository: {},
            receiptKeys: parseKeyList(env.JILU_PROVENANCE_RECEIPT_KEYS),
          }).publicKeys()
        : [];
    return json(
      { ...body, keys: [...(body.keys || []), ...captureKeys, ...receiptKeys] },
      response.status,
      {
        ...headers,
        "Cache-Control":
          response.headers.get("cache-control") || "public, max-age=300",
      },
    );
  }
  if (url.pathname === "/v2/auth/wechat" && request.method === "POST") {
    const ip =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for") ||
      "unknown";
    if (!rateAllowed(authRateClients, `login:${ip}`, 20))
      return json({ ok: false, code: "RATE_LIMITED" }, 429, {
        ...headers,
        "Retry-After": "60",
      });
    if (!kv)
      return json(
        { ok: false, code: "PERSISTENT_STORAGE_NOT_CONFIGURED" },
        503,
        headers,
      );
    let input;
    try {
      input = await request.json();
    } catch {
      return json({ ok: false, code: "INVALID_JSON" }, 400, headers);
    }
    try {
      const auth=authService(env,kv),x=await auth.login(input.loginCode),identity=(await auth.authenticate(x.token)).subject,entitlements=new SubjectEntitlementService(env.PROVENANCE_D1?new D1SubjectEntitlementRepository(env.PROVENANCE_D1):new EdgeOneSubjectEntitlementRepository(kv));
      return json(
        {
          ok: true,
          sessionToken: x.token,
          expiresAt: x.expiresAt,
          user: { publicId: x.publicId },
          capabilities: await entitlements.projection(identity.subjectId),
        },
        200,
        headers,
      );
    } catch (error) {
      return authError(error, headers);
    }
  }
  if (url.pathname === "/v2/auth/logout" && request.method === "POST") {
    try {
      await authService(env, kv).logout(bearer(request));
      return new Response(null, { status: 204, headers });
    } catch (error) {
      return authError(error, headers);
    }
  }
  const creatorSessionSubject = async () => { const token=bearer(request),hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,"0")).join(""),session=JSON.parse(await kv.get(`creator:session:${hash}`)||"null");return session&&session.expiresAt>Date.now()?session.subjectId:null; };
  const cleanupCreatorFeedback=async()=>{const cutoff=Date.now()-30*86400000;for(const prefix of ["creator:inquiry:","creator:notice:"]){const names=(await kv.list({prefix})).keys||[];for(const item of names){const name=item.name||item.key,record=JSON.parse(await kv.get(name)||"null");if(record&&Number(record.updatedAt||record.createdAt)<cutoff)await kv.delete(name)}}const submissionNames=(await kv.list({prefix:"submission:record:"})).keys||[];for(const item of submissionNames){const name=item.name||item.key,record=JSON.parse(await kv.get(name)||"null");if(record&&record.status!=="PENDING"&&Number(record.reviewedAt||record.createdAt)<cutoff){await kv.delete(name);if(await kv.get(`submission:active:${record.subjectId}`)===record.submissionId)await kv.delete(`submission:active:${record.subjectId}`)}}};
  const creatorPreview=url.pathname.match(/^\/v1\/creator\/templates\/([^/]+)\/preview$/);if(creatorPreview&&request.method==="GET"){if(!kv)return json({ok:false,code:"PERSISTENT_STORAGE_NOT_CONFIGURED"},503,headers);const subjectId=await creatorSessionSubject();if(!subjectId)return json({ok:false,code:"CREATOR_SESSION_INVALID"},401,headers);const subject=JSON.parse(await kv.get(`subject_${subjectId}`)||"null"),repository=new EdgeOneTemplateRepository(kv),templateId=decodeURIComponent(creatorPreview[1]),template=await repository.getTemplate(templateId);if(!template||template.creatorPublicId!==subject?.publicId)return json({ok:false,code:"TEMPLATE_NOT_FOUND"},404,headers);if(!templateHandlers.get(env))await handleRequest(new Request(new URL("/v1/templates/catalog",url),{method:"POST",headers:{authorization:"Bearer invalid","content-type":"application/json"},body:"{}"}),env,kv);const bytes=await templateHandlers.get(env)?.storage?.getPreview?.(templateId,Number(url.searchParams.get("version"))||Number(template.latestVersion));if(!bytes)return json({ok:false,code:"TEMPLATE_PACKAGE_NOT_AVAILABLE"},404,headers);return new Response(bytes,{status:200,headers:{...headers,"content-type":"image/webp","cache-control":"private, max-age=300"}})}
  if(url.pathname==="/v1/creator/sessions"&&request.method==="POST"){if(!kv)return json({ok:false,code:"PERSISTENT_STORAGE_NOT_CONFIGURED"},503,headers);try{const input=await request.json(),session=await authService(env,kv).withBindingCode(input.bindingCode,async subjectId=>{const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);const token=btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,"0")).join(""),expiresAt=Date.now()+86400000;await kv.put(`creator:session:${hash}`,JSON.stringify({subjectId,expiresAt}),{expirationTtl:86400});return{token,expiresAt}});return json({ok:true,...session},201,headers)}catch(error){return json({ok:false,code:error.code||"CREATOR_LOGIN_FAILED"},error.status||500,headers)}}
  if(url.pathname==="/v1/creator/me"&&request.method==="GET"){if(!kv)return json({ok:false,code:"PERSISTENT_STORAGE_NOT_CONFIGURED"},503,headers);const subjectId=await creatorSessionSubject();if(!subjectId)return json({ok:false,code:"CREATOR_SESSION_INVALID"},401,headers);await cleanupCreatorFeedback();const subject=JSON.parse(await kv.get(`subject_${subjectId}`)||"null"),submissionNames=(await kv.list({prefix:"submission:record:"})).keys||[],inquiryNames=(await kv.list({prefix:"creator:inquiry:"})).keys||[],noticeNames=(await kv.list({prefix:"creator:notice:"})).keys||[],submissions=[],inquiries=[],notices=[];for(const item of submissionNames){const record=JSON.parse(await kv.get(item.name||item.key)||"null");if(record?.subjectId===subjectId)submissions.push({submissionId:record.submissionId,status:record.status,title:record.title,category:record.category,createdAt:record.createdAt,reviewedAt:record.reviewedAt,reviewNote:record.reviewNote||"",publishedTemplateId:record.publishedTemplateId||null,upgradeTemplateId:record.upgradeTemplateId||null,upgradeFromVersion:record.upgradeFromVersion||null,submissionType:record.upgradeTemplateId?"VERSION_UPGRADE":"NEW_TEMPLATE"})}for(const item of inquiryNames){const record=JSON.parse(await kv.get(item.name||item.key)||"null");if(record?.subjectId===subjectId)inquiries.push(record)}for(const item of noticeNames){const record=JSON.parse(await kv.get(item.name||item.key)||"null");if(record?.subjectId===subjectId)notices.push(record)}const repository=new EdgeOneTemplateRepository(kv),templateIds=[...new Set(submissions.filter(item=>item.status==="APPROVED"&&item.publishedTemplateId).map(item=>item.publishedTemplateId))],grantNames=(await kv.list({prefix:"te_dg_"})).keys||[],publishedWorks=[];for(const templateId of templateIds){const template=await repository.getTemplate(templateId);if(!template||template.deletedAt||template.archivedAt||template.enabled===false||template.creatorPublicId!==subject?.publicId)continue;const sharedWith=[];for(const grantItem of grantNames){const grant=JSON.parse(await kv.get(grantItem.name||grantItem.key)||"null");if(grant?.templateId!==templateId||grant.enabled===false||grant.revokedAt||grant.grantedBy!==`creator:${subject.publicId}`)continue;const target=JSON.parse(await kv.get(`subject_${grant.subjectId}`)||"null");if(target?.publicId)sharedWith.push({publicId:target.publicId,grantedAt:grant.grantedAt})}publishedWorks.push({templateId,name:template.name,description:template.description||"",category:template.category,latestVersion:Number(template.latestVersion)||1,updatedAt:template.updatedAt||template.publishedAt||0,creatorSharingEnabled:template.creatorSharingEnabled!==false,sharedWith})}const entitlements=new SubjectEntitlementService(env.PROVENANCE_D1?new D1SubjectEntitlementRepository(env.PROVENANCE_D1):new EdgeOneSubjectEntitlementRepository(kv));return json({ok:true,user:{publicId:subject?.publicId},capabilities:await entitlements.projection(subjectId),submissions:submissions.sort((a,b)=>b.createdAt-a.createdAt),publishedWorks,notices:notices.sort((a,b)=>Number(b.createdAt)-Number(a.createdAt)),inquiries:inquiries.sort((a,b)=>Number(b.updatedAt||b.createdAt)-Number(a.updatedAt||a.createdAt)),feedbackRetentionDays:30,reviewRetentionDays:30,notificationRetentionDays:30},200,{...headers,"cache-control":"no-store"})}
  if(url.pathname==="/v1/creator/inquiries"&&request.method==="POST"){if(!kv)return json({ok:false,code:"PERSISTENT_STORAGE_NOT_CONFIGURED"},503,headers);const subjectId=await creatorSessionSubject();if(!subjectId)return json({ok:false,code:"CREATOR_SESSION_INVALID"},401,headers);const input=await request.json(),subject=cleanText(input.subject,80),content=cleanText(input.content,1000);if(!subject||!content)return json({ok:false,code:"INQUIRY_INVALID"},400,headers);const inquiryId=`inq_${crypto.randomUUID().replaceAll("-","")}`,now=Date.now(),record={inquiryId,subjectId,subject,content,status:"OPEN",createdAt:now,updatedAt:now,resolvedAt:null,reply:"",messages:[{messageId:`im_${crypto.randomUUID().replaceAll("-","")}`,senderType:"USER",content,createdAt:now}]};await kv.put(`creator:inquiry:${inquiryId}`,JSON.stringify(record));await new EdgeNotificationService({kv,env}).emit("USER_INQUIRY",{inquiryId,subject,content}).catch(()=>{});return json({ok:true,inquiryId},201,headers)}
  const creatorInquiryMessage=url.pathname.match(/^\/v1\/creator\/inquiries\/([^/]+)\/messages$/);if(creatorInquiryMessage&&request.method==="POST"){if(!kv)return json({ok:false,code:"PERSISTENT_STORAGE_NOT_CONFIGURED"},503,headers);const subjectId=await creatorSessionSubject();if(!subjectId)return json({ok:false,code:"CREATOR_SESSION_INVALID"},401,headers);const name=`creator:inquiry:${decodeURIComponent(creatorInquiryMessage[1])}`,record=JSON.parse(await kv.get(name)||"null"),input=await request.json(),content=cleanText(input.content,1000);if(!record||record.subjectId!==subjectId)return json({ok:false,code:"INQUIRY_NOT_FOUND"},404,headers);if(!content)return json({ok:false,code:"INQUIRY_INVALID"},400,headers);const now=Date.now();record.messages=Array.isArray(record.messages)?record.messages:[];record.messages.push({messageId:`im_${crypto.randomUUID().replaceAll("-","")}`,senderType:"USER",content,createdAt:now});record.status="OPEN";record.updatedAt=now;record.resolvedAt=null;await kv.put(name,JSON.stringify(record));await new EdgeNotificationService({kv,env}).emit("USER_FOLLOW_UP",{inquiryId:record.inquiryId,content}).catch(()=>{});return json({ok:true,status:"OPEN"},201,headers)}
  const creatorInquiryDelete=url.pathname.match(/^\/v1\/creator\/inquiries\/([^/]+)$/);if(creatorInquiryDelete&&request.method==="DELETE"){if(!kv)return json({ok:false,code:"PERSISTENT_STORAGE_NOT_CONFIGURED"},503,headers);const subjectId=await creatorSessionSubject();if(!subjectId)return json({ok:false,code:"CREATOR_SESSION_INVALID"},401,headers);const name=`creator:inquiry:${decodeURIComponent(creatorInquiryDelete[1])}`,record=JSON.parse(await kv.get(name)||"null");if(!record||record.subjectId!==subjectId)return json({ok:false,code:"INQUIRY_NOT_FOUND"},404,headers);await kv.delete(name);return json({ok:true,deleted:true},200,headers)}
  const creatorShare=url.pathname.match(/^\/v1\/creator\/templates\/([^/]+)\/share$/);if(creatorShare&&request.method==="POST"){if(!kv)return json({ok:false,code:"PERSISTENT_STORAGE_NOT_CONFIGURED"},503,headers);try{const ownerSubjectId=await creatorSessionSubject();if(!ownerSubjectId)return json({ok:false,code:"CREATOR_SESSION_INVALID"},401,headers);const owner=JSON.parse(await kv.get(`subject_${ownerSubjectId}`)||"null"),repository=new EdgeOneTemplateRepository(kv),service=new TemplateEntitlementService({repository}),template=await repository.getTemplate(decodeURIComponent(creatorShare[1]));if(!template||template.creatorPublicId!==owner?.publicId||template.contributionType!=="USER_SUBMISSION")return json({ok:false,code:"CREATOR_TEMPLATE_OWNERSHIP_REQUIRED"},403,headers);if(template.creatorSharingEnabled===false)return json({ok:false,code:"CREATOR_SHARING_DISABLED"},403,headers);const input=await request.json(),result=await authService(env,kv).withBindingCode(input.bindingCode,async targetSubjectId=>{if(targetSubjectId===ownerSubjectId)throw Object.assign(new Error("self"),{code:"CREATOR_SHARE_SELF_DENIED",status:409});const target=JSON.parse(await kv.get(`subject_${targetSubjectId}`)||"null"),old=await repository.getDirectGrant(targetSubjectId,template.templateId);if(old?.enabled&&!old.revokedAt&&old.grantedBy!==`creator:${owner.publicId}`)throw Object.assign(new Error("authorized"),{code:"CREATOR_SHARE_TARGET_ALREADY_AUTHORIZED",status:409});await service.grantUser(template.templateId,targetSubjectId,`creator:${owner.publicId}`,null);return{shared:true,publicId:target?.publicId,alreadyShared:Boolean(old?.enabled&&!old.revokedAt)}});return json({ok:true,...result},200,headers)}catch(error){return json({ok:false,code:error.code||"CREATOR_SHARE_FAILED"},error.status||500,headers)}}
  const creatorRevoke=url.pathname.match(/^\/v1\/creator\/templates\/([^/]+)\/shares\/([^/]+)$/);if(creatorRevoke&&request.method==="DELETE"){if(!kv)return json({ok:false,code:"PERSISTENT_STORAGE_NOT_CONFIGURED"},503,headers);try{const ownerSubjectId=await creatorSessionSubject();if(!ownerSubjectId)return json({ok:false,code:"CREATOR_SESSION_INVALID"},401,headers);const owner=JSON.parse(await kv.get(`subject_${ownerSubjectId}`)||"null"),repository=new EdgeOneTemplateRepository(kv),service=new TemplateEntitlementService({repository}),template=await repository.getTemplate(decodeURIComponent(creatorRevoke[1]));if(!template||template.creatorPublicId!==owner?.publicId)return json({ok:false,code:"CREATOR_TEMPLATE_OWNERSHIP_REQUIRED"},403,headers);const subjectNames=(await kv.list({prefix:"subject_"})).keys||[];let target=null;for(const item of subjectNames){const candidate=JSON.parse(await kv.get(item.name||item.key)||"null");if(candidate?.publicId===decodeURIComponent(creatorRevoke[2])){target=candidate;break}}if(!target)return json({ok:false,code:"SUBJECT_NOT_FOUND"},404,headers);const grant=await repository.getDirectGrant(target.subjectId,template.templateId);if(!grant||grant.grantedBy!==`creator:${owner.publicId}`)return json({ok:false,code:"CREATOR_SHARE_NOT_REVOCABLE"},409,headers);await service.revokeUser(template.templateId,target.subjectId,`creator:${owner.publicId}`);return new Response(null,{status:204,headers})}catch(error){return json({ok:false,code:error.code||"CREATOR_SHARE_REVOKE_FAILED"},error.status||500,headers)}}
  if (url.pathname === "/v1/template-submissions" && request.method === "POST") {
    if (!kv) return json({ ok: false, code: "PERSISTENT_STORAGE_NOT_CONFIGURED" }, 503, headers);
    try {
      const input = await request.json(), template = input?.template;
      if (!template || template.format !== "xianchang-jilu-watermark-scheme" || !template.scheme || !Array.isArray(template.scheme.fields))
        return json({ ok: false, code: "TEMPLATE_SUBMISSION_INVALID" }, 400, headers);
      const packageJson = JSON.stringify(template), byteLength = new TextEncoder().encode(packageJson).byteLength;
      if (byteLength > 12 * 1024 * 1024) return json({ ok: false, code: "TEMPLATE_SUBMISSION_TOO_LARGE" }, 413, headers);
      const title = cleanText(input.title || template.scheme.name, 40), description = cleanText(input.description, 300), category = cleanText(input.category, 40);
      if (!title || !description || !category) return json({ ok: false, code: "TEMPLATE_SUBMISSION_INVALID" }, 400, headers);
      const createSubmission = async subjectId => {
        const activeKey = `submission:active:${subjectId}`, activeId = await kv.get(activeKey), active = activeId ? JSON.parse(await kv.get(`submission:record:${activeId}`) || "null") : null;
        if (active?.status === "PENDING") throw Object.assign(new Error("pending"), { code: "SUBMISSION_ALREADY_PENDING", status: 409 });
        const upgradeTemplateId=cleanText(input.upgradeTemplateId,96)||null;let upgradeFromVersion=null;if(upgradeTemplateId){const owner=JSON.parse(await kv.get(`subject_${subjectId}`)||"null"),published=await new EdgeOneTemplateRepository(kv).getTemplate(upgradeTemplateId);if(!published||published.creatorPublicId!==owner?.publicId||published.contributionType!=="USER_SUBMISSION")throw Object.assign(new Error("ownership"),{code:"CREATOR_TEMPLATE_OWNERSHIP_REQUIRED",status:403});upgradeFromVersion=Number(published.latestVersion)||1;}
        const submissionId = `sub_${crypto.randomUUID().replaceAll("-", "")}`, tokenBytes = new Uint8Array(24); crypto.getRandomValues(tokenBytes);
        const statusToken = btoa(String.fromCharCode(...tokenBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), statusTokenHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(statusToken)))].map(x => x.toString(16).padStart(2, "0")).join("");
        const chunkSize = 80000, packageChunks = Math.ceil(packageJson.length / chunkSize), record = { submissionId, subjectId, status: "PENDING", title, description, category, contributionType: upgradeTemplateId?"USER_SUBMISSION_UPGRADE":"USER_SUBMISSION", upgradeTemplateId, upgradeFromVersion, statusTokenHash, packageChunks, packageSize: byteLength, createdAt: Date.now(), reviewedAt: null, reviewedBy: null, reviewNote: "", publishedTemplateId: null };
        await Promise.all([
          kv.put(`submission:record:${submissionId}`, JSON.stringify(record)),
          kv.put(activeKey, submissionId),
          ...Array.from({ length: packageChunks }, (_, index) =>
            kv.put(
              `submission:package:${submissionId}:${index}`,
              packageJson.slice(index * chunkSize, (index + 1) * chunkSize),
            ),
          ),
        ]);
        return { submissionId, statusToken, createdAt: record.createdAt, submissionType:upgradeTemplateId?"VERSION_UPGRADE":"NEW_TEMPLATE", upgradeTemplateId, targetVersion:upgradeFromVersion?upgradeFromVersion+1:null };
      };
      const authenticatedSubject=await creatorSessionSubject();
      const result=authenticatedSubject?await createSubmission(authenticatedSubject):await authService(env,kv).withBindingCode(input.bindingCode,createSubmission);
      await new EdgeNotificationService({kv,env}).emit("TEMPLATE_SUBMISSION",{submissionId:result.submissionId,title,category,submissionType:result.submissionType}).catch(()=>{});
      return json({ ok: true, ...result }, 201, headers);
    } catch (error) { return json({ ok: false, code: error.code || "TEMPLATE_SUBMISSION_FAILED" }, error.status || 500, headers); }
  }
  const submissionStatus = url.pathname.match(/^\/v1\/template-submissions\/([^/]+)$/);
  if (submissionStatus && request.method === "GET") {
    if (!kv) return json({ ok: false, code: "PERSISTENT_STORAGE_NOT_CONFIGURED" }, 503, headers);
    const record = JSON.parse(await kv.get(`submission:record:${decodeURIComponent(submissionStatus[1])}`) || "null"), supplied = url.searchParams.get("token") || "", suppliedHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(supplied)))].map(x => x.toString(16).padStart(2, "0")).join("");
    if (!record || suppliedHash !== record.statusTokenHash) return json({ ok: false, code: "SUBMISSION_NOT_FOUND" }, 404, headers);
    return json({ ok: true, submissionId: record.submissionId, status: record.status, reviewNote: record.reviewNote || "", publishedTemplateId: record.publishedTemplateId || null, createdAt: record.createdAt, reviewedAt: record.reviewedAt || null }, 200, headers);
  }
  const submissionWithdraw=url.pathname.match(/^\/v1\/template-submissions\/([^/]+)\/withdraw$/);if(submissionWithdraw&&request.method==="POST"){if(!kv)return json({ok:false,code:"PERSISTENT_STORAGE_NOT_CONFIGURED"},503,headers);const subjectId=await creatorSessionSubject();if(!subjectId)return json({ok:false,code:"CREATOR_SESSION_INVALID"},401,headers);const name=`submission:record:${decodeURIComponent(submissionWithdraw[1])}`,record=JSON.parse(await kv.get(name)||"null");if(!record||record.subjectId!==subjectId||record.status!=="PENDING")return json({ok:false,code:"SUBMISSION_NOT_PENDING_OR_NOT_FOUND"},409,headers);for(let index=0;index<Number(record.packageChunks||0);index++)await kv.delete(`submission:package:${record.submissionId}:${index}`);record.status="WITHDRAWN";record.packageChunks=0;record.packageSize=0;record.reviewedAt=Date.now();record.reviewNote="用户主动撤回投稿";await Promise.all([kv.put(name,JSON.stringify(record)),kv.delete(`submission:active:${subjectId}`)]);return json({ok:true,status:"WITHDRAWN",packageDeleted:true},200,headers)}
  if(url.pathname==="/v1/creator/qr/options"&&request.method==="POST"){const ip=request.headers.get("cf-connecting-ip")||request.headers.get("x-forwarded-for")||"unknown";if(!rateAllowed(authRateClients,`creator-qr-options:${ip}`,12))return json({ok:false,code:"RATE_LIMITED"},429,{...headers,"Retry-After":"60"});const requestId=`qr_${crypto.randomUUID().replaceAll("-","")}`,secret=`${crypto.randomUUID().replaceAll("-","")}${crypto.randomUUID().replaceAll("-","")}`,expiresAt=Date.now()+120000,record={requestId,secretHash:await sha256(secret),purpose:"CREATOR",status:"PENDING",createdAt:Date.now(),expiresAt};await kv.put(`web-qr:${requestId}`,JSON.stringify(record),{expirationTtl:180});return json({ok:true,requestId,secret,purpose:"creator",expiresAt,qrContent:`https://shuiyin.nnu.cn/wx-login?request=${encodeURIComponent(requestId)}&secret=${encodeURIComponent(secret)}&purpose=creator`},201,headers)}
  if(url.pathname==="/v1/creator/qr/verify"&&request.method==="POST"){const ip=request.headers.get("cf-connecting-ip")||request.headers.get("x-forwarded-for")||"unknown";if(!rateAllowed(authRateClients,`creator-qr-verify:${ip}`,100))return json({ok:false,code:"RATE_LIMITED"},429,{...headers,"Retry-After":"60"});const input=await request.json();if(!/^qr_[A-Za-z0-9_-]{20,64}$/.test(String(input.requestId||""))||!/^[A-Za-z0-9_-]{32,96}$/.test(String(input.secret||"")))return json({ok:false,code:"QR_LOGIN_INVALID"},404,headers);const name=`web-qr:${cleanText(input.requestId,96)}`,record=JSON.parse(await kv.get(name)||"null");if(!record||record.secretHash!==await sha256(input.secret)||record.purpose!=="CREATOR"||record.expiresAt<=Date.now()||record.usedAt)return json({ok:false,code:"QR_LOGIN_INVALID"},404,headers);if(record.status==="PENDING")return json({ok:true,pending:true,expiresAt:record.expiresAt},202,headers);record.usedAt=Date.now();record.consumptionId=crypto.randomUUID();await kv.put(name,JSON.stringify(record),{expirationTtl:60});if(JSON.parse(await kv.get(name)||"null")?.consumptionId!==record.consumptionId)return json({ok:false,code:"QR_LOGIN_CONSUMED"},409,headers);const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);const token=btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");await kv.put(`creator:session:${await sha256(token)}`,JSON.stringify({subjectId:record.subjectId,expiresAt:Date.now()+86400000}),{expirationTtl:86400});return json({ok:true,token,expiresAt:Date.now()+86400000},200,headers)}
  if(url.pathname==="/v1/auth/qr-login/approve"&&request.method==="POST"){try{const auth=await authService(env,kv).authenticate(bearer(request)),input=await request.json();if(!/^qr_[A-Za-z0-9_-]{20,64}$/.test(String(input.requestId||""))||!/^[A-Za-z0-9_-]{32,96}$/.test(String(input.secret||"")))return json({ok:false,code:"QR_LOGIN_INVALID"},404,headers);const name=`web-qr:${cleanText(input.requestId,96)}`,record=JSON.parse(await kv.get(name)||"null");if(!record||record.secretHash!==await sha256(input.secret)||record.purpose!==String(input.purpose||"").toUpperCase()||record.status!=="PENDING"||record.expiresAt<=Date.now())return json({ok:false,code:"QR_LOGIN_INVALID"},404,headers);record.status="APPROVED";record.subjectId=auth.subject.subjectId;record.approvalId=crypto.randomUUID();await kv.put(name,JSON.stringify(record),{expirationTtl:180});if(JSON.parse(await kv.get(name)||"null")?.approvalId!==record.approvalId)return json({ok:false,code:"QR_LOGIN_ALREADY_APPROVED"},409,headers);return json({ok:true,approved:true,purpose:String(input.purpose).toLowerCase()},200,headers)}catch(error){return authError(error,headers)}}
  if (url.pathname === "/v1/auth/binding-code" && request.method === "POST") {
    try {
      const service = authService(env, kv),
        auth = await service.authenticate(bearer(request)),
        ip = request.headers.get("cf-connecting-ip") || "unknown";
      if (
        !rateAllowed(
          authRateClients,
          `binding:${auth.subject.subjectId}:${ip}`,
          10,
        )
      )
        return json({ ok: false, code: "RATE_LIMITED" }, 429, {
          ...headers,
          "Retry-After": "60",
        });
      return json(
        { ok: true, ...(await service.createBindingCode(bearer(request))) },
        200,
        headers,
      );
    } catch (error) {
      return authError(error, headers);
    }
  }
  const isLocationReverse =
    url.pathname === "/v2/location/reverse" && request.method === "POST";
  if (url.pathname === "/api/photo-provenance")
    return json({ ok: false, code: "LEGACY_PROVENANCE_RETIRED" }, 410, headers);
  if (!isLocationReverse)
    return json({ ok: false, code: "NOT_FOUND" }, 404, headers);
  if (!kv) return json({ ok: false, code: "KV_BINDING_MISSING" }, 503, headers);
  if (Number(request.headers.get("content-length") || 0) > 65_536)
    return json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, 413, headers);
  let input;
  try {
    const text = await request.text();
    if (text.length > 65_536) throw new Error("large");
    input = JSON.parse(text || "{}");
  } catch {
    return json({ ok: false, code: "INVALID_JSON" }, 400, headers);
  }

  if (isLocationReverse)
    return reverseLocation(request, input, env, kv, headers);
}

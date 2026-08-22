import assert from "node:assert/strict";
import test from "node:test";
import { buildTencentMapUrl, handleRequest, md5 } from "../src/core.js";
import { validateTemplateBundle } from "../src/template-package-core.generated.js";
import {
  ticketDigest,
  validateReceipt,
  validateStoredRecord,
} from "../src/provenance-core.generated.js";

class MemoryKv {
  data = new Map();
  async get(key) {
    return this.data.get(key) ?? null;
  }
  async put(key, value) {
    this.data.set(key, String(value));
  }
  async list({ prefix = "", limit = 100 } = {}) {
    const keys = [...this.data.keys()]
      .filter((key) => key.startsWith(prefix))
      .slice(0, limit)
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}
class MemoryBlob {
  data = new Map();
  gets = [];
  async set(key, value, options = {}) {
    if (options.onlyIfNew && this.data.has(key))
      throw Object.assign(new Error(), { code: "TEMPLATE_VERSION_CONFLICT" });
    this.data.set(key, value);
  }
  async get(key, options) {
    this.gets.push({ key, options });
    const value = this.data.get(key);
    return value == null
      ? null
      : {
          arrayBuffer: async () =>
            value.buffer.slice(
              value.byteOffset,
              value.byteOffset + value.byteLength,
            ),
        };
  }
  async delete(key) {
    this.data.delete(key);
  }
  async list() {
    return {
      items: [...this.data.entries()].map(([name, value]) => ({
        name,
        size: value.byteLength,
        createdAt: 0,
      })),
    };
  }
}
const b64 = (b) => Buffer.from(b).toString("base64url");

const hash = (character) => character.repeat(64);
const marker = "abcdef123456";
const env = {
  ALLOWED_ORIGIN: "https://shuiyin.nnu.cn",
  WECHAT_APP_ID: "app",
  WECHAT_APP_SECRET: "secret",
  JILU_IDENTITY_HMAC_KEY: "test-only-hmac-key",
  JILU_SUBJECT_DERIVATION_KEY: "test-only-subject-key",
};

test("admin responses preserve CORS headers, including authentication errors", async () => {
  const request = new Request("https://api.shuiyin.nnu.cn/admin/v1/console/me", {
    headers: { Origin: "https://shuiyin.nnu.cn" },
  });
  const response = await handleRequest(request, env, new MemoryKv());
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://shuiyin.nnu.cn");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.match(response.headers.get("vary") || "", /Origin/i);
});
const phase8cHashes = Array.from({ length: 16 }, (_, i) =>
  i.toString(16).padStart(64, "0"),
);
const phase8cRegionalV3={algorithm:'regional-integrity-v3',grid:{columns:4,rows:4},descriptorFormat:'hybrid-normalized-patch-8x8-residual4x4-v1-base64url',blocks:Array.from({length:16},(_,index)=>({index,descriptor:Buffer.alloc(80,index).toString('base64url')}))}
const phase8cWatermarkV2={algorithm:'watermark-integrity-v2',grid:{columns:4,rows:3},descriptorFormat:'int8-normalized-patch-8x8-base64url',blocks:Array.from({length:12},(_,index)=>({index,descriptor:Buffer.alloc(64,index).toString('base64url')}))}
const phase8cDraft = (ticket, digest) => ({
  schema: "jilu-provenance",
  protocolVersion: 2,
  trustPolicyVersion: "trusted-capture-v2",
  source: {
    type: "live-camera",
    captureMode: "TRUSTED",
    platform: "unknown",
    appVersion: "1",
    wechatVersion: "1",
    sdkVersion: "1",
  },
  time: {
    captureRequestedAt: ticket.issuedAt,
    captureCompletedAt: ticket.issuedAt + 1,
  },
  location: {
    source: "device-gps",
    name: "private",
    latitude: 1,
    longitude: 2,
    accuracyMeters: 3,
    altitudeMeters: null,
  },
  binding: {
    sha256: "a".repeat(64),
    dhash256: "b".repeat(64),
    phash256: "c".repeat(64),
    blindMarkerId: ticket.markerId,
    blindWatermarkEmbedded: true,
    blindEvidence: {
      extracted: true,
      markerId: ticket.markerId,
      ticketDigest: digest,
      flags: 1,
      confidence: 0.9,
    },
    algorithms: {
      sha256: "sha256-v1",
      dhash256: "dhash256-v2",
      phash256: "phash256-v1",
      blindWatermark: "jilu-blind-v2",
    },
    watermarkRegion: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 },
  },
  integrity: structuredClone(phase8cRegionalV3),
  watermarkIntegrity: structuredClone(phase8cWatermarkV2),
  rendererVersion: 2,
  privacyLevel: "private",
});
const apiRequest = (body) =>
  new Request("https://example.com/api/photo-provenance", {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.ALLOWED_ORIGIN },
    body: JSON.stringify(body),
  });
const locationRequest = (body, token = "") =>
  new Request("https://example.com/v2/location/reverse", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      origin: env.ALLOWED_ORIGIN,
      "cf-connecting-ip": "203.0.113.10",
    },
    body: JSON.stringify(body),
  });

test("health endpoint reports edge KV", async () => {
  const response = await handleRequest(
    new Request("https://example.com/health"),
    { PLATFORM_NAME: "test-edge" },
    null,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.platform, "test-edge");
  assert.equal(body.serviceVersion, "1.1.0");
  assert.deepEqual(body.apiVersions, ["identity-v2", "template-v1", "provenance-v2", "verification-exchange-v3"]);
});

test("real Edge handler serves capture tickets and merged public keys", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ openid: "capture-edge-openid" });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const pair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]),
    privateKey = b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
    publicKey = b64(await crypto.subtle.exportKey("raw", pair.publicKey)),
    kv = new MemoryKv(),
    captureEnv = {
      ...env,
      JILU_CAPTURE_TICKET_KEYS: JSON.stringify([
        {
          keyId: "capture-active",
          purpose: "capture-ticket-signing",
          status: "ACTIVE",
          privateKey,
          publicKey,
        },
        {
          keyId: "capture-old",
          purpose: "capture-ticket-signing",
          status: "VERIFY_ONLY",
          publicKey,
        },
        {
          keyId: "capture-retired",
          purpose: "capture-ticket-signing",
          status: "RETIRED",
          publicKey,
        },
      ]),
      JILU_TEMPLATE_PACKAGE_KEYS: "[]",
      JILU_TEMPLATE_LEASE_KEYS: "[]",
    };
  const login = await handleRequest(
      new Request("https://example.com/v2/auth/wechat", {
        method: "POST",
        body: '{"loginCode":"valid"}',
      }),
      captureEnv,
      kv,
    ),
    token = (await login.json()).sessionToken,
    call = (body, auth = token) =>
      handleRequest(
        new Request("https://example.com/v2/capture-ticket", {
          method: "POST",
          headers: {
            authorization: `Bearer ${auth}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        captureEnv,
        kv,
      );
  const online = await call({ kind: "online", count: 1 }),
    onlineBody = await online.json();
  assert.equal(online.status, 200);
  assert.equal(online.headers.get("cache-control"), "no-store");
  assert.equal(onlineBody.tickets[0].kind, "online");
  assert.equal(onlineBody.tickets[0].keyId, "capture-active");
  const offline = await call({ kind: "offline", count: 20 });
  assert.equal(offline.status, 200);
  assert.equal((await offline.json()).tickets.length, 20);
  assert.equal((await call({ kind: "online", count: 2 })).status, 400);
  assert.equal((await call({ kind: "bad", count: 1 })).status, 400);
  assert.equal((await call({ kind: "online", count: 1 }, "bad")).status, 401);
  const keys = await handleRequest(
      new Request("https://example.com/v2/public-keys"),
      captureEnv,
      kv,
    ),
    keyBody = await keys.json();
  assert.equal(
    keyBody.keys.some(
      (x) => x.purpose === "capture-ticket-signing" && x.status === "ACTIVE",
    ),
    true,
  );
  assert.equal(
    keyBody.keys.some((x) => x.keyId === "capture-old"),
    true,
  );
  assert.equal(
    keyBody.keys.some((x) => x.keyId === "capture-retired"),
    false,
  );
  assert.equal(JSON.stringify(keyBody).includes("privateKey"), false);
  const noActive = {
    ...captureEnv,
    JILU_CAPTURE_TICKET_KEYS: JSON.stringify([
      {
        keyId: "only-old",
        purpose: "capture-ticket-signing",
        status: "VERIFY_ONLY",
        publicKey,
      },
    ]),
  };
  assert.equal(
    (
      await handleRequest(
        new Request("https://example.com/v2/capture-ticket", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: '{"kind":"online","count":1}',
        }),
        noActive,
        kv,
      )
    ).status,
    503,
  );
  const subjectEntry = [...kv.data.entries()].find(([key]) =>
      key.startsWith("subject_"),
    ),
    disabled = { ...JSON.parse(subjectEntry[1]), status: "disabled" };
  await kv.put(subjectEntry[0], JSON.stringify(disabled));
  assert.equal((await call({ kind: "online", count: 1 })).status, 403);
});

test("retires the legacy provenance route and rejects unknown routes", async () => {
  const retired = await handleRequest(
    new Request("https://example.com/api/photo-provenance", {
      method: "POST",
      body: "{",
    }),
    env,
    new MemoryKv(),
  );
  assert.equal(retired.status, 410);
  assert.equal((await retired.json()).code, "LEGACY_PROVENANCE_RETIRED");
  const missing = await handleRequest(
    new Request("https://example.com/nope"),
    env,
    new MemoryKv(),
  );
  assert.equal(missing.status, 404);
});

test("builds Tencent SK signatures without exposing secrets", () => {
  assert.equal(md5("abc"), "900150983cd24fb0d6963f7d28e17f72");
  const url = buildTencentMapUrl(31.23, 121.47, "public-key", "private-secret");
  assert.match(url, /^https:\/\/apis\.map\.qq\.com\/ws\/geocoder\/v1\//);
  assert.match(url, /&sig=[a-f0-9]{32}$/);
  assert.doesNotMatch(url, /private-secret/);
});

test("authenticates, sanitizes and caches reverse geocoder results", async (t) => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("https://api.weixin.qq.com/"))
      return Response.json({ openid: "location-owner" });
    upstreamCalls += 1;
    assert.doesNotMatch(String(url), /map-secret/);
    return Response.json({
      status: 0,
      result: {
        address: "上海市测试路1号",
        ad_info: { adcode: "310000" },
        pois: [{ title: "测试中心", category: "楼宇", _distance: 10 }],
      },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const kv = new MemoryKv(),
    locationEnv = {
      ...env,
      TENCENT_MAP_KEY: "map-key",
      TENCENT_MAP_SECRET: "map-secret",
    };
  const login = await handleRequest(
    new Request("https://example.com/v2/auth/wechat", {
      method: "POST",
      body: JSON.stringify({ loginCode: "one" }),
    }),
    locationEnv,
    kv,
  );
  const token = (await login.json()).sessionToken;
  const first = await handleRequest(
    locationRequest({ latitude: 31.23, longitude: 121.47 }, token),
    locationEnv,
    kv,
  );
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    ok: true,
    name: "测试中心",
    address: "上海市测试路1号",
    adcode: "310000",
    cached: false,
  });
  const second = await handleRequest(
    locationRequest({ latitude: 31.23001, longitude: 121.47001 }, token),
    locationEnv,
    kv,
  );
  assert.equal((await second.json()).cached, true);
  assert.equal(upstreamCalls, 1);
});

test("development reverse geocoder exposes sanitized provider diagnostics", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url).startsWith("https://api.weixin.qq.com/")
    ? Response.json({ openid: "diagnostic-owner" })
    : Response.json({ status: 120, message: "key鉴权失败" });
  t.after(() => { globalThis.fetch = originalFetch; });
  const kv = new MemoryKv(), locationEnv = { ...env, ENVIRONMENT: "development", TENCENT_MAP_KEY: "map-key" };
  const login = await handleRequest(new Request("https://example.com/v2/auth/wechat", { method: "POST", body: JSON.stringify({ loginCode: "one" }) }), locationEnv, kv);
  const token = (await login.json()).sessionToken;
  const response = await handleRequest(locationRequest({ latitude: 31.23, longitude: 121.47 }, token), locationEnv, kv), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.code, "PROVIDER_AUTH_FAILED");
  assert.deepEqual(body.diagnostic, { provider:"tencent-map",backend:"edge",environment:"development",providerHttpStatus:200,providerStatus:120,providerMessage:"key鉴权失败" });
  assert.doesNotMatch(JSON.stringify(body), /map-key/);
});

test("Edge real handlers call EdgeOne Blob-compatible storage for runtime APIs", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ openid: "edge-runtime-openid" });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const pair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]),
    privateKey = b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
    publicKey = b64(await crypto.subtle.exportKey("raw", pair.publicKey)),
    kv = new MemoryKv(),
    blob = new MemoryBlob(),
    runtimeEnv = {
      ...env,
      TEMPLATE_BLOB: blob,
      JILU_TEMPLATE_DOWNLOAD_TOKEN_KEY: "edge-download-key",
      JILU_TEMPLATE_PACKAGE_KEYS: JSON.stringify([
        { keyId: "pkg-active", status: "ACTIVE", publicKey },
      ]),
      JILU_TEMPLATE_LEASE_KEYS: JSON.stringify([
        { keyId: "lease-active", status: "ACTIVE", publicKey, privateKey },
      ]),
    };
  const login = await handleRequest(
      new Request("https://example.com/v2/auth/wechat", {
        method: "POST",
        body: '{"loginCode":"valid"}',
      }),
      runtimeEnv,
      kv,
    ),
    auth = (await login.json()).sessionToken,
    subject = JSON.parse(
      [...kv.data.entries()].find(([key]) => key.startsWith("subject_"))[1],
    );
  await kv.put(
    "te_tpl_tpl_edge_001",
    JSON.stringify({
      templateId: "tpl_edge_001",
      visibility: "USER_RESTRICTED",
      enabled: true,
      latestVersion: 1,
      minimumSupportedVersion: 1,
      updatePolicy: "AUTO",
      name: "Edge",
      description: "",
      category: "general",
      tags: [],
      offlinePolicy: { allowed: true, leaseHours: 4 },
      sortOrder: 0,
      updatedAt: 1,
    }),
  );
  await kv.put(
    "te_ver_tpl_edge_001_1",
    JSON.stringify({
      templateId: "tpl_edge_001",
      templateVersion: 1,
      status: "PUBLISHED",
      packageSha256: "abc",
    }),
  );
  await kv.put(
    `te_dg_${subject.subjectId}_tpl_edge_001`,
    JSON.stringify({
      subjectId: subject.subjectId,
      templateId: "tpl_edge_001",
      enabled: true,
      expiresAt: null,
      revokedAt: null,
    }),
  );
  await blob.set(
    "templates/tpl_edge_001/v1/package.jltpkg",
    new Uint8Array([1, 3, 5]),
  );
  await blob.set(
    "templates/tpl_edge_001/v1/preview.webp",
    new Uint8Array([2, 4]),
  );
  const headers = {
      authorization: `Bearer ${auth}`,
      "content-type": "application/json",
    },
    issued = await handleRequest(
      new Request("https://example.com/v1/templates/download-token", {
        method: "POST",
        headers,
        body: '{"templateId":"tpl_edge_001","templateVersion":1}',
      }),
      runtimeEnv,
      kv,
    ),
    token = (await issued.json()).downloadToken;
  assert.equal(issued.status, 200);
  const pkg = await handleRequest(
    new Request("https://example.com/v1/templates/package/tpl_edge_001", {
      headers: {
        authorization: headers.authorization,
        "x-jilu-download-token": token,
      },
    }),
    runtimeEnv,
    kv,
  );
  assert.equal(pkg.status, 200);
  assert.deepEqual([...new Uint8Array(await pkg.arrayBuffer())], [1, 3, 5]);
  assert.equal(blob.gets.at(-1).options.consistency, "strong");
  const preview = await handleRequest(
    new Request("https://example.com/v1/templates/preview/tpl_edge_001", {
      headers: { authorization: headers.authorization },
    }),
    runtimeEnv,
    kv,
  );
  assert.equal(preview.status, 200);
  const lease = await handleRequest(
    new Request("https://example.com/v1/templates/lease", {
      method: "POST",
      headers,
      body: '{"templateId":"tpl_edge_001","templateVersion":1}',
    }),
    runtimeEnv,
    kv,
  );
  assert.equal(lease.status, 200);
  const keys = await handleRequest(
    new Request("https://example.com/v2/public-keys"),
    runtimeEnv,
    kv,
  );
  assert.equal(keys.status, 200);
  assert.equal(JSON.stringify(await keys.json()).includes("privateKey"), false);
});
test("Edge admin publish route completes trusted publish and authorized download E2E", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ openid: "edge-publish-openid" });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const pair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]),
    privateKey = b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
    publicKey = b64(await crypto.subtle.exportKey("raw", pair.publicKey)),
    kv = new MemoryKv(),
    blob = new MemoryBlob(),
    publishEnv = {
      ...env,
      ADMIN_TOKEN: "edge-admin",
      TEMPLATE_BLOB: blob,
      JILU_TEMPLATE_DOWNLOAD_TOKEN_KEY: "edge-publish-download",
      JILU_TEMPLATE_PACKAGE_KEYS: JSON.stringify([
        { keyId: "edge-pkg-active", status: "ACTIVE", publicKey, privateKey },
      ]),
      JILU_TEMPLATE_LEASE_KEYS: "[]",
    },
    login = await handleRequest(
      new Request("https://example.com/v2/auth/wechat", {
        method: "POST",
        body: '{"loginCode":"valid"}',
      }),
      publishEnv,
      kv,
    ),
    session = (await login.json()).sessionToken,
    subject = JSON.parse(
      [...kv.data.entries()].find(([key]) => key.startsWith("subject_"))[1],
    ),
    admin = {
      authorization: "Bearer edge-admin",
      "content-type": "application/json",
    };
  let response = await handleRequest(
    new Request("https://example.com/admin/v1/templates", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        templateId: "tpl_publish_edge",
        visibility: "USER_RESTRICTED",
        category: "general",
        sortOrder: 0,
        latestVersion: 0,
        minimumSupportedVersion: 1,
        updatePolicy: "AUTO",
        name: "Edge Published",
        description: "E2E",
        tags: [],
        offlinePolicy: { allowed: true, leaseHours: 8 },
      }),
    }),
    publishEnv,
    kv,
  );
  assert.equal(response.status, 201);
  response = await handleRequest(
    new Request(
      "https://example.com/admin/v1/templates/tpl_publish_edge/versions",
      {
        method: "POST",
        headers: admin,
        body: JSON.stringify({
          templateVersion: 1,
          layout: { fields: [{ fieldId: "field_edge", type: "text" }] },
          assets: [],
        }),
      },
    ),
    publishEnv,
    kv,
  );
  assert.equal(response.status, 201);
  response = await handleRequest(
    new Request(
      "https://example.com/admin/v1/templates/tpl_publish_edge/user-grants",
      {
        method: "POST",
        headers: admin,
        body: JSON.stringify({ subjectId: subject.subjectId }),
      },
    ),
    publishEnv,
    kv,
  );
  assert.equal(response.status, 200);
  const published = await handleRequest(
      new Request(
        "https://example.com/admin/v1/templates/tpl_publish_edge/versions/1/publish",
        {
          method: "POST",
          headers: { ...admin, "x-request-id": "edge-e2e" },
          body: "{}",
        },
      ),
      publishEnv,
      kv,
    ),
    publishedBody = await published.json();
  assert.equal(published.status, 200, JSON.stringify(publishedBody));
  assert.equal(publishedBody.status, "PUBLISHED");
  const auth = {
      authorization: `Bearer ${session}`,
      "content-type": "application/json",
    },
    catalog = await handleRequest(
      new Request("https://example.com/v1/templates/catalog", {
        method: "POST",
        headers: auth,
        body: "{}",
      }),
      publishEnv,
      kv,
    );
  assert.equal(
    (await catalog.json()).items.some(
      (x) => x.templateId === "tpl_publish_edge",
    ),
    true,
  );
  const issued = await handleRequest(
      new Request("https://example.com/v1/templates/download-token", {
        method: "POST",
        headers: auth,
        body: '{"templateId":"tpl_publish_edge","templateVersion":1}',
      }),
      publishEnv,
      kv,
    ),
    token = (await issued.json()).downloadToken,
    download = await handleRequest(
      new Request("https://example.com/v1/templates/package/tpl_publish_edge", {
        headers: {
          authorization: auth.authorization,
          "x-jilu-download-token": token,
        },
      }),
      publishEnv,
      kv,
    ),
    packageBytes = new Uint8Array(await download.arrayBuffer()),
    keysResponse = await handleRequest(
      new Request("https://example.com/v2/public-keys"),
      publishEnv,
      kv,
    ),
    publicKeys = (await keysResponse.json()).keys;
  assert.equal(download.status, 200);
  assert.equal(
    (
      await validateTemplateBundle({
        bytes: packageBytes,
        expectedTemplateId: "tpl_publish_edge",
        expectedVersion: 1,
        rendererVersion: 2,
        keys: publicKeys.filter(
          (k) => k.purpose === "template-package-signing",
        ),
      })
    ).valid,
    true,
  );
  assert.equal(
    (
      await handleRequest(
        new Request(
          "https://example.com/templates/tpl_publish_edge/v1/package.jltpkg",
        ),
        publishEnv,
        kv,
      )
    ).status,
    404,
  );
});

test("EdgeOne Blob real handler conditionally commits registration and strong-reads retry", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ openid: "edge-p8c-openid" });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const make = async (purpose, keyId) => {
      const p = await crypto.subtle.generateKey("Ed25519", true, [
        "sign",
        "verify",
      ]);
      return {
        keyId,
        purpose,
        status: "ACTIVE",
        privateKey: b64(await crypto.subtle.exportKey("pkcs8", p.privateKey)),
        publicKey: b64(await crypto.subtle.exportKey("raw", p.publicKey)),
      };
    },
    capture = await make("capture-ticket-signing", "cap-p8c"),
    receipt = await make("provenance-receipt-signing", "receipt-p8c"),
    kv = new MemoryKv(),
    blob = new MemoryBlob(),
    runtimeEnv = {
      ...env,
      PROVENANCE_BLOB: blob,
      JILU_CAPTURE_TICKET_KEYS: JSON.stringify([capture]),
      JILU_PROVENANCE_RECEIPT_KEYS: JSON.stringify([receipt]),
      PLATFORM_NAME: "test",
      PROVENANCE_REQUIRE_INTEGRITY_V2: "true",
    },
    login = await handleRequest(
      new Request("https://example.com/v2/auth/wechat", {
        method: "POST",
        body: '{"loginCode":"valid"}',
      }),
      runtimeEnv,
      kv,
    ),
    token = (await login.json()).sessionToken,
    headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    issued = await handleRequest(
      new Request("https://example.com/v2/capture-ticket", {
        method: "POST",
        headers,
        body: '{"kind":"online","count":1}',
      }),
      runtimeEnv,
      kv,
    ).then((r) => r.json()),
    ticket = issued.tickets[0],
    request = {
      clientTaskId: "task_edgeone_123456",
      draft: phase8cDraft(ticket, await ticketDigest(ticket, crypto.subtle)),
      ticket,
    },
    call = (body) =>
      handleRequest(
        new Request("https://example.com/v2/provenance/register", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
        runtimeEnv,
        kv,
      );
  let response = await call(request),
    body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.result, "CREATED");
  assert.equal(
    (
      await validateReceipt({
        receipt: body.receipt,
        keys: [receipt],
        subtle: crypto.subtle,
      })
    ).valid,
    true,
  );
  const replay = await call(request).then((r) => r.json());
  assert.equal(replay.result, "IDEMPOTENT_REPLAY");
  assert.equal(replay.recordId, body.recordId);
  assert.equal(
    blob.gets.some(
      (x) =>
        x.key.includes("/commits/ticket/") &&
        x.options?.consistency === "strong",
    ),
    true,
  );
  const changed = structuredClone(request);
  changed.draft.location.name = "different";
  response = await call(changed);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "CAPTURE_TICKET_ALREADY_CONSUMED");
  assert.equal(
    [...blob.data.keys()].filter((k) => k.includes("/commits/ticket/")).length,
    1,
  );
  assert.equal(
    [...blob.data.keys()].filter((k) => k.includes("/band/")).length,
    8,
  );
  const authoritativeKey=[...blob.data.keys()].find(k=>k.includes('/record/')),authoritative=JSON.parse(Buffer.from(blob.data.get(authoritativeKey)).toString());
  assert.equal(authoritative.integrity.algorithm,'regional-integrity-v3');
  assert.equal(authoritative.watermarkIntegrity.algorithm,'watermark-integrity-v2');
  assert.deepEqual(authoritative.integrity.blocks,request.draft.integrity.blocks);
  assert.deepEqual(authoritative.watermarkIntegrity.blocks,request.draft.watermarkIntegrity.blocks);
  assert.equal(await validateStoredRecord(authoritative,crypto.subtle),true);
  assert.equal((await validateReceipt({receipt:authoritative.receipt,keys:[receipt],subtle:crypto.subtle})).valid,true);
  const preparedEvidence={verificationExchangeVersion:3,file:{algorithm:'sha256-v1',sha256:request.draft.binding.sha256},fingerprints:{dhash:{algorithm:'dhash256-v2',value:request.draft.binding.dhash256},phash:{algorithm:'phash256-v1',value:request.draft.binding.phash256},regional:request.draft.integrity},blindMarker:{algorithm:'jilu-blind-v2',protocolVersion:2,extracted:true,markerId:ticket.markerId,ticketDigest:await ticketDigest(ticket,crypto.subtle),flags:1,crcValid:true,confidence:.9}},prepareResponse=await handleRequest(new Request('https://example.com/v3/provenance/verify/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(preparedEvidence)}),runtimeEnv,kv),prepared=await prepareResponse.json();
  assert.equal(prepareResponse.status,200,JSON.stringify(prepared));
  assert.equal(prepareResponse.headers.get('cache-control'),'no-store');
  assert.equal(prepared.watermarkContexts.length,1);
  assert.equal(/subjectId|recordId|location|photoBytes|fileBytes/.test(JSON.stringify(prepared)),false);
  const context=prepared.watermarkContexts[0],finalRequest={verificationExchangeVersion:3,preparedEvidence,preparedEvidenceDigest:prepared.preparedEvidenceDigest,contextSetDigest:prepared.contextSetDigest,watermarkEvidenceContexts:[{...context,fingerprint:{...request.draft.watermarkIntegrity,bounds:context.bounds}}]},finalResponse=await handleRequest(new Request('https://example.com/v3/provenance/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(finalRequest)}),runtimeEnv,kv),final=await finalResponse.json();
  assert.equal(finalResponse.status,200,JSON.stringify(final));
  assert.equal(finalResponse.headers.get('cache-control'),'no-store');
  assert.equal(final.status,'EXACT_FILE');
  assert.equal(/imageBase64|photoBytes|fileBytes|data:image/.test(JSON.stringify(finalRequest)),false);
  const tampered=structuredClone(finalRequest);tampered.watermarkEvidenceContexts[0].bounds.x=.2;const tamperedResponse=await handleRequest(new Request('https://example.com/v3/provenance/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(tampered)}),runtimeEnv,kv);assert.equal([400,409].includes(tamperedResponse.status),true);assert.equal(['PROVENANCE_VERIFY_V3_REQUEST_INVALID','VERIFICATION_CONTEXT_MISMATCH'].includes((await tamperedResponse.json()).code),true);
  const malformed=structuredClone(finalRequest);malformed.watermarkEvidenceContexts[0].fingerprint.blocks[0].descriptor='!';const malformedResponse=await handleRequest(new Request('https://example.com/v3/provenance/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(malformed)}),runtimeEnv,kv);assert.equal(malformedResponse.status,400);assert.equal((await malformedResponse.json()).code,'PROVENANCE_VERIFY_V3_REQUEST_INVALID');
  const oversizedResponse=await handleRequest(new Request('https://example.com/v3/provenance/verify/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({padding:'x'.repeat(128*1024)})}),runtimeEnv,kv);assert.equal(oversizedResponse.status,413);assert.equal((await oversizedResponse.json()).code,'PAYLOAD_TOO_LARGE');
});

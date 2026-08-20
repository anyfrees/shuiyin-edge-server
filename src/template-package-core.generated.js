// @ts-nocheck -- generated from shared template-package-core
// packages/template-package-core/src/storage.js
var failure = (code) => Object.assign(new Error(code), { code });
var key = (id, v, type) => {
  if (!/^tpl_[a-z0-9_-]{3,80}$/.test(id) || !Number.isInteger(v) || v < 1) throw failure("TEMPLATE_PACKAGE_INVALID");
  return `templates/${id}/v${v}/${type}`;
};
var parseRef = (ref) => {
  const m = String(ref).match(/^templates\/(tpl_[a-z0-9_-]{3,80})\/v(\d+)\/package\.jltpkg$/);
  if (!m) throw failure("TEMPLATE_PACKAGE_INVALID");
  return { id: m[1], version: Number(m[2]) };
};
var Contract = class {
  objectRef(id, v) {
    return key(id, v, "package.jltpkg");
  }
  async deleteObject(ref) {
    const x = parseRef(ref);
    return this.deletePackage(x.id, x.version);
  }
};
var MemoryTemplateObjectStorage = class extends Contract {
  constructor({ now = () => Date.now() } = {}) {
    super();
    this.data = /* @__PURE__ */ new Map();
    this.created = /* @__PURE__ */ new Map();
    this.now = now;
  }
  async putPackage(id, v, b) {
    const k = this.objectRef(id, v);
    if (this.data.has(k)) throw failure("TEMPLATE_VERSION_CONFLICT");
    this.data.set(k, b);
    this.created.set(k, this.now());
    return k;
  }
  async getPackage(id, v) {
    return this.data.get(this.objectRef(id, v)) || null;
  }
  async putPreview(id, v, b) {
    this.data.set(key(id, v, "preview.webp"), b);
  }
  async getPreview(id, v) {
    return this.data.get(key(id, v, "preview.webp")) || null;
  }
  async deletePackage(id, v) {
    const k = this.objectRef(id, v);
    this.created.delete(k);
    return this.data.delete(k);
  }
  async deletePreview(id, v) {
    this.data.delete(key(id, v, "preview.webp"));
  }
  async exists(id, v) {
    return this.data.has(this.objectRef(id, v));
  }
  async getMetadata(id, v) {
    const k = this.objectRef(id, v), b = this.data.get(k);
    return b ? { size: b.byteLength, createdAt: this.created.get(k), objectRef: k } : null;
  }
  async listPackages() {
    return [...this.data.entries()].filter(([k]) => k.endsWith("/package.jltpkg")).map(([objectRef, b]) => ({ objectRef, safeId: objectRef, size: b.byteLength, createdAt: this.created.get(objectRef) }));
  }
};
var CloudflareR2TemplateStorage = class extends Contract {
  constructor(bucket) {
    super();
    if (!bucket) throw failure("OBJECT_STORAGE_NOT_CONFIGURED");
    this.bucket = bucket;
  }
  async putPackage(id, v, b) {
    const k = this.objectRef(id, v), old = await this.bucket.head(k);
    if (old) throw failure("TEMPLATE_VERSION_CONFLICT");
    await this.bucket.put(k, b, { httpMetadata: { contentType: "application/vnd.jilu.template+json" }, customMetadata: { jiluImmutable: "1" } });
    return k;
  }
  async getPackage(id, v) {
    const x = await this.bucket.get(this.objectRef(id, v));
    return x ? new Uint8Array(await x.arrayBuffer()) : null;
  }
  async putPreview(id, v, b) {
    await this.bucket.put(key(id, v, "preview.webp"), b, { httpMetadata: { contentType: "image/webp" } });
  }
  async getPreview(id, v) {
    const x = await this.bucket.get(key(id, v, "preview.webp"));
    return x ? new Uint8Array(await x.arrayBuffer()) : null;
  }
  async deletePackage(id, v) {
    return this.bucket.delete(this.objectRef(id, v));
  }
  async exists(id, v) {
    return Boolean(await this.bucket.head(this.objectRef(id, v)));
  }
  async getMetadata(id, v) {
    return this.bucket.head(this.objectRef(id, v));
  }
  async listPackages() {
    const out = [];
    let cursor;
    do {
      const page = await this.bucket.list({ prefix: "templates/", ...cursor ? { cursor } : {} });
      for (const x of page.objects || []) if (x.key.endsWith("/package.jltpkg")) out.push({ objectRef: x.key, safeId: x.key, size: x.size, createdAt: new Date(x.uploaded || 0).getTime() });
      cursor = page.truncated ? page.cursor : null;
    } while (cursor);
    return out;
  }
};
var EdgeOneBlobTemplateStorage = class extends Contract {
  constructor(store) {
    super();
    if (!store) throw failure("OBJECT_STORAGE_NOT_CONFIGURED");
    this.store = store;
  }
  async putPackage(id, v, b) {
    const k = this.objectRef(id, v);
    await this.store.set(k, b, { onlyIfNew: true });
    return k;
  }
  async getPackage(id, v) {
    const x = await this.store.get(this.objectRef(id, v), { consistency: "strong" });
    return x ? new Uint8Array(await x.arrayBuffer?.() || x) : null;
  }
  async putPreview(id, v, b) {
    await this.store.set(key(id, v, "preview.webp"), b);
  }
  async getPreview(id, v) {
    const x = await this.store.get(key(id, v, "preview.webp"), { consistency: "strong" });
    return x ? new Uint8Array(await x.arrayBuffer?.() || x) : null;
  }
  async deletePackage(id, v) {
    return this.store.delete(this.objectRef(id, v));
  }
  async exists(id, v) {
    return Boolean(await this.store.get(this.objectRef(id, v), { consistency: "strong" }));
  }
  async getMetadata(id, v) {
    const x = await this.store.getWithHeaders?.(this.objectRef(id, v), { consistency: "strong" });
    if (x) return x;
    const b = await this.getPackage(id, v);
    return b ? { size: b.byteLength } : null;
  }
  async listPackages() {
    if (typeof this.store.list !== "function") throw failure("CAPABILITY_NOT_SUPPORTED");
    const out = [];
    let cursor;
    do {
      const page = await this.store.list({ prefix: "templates/", ...cursor ? { cursor } : {} }), items = page.blobs || page.objects || page.items || [];
      out.push(...items.filter((x) => (x.key || x.name).endsWith("/package.jltpkg")).map((x) => ({ objectRef: x.key || x.name, safeId: x.key || x.name, size: x.size, createdAt: new Date(x.uploadedAt || x.uploaded || x.createdAt || 0).getTime() })));
      cursor = page.hasMore || page.truncated ? page.cursor : null;
    } while (cursor);
    return out;
  }
};
var AlibabaEsaTemplateStorage = class {
  constructor(storage) {
    if (!storage) throw failure("OBJECT_STORAGE_NOT_CONFIGURED");
    this.storage = storage;
  }
};

// packages/template-entitlement-core/src/http.js
var enc = new TextEncoder();

// packages/template-entitlement-core/src/index.js
var VISIBILITIES = ["PUBLIC", "AUTHENTICATED", "USER_RESTRICTED", "GROUP_RESTRICTED", "INTERNAL", "DISABLED"];
var UPDATE_POLICIES = ["AUTO", "PROMPT", "FORCED"];
var VERSION_STATUSES = ["DRAFT", "PUBLISHED", "RETIRED"];
var active = (x, now) => Boolean(x && x.enabled !== false && !x.revokedAt && (x.expiresAt == null || Number(x.expiresAt) > now));
var TEMPLATE_VISIBILITY = Object.freeze(Object.fromEntries(VISIBILITIES.map((x) => [x, x])));
var TEMPLATE_UPDATE_POLICY = Object.freeze(Object.fromEntries(UPDATE_POLICIES.map((x) => [x, x])));
var TEMPLATE_VERSION_STATUS = Object.freeze(Object.fromEntries(VERSION_STATUSES.map((x) => [x, x])));
var evaluateTemplateAccess = ({ template, subject, directGrant, memberships = [], groups = [], groupGrants = [], now = Date.now() }) => {
  const deny = (reason) => ({ allowed: false, reason, entitlementType: null, expiresAt: null }), allow = (reason, type, expiresAt = null) => ({ allowed: true, reason, entitlementType: type, expiresAt });
  if (!template || template.enabled !== true || template.visibility === "DISABLED" || template.deletedAt || template.archivedAt || template.lifecycleStatus === "FAILED" || !Number.isInteger(Number(template.latestVersion)) || Number(template.latestVersion) < 1) return deny("TEMPLATE_NOT_PUBLISHED");
  if (!subject || subject.status !== "active") return deny("SUBJECT_DISABLED");
  if (template.visibility === "PUBLIC") return allow("PUBLIC", "PUBLIC");
  if (subject.anonymous === true) return deny("NOT_ENTITLED");
  if (template.visibility === "AUTHENTICATED") return allow("AUTHENTICATED", "AUTHENTICATED");
  if (template.visibility === "INTERNAL") return subject.internal === true ? allow("INTERNAL", "INTERNAL") : deny("NOT_ENTITLED");
  if (template.visibility === "USER_RESTRICTED") return active(directGrant, now) ? allow("DIRECT_GRANT", "USER_RESTRICTED", directGrant.expiresAt ?? null) : deny("NOT_ENTITLED");
  if (template.visibility === "GROUP_RESTRICTED") for (const membership of memberships) {
    if (!active(membership, now) || membership.subjectId !== subject.subjectId) continue;
    const group = groups.find((x) => x.groupId === membership.groupId);
    const grant = groupGrants.find((x) => x.groupId === membership.groupId && x.templateId === template.templateId);
    if (group?.enabled === true && active(grant, now)) {
      const expiries = [membership.expiresAt, grant.expiresAt].filter((x) => x != null);
      return allow("GROUP_GRANT", "GROUP_RESTRICTED", expiries.length ? Math.min(...expiries) : null);
    }
  }
  return deny("NOT_ENTITLED");
};

// packages/template-package-core/src/runtime.js
var fail = (code, status = 400) => Object.assign(new Error(code), { code, status });
var safeId = (id) => /^tpl_[a-z0-9_-]{3,80}$/.test(String(id || ""));
var noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Vary": "Authorization" };
var restricted = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Authorization" };
var json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { ...noStore, ...headers } });
var unavailable = () => fail("TEMPLATE_NOT_AVAILABLE", 404);
var asBytes = (value) => value instanceof Uint8Array ? value : new Uint8Array(value);
var TEMPLATE_RUNTIME_DEFAULTS = Object.freeze({ downloadTokenTtlMs: 18e4, maxLeaseHours: 168, publicKeysMaxAge: 300 });
var TemplateRuntimeService = class {
  constructor({ entitlementService, repository, storage, downloadTokenKey, packageKeys = [], leaseKeys = [], additionalPublicKeys = [], now = () => Date.now(), downloadTokenTtlMs = TEMPLATE_RUNTIME_DEFAULTS.downloadTokenTtlMs, maxLeaseHours = TEMPLATE_RUNTIME_DEFAULTS.maxLeaseHours }) {
    Object.assign(this, { entitlementService, repository, storage, downloadTokenKey, packageKeys, leaseKeys, additionalPublicKeys, now, downloadTokenTtlMs, maxLeaseHours });
  }
  async authorized(subject, templateId, templateVersion) {
    if (!subject || subject.status !== "active") throw fail("SUBJECT_DISABLED", 403);
    if (!safeId(templateId)) throw unavailable();
    const ctx = await this.entitlementService.context(subject, templateId), access = evaluateTemplateAccess(ctx), version = await this.repository.getVersion(templateId, Number(templateVersion));
    if (!access.allowed || !version || version.status !== "PUBLISHED" || version.templateVersion !== Number(templateVersion)) throw unavailable();
    return { ctx, access, version, epoch: await this.repository.getEpoch(templateId) };
  }
  async downloadToken(subject, { templateId, templateVersion }) {
    if (!this.downloadTokenKey) throw fail("TEMPLATE_DOWNLOAD_TOKEN_KEY_NOT_CONFIGURED", 503);
    const x = await this.authorized(subject, templateId, templateVersion), issuedAt = this.now();
    return { downloadToken: await issueDownloadToken({ subjectId: subject.subjectId, templateId, templateVersion: Number(templateVersion), entitlementEpoch: x.epoch, issuedAt, expiresAt: issuedAt + this.downloadTokenTtlMs }, this.downloadTokenKey), expiresAt: issuedAt + this.downloadTokenTtlMs };
  }
  async package(subject, templateId, token, { requestId = "", appVersion = "" } = {}) {
    if (!this.storage) throw fail("OBJECT_STORAGE_NOT_CONFIGURED", 503);
    if (!this.downloadTokenKey) throw fail("TEMPLATE_DOWNLOAD_TOKEN_KEY_NOT_CONFIGURED", 503);
    const payload = await verifyDownloadToken(token, this.downloadTokenKey, this.now());
    if (payload.subjectId !== subject?.subjectId) throw fail("TEMPLATE_DOWNLOAD_TOKEN_INVALID", 401);
    if (payload.templateId !== templateId) throw fail("TEMPLATE_DOWNLOAD_TOKEN_INVALID", 401);
    const x = await this.authorized(subject, templateId, payload.templateVersion);
    if (x.epoch !== payload.entitlementEpoch) throw fail("TEMPLATE_DOWNLOAD_TOKEN_INVALID", 401);
    const bytes2 = await this.storage.getPackage(templateId, payload.templateVersion);
    if (!bytes2) throw fail("TEMPLATE_PACKAGE_NOT_AVAILABLE", 404);
    await this.repository.appendAudit({ eventId: `evt_${crypto.randomUUID().replace(/-/g, "")}`, eventType: "TEMPLATE_PACKAGE_DOWNLOADED", actorId: subject.subjectId, subjectId: subject.subjectId, templateId, templateVersion: payload.templateVersion, timestamp: this.now(), requestId: String(requestId).slice(0, 128), appVersion: String(appVersion).slice(0, 64) });
    return { bytes: asBytes(bytes2), version: x.version, templateVersion: payload.templateVersion };
  }
  async preview(subject, templateId, templateVersion) {
    if (!this.storage) throw fail("OBJECT_STORAGE_NOT_CONFIGURED", 503);
    const version = Number(templateVersion) || Number((await this.repository.getTemplate(templateId))?.latestVersion), x = await this.authorized(subject, templateId, version), bytes2 = await this.storage.getPreview?.(templateId, version);
    if (!bytes2) throw fail("TEMPLATE_PACKAGE_NOT_AVAILABLE", 404);
    return { bytes: asBytes(bytes2), templateVersion: version, version: x.version };
  }
  activeLeaseKey() {
    const key2 = this.leaseKeys.find((x) => x.status === "ACTIVE" && x.privateKey);
    if (!key2) throw fail("TEMPLATE_SIGNATURE_KEY_UNKNOWN", 503);
    return key2;
  }
  async lease(subject, { templateId, templateVersion }) {
    const x = await this.authorized(subject, templateId, templateVersion), policy = x.ctx.template.offlinePolicy || {};
    if (!policy.allowed) throw fail("TEMPLATE_LEASE_NOT_ALLOWED", 403);
    const key2 = this.activeLeaseKey(), issuedAt = this.now(), hours = Math.min(this.maxLeaseHours, Math.max(0, Number(policy.leaseHours) || 0));
    if (!hours) throw fail("TEMPLATE_LEASE_NOT_ALLOWED", 403);
    return issueLease({ keyId: key2.keyId, privateKey: key2.privateKey, lease: { subjectId: subject.subjectId, templateId, templateVersion: Number(templateVersion), entitlementEpoch: x.epoch, issuedAt, expiresAt: issuedAt + hours * 36e5 } });
  }
  async renew(subject, { lease }) {
    if (!lease || lease.subjectId !== subject?.subjectId) throw fail("TEMPLATE_LEASE_INVALID", 401);
    const x = await this.authorized(subject, lease.templateId, lease.templateVersion);
    await verifyLease({ lease, keys: this.leaseKeys, now: this.now(), subjectId: subject.subjectId, templateId: lease.templateId, templateVersion: lease.templateVersion, entitlementEpoch: x.epoch });
    return this.lease(subject, { templateId: lease.templateId, templateVersion: lease.templateVersion });
  }
  publicKeys() {
    return [...this.packageKeys.map((x) => ({ ...x, purpose: "template-package-signing" })), ...this.leaseKeys.map((x) => ({ ...x, purpose: "template-entitlement-lease" })), ...this.additionalPublicKeys].filter((x) => ["ACTIVE", "VERIFY_ONLY"].includes(x.status)).map(({ keyId, purpose, algorithm = "Ed25519", status, publicKey }) => ({ keyId, purpose, algorithm, status, publicKey }));
  }
};
var statusFor = (code) => ({ TEMPLATE_NOT_AVAILABLE: 404, TEMPLATE_PACKAGE_NOT_AVAILABLE: 404, TEMPLATE_DOWNLOAD_TOKEN_INVALID: 401, TEMPLATE_DOWNLOAD_TOKEN_EXPIRED: 401, TEMPLATE_LEASE_INVALID: 401, TEMPLATE_LEASE_EXPIRED: 401, TEMPLATE_LEASE_NOT_ALLOWED: 403, SUBJECT_DISABLED: 403, OBJECT_STORAGE_NOT_CONFIGURED: 503, TEMPLATE_DOWNLOAD_TOKEN_KEY_NOT_CONFIGURED: 503, TEMPLATE_SIGNATURE_KEY_UNKNOWN: 503, RATE_LIMITED: 429 })[code] || 400;
var createTemplateRuntimeHttpHandler = ({ service, authenticate, limits = {}, now = () => Date.now() }) => {
  const rates = /* @__PURE__ */ new Map(), defaults = { downloadToken: 30, package: 60, preview: 60, leaseIssue: 20, leaseRenew: 20, publicKeys: 240, ...limits };
  return async (request) => {
    const url = new URL(request.url), p = url.pathname, m = request.method;
    let bucket = p === "/v1/templates/download-token" ? "downloadToken" : p.startsWith("/v1/templates/package/") ? "package" : p.startsWith("/v1/templates/preview/") ? "preview" : p === "/v1/templates/lease" ? "leaseIssue" : p === "/v1/templates/lease/renew" ? "leaseRenew" : p === "/v2/public-keys" ? "publicKeys" : null;
    if (!bucket) return json({ ok: false, code: "NOT_FOUND" }, 404);
    try {
      let subject = null;
      if (bucket !== "publicKeys") subject = await authenticate(request);
      const rateKey = `${bucket}:${subject?.subjectId || request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "anonymous"}`, time = now(), state = rates.get(rateKey), limit = defaults[bucket];
      if (!state || state.resetAt <= time) rates.set(rateKey, { count: 1, resetAt: time + 6e4 });
      else if (++state.count > limit) return json({ ok: false, code: "RATE_LIMITED" }, 429, { "Retry-After": String(Math.max(1, Math.ceil((state.resetAt - time) / 1e3))) });
      if (bucket === "publicKeys" && m === "GET") return json({ keys: service.publicKeys() }, 200, { "Cache-Control": `public, max-age=${TEMPLATE_RUNTIME_DEFAULTS.publicKeysMaxAge}`, "Vary": "Accept-Encoding" });
      const body = ["GET", "HEAD"].includes(m) ? {} : await request.json().catch(() => {
        throw fail("INVALID_JSON");
      });
      if (bucket === "downloadToken" && m === "POST") return json({ ok: true, ...await service.downloadToken(subject, body) });
      if (bucket === "package" && m === "GET") {
        const id = decodeURIComponent(p.slice("/v1/templates/package/".length)), x = await service.package(subject, id, request.headers.get("x-jilu-download-token") || url.searchParams.get("token") || "", { requestId: request.headers.get("x-request-id") || "", appVersion: request.headers.get("x-jilu-app-version") || "" }), name = `jilu-template-${id.replace(/[^a-z0-9_-]/g, "_")}-v${x.templateVersion}.jltpkg`;
        return new Response(x.bytes, { status: 200, headers: { ...restricted, "Content-Type": "application/vnd.jilu.template+json", "Content-Length": String(x.bytes.byteLength), "Content-Disposition": `attachment; filename="${name}"`, "X-JILU-Template-ID": id, "X-JILU-Template-Version": String(x.templateVersion), ...x.version.packageSha256 ? { "ETag": `"sha256-${x.version.packageSha256}"`, "Digest": `sha-256=${x.version.packageSha256}` } : {} } });
      }
      if (bucket === "preview" && m === "GET") {
        const id = decodeURIComponent(p.slice("/v1/templates/preview/".length)), x = await service.preview(subject, id, url.searchParams.get("version"));
        return new Response(x.bytes, { status: 200, headers: { ...restricted, "Content-Type": "image/webp", "Content-Length": String(x.bytes.byteLength), "X-JILU-Template-ID": id, "X-JILU-Template-Version": String(x.templateVersion) } });
      }
      if (bucket === "leaseIssue" && m === "POST") return json({ ok: true, lease: await service.lease(subject, body) });
      if (bucket === "leaseRenew" && m === "POST") return json({ ok: true, lease: await service.renew(subject, body) });
      return json({ ok: false, code: "NOT_FOUND" }, 404);
    } catch (error) {
      const code = error?.code || "TEMPLATE_NOT_AVAILABLE";
      return json({ ok: false, code }, error?.status || statusFor(code));
    }
  };
};

// packages/template-package-core/src/publish.js
var fail2 = (code, status = 400, cause) => Object.assign(new Error(code, { cause }), { code, status });
var bytes = (value) => value instanceof Uint8Array ? value : typeof value === "string" ? Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), (c) => c.charCodeAt(0)) : new Uint8Array(value || []);
var PUBLISH_OPERATION_STATUS = Object.freeze({ BUILDING: "BUILDING", UPLOADED: "UPLOADED", VERIFIED: "VERIFIED", COMMITTING: "COMMITTING", COMPLETED: "COMPLETED", AUDIT_PENDING: "AUDIT_PENDING", FAILED: "FAILED" });
var TemplatePublishService = class {
  constructor({ repository, storage, packageKeys = [], now = () => Date.now(), operationId = () => `pop_${crypto.randomUUID().replace(/-/g, "")}`, builder = buildTemplateBundle, validator = validateTemplateBundle }) {
    Object.assign(this, { repository, storage, packageKeys, now, operationId, builder, validator });
  }
  activeKey() {
    const key2 = this.packageKeys.find((x) => x.status === "ACTIVE" && x.privateKey && x.publicKey);
    if (!key2) throw fail2("TEMPLATE_SIGNING_KEY_UNAVAILABLE", 503);
    return key2;
  }
  async publish({ templateId, templateVersion, actorId = "admin", requestId = "" }) {
    if (!this.storage) throw fail2("OBJECT_STORAGE_NOT_CONFIGURED", 503);
    const template = await this.repository.getTemplate(templateId), version = await this.repository.getVersion(templateId, Number(templateVersion));
    if (!template) throw fail2("TEMPLATE_NOT_AVAILABLE", 404);
    if (!version) throw fail2("TEMPLATE_VERSION_NOT_FOUND", 404);
    if (version.status === "PUBLISHED" && version.contentDigest && version.artifactSha256) return { ...this.response(version), idempotent: true };
    if (version.status !== "DRAFT") throw fail2("TEMPLATE_VERSION_NOT_DRAFT", 409);
    const opId = this.operationId(), op = { operationId: opId, templateId, templateVersion: Number(templateVersion), status: "BUILDING", actorId, requestId: String(requestId).slice(0, 128), createdAt: this.now(), updatedAt: this.now() };
    await this.repository.savePublishOperation(op);
    let built, uploaded = false;
    try {
      this.validateTemplate(template);
      const key2 = this.activeKey(), draft = version.draft || {};
      built = await this.builder({ templateId, templateVersion: Number(templateVersion), name: template.name, description: template.description, layout: draft.layout, assets: (draft.assets || []).map((a) => ({ ...a, bytes: bytes(a.bytes ?? a.data) })), createdAt: version.createdAt || 0, keyId: key2.keyId, privateKey: key2.privateKey });
      await this.validator({ bytes: built.bytes, expectedTemplateId: templateId, expectedVersion: Number(templateVersion), rendererVersion: 2, keys: this.packageKeys });
      const existing = await this.storage.getPackage(templateId, Number(templateVersion));
      if (existing) {
        const remote2 = await this.validateRemote(existing, built, templateId, Number(templateVersion));
        if (!remote2) throw fail2("TEMPLATE_VERSION_CONFLICT", 409);
      } else {
        try {
          await this.storage.putPackage(templateId, Number(templateVersion), built.bytes);
          uploaded = true;
        } catch (error) {
          if (error?.code === "TEMPLATE_VERSION_CONFLICT") {
            const remote2 = await this.storage.getPackage(templateId, Number(templateVersion));
            if (!remote2 || !await this.validateRemote(remote2, built, templateId, Number(templateVersion))) throw fail2("TEMPLATE_VERSION_CONFLICT", 409);
          } else throw fail2("TEMPLATE_STORAGE_UPLOAD_FAILED", 502, error);
        }
      }
      await this.updateOp(op, "UPLOADED", { artifactSha256: built.artifactSha256, contentDigest: built.contentDigest, objectRef: this.storage.objectRef?.(templateId, Number(templateVersion)) || `template:${templateId}:v${templateVersion}` });
      const remote = await this.storage.getPackage(templateId, Number(templateVersion)), metadata = await this.storage.getMetadata(templateId, Number(templateVersion));
      if (!remote || Number(metadata?.size ?? remote.byteLength) !== built.bytes.byteLength || !await this.validateRemote(remote, built, templateId, Number(templateVersion))) throw fail2("TEMPLATE_STORAGE_VERIFY_FAILED", 502);
      await this.updateOp(op, "VERIFIED");
      const publishedAt = this.now(), published = { ...version, status: "PUBLISHED", previewLayout: structuredClone(draft.layout), contentDigest: built.contentDigest, artifactSha256: built.artifactSha256, packageSha256: built.artifactSha256, packageSize: built.bytes.byteLength, signature: built.manifest.signature.value, packageSignature: built.manifest.signature.value, signatureKeyId: key2.keyId, packageKeyId: key2.keyId, internalObjectRef: op.objectRef, publishedAt, publishedBy: actorId, draft: void 0 }, audit = { eventId: `evt_${crypto.randomUUID().replace(/-/g, "")}`, eventType: "TEMPLATE_VERSION_PUBLISHED", actorId, templateId, templateVersion: Number(templateVersion), contentDigest: built.contentDigest, artifactSha256: built.artifactSha256, timestamp: publishedAt, operationId: opId, requestId: String(requestId).slice(0, 128) };
      await this.updateOp(op, "COMMITTING");
      try {
        await this.repository.commitPublished({ version: published, template: { ...template, latestVersion: Math.max(Number(template.latestVersion) || 0, Number(templateVersion)), updatedAt: publishedAt, publishedAt }, audit, operation: { ...op, status: "COMPLETED", updatedAt: this.now() } });
      } catch (error) {
        await this.updateOp(op, "FAILED", { errorCode: "TEMPLATE_PUBLISH_COMMIT_FAILED" }).catch(() => {
        });
        throw fail2("TEMPLATE_PUBLISH_COMMIT_FAILED", 500, error);
      }
      return this.response(published);
    } catch (error) {
      if (!["COMPLETED", "FAILED"].includes(op.status)) await this.updateOp(op, "FAILED", { errorCode: error?.code || "TEMPLATE_PACKAGE_INVALID", uploaded }).catch(() => {
      });
      throw error?.code ? error : fail2("TEMPLATE_PACKAGE_INVALID", 400, error);
    }
  }
  validateTemplate(t) {
    if (!t || !/^tpl_[a-z0-9_-]{3,80}$/.test(t.templateId) || !String(t.name || "").trim() || !["PUBLIC", "AUTHENTICATED", "USER_RESTRICTED", "GROUP_RESTRICTED", "INTERNAL", "DISABLED"].includes(t.visibility)) throw fail2("TEMPLATE_PACKAGE_INVALID");
  }
  async validateRemote(remote, built, id, v) {
    try {
      const data = remote instanceof Uint8Array ? remote : new Uint8Array(remote);
      if (data.byteLength !== built.bytes.byteLength) return false;
      const checked = await this.validator({ bytes: data, expectedTemplateId: id, expectedVersion: v, rendererVersion: 2, keys: this.packageKeys });
      return checked.manifest.artifactSha256 === built.artifactSha256 && checked.manifest.contentDigest === built.contentDigest;
    } catch {
      return false;
    }
  }
  async updateOp(op, status, patch = {}) {
    Object.assign(op, patch, { status, updatedAt: this.now() });
    await this.repository.savePublishOperation(op);
    return op;
  }
  response(v) {
    return { ok: true, templateId: v.templateId, templateVersion: v.templateVersion, status: "PUBLISHED", contentDigest: v.contentDigest, artifactSha256: v.artifactSha256, publishedAt: v.publishedAt };
  }
};
var cleanupOrphanPackages = async ({ repository, storage, execute = false, olderThanMs = 24 * 36e5, now = Date.now() }) => {
  if (!storage) throw fail2("OBJECT_STORAGE_NOT_CONFIGURED", 503);
  if (typeof storage.listPackages !== "function" || typeof storage.deleteObject !== "function") throw fail2("CAPABILITY_NOT_SUPPORTED", 501);
  const objects = await storage.listPackages(), out = [];
  for (const object of objects) {
    const age = Math.max(0, now - Number(object.createdAt || now)), referenced = await repository.isObjectReferenced(object.objectRef);
    if (!referenced && age >= olderThanMs) {
      const item = { objectKey: object.safeId || object.objectRef, ageMs: age, reason: "NO_PUBLISHED_VERSION_REFERENCE", referenced: false, estimatedBytes: Number(object.size) || 0, deleted: false };
      if (execute && !await repository.isObjectReferenced(object.objectRef)) {
        await storage.deleteObject(object.objectRef);
        item.deleted = true;
      }
      out.push(item);
    }
  }
  return { dryRun: !execute, objectCount: out.length, estimatedBytes: out.reduce((n, x) => n + x.estimatedBytes, 0), objects: out };
};
var recoverPublishOperations = async ({ repository, storage }) => {
  const ops = await repository.listPublishOperations?.(["UPLOADED", "VERIFIED", "COMMITTING", "AUDIT_PENDING", "FAILED"]) || [], result = [];
  for (const op of ops) {
    const version = await repository.getVersion(op.templateId, op.templateVersion);
    if (version?.status === "PUBLISHED") {
      if (op.status !== "COMPLETED") await repository.savePublishOperation({ ...op, status: "COMPLETED", updatedAt: Date.now() });
      result.push({ operationId: op.operationId, status: "COMPLETED" });
    } else result.push({ operationId: op.operationId, status: "ORPHAN_CANDIDATE" });
  }
  return result;
};

// packages/template-package-core/src/index.js
var enc2 = new TextEncoder();
var dec = new TextDecoder();
var hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
var b64 = (b) => {
  let s = "";
  for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
var unb64 = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));
var canonical = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map((x) => x === void 0 ? "null" : canonical(x)).join(",")}]` : `{${Object.keys(v).filter((k) => v[k] !== void 0).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
var sha = async (b) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", b instanceof Uint8Array ? b : enc2.encode(b))));
var err = (code) => Object.assign(new Error(code), { code });
var safePath = (p) => typeof p === "string" && !p.includes("..") && !p.includes("\\") && !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && /^[\x20-\x7e]+$/.test(p);
var PACKAGE_LIMITS = Object.freeze({ package: 10 * 1024 * 1024, assetCount: 32, asset: 5 * 1024 * 1024, manifest: 64 * 1024, layout: 256 * 1024 });
var MIME_ALLOWLIST = Object.freeze(["image/png", "image/jpeg", "image/webp"]);
var WEB_DIY_FORMAT = "xianchang-jilu-watermark-scheme";
var WEB_DIY_VERSION = 1;
var officialTypes = /* @__PURE__ */ new Set(["text", "single-select", "multi-select", "person", "system-time", "location", "system-weather", "image", "logo", "custom-text"]);
var typeAliases = { time: "system-time", date: "system-time", location: "location", weather: "system-weather", person: "person", logo: "logo" };
var parseWebDiyExport = (value) => {
  let raw;
  try {
    raw = typeof value === "string" ? JSON.parse(value.replace(/^\uFEFF/, "")) : structuredClone(value);
  } catch {
    throw err("TEMPLATE_JSON_INVALID");
  }
  if (raw?.format && raw.format !== WEB_DIY_FORMAT) throw err("TEMPLATE_FORMAT_UNSUPPORTED");
  if (raw?.version != null && Number(raw.version) !== WEB_DIY_VERSION) throw err("TEMPLATE_VERSION_UNSUPPORTED");
  return raw;
};
var normalizeWebDiyExport = (value) => {
  const raw = parseWebDiyExport(value), source = raw?.layout || raw?.scheme || raw?.template || raw, sourceFields = Array.isArray(source?.fields) ? source.fields : Array.isArray(source?.elements) ? source.elements : Array.isArray(source?.textLayout) ? source.textLayout : [];
  if (!source || !sourceFields.length) throw err("TEMPLATE_PACKAGE_INVALID");
  const used = /* @__PURE__ */ new Set(), fields = sourceFields.filter((f) => f?.enabled !== false).map((f, i) => {
    const stem = String(f.fieldId || f.key || `item_${i + 1}`).toLowerCase().replace(/^field_/, "").replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56);
    let fieldId = `field_${stem || `item_${i + 1}`}`;
    while (used.has(fieldId)) fieldId = `${fieldId.slice(0, 60)}_${i + 1}`;
    used.add(fieldId);
    return { ...f, fieldId, type: officialTypes.has(f.type) ? f.type : typeAliases[f.key] || "text", label: String(f.label || f.sample || `\u680F\u76EE ${i + 1}`).slice(0, 120) };
  }), assets = Array.isArray(raw.assets) ? raw.assets : Object.entries(raw.assets || {}).filter(([, a]) => a?.data).map(([id, a]) => {
    const ext = /^(png|jpe?g|webp)$/i.test(a.ext) ? a.ext.toLowerCase().replace("jpeg", "jpg") : "png";
    return { id, path: `assets/${id}.${ext}`, mimeType: ext === "jpg" ? "image/jpeg" : `image/${ext}`, data: a.data };
  });
  return { layout: { ...source, identity: "OFFICIAL", origin: "official", customTemplateId: void 0, fields }, assets };
};
var validateLayout = (layout) => {
  if (!layout || !Array.isArray(layout.fields)) throw err("TEMPLATE_PACKAGE_INVALID");
  const ids = /* @__PURE__ */ new Set();
  for (const f of layout.fields) {
    if (!/^field_[a-z0-9_-]{2,64}$/.test(f?.fieldId || "") || ids.has(f.fieldId)) throw err("TEMPLATE_PACKAGE_INVALID");
    ids.add(f.fieldId);
    if (!["text", "single-select", "multi-select", "person", "location", "system-time", "system-weather", "image", "logo", "custom-text"].includes(f.type)) throw err("TEMPLATE_PACKAGE_INVALID");
  }
  return true;
};
var signaturePayload = (m) => enc2.encode(canonical({ format: m.format, formatVersion: m.formatVersion, templateId: m.templateId, templateVersion: m.templateVersion, contentDigest: m.contentDigest, minimumRendererVersion: m.rendererCompatibility.minimumRendererVersion }));
var importPrivate = (k) => crypto.subtle.importKey("pkcs8", unb64(k), { name: "Ed25519" }, false, ["sign"]);
var importPublic = (k) => crypto.subtle.importKey("raw", unb64(k), { name: "Ed25519" }, false, ["verify"]);
var buildTemplateBundle = async ({ templateId, templateVersion, name = "", description = "", layout, assets = [], createdAt = 0, keyId, privateKey }) => {
  if (!/^tpl_[a-z0-9_-]{3,80}$/.test(templateId) || !Number.isInteger(templateVersion) || templateVersion < 1) throw err("TEMPLATE_PACKAGE_INVALID");
  validateLayout(layout);
  const layoutBytes = enc2.encode(canonical(layout));
  if (layoutBytes.length > PACKAGE_LIMITS.layout) throw err("TEMPLATE_PACKAGE_TOO_LARGE");
  if (assets.length > PACKAGE_LIMITS.assetCount) throw err("TEMPLATE_PACKAGE_TOO_LARGE");
  const paths = /* @__PURE__ */ new Set(["manifest.json", "layout.json"]), files = { "layout.json": b64(layoutBytes) }, entries = [];
  for (const a of [...assets].sort((x, y) => x.path.localeCompare(y.path))) {
    if (!safePath(a.path) || !a.path.startsWith("assets/") || paths.has(a.path.toLowerCase()) || !MIME_ALLOWLIST.includes(a.mimeType)) throw err("TEMPLATE_PACKAGE_INVALID");
    paths.add(a.path.toLowerCase());
    const bytes3 = a.bytes instanceof Uint8Array ? a.bytes : new Uint8Array(a.bytes);
    if (bytes3.length > PACKAGE_LIMITS.asset) throw err("TEMPLATE_PACKAGE_TOO_LARGE");
    files[a.path] = b64(bytes3);
    entries.push({ id: a.id, path: a.path, sha256: await sha(bytes3), mimeType: a.mimeType, size: bytes3.length });
  }
  const content = { layout: { path: "layout.json", sha256: await sha(layoutBytes), size: layoutBytes.length }, assets: entries }, contentDigest = await sha(canonical(content));
  let manifest = { format: "jilu-template", formatVersion: 2, templateId, templateVersion, name, description, layout: content.layout, assets: entries, rendererCompatibility: { minimumRendererVersion: 2 }, createdAt, contentDigest, artifactSha256: null, signature: { algorithm: "Ed25519", keyId, value: "" } };
  manifest.signature.value = b64(new Uint8Array(await crypto.subtle.sign("Ed25519", await importPrivate(privateKey), signaturePayload(manifest))));
  const artifact = enc2.encode(canonical({ manifest, files }));
  if (artifact.length > PACKAGE_LIMITS.package) throw err("TEMPLATE_PACKAGE_TOO_LARGE");
  manifest.artifactSha256 = await sha(artifact);
  const bytes2 = enc2.encode(canonical({ manifest, files }));
  return { bytes: bytes2, manifest: { ...manifest }, contentDigest, artifactSha256: manifest.artifactSha256 };
};
var validateTemplateBundle = async ({ bytes: bytes2, expectedTemplateId, expectedVersion, rendererVersion, keys }) => {
  if (bytes2.length > PACKAGE_LIMITS.package) throw err("TEMPLATE_PACKAGE_TOO_LARGE");
  let bundle;
  try {
    bundle = JSON.parse(dec.decode(bytes2));
  } catch {
    throw err("TEMPLATE_PACKAGE_INVALID");
  }
  const m = bundle.manifest;
  if (m?.formatVersion !== 2) throw err("TEMPLATE_FORMAT_UNSUPPORTED");
  if (m.templateId !== expectedTemplateId || m.templateVersion !== expectedVersion) throw err("TEMPLATE_PACKAGE_INVALID");
  const unsignedArtifact = structuredClone(bundle);
  unsignedArtifact.manifest.artifactSha256 = null;
  if (await sha(enc2.encode(canonical(unsignedArtifact))) !== m.artifactSha256) throw err("TEMPLATE_PACKAGE_HASH_MISMATCH");
  if (rendererVersion < m.rendererCompatibility.minimumRendererVersion) throw err("RENDERER_UPDATE_REQUIRED");
  const key2 = keys.find((x) => x.keyId === m.signature.keyId && ["ACTIVE", "VERIFY_ONLY"].includes(x.status));
  if (!key2) throw err("TEMPLATE_SIGNATURE_KEY_UNKNOWN");
  if (!await crypto.subtle.verify("Ed25519", await importPublic(key2.publicKey), unb64(m.signature.value), signaturePayload(m))) throw err("TEMPLATE_SIGNATURE_INVALID");
  validateLayout(JSON.parse(dec.decode(unb64(bundle.files["layout.json"]))));
  if (await sha(unb64(bundle.files["layout.json"])) !== m.layout.sha256) throw err("TEMPLATE_ASSET_HASH_MISMATCH");
  const listed = /* @__PURE__ */ new Set(["layout.json"]);
  for (const a of m.assets) {
    listed.add(a.path);
    if (!safePath(a.path) || !bundle.files[a.path] || await sha(unb64(bundle.files[a.path])) !== a.sha256) throw err("TEMPLATE_ASSET_HASH_MISMATCH");
  }
  if (Object.keys(bundle.files).some((x) => !listed.has(x))) throw err("TEMPLATE_PACKAGE_INVALID");
  return { valid: true, manifest: m };
};
var tokenKey = async (secret) => crypto.subtle.importKey("raw", enc2.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
var issueDownloadToken = async (payload, secret) => {
  const body = b64(enc2.encode(canonical(payload))), sig = b64(new Uint8Array(await crypto.subtle.sign("HMAC", await tokenKey(secret), enc2.encode(body))));
  return `${body}.${sig}`;
};
var verifyDownloadToken = async (token, secret, now = Date.now()) => {
  const [body, sig] = String(token).split(".");
  if (!body || !sig || !await crypto.subtle.verify("HMAC", await tokenKey(secret), unb64(sig), enc2.encode(body))) throw err("TEMPLATE_DOWNLOAD_TOKEN_INVALID");
  const p = JSON.parse(dec.decode(unb64(body)));
  if (p.expiresAt <= now) throw err("TEMPLATE_DOWNLOAD_TOKEN_EXPIRED");
  return p;
};
var issueLease = async ({ lease, keyId, privateKey }) => {
  const body = { schema: "jilu-template-entitlement-lease", version: 1, ...lease, keyId };
  return { ...body, signature: b64(new Uint8Array(await crypto.subtle.sign("Ed25519", await importPrivate(privateKey), enc2.encode(canonical(body))))) };
};
var verifyLease = async ({ lease, keys, now = Date.now(), subjectId, templateId, templateVersion, entitlementEpoch }) => {
  const { signature, ...body } = lease || {}, key2 = keys.find((x) => x.keyId === body.keyId && ["ACTIVE", "VERIFY_ONLY"].includes(x.status));
  if (!key2 || !await crypto.subtle.verify("Ed25519", await importPublic(key2.publicKey), unb64(signature || ""), enc2.encode(canonical(body)))) throw err("TEMPLATE_LEASE_INVALID");
  if (body.expiresAt <= now) throw err("TEMPLATE_LEASE_EXPIRED");
  if (body.subjectId !== subjectId || body.templateId !== templateId || body.templateVersion !== templateVersion || body.entitlementEpoch !== entitlementEpoch) throw err("TEMPLATE_LEASE_INVALID");
  return true;
};
var decideTemplateUpdate = ({ installedVersion, latestVersion, minimumSupportedVersion, updatePolicy }) => installedVersion >= latestVersion ? "CURRENT" : installedVersion < minimumSupportedVersion ? "FORCED_UPDATE_REQUIRED" : updatePolicy === "AUTO" ? "AUTO_UPDATE_AVAILABLE" : updatePolicy === "PROMPT" ? "PROMPT_UPDATE_AVAILABLE" : "FORCED_UPDATE_REQUIRED";
var MemoryAtomicInstaller = class {
  constructor() {
    this.active = /* @__PURE__ */ new Map();
    this.staging = /* @__PURE__ */ new Map();
  }
  stage(id, v, data) {
    this.staging.set(`${id}:${v}`, data);
  }
  commit(id, v) {
    const k = `${id}:${v}`;
    if (!this.staging.has(k)) throw err("TEMPLATE_UPDATE_FAILED");
    this.active.set(id, { version: v, data: this.staging.get(k) });
    this.staging.delete(k);
  }
  recover() {
    this.staging.clear();
  }
  get(id) {
    return this.active.get(id) || null;
  }
};
export {
  AlibabaEsaTemplateStorage,
  CloudflareR2TemplateStorage,
  EdgeOneBlobTemplateStorage,
  MIME_ALLOWLIST,
  MemoryAtomicInstaller,
  MemoryTemplateObjectStorage,
  PACKAGE_LIMITS,
  PUBLISH_OPERATION_STATUS,
  TEMPLATE_RUNTIME_DEFAULTS,
  TemplatePublishService,
  TemplateRuntimeService,
  WEB_DIY_FORMAT,
  WEB_DIY_VERSION,
  buildTemplateBundle,
  cleanupOrphanPackages,
  createTemplateRuntimeHttpHandler,
  decideTemplateUpdate,
  issueDownloadToken,
  issueLease,
  normalizeWebDiyExport,
  parseWebDiyExport,
  recoverPublishOperations,
  signaturePayload,
  validateLayout,
  validateTemplateBundle,
  verifyDownloadToken,
  verifyLease
};
//# sourceMappingURL=index.js.map

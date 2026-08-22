// @ts-nocheck -- generated from shared identity-core
// packages/identity-core/src/kv-repository.js
var parse = (value) => {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};
var KvIdentityRepository = class {
  constructor(kv) {
    if (!kv) throw new IdentityError("PERSISTENT_STORAGE_NOT_CONFIGURED", 503);
    this.kv = kv;
  }
  async read(key) {
    return parse(await this.kv.get(key));
  }
  async write(key, value) {
    await this.kv.put(key, JSON.stringify(value));
  }
  identityKey(p, a, h) {
    return `id_${p}_${a.replace(/[^\w-]/g, "_")}_${h}`;
  }
  async findIdentity(p, a, h) {
    return this.read(this.identityKey(p, a, h));
  }
  async saveIdentity(x) {
    return this.write(this.identityKey(x.provider, x.providerAppId, x.providerSubjectHash), x);
  }
  async resolveOrCreateIdentity({ mapping, subject }) {
    const existing = await this.findIdentity(mapping.provider, mapping.providerAppId, mapping.providerSubjectHash);
    if (existing) {
      const saved = await this.getSubject(existing.subjectId);
      return { subject: saved || subject, created: false };
    }
    await this.saveSubject(subject);
    await this.saveIdentity(mapping);
    return { subject, created: true };
  }
  async getSubject(id) {
    return this.read(`subject_${id}`);
  }
  async getSubjectByPublicId(publicId) {
    const id = await this.kv.get(`public_${publicId}`);
    return id ? this.getSubject(id) : null;
  }
  async saveSubject(x) {
    await this.write(`subject_${x.subjectId}`, x);
    await this.kv.put(`public_${x.publicId}`, x.subjectId);
  }
  async publicIdExists(id) {
    return Boolean(await this.kv.get(`public_${id}`));
  }
  async saveSession(h, x) {
    return this.write(`session_${h}`, x);
  }
  async getSession(h) {
    return this.read(`session_${h}`);
  }
  async revokeSession(h, at) {
    const x = await this.getSession(h);
    if (x) {
      x.revokedAt = at;
      await this.saveSession(h, x);
    }
  }
  async saveBindingCode(h, x) {
    return this.write(`binding_${h}`, x);
  }
  async getBindingCode(h) {
    return this.read(`binding_${h}`);
  }
  async consumeBindingCode(h, at) {
    const x = await this.getBindingCode(h);
    if (!x || x.usedAt) return false;
    x.usedAt = at;
    await this.saveBindingCode(h, x);
    return true;
  }
};
var EdgeOneIdentityRepository = class extends KvIdentityRepository {
};
var AlibabaEsaIdentityRepository = class extends KvIdentityRepository {
};

// packages/identity-core/src/sql-repository.js
var SqlIdentityRepository = class {
  constructor(db) {
    if (!db) throw new IdentityError("PERSISTENT_STORAGE_NOT_CONFIGURED", 503);
    this.db = db;
  }
  async one(sql, p = []) {
    const q = this.db.prepare(sql);
    const bound = typeof q.bind === "function";
    const b = bound ? q.bind(...p) : q;
    return await (b.first ? b.first() : b.get(...bound ? [] : p)) || null;
  }
  async run(sql, p = []) {
    const q = this.db.prepare(sql);
    const b = q.bind ? q.bind(...p) : q;
    return b.run(...q.bind ? [] : p);
  }
  async findIdentity(a, b, c) {
    const x = await this.one("SELECT * FROM identity_mappings WHERE provider=? AND provider_app_id=? AND provider_subject_hash=?", [a, b, c]);
    return x && { provider: x.provider, providerAppId: x.provider_app_id, providerSubjectHash: x.provider_subject_hash, subjectId: x.subject_id, createdAt: x.created_at, lastSeenAt: x.last_seen_at };
  }
  async saveIdentity(x) {
    return this.run("INSERT OR REPLACE INTO identity_mappings VALUES(?,?,?,?,?,?)", [x.provider, x.providerAppId, x.providerSubjectHash, x.subjectId, x.createdAt, x.lastSeenAt]);
  }
  async resolveOrCreateIdentity({ mapping, subject }) {
    await this.run("INSERT OR IGNORE INTO subjects VALUES(?,?,?,?,?,?,?)", [subject.subjectId, subject.publicId, subject.status, subject.internal ? 1 : 0, subject.createdAt, subject.lastSeenAt, subject.identityVersion]);
    await this.run("INSERT OR IGNORE INTO identity_mappings VALUES(?,?,?,?,?,?)", [mapping.provider, mapping.providerAppId, mapping.providerSubjectHash, mapping.subjectId, mapping.createdAt, mapping.lastSeenAt]);
    const canonical = await this.findIdentity(mapping.provider, mapping.providerAppId, mapping.providerSubjectHash);
    return { subject: await this.getSubject(canonical.subjectId), created: canonical.createdAt === mapping.createdAt };
  }
  async getSubject(id) {
    const x = await this.one("SELECT * FROM subjects WHERE id=?", [id]);
    return x && { subjectId: x.id, publicId: x.public_id, status: x.status, internal: Boolean(x.internal), createdAt: x.created_at, lastSeenAt: x.last_seen_at, identityVersion: x.identity_version };
  }
  async getSubjectByPublicId(publicId) {
    const x = await this.one("SELECT * FROM subjects WHERE public_id=?", [publicId]);
    return x && { subjectId: x.id, publicId: x.public_id, status: x.status, internal: Boolean(x.internal), createdAt: x.created_at, lastSeenAt: x.last_seen_at, identityVersion: x.identity_version };
  }
  async saveSubject(x) {
    return this.run("INSERT OR REPLACE INTO subjects VALUES(?,?,?,?,?,?,?)", [x.subjectId, x.publicId, x.status, x.internal ? 1 : 0, x.createdAt, x.lastSeenAt, x.identityVersion]);
  }
  async publicIdExists(id) {
    return Boolean(await this.one("SELECT id FROM subjects WHERE public_id=?", [id]));
  }
  async saveSession(h, x) {
    return this.run("INSERT OR REPLACE INTO sessions VALUES(?,?,?,?,?)", [h, x.subjectId, x.issuedAt, x.expiresAt, x.revokedAt]);
  }
  async getSession(h) {
    const x = await this.one("SELECT * FROM sessions WHERE token_hash=?", [h]);
    return x && { subjectId: x.subject_id, issuedAt: x.issued_at, expiresAt: x.expires_at, revokedAt: x.revoked_at };
  }
  async revokeSession(h, at) {
    return this.run("UPDATE sessions SET revoked_at=? WHERE token_hash=?", [at, h]);
  }
  async saveBindingCode(h, x) {
    return this.run("INSERT OR REPLACE INTO binding_codes VALUES(?,?,?,?,?,?)", [h, x.subjectId, x.createdAt, x.expiresAt, x.usedAt, x.failedAttempts]);
  }
  async getBindingCode(h) {
    const x = await this.one("SELECT * FROM binding_codes WHERE code_hash=?", [h]);
    return x && { subjectId: x.subject_id, createdAt: x.created_at, expiresAt: x.expires_at, usedAt: x.used_at, failedAttempts: x.failed_attempts };
  }
  async consumeBindingCode(h, at) {
    const x = await this.getBindingCode(h);
    if (!x || x.usedAt) return false;
    await this.run("UPDATE binding_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL", [at, h]);
    return true;
  }
};
var CloudflareD1IdentityRepository = class extends SqlIdentityRepository {
};
var DockerSqliteIdentityRepository = class extends SqlIdentityRepository {
};
var IDENTITY_SQL = "CREATE TABLE IF NOT EXISTS subjects(id TEXT PRIMARY KEY,public_id TEXT UNIQUE NOT NULL,status TEXT NOT NULL,internal INTEGER NOT NULL,created_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,identity_version INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS identity_mappings(provider TEXT NOT NULL,provider_app_id TEXT NOT NULL,provider_subject_hash TEXT NOT NULL,subject_id TEXT NOT NULL,created_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,PRIMARY KEY(provider,provider_app_id,provider_subject_hash));CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,subject_id TEXT NOT NULL,issued_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER);CREATE TABLE IF NOT EXISTS binding_codes(code_hash TEXT PRIMARY KEY,subject_id TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER,failed_attempts INTEGER NOT NULL DEFAULT 0);";

// packages/identity-core/src/index.js
var enc = new TextEncoder();
var b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
var hex = (bytes) => [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
var random = (size) => crypto.getRandomValues(new Uint8Array(size));
var digest = async (value) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))));
var hmac = async (secret, value) => {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value))));
};
var IdentityError = class extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
};
var createSubjectId = () => `sub_${b64u(random(20))}`;
var createPublicId = () => `JL-${[...random(6)].map((x) => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[x % 32]).join("")}`;
var deriveCanonicalSubject = async (secret, provider, appId, providerSubjectHash) => {
  if (!secret) throw new IdentityError("SUBJECT_DERIVATION_KEY_MISSING", 503);
  const material = await hmac(secret, `subject:v1:${provider}:${appId}:${providerSubjectHash}`);
  const idBytes = Uint8Array.from(material.slice(0, 40).match(/../g), (x) => parseInt(x, 16));
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const publicMaterial = await hmac(secret, `public:v1:${provider}:${appId}:${providerSubjectHash}`);
  const publicId = `JL-${[0, 2, 4, 6, 8, 10].map((offset) => alphabet[parseInt(publicMaterial.slice(offset, offset + 2), 16) % 32]).join("")}`;
  return { subjectId: `sub_${b64u(idBytes)}`, publicId };
};
var hashWechatIdentity = (secret, appId, openid) => {
  if (!secret) throw new IdentityError("IDENTITY_HMAC_KEY_MISSING", 503);
  return hmac(secret, `wechat:${appId}:${openid}`);
};
var MemoryIdentityRepository = class {
  constructor() {
    this.subjects = /* @__PURE__ */ new Map();
    this.identities = /* @__PURE__ */ new Map();
    this.sessions = /* @__PURE__ */ new Map();
    this.codes = /* @__PURE__ */ new Map();
  }
  async findIdentity(provider, appId, hash) {
    return this.identities.get(`${provider}|${appId}|${hash}`) || null;
  }
  async saveIdentity(value) {
    this.identities.set(`${value.provider}|${value.providerAppId}|${value.providerSubjectHash}`, structuredClone(value));
  }
  async resolveOrCreateIdentity({ mapping, subject }) {
    const existing = await this.findIdentity(mapping.provider, mapping.providerAppId, mapping.providerSubjectHash);
    if (existing) return { subject: await this.getSubject(existing.subjectId), created: false };
    await this.saveSubject(subject);
    await this.saveIdentity(mapping);
    return { subject: structuredClone(subject), created: true };
  }
  async getSubject(id) {
    return this.subjects.get(id) || null;
  }
  async getSubjectByPublicId(publicId) {
    return [...this.subjects.values()].find((x) => x.publicId === publicId) || null;
  }
  async saveSubject(value) {
    this.subjects.set(value.subjectId, structuredClone(value));
  }
  async publicIdExists(id) {
    return [...this.subjects.values()].some((x) => x.publicId === id);
  }
  async saveSession(hash, value) {
    this.sessions.set(hash, structuredClone(value));
  }
  async getSession(hash) {
    return this.sessions.get(hash) || null;
  }
  async revokeSession(hash, at) {
    const x = this.sessions.get(hash);
    if (x) {
      x.revokedAt = at;
      this.sessions.set(hash, x);
    }
  }
  async saveBindingCode(hash, value) {
    this.codes.set(hash, structuredClone(value));
  }
  async getBindingCode(hash) {
    return this.codes.get(hash) || null;
  }
  async consumeBindingCode(hash, at) {
    const x = this.codes.get(hash);
    if (!x || x.usedAt) return false;
    x.usedAt = at;
    this.codes.set(hash, x);
    return true;
  }
};
var AuthService = class {
  constructor({ repository, identityProvider, hmacKey, subjectDerivationKey, now = () => Date.now(), sessionTtlMs = 24 * 60 * 6e4 }) {
    Object.assign(this, { repository, identityProvider, hmacKey, subjectDerivationKey, now, sessionTtlMs });
  }
  async login(code) {
    let identity;
    try {
      identity = await this.identityProvider.exchange(code);
    } catch {
      throw new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", 502);
    }
    if (!identity?.openid || !identity?.appId) throw new IdentityError("INVALID_LOGIN_CODE", 401);
    const identityHash = await hashWechatIdentity(this.hmacKey, identity.appId, identity.openid);
    const now = this.now();
    const canonical = await deriveCanonicalSubject(this.subjectDerivationKey, "wechat", identity.appId, identityHash);
    const candidate = { ...canonical, status: "active", internal: false, createdAt: now, lastSeenAt: now, identityVersion: 1 };
    const mapping = { provider: "wechat", providerAppId: identity.appId, providerSubjectHash: identityHash, subjectId: candidate.subjectId, createdAt: now, lastSeenAt: now };
    const resolved = await this.repository.resolveOrCreateIdentity({ mapping, subject: candidate, now });
    const subject = resolved.subject;
    if (subject.status !== "active") throw new IdentityError("SUBJECT_DISABLED", 403);
    const token = b64u(random(32)), tokenHash = await digest(token), expiresAt = now + this.sessionTtlMs;
    await this.repository.saveSession(tokenHash, { subjectId: subject.subjectId, issuedAt: now, expiresAt, revokedAt: null });
    return { token, expiresAt, publicId: subject.publicId };
  }
  async authenticate(token) {
    if (!token) throw new IdentityError("UNAUTHENTICATED", 401);
    const hash = await digest(token), session = await this.repository.getSession(hash), now = this.now();
    if (!session || session.revokedAt || session.expiresAt <= now) throw new IdentityError("SESSION_INVALID", 401);
    const subject = await this.repository.getSubject(session.subjectId);
    if (!subject || subject.status !== "active") throw new IdentityError("SUBJECT_DISABLED", 403);
    return { subject, tokenHash: hash };
  }
  async logout(token) {
    const auth = await this.authenticate(token);
    await this.repository.revokeSession(auth.tokenHash, this.now());
  }
  async createBindingCode(token) {
    const { subject } = await this.authenticate(token), now = this.now(), code = [...random(8)].map((x) => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[x % 32]).join("");
    await this.repository.saveBindingCode(await digest(code), { subjectId: subject.subjectId, createdAt: now, expiresAt: now + 6e5, usedAt: null, failedAttempts: 0 });
    return { code, expiresAt: now + 6e5 };
  }
  async consumeBindingCode(code) {
    const key = await digest(String(code || "").toUpperCase()), item = await this.repository.getBindingCode(key), now = this.now();
    if (!item || item.usedAt || item.expiresAt <= now) throw new IdentityError("BINDING_CODE_INVALID", 400);
    if (item.failedAttempts >= 5) throw new IdentityError("RATE_LIMITED", 429);
    if (!await this.repository.consumeBindingCode(key, now)) throw new IdentityError("BINDING_CODE_INVALID", 400);
    return this.repository.getSubject(item.subjectId);
  }
  async withBindingCode(code, operation) {
    const key = await digest(String(code || "").toUpperCase()), item = await this.repository.getBindingCode(key), now = this.now();
    if (!item || item.usedAt || item.expiresAt <= now) throw new IdentityError("BINDING_CODE_INVALID", 400);
    const result = await operation(item.subjectId);
    if (!await this.repository.consumeBindingCode(key, now)) throw new IdentityError("BINDING_CODE_INVALID", 400);
    return result;
  }
};
var WechatIdentityProvider = class {
  constructor({ appId, appSecret, fetchImpl = fetch }) {
    Object.assign(this, { appId, appSecret, fetchImpl });
  }
  async exchange(code) {
    if (!code || !this.appId || !this.appSecret) throw new Error("invalid");
    const qs = new URLSearchParams({ appid: this.appId, secret: this.appSecret, js_code: code, grant_type: "authorization_code" });
    const res = await this.fetchImpl(`https://api.weixin.qq.com/sns/jscode2session?${qs}`), body = res.ok ? await res.json() : null;
    if (!body?.openid || body.errcode) throw new Error("invalid");
    return { appId: this.appId, openid: body.openid };
  }
};
export {
  AlibabaEsaIdentityRepository,
  AuthService,
  CloudflareD1IdentityRepository,
  DockerSqliteIdentityRepository,
  EdgeOneIdentityRepository,
  IDENTITY_SQL,
  IdentityError,
  KvIdentityRepository,
  MemoryIdentityRepository,
  SqlIdentityRepository,
  WechatIdentityProvider,
  createPublicId,
  createSubjectId,
  deriveCanonicalSubject,
  hashWechatIdentity
};
//# sourceMappingURL=index.js.map

// @ts-nocheck -- generated from shared template-entitlement-core
// packages/template-entitlement-core/src/repositories.js
var parse = (x) => {
  try {
    return x ? JSON.parse(x) : null;
  } catch {
    return null;
  }
};
var KvTemplateEntitlementRepository = class {
  constructor(kv) {
    if (!kv) throw new EntitlementError("PERSISTENT_STORAGE_NOT_CONFIGURED", 503);
    this.kv = kv;
  }
  async read(k) {
    return parse(await this.kv.get(k));
  }
  async write(k, x) {
    await this.kv.put(k, JSON.stringify(x));
    return x;
  }
  async saveTemplate(x) {
    await this.write(`te_tpl_${x.templateId}`, x);
    await this.kv.put(`te_idx_${x.visibility}_${x.templateId}`, "1");
    return x;
  }
  async getTemplate(id) {
    return this.read(`te_tpl_${id}`);
  }
  async listTemplates() {
    return (await Promise.all((await this.names("te_tpl_")).map((k) => this.read(k)))).filter(Boolean);
  }
  async saveVersion(x) {
    const k = `te_ver_${x.templateId}_${x.templateVersion}`, old = await this.read(k);
    if (old && !(old.status === "FAILED" && old.deletedAt)) throw new EntitlementError("TEMPLATE_VERSION_CONFLICT", 409);
    return this.write(k, x);
  }
  async getVersion(id, v) {
    return this.read(`te_ver_${id}_${v}`);
  }
  async updateVersion(x) {
    const k = `te_ver_${x.templateId}_${x.templateVersion}`, old = await this.read(k);
    if (!old || old.status === "PUBLISHED") throw new EntitlementError("TEMPLATE_VERSION_CONFLICT", 409);
    return this.write(k, x);
  }
  async saveGroup(x) {
    return this.write(`te_grp_${x.groupId}`, x);
  }
  async getGroup(id) {
    return this.read(`te_grp_${id}`);
  }
  async listGroups() {
    return (await Promise.all((await this.names("te_grp_")).map((k) => this.read(k)))).filter(Boolean);
  }
  async listGroupMembers(id) {
    return (await Promise.all((await this.names("te_mem_")).map((k) => this.read(k)))).filter((x) => x?.groupId === id);
  }
  async upsertDirectGrant(x) {
    const k = `te_dg_${x.subjectId}_${x.templateId}`, index = `te_s_tpl_${x.subjectId}_${x.templateId}`, old = await this.read(k);
    if (old?.enabled && !old.revokedAt) return old;
    await this.write(k, x);
    try {
      await this.kv.put(index, "1");
    } catch (error) {
      await this.write(k, { ...x, enabled: false, revokedAt: Date.now(), revokedBy: "INFRASTRUCTURE_ROLLBACK" }).catch(() => {
      });
      await this.kv.delete?.(index).catch(() => {
      });
      throw error;
    }
    return x;
  }
  async getDirectGrant(s, t) {
    return this.read(`te_dg_${s}_${t}`);
  }
  async upsertMembership(x) {
    const k = `te_mem_${x.subjectId}_${x.groupId}`, index = `te_s_grp_${x.subjectId}_${x.groupId}`, old = await this.read(k);
    if (old?.enabled && !old.revokedAt) {
      await this.kv.put(index, "1");
      return old;
    }
    await this.write(k, x);
    try {
      await this.kv.put(index, "1");
    } catch (error) {
      await this.write(k, { ...x, enabled: false, revokedAt: Date.now(), revokedBy: "INFRASTRUCTURE_ROLLBACK" }).catch(() => {
      });
      await this.kv.delete?.(index).catch(() => {
      });
      throw error;
    }
    return x;
  }
  async upsertGroupGrant(x) {
    const k = `te_gg_${x.groupId}_${x.templateId}`, index = `te_g_tpl_${x.groupId}_${x.templateId}`, old = await this.read(k);
    if (old?.enabled && !old.revokedAt) return old;
    await this.write(k, x);
    try {
      await this.kv.put(index, "1");
    } catch (error) {
      await this.write(k, { ...x, enabled: false, revokedAt: Date.now(), revokedBy: "INFRASTRUCTURE_ROLLBACK" }).catch(() => {
      });
      await this.kv.delete?.(index).catch(() => {
      });
      throw error;
    }
    return x;
  }
  async names(prefix) {
    const out = [];
    let cursor;
    do {
      const page = await this.kv.list({ prefix, limit: 100, ...cursor ? { cursor } : {} });
      out.push(...(page.keys || []).map((x) => x.name));
      cursor = page.list_complete || page.complete ? null : page.cursor;
    } while (cursor);
    return out;
  }
  async listMemberships(s) {
    return Promise.all((await this.names(`te_mem_${s}_`)).map((k) => this.read(k)));
  }
  async listGroupGrants(ids, t) {
    const all = (await Promise.all(ids.map((id) => this.names(`te_gg_${id}_`)))).flat();
    return (await Promise.all(all.map((k) => this.read(k)))).filter((x) => !t || x.templateId === t);
  }
  async listCandidateTemplateIds({ subjectId, internal, anonymous = false, groupIds }) {
    const prefixes = ["te_idx_PUBLIC_", ...!anonymous ? ["te_idx_AUTHENTICATED_", `te_s_tpl_${subjectId}_`, ...groupIds.map((x) => `te_g_tpl_${x}_`)] : [], ...internal ? ["te_idx_INTERNAL_"] : []];
    const chunks = await Promise.all(prefixes.map(async (p) => (await this.names(p)).map((x) => x.slice(p.length))));
    return [...new Set(chunks.flat())];
  }
  async listCandidatePage({ subjectId, internal, anonymous = false, groupIds, limit, cursor }) {
    const prefixes = ["te_idx_PUBLIC_", ...!anonymous ? ["te_idx_AUTHENTICATED_", `te_s_tpl_${subjectId}_`, ...groupIds.map((x) => `te_g_tpl_${x}_`)] : [], ...internal ? ["te_idx_INTERNAL_"] : []];
    let state = cursor ? JSON.parse(atob(cursor)) : { sources: {} };
    for (const prefix of prefixes) {
      let s = state.sources[prefix] || { cursor: null, done: false, buffer: [] };
      if (!s.buffer.length && !s.done) {
        const page = await this.kv.list({ prefix, limit, ...s.cursor ? { cursor: s.cursor } : {} });
        s.buffer = (page.keys || []).map((x) => x.name.slice(prefix.length));
        s.cursor = page.cursor || null;
        s.done = Boolean(page.list_complete || page.complete || !page.cursor);
      }
      state.sources[prefix] = s;
    }
    const ids = [...new Set(prefixes.flatMap((p) => state.sources[p].buffer))].sort().slice(0, limit);
    for (const p of prefixes) state.sources[p].buffer = state.sources[p].buffer.filter((x) => !ids.includes(x));
    const more = prefixes.some((p) => state.sources[p].buffer.length || !state.sources[p].done);
    return { ids, nextCursor: more ? btoa(JSON.stringify(state)) : null };
  }
  async appendAudit(x) {
    await this.write(`te_audit_${String(x.timestamp).padStart(16, "0")}_${x.eventId}`, x);
  }
  async bumpEpoch(id) {
    const n = Number(await this.kv.get(`te_epoch_${id}`) || 0) + 1;
    await this.kv.put(`te_epoch_${id}`, String(n));
    return n;
  }
  async getEpoch(id) {
    return Number(await this.kv.get(`te_epoch_${id}`) || 0);
  }
  async savePublishOperation(x) {
    return this.write(`te_pop_${x.operationId}`, x);
  }
  async getPublishOperation(id) {
    return this.read(`te_pop_${id}`);
  }
  async listPublishOperations(statuses = []) {
    return (await Promise.all((await this.names("te_pop_")).map((k) => this.read(k)))).filter((x) => x && (!statuses.length || statuses.includes(x.status)));
  }
  async isObjectReferenced(ref) {
    for (const k of await this.names("te_ver_")) {
      const x = await this.read(k);
      if (["PUBLISHED", "RETIRED"].includes(x?.status) && x.internalObjectRef === ref) return true;
    }
    return false;
  }
  async commitPublished({ version, template, audit, operation }) {
    const oldV = await this.getVersion(version.templateId, version.templateVersion), oldT = await this.getTemplate(template.templateId);
    if (oldV?.status === "PUBLISHED") {
      if (oldV.artifactSha256 !== version.artifactSha256) throw new EntitlementError("TEMPLATE_VERSION_CONFLICT", 409);
      return oldV;
    }
    try {
      await this.write(`te_ver_${version.templateId}_${version.templateVersion}`, version);
      await this.saveTemplate({ ...template, latestVersion: Math.max(Number(oldT?.latestVersion) || 0, Number(template.latestVersion) || 0) });
      await this.appendAudit(audit);
      await this.savePublishOperation(operation);
      return version;
    } catch (error) {
      try {
        await this.write(`te_ver_${version.templateId}_${version.templateVersion}`, oldV);
        await this.saveTemplate(oldT);
        await this.savePublishOperation({ ...operation, status: "FAILED", errorCode: "TEMPLATE_PUBLISH_COMMIT_FAILED" });
      } catch {
      }
      throw error;
    }
  }
  async revoke(kind, key, actor, now) {
    const prefixes = { direct: "te_dg_", membership: "te_mem_", groupGrants: "te_gg_" }, k = (prefixes[kind] || "") + key.replace(/\|/g, "_"), x = await this.read(k);
    if (x) {
      x.enabled = false;
      x.revokedAt = now;
      x.revokedBy = actor;
      await this.write(k, x);
    }
    return x;
  }
  async revokeDirect(s, t, a, n) {
    return this.revoke("direct", `${s}|${t}`, a, n);
  }
  async revokeMembership(g, s, a, n) {
    return this.revoke("membership", `${s}|${g}`, a, n);
  }
  async revokeGroupGrant(g, t, a, n) {
    return this.revoke("groupGrants", `${g}|${t}`, a, n);
  }
  async retireVersion(id, v) {
    const x = await this.getVersion(id, v);
    if (!x || x.status !== "PUBLISHED") throw new EntitlementError("TEMPLATE_VERSION_NOT_PUBLISHED", 409);
    x.status = "RETIRED";
    return this.write(`te_ver_${id}_${v}`, x);
  }
};
var EdgeOneTemplateRepository = class extends KvTemplateEntitlementRepository {
};
var AlibabaEsaTemplateRepository = class extends KvTemplateEntitlementRepository {
};
var TEMPLATE_SQL = "CREATE TABLE IF NOT EXISTS templates(template_id TEXT PRIMARY KEY,visibility TEXT NOT NULL,category TEXT NOT NULL,sort_order INTEGER NOT NULL,updated_at INTEGER NOT NULL,payload TEXT NOT NULL);CREATE TABLE IF NOT EXISTS template_versions(template_id TEXT NOT NULL,template_version INTEGER NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(template_id,template_version));CREATE TABLE IF NOT EXISTS template_groups(group_id TEXT PRIMARY KEY,payload TEXT NOT NULL);CREATE TABLE IF NOT EXISTS template_memberships(subject_id TEXT NOT NULL,group_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(subject_id,group_id));CREATE TABLE IF NOT EXISTS template_direct_grants(subject_id TEXT NOT NULL,template_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(subject_id,template_id));CREATE TABLE IF NOT EXISTS template_group_grants(group_id TEXT NOT NULL,template_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(group_id,template_id));CREATE TABLE IF NOT EXISTS template_entitlement_epochs(resource_id TEXT PRIMARY KEY,epoch INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS template_audit(event_id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS template_publish_operations(operation_id TEXT PRIMARY KEY,status TEXT NOT NULL,value TEXT NOT NULL);CREATE INDEX IF NOT EXISTS idx_templates_catalog ON templates(visibility,category,sort_order,updated_at,template_id);CREATE INDEX IF NOT EXISTS idx_direct_subject ON template_direct_grants(subject_id,template_id);CREATE INDEX IF NOT EXISTS idx_membership_subject ON template_memberships(subject_id,group_id);CREATE INDEX IF NOT EXISTS idx_group_grant_group ON template_group_grants(group_id,template_id);";
var SqlTemplateEntitlementRepository = class {
  constructor(db) {
    if (!db) throw new EntitlementError("PERSISTENT_STORAGE_NOT_CONFIGURED", 503);
    this.db = db;
  }
  stmt(sql, p = []) {
    const q = this.db.prepare(sql), bound = typeof q.bind === "function", b = bound ? q.bind(...p) : q;
    return { one: () => b.first ? b.first() : b.get(...bound ? [] : p), all: () => b.all ? b.all(...bound ? [] : p) : Promise.resolve({ results: [] }).then(() => []), run: () => b.run(...bound ? [] : p) };
  }
  async all(sql, p = []) {
    const q = this.db.prepare(sql), bound = typeof q.bind === "function", b = bound ? q.bind(...p) : q, r = await b.all(...bound ? [] : p);
    return r.results || r || [];
  }
  async payload(sql, p = []) {
    const x = await this.stmt(sql, p).one();
    return parse(x?.payload);
  }
  async saveTemplate(x) {
    await this.stmt("INSERT OR REPLACE INTO templates VALUES(?,?,?,?,?,?)", [x.templateId, x.visibility, x.category, x.sortOrder, x.updatedAt, JSON.stringify(x)]).run();
    return x;
  }
  async getTemplate(id) {
    return this.payload("SELECT payload FROM templates WHERE template_id=?", [id]);
  }
  async listTemplates() {
    return (await this.all("SELECT payload FROM templates")).map((x) => parse(x.payload));
  }
  async saveVersion(x) {
    const old = await this.getVersion(x.templateId, x.templateVersion);
    if (old?.status === "FAILED" && old.deletedAt) {
      await this.stmt("UPDATE template_versions SET status=?,payload=? WHERE template_id=? AND template_version=?", [x.status, JSON.stringify(x), x.templateId, x.templateVersion]).run();
      return x;
    }
    try {
      await this.stmt("INSERT INTO template_versions VALUES(?,?,?,?)", [x.templateId, x.templateVersion, x.status, JSON.stringify(x)]).run();
      return x;
    } catch {
      throw new EntitlementError("TEMPLATE_VERSION_CONFLICT", 409);
    }
  }
  async getVersion(id, v) {
    return this.payload("SELECT payload FROM template_versions WHERE template_id=? AND template_version=?", [id, v]);
  }
  async updateVersion(x) {
    const old = await this.getVersion(x.templateId, x.templateVersion);
    if (!old || old.status === "PUBLISHED") throw new EntitlementError("TEMPLATE_VERSION_CONFLICT", 409);
    await this.stmt("UPDATE template_versions SET status=?,payload=? WHERE template_id=? AND template_version=?", [x.status, JSON.stringify(x), x.templateId, x.templateVersion]).run();
    return x;
  }
  async saveGroup(x) {
    await this.stmt("INSERT OR REPLACE INTO template_groups VALUES(?,?)", [x.groupId, JSON.stringify(x)]).run();
    return x;
  }
  async getGroup(id) {
    return this.payload("SELECT payload FROM template_groups WHERE group_id=?", [id]);
  }
  async listGroups() {
    return (await this.all("SELECT payload FROM template_groups")).map((x) => parse(x.payload));
  }
  async listGroupMembers(id) {
    return (await this.all("SELECT payload FROM template_memberships WHERE group_id=?", [id])).map((x) => parse(x.payload));
  }
  async upsertTable(table, where, p, x, insert) {
    const old = await this.payload(`SELECT payload FROM ${table} WHERE ${where}`, p);
    if (old?.enabled && !old.revokedAt) return old;
    await this.stmt(`INSERT OR REPLACE INTO ${table} VALUES(${p.map(() => "?").join(",")},?)`, [...p, JSON.stringify(x)]).run();
    return x;
  }
  async upsertDirectGrant(x) {
    return this.upsertTable("template_direct_grants", "subject_id=? AND template_id=?", [x.subjectId, x.templateId], x);
  }
  async getDirectGrant(s, t) {
    return this.payload("SELECT payload FROM template_direct_grants WHERE subject_id=? AND template_id=?", [s, t]);
  }
  async upsertMembership(x) {
    return this.upsertTable("template_memberships", "subject_id=? AND group_id=?", [x.subjectId, x.groupId], x);
  }
  async listMemberships(s) {
    return (await this.all("SELECT payload FROM template_memberships WHERE subject_id=?", [s])).map((x) => parse(x.payload));
  }
  async upsertGroupGrant(x) {
    return this.upsertTable("template_group_grants", "group_id=? AND template_id=?", [x.groupId, x.templateId], x);
  }
  async listGroupGrants(ids, t) {
    if (!ids.length) return [];
    const rows = await this.all(`SELECT payload FROM template_group_grants WHERE group_id IN (${ids.map(() => "?").join(",")})${t ? " AND template_id=?" : ""}`, [...ids, ...t ? [t] : []]);
    return rows.map((x) => parse(x.payload));
  }
  async listCandidatePage({ subjectId, internal, anonymous = false, groupIds, limit, cursor }) {
    const offset = cursor ? Number(JSON.parse(atob(cursor)).offset) : 0, visibility = anonymous ? ["PUBLIC"] : internal ? ["PUBLIC", "AUTHENTICATED", "INTERNAL"] : ["PUBLIC", "AUTHENTICATED"], restricted = anonymous ? "" : ` UNION SELECT template_id FROM template_direct_grants WHERE subject_id=?${groupIds.length ? ` UNION SELECT template_id FROM template_group_grants WHERE group_id IN (${groupIds.map(() => "?").join(",")})` : ""}`, params = [...visibility, ...anonymous ? [] : [subjectId, ...groupIds], limit, offset];
    const rows = await this.all(`SELECT t.template_id FROM templates t JOIN (SELECT template_id FROM templates WHERE visibility IN (${visibility.map(() => "?").join(",")})${restricted}) c ON c.template_id=t.template_id ORDER BY t.sort_order ASC,t.updated_at DESC,t.template_id ASC LIMIT ? OFFSET ?`, params);
    const ids = rows.map((x) => x.template_id);
    return { ids, nextCursor: ids.length === limit ? btoa(JSON.stringify({ offset: offset + ids.length })) : null };
  }
  async appendAudit(x) {
    await this.stmt("INSERT INTO template_audit(event_id,value) VALUES(?,?)", [x.eventId, JSON.stringify(x)]).run();
  }
  async bumpEpoch(id) {
    const n = await this.getEpoch(id) + 1;
    await this.stmt("INSERT OR REPLACE INTO template_entitlement_epochs VALUES(?,?)", [id, n]).run();
    return n;
  }
  async getEpoch(id) {
    return Number((await this.stmt("SELECT epoch FROM template_entitlement_epochs WHERE resource_id=?", [id]).one())?.epoch || 0);
  }
  async savePublishOperation(x) {
    await this.stmt("INSERT OR REPLACE INTO template_publish_operations VALUES(?,?,?)", [x.operationId, x.status, JSON.stringify(x)]).run();
    return x;
  }
  async getPublishOperation(id) {
    return this.payload("SELECT value AS payload FROM template_publish_operations WHERE operation_id=?", [id]);
  }
  async listPublishOperations(statuses = []) {
    const rows = await this.all("SELECT value AS payload FROM template_publish_operations");
    return rows.map((x) => parse(x.payload)).filter((x) => !statuses.length || statuses.includes(x.status));
  }
  async isObjectReferenced(ref) {
    const rows = await this.all("SELECT payload FROM template_versions WHERE status IN ('PUBLISHED','RETIRED')");
    return rows.map((x) => parse(x.payload)).some((x) => x?.internalObjectRef === ref);
  }
  async commitPublished({ version, template, audit, operation }) {
    const current = await this.getVersion(version.templateId, version.templateVersion);
    if (current?.status === "PUBLISHED") {
      if (current.artifactSha256 !== version.artifactSha256) throw new EntitlementError("TEMPLATE_VERSION_CONFLICT", 409);
      return current;
    }
    if (typeof this.db.transaction === "function") {
      const tx = this.db.transaction(() => {
        const latest = this.db.prepare("SELECT payload FROM templates WHERE template_id=?").get(template.templateId), old = parse(latest?.payload), safe = { ...template, latestVersion: Math.max(Number(old?.latestVersion) || 0, Number(template.latestVersion) || 0) };
        this.db.prepare("UPDATE template_versions SET status=?,payload=? WHERE template_id=? AND template_version=?").run("PUBLISHED", JSON.stringify(version), version.templateId, version.templateVersion);
        this.db.prepare("INSERT OR REPLACE INTO templates VALUES(?,?,?,?,?,?)").run(safe.templateId, safe.visibility, safe.category, safe.sortOrder, safe.updatedAt, JSON.stringify(safe));
        this.db.prepare("INSERT INTO template_audit VALUES(?,?)").run(audit.eventId, JSON.stringify(audit));
        this.db.prepare("INSERT OR REPLACE INTO template_publish_operations VALUES(?,?,?)").run(operation.operationId, operation.status, JSON.stringify(operation));
      });
      tx();
      return version;
    }
    const oldT = await this.getTemplate(template.templateId);
    try {
      await this.stmt("UPDATE template_versions SET status=?,payload=? WHERE template_id=? AND template_version=?", ["PUBLISHED", JSON.stringify(version), version.templateId, version.templateVersion]).run();
      await this.saveTemplate({ ...template, latestVersion: Math.max(Number(oldT?.latestVersion) || 0, Number(template.latestVersion) || 0) });
      await this.appendAudit(audit);
      await this.savePublishOperation(operation);
      return version;
    } catch (error) {
      try {
        await this.stmt("UPDATE template_versions SET status=?,payload=? WHERE template_id=? AND template_version=?", [current.status, JSON.stringify(current), current.templateId, current.templateVersion]).run();
        await this.saveTemplate(oldT);
      } catch {
      }
      throw error;
    }
  }
  async revokeRow(table, where, p, actor, now) {
    const x = await this.payload(`SELECT payload FROM ${table} WHERE ${where}`, p);
    if (x) {
      x.enabled = false;
      x.revokedAt = now;
      x.revokedBy = actor;
      await this.stmt(`UPDATE ${table} SET payload=? WHERE ${where}`, [JSON.stringify(x), ...p]).run();
    }
    return x;
  }
  async revokeDirect(s, t, a, n) {
    return this.revokeRow("template_direct_grants", "subject_id=? AND template_id=?", [s, t], a, n);
  }
  async revokeMembership(g, s, a, n) {
    return this.revokeRow("template_memberships", "subject_id=? AND group_id=?", [s, g], a, n);
  }
  async revokeGroupGrant(g, t, a, n) {
    return this.revokeRow("template_group_grants", "group_id=? AND template_id=?", [g, t], a, n);
  }
  async retireVersion(id, v) {
    const x = await this.getVersion(id, v);
    if (!x || x.status !== "PUBLISHED") throw new EntitlementError("TEMPLATE_VERSION_NOT_PUBLISHED", 409);
    x.status = "RETIRED";
    await this.stmt("UPDATE template_versions SET status=?,payload=? WHERE template_id=? AND template_version=?", [x.status, JSON.stringify(x), id, v]).run();
    return x;
  }
};
var CloudflareD1TemplateRepository = class extends SqlTemplateEntitlementRepository {
};
var DockerSqliteTemplateRepository = class extends SqlTemplateEntitlementRepository {
};

// packages/template-entitlement-core/src/http.js
var enc = new TextEncoder();
var json = (body, status = 200) => Response.json(body, {
  status,
  headers: {
    "Cache-Control": "private, no-store",
    Vary: "Authorization",
    "X-Content-Type-Options": "nosniff"
  }
});
var publicGrant = (x) => x && {
  templateId: x.templateId,
  enabled: x.enabled,
  grantedAt: x.grantedAt,
  expiresAt: x.expiresAt ?? null,
  revokedAt: x.revokedAt ?? null
};
var publicMembership = (x) => x && { groupId: x.groupId, enabled: x.enabled, grantedAt: x.grantedAt, expiresAt: x.expiresAt ?? null, revokedAt: x.revokedAt ?? null };
var equal = async (a, b) => {
  const [x, y] = await Promise.all(
    [a, b].map(
      (v2) => crypto.subtle.digest("SHA-256", enc.encode(String(v2 || "")))
    )
  ), u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0 && Boolean(a) && Boolean(b);
};
var createTemplateHttpHandler = (options) => {
  const rates = /* @__PURE__ */ new Map();
  return async (request) => {
    const rawPath = new URL(request.url).pathname, path = rawPath.replace(/^\/admin\/v1\/console(?=\/|$)/, "/admin/v1"), ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "local", bucket = path.includes("/publish") ? "publish" : path.startsWith("/admin/") ? "admin" : path.endsWith("/catalog") ? "catalog" : "detail", limit = { publish: 10, admin: 30, catalog: 120, detail: 120 }[bucket], key = `${bucket}:${ip}`, now = Date.now(), state = rates.get(key);
    if (!state || state.reset <= now)
      rates.set(key, { count: 1, reset: now + 6e4 });
    else if (++state.count > limit)
      return json({ ok: false, code: "RATE_LIMITED" }, 429);
    return handle(options, request);
  };
};
var handle = async ({
  service,
  publishService,
  authenticate,
  adminToken,
  resolveBindingCode,
  resolveSubjectById,
  resolveSubjectByPublicId
}, request) => {
  try {
    const path = new URL(request.url).pathname.replace(/^\/admin\/v1\/console(?=\/|$)/, "/admin/v1"), body = ["GET", "DELETE"].includes(request.method) ? {} : await request.json().catch(() => {
      throw new EntitlementError("INVALID_JSON");
    });
    if (path === "/v1/templates/catalog" && request.method === "POST") {
      const subject = await authenticate(request);
      return json({ ok: true, ...await service.catalog(subject, body) });
    }
    if (path === "/v1/templates/detail" && request.method === "POST") {
      const subject = await authenticate(request);
      return json({
        ok: true,
        template: await service.detail(subject, body.templateId)
      });
    }
    if (!path.startsWith("/admin/v1/"))
      return json({ ok: false, code: "NOT_FOUND" }, 404);
    const supplied = (request.headers.get("authorization") || "").match(
      /^Bearer\s+(.+)$/i
    )?.[1];
    if (!await equal(supplied, adminToken))
      throw new EntitlementError("ADMIN_UNAUTHORIZED", 401);
    const actor = String(request.headers.get("x-jilu-admin-actor") || "admin").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120) || "admin";
    const byPublicId = async (publicId) => {
      const subject = await resolveSubjectByPublicId?.(String(publicId || "").toUpperCase());
      if (!subject) throw new EntitlementError("SUBJECT_NOT_FOUND", 404);
      return subject;
    };
    if (path === "/admin/v1/templates" && request.method === "GET")
      return json({ ok: true, items: (await service.repository.listTemplates()).filter((item) => item && !item.deletedAt) });
    if (path === "/admin/v1/templates/atomic-publish" && request.method === "POST") {
      if (!publishService)
        throw new EntitlementError("OBJECT_STORAGE_NOT_CONFIGURED", 503);
      const requestId = String(body.clientRequestId || request.headers.get("x-request-id") || "").slice(0, 128);
      if (!requestId) throw new EntitlementError("INVALID_REQUEST_ID");
      publishService.atomicRequests || (publishService.atomicRequests = /* @__PURE__ */ new Map());
      if (publishService.atomicRequests.has(requestId))
        return json(await publishService.atomicRequests.get(requestId));
      const operation = (async () => {
        const meta = { ...body.template || {}, enabled: false, latestVersion: 0 };
        if (["USER_RESTRICTED", "GROUP_RESTRICTED"].includes(meta.visibility) && (!meta.offlinePolicy?.allowed || Number(meta.offlinePolicy?.leaseHours) <= 0))
          meta.offlinePolicy = { allowed: true, leaseHours: 24 };
        const draft = body.version || {};
        let stage = "CREATE_TEMPLATE";
        try {
          await service.createTemplate(meta, actor);
          const publishedVersion = await service.repository.getVersion(
            meta.templateId,
            Number(draft.templateVersion)
          );
          if (publishedVersion?.status === "PUBLISHED") {
            stage = "ACTIVATE_TEMPLATE";
            await service.updateTemplate(
              meta.templateId,
              {
                enabled: body.template?.enabled !== false,
                lifecycleStatus: "ACTIVE",
                deletedAt: null
              },
              actor
            );
            return { ...publishService.response(publishedVersion), recovered: true };
          }
          stage = "CREATE_VERSION";
          try {
            await service.createVersion(meta.templateId, draft, actor);
          } catch (error) {
            const existingVersion = await service.repository.getVersion(
              meta.templateId,
              Number(draft.templateVersion)
            );
            if (existingVersion?.status !== "PUBLISHED") throw error;
            stage = "ACTIVATE_TEMPLATE";
            await service.updateTemplate(
              meta.templateId,
              {
                enabled: body.template?.enabled !== false,
                lifecycleStatus: "ACTIVE",
                deletedAt: null
              },
              actor
            );
            return {
              ...publishService.response(existingVersion),
              recovered: true
            };
          }
          stage = "BUILD_SIGN_VERIFY_UPLOAD";
          const result = await publishService.publish({ templateId: meta.templateId, templateVersion: Number(draft.templateVersion), actorId: actor, requestId });
          stage = "ACTIVATE_TEMPLATE";
          await service.updateTemplate(meta.templateId, { enabled: body.template?.enabled !== false, lifecycleStatus: "ACTIVE", deletedAt: null }, actor);
          return result;
        } catch (error) {
          error.stage || (error.stage = stage);
          const failedVersion = await service.repository.getVersion(meta.templateId, Number(draft.templateVersion)).catch(() => null);
          if (failedVersion && failedVersion.status !== "PUBLISHED")
            await service.repository.updateVersion({ ...failedVersion, status: "FAILED", deletedAt: Date.now() }).catch(() => {
            });
          const existing = await service.repository.getTemplate(meta.templateId).catch(() => null);
          if (existing && Number(existing.publishedAt || 0) <= 0)
            await service.updateTemplate(meta.templateId, { enabled: false, lifecycleStatus: "FAILED", deletedAt: Date.now() }, actor).catch(() => {
            });
          throw error;
        }
      })();
      publishService.atomicRequests.set(requestId, operation);
      try {
        return json(await operation, 201);
      } catch (error) {
        publishService.atomicRequests.delete(requestId);
        throw error;
      }
    }
    const recoverPublish = path.match(
      /^\/admin\/v1\/templates\/([^/]+)\/versions\/(\d+)\/recover-publish$/
    );
    if (recoverPublish && request.method === "POST") {
      const templateId = decodeURIComponent(recoverPublish[1]);
      const templateVersion = Number(recoverPublish[2]);
      const version = await service.repository.getVersion(
        templateId,
        templateVersion
      );
      if (version?.status !== "PUBLISHED")
        throw new EntitlementError("TEMPLATE_VERSION_NOT_PUBLISHED", 409);
      await service.updateTemplate(
        templateId,
        {
          enabled: body.enabled !== false,
          lifecycleStatus: "ACTIVE",
          deletedAt: null
        },
        actor
      );
      return json({
        ...publishService.response(version),
        recovered: true
      });
    }
    if (path === "/admin/v1/groups" && request.method === "GET") {
      const groups = await service.repository.listGroups();
      const items = await Promise.all(groups.map(async (group) => ({ ...group, memberCount: (await service.repository.listGroupMembers(group.groupId)).filter((x) => x?.enabled !== false).length, grantCount: (await service.repository.listGroupGrants([group.groupId])).filter((x) => x?.enabled !== false).length })));
      return json({ ok: true, items });
    }
    if (path === "/admin/v1/templates" && request.method === "POST")
      return json(
        { ok: true, template: await service.createTemplate(body, actor) },
        201
      );
    let m = path.match(/^\/admin\/v1\/templates\/([^/]+)$/);
    if (m && request.method === "PATCH")
      return json({
        ok: true,
        template: await service.updateTemplate(m[1], body, actor)
      });
    m = path.match(/^\/admin\/v1\/templates\/([^/]+)\/archive$/);
    if (m && request.method === "POST")
      return json({
        ok: true,
        template: await service.updateTemplate(m[1], { enabled: false, lifecycleStatus: "ARCHIVED", archivedAt: Date.now() }, actor)
      });
    m = path.match(/^\/admin\/v1\/templates\/([^/]+)$/);
    if (m && request.method === "DELETE") {
      const template = await service.repository.getTemplate(m[1]);
      if (!template) throw new EntitlementError("TEMPLATE_NOT_AVAILABLE", 404);
      if (Number(template.publishedAt || 0) > 0 && !template.archivedAt)
        throw new EntitlementError("TEMPLATE_ARCHIVE_REQUIRED", 409);
      return json({
        ok: true,
        template: await service.updateTemplate(m[1], { enabled: false, lifecycleStatus: "ARCHIVED", deletedAt: Date.now(), deletedBy: actor }, actor)
      });
    }
    m = path.match(/^\/admin\/v1\/templates\/([^/]+)\/versions$/);
    if (m && request.method === "POST")
      return json(
        { ok: true, version: await service.createVersion(m[1], body, actor) },
        201
      );
    m = path.match(
      /^\/admin\/v1\/templates\/([^/]+)\/versions\/(\d+)\/(publish|retire)$/
    );
    if (m && request.method === "POST") {
      if (m[3] === "publish") {
        if (!publishService)
          throw new EntitlementError("OBJECT_STORAGE_NOT_CONFIGURED", 503);
        return json(
          await publishService.publish({
            templateId: m[1],
            templateVersion: Number(m[2]),
            actorId: actor,
            requestId: request.headers.get("x-request-id") || ""
          })
        );
      }
      return json({
        ok: true,
        version: await service.retireVersion(m[1], Number(m[2]), actor)
      });
    }
    if (path === "/admin/v1/groups" && request.method === "POST")
      return json(
        { ok: true, group: await service.createGroup(body, actor) },
        201
      );
    m = path.match(/^\/admin\/v1\/groups\/([^/]+)$/);
    if (m && request.method === "PATCH")
      return json({
        ok: true,
        group: await service.updateGroup(m[1], body, actor)
      });
    m = path.match(/^\/admin\/v1\/groups\/([^/]+)\/detail$/);
    if (m && request.method === "GET")
      return json({ ok: true, group: await service.repository.getGroup(m[1]), members: await service.repository.listGroupMembers(m[1]), grants: await service.repository.listGroupGrants([m[1]]) });
    m = path.match(/^\/admin\/v1\/groups\/([^/]+)\/members$/);
    if (m && request.method === "POST") {
      const subject = body.publicId ? await byPublicId(body.publicId) : null;
      return json({
        ok: true,
        membership: publicMembership(await service.addMember(
          m[1],
          subject?.subjectId || body.subjectId,
          actor,
          body.expiresAt ?? null
        ))
      });
    }
    m = path.match(/^\/admin\/v1\/groups\/([^/]+)\/members\/([^/]+)$/);
    if (m && request.method === "DELETE")
      return json({
        ok: true,
        membership: await service.removeMember(m[1], m[2], actor)
      });
    m = path.match(/^\/admin\/v1\/templates\/([^/]+)\/user-grants$/);
    if (m && request.method === "POST") {
      const subject = body.publicId ? await byPublicId(body.publicId) : null;
      const grant = body.bindingCode ? await resolveBindingCode(
        body.bindingCode,
        (id) => service.grantUser(m[1], id, actor, body.expiresAt ?? null)
      ) : await service.grantUser(
        m[1],
        subject?.subjectId || body.subjectId,
        actor,
        body.expiresAt ?? null
      );
      return json({ ok: true, grant: publicGrant(grant) });
    }
    m = path.match(/^\/admin\/v1\/templates\/([^/]+)\/user-grants\/revoke$/);
    if (m && request.method === "POST") {
      const subject = await byPublicId(body.publicId);
      return json({ ok: true, grant: publicGrant(await service.revokeUser(m[1], subject.subjectId, actor)) });
    }
    m = path.match(/^\/admin\/v1\/templates\/([^/]+)\/user-grants\/([^/]+)$/);
    if (m && request.method === "DELETE")
      return json({
        ok: true,
        grant: publicGrant(await service.revokeUser(m[1], m[2], actor))
      });
    m = path.match(/^\/admin\/v1\/templates\/([^/]+)\/group-grants$/);
    if (m && request.method === "POST")
      return json({
        ok: true,
        grant: await service.grantGroup(
          m[1],
          body.groupId,
          actor,
          body.expiresAt ?? null
        )
      });
    m = path.match(/^\/admin\/v1\/templates\/([^/]+)\/group-grants\/([^/]+)$/);
    if (m && request.method === "DELETE")
      return json({
        ok: true,
        grant: await service.revokeGroup(m[1], m[2], actor)
      });
    m = path.match(/^\/admin\/v1\/subjects\/([^/]+)\/access$/);
    if (m && request.method === "GET") {
      const subject = await resolveSubjectById(m[1]);
      return json({ ok: true, items: await service.listUserAccess(subject) });
    }
    if (path === "/admin/v1/subjects/access" && request.method === "POST") {
      const subject = await byPublicId(body.publicId);
      return json({ ok: true, publicId: subject.publicId, items: await service.listUserAccess(subject) });
    }
    return json({ ok: false, code: "NOT_FOUND" }, 404);
  } catch (error) {
    const e = error instanceof EntitlementError ? error : new EntitlementError(
      error?.code || "ADMIN_INTERNAL_ERROR",
      error?.status || 500
    );
    return json({ ok: false, code: e.code, ...error?.stage ? { stage: error.stage } : {}, ...error?.field ? { field: error.field } : {} }, e.status);
  }
};

// packages/template-entitlement-core/src/index.js
var VISIBILITIES = ["PUBLIC", "AUTHENTICATED", "USER_RESTRICTED", "GROUP_RESTRICTED", "INTERNAL", "DISABLED"];
var UPDATE_POLICIES = ["AUTO", "PROMPT", "FORCED"];
var VERSION_STATUSES = ["DRAFT", "PUBLISHED", "RETIRED"];
var TEMPLATE_CATEGORIES = ["general", "inspection", "operations", "construction", "event"];
var CATEGORIES = ["all", ...TEMPLATE_CATEGORIES, "creative", "shared"];
var active = (x, now) => Boolean(x && x.enabled !== false && !x.revokedAt && (x.expiresAt == null || Number(x.expiresAt) > now));
var safeId = (value, prefix) => new RegExp(`^${prefix}_[a-z0-9_-]{3,80}$`).test(String(value || ""));
var clean = (value, max) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
var randomId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
var derivedId = async (prefix, value) => {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${prefix}:v1:${value}`)));
  return `${prefix}_${[...bytes.slice(0, 16)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};
var EntitlementError = class extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
};
var TEMPLATE_VISIBILITY = Object.freeze(Object.fromEntries(VISIBILITIES.map((x) => [x, x])));
var TEMPLATE_UPDATE_POLICY = Object.freeze(Object.fromEntries(UPDATE_POLICIES.map((x) => [x, x])));
var TEMPLATE_VERSION_STATUS = Object.freeze(Object.fromEntries(VERSION_STATUSES.map((x) => [x, x])));
var evaluateTemplateAccess = ({ template, subject, directGrant, memberships = [], groups = [], groupGrants = [], now = Date.now() }) => {
  const deny = (reason) => ({ allowed: false, reason, entitlementType: null, expiresAt: null }), allow = (reason, type, expiresAt = null) => ({ allowed: true, reason, entitlementType: type, expiresAt });
  if (!template || template.enabled !== true || template.visibility === "DISABLED" || template.deletedAt || template.archivedAt || template.lifecycleStatus === "FAILED" || !Number.isInteger(Number(template.latestVersion)) || Number(template.latestVersion) < 1) return deny("TEMPLATE_NOT_PUBLISHED");
  if (!subject || String(subject.status || "").toLowerCase() !== "active") return deny("SUBJECT_DISABLED");
  if (template.visibility === "PUBLIC") return allow("PUBLIC", "PUBLIC");
  if (subject.anonymous === true) return deny("NOT_ENTITLED");
  if (template.visibility === "AUTHENTICATED") return allow("AUTHENTICATED", "AUTHENTICATED");
  if (template.visibility === "INTERNAL") return subject.internal === true ? allow("INTERNAL", "INTERNAL") : deny("NOT_ENTITLED");
  if (["USER_RESTRICTED", "GROUP_RESTRICTED"].includes(template.visibility)) {
    if (active(directGrant, now)) return allow("DIRECT_GRANT", "USER_RESTRICTED", directGrant.expiresAt ?? null);
    const groupAccess = [];
    for (const membership of memberships) {
      if (!active(membership, now) || membership.subjectId !== subject.subjectId) continue;
      const group = groups.find((x) => x.groupId === membership.groupId);
      const grant = groupGrants.find((x) => x.groupId === membership.groupId && x.templateId === template.templateId);
      if (group && group.enabled !== false && active(grant, now)) {
        const expiries = [membership.expiresAt, grant.expiresAt].filter((x) => x != null).map(Number);
        groupAccess.push(expiries.length ? Math.min(...expiries) : null);
      }
    }
    if (groupAccess.length) {
      const expiresAt = groupAccess.includes(null) ? null : Math.max(...groupAccess);
      return allow("GROUP_GRANT", "GROUP_RESTRICTED", expiresAt);
    }
  }
  return deny("NOT_ENTITLED");
};
var validateTemplate = (input) => {
  const x = { ...input };
  if (!safeId(x.templateId, "tpl")) throw new EntitlementError("INVALID_TEMPLATE_ID");
  if (!VISIBILITIES.includes(x.visibility)) throw new EntitlementError("INVALID_VISIBILITY");
  if (!UPDATE_POLICIES.includes(x.updatePolicy)) throw new EntitlementError("INVALID_UPDATE_POLICY");
  if (!TEMPLATE_CATEGORIES.includes(x.category)) throw new EntitlementError("INVALID_CATEGORY");
  if (!Number.isInteger(x.latestVersion) || x.latestVersion < 0 || !Number.isInteger(x.minimumSupportedVersion) || x.minimumSupportedVersion < 1 || x.minimumSupportedVersion > Math.max(1, x.latestVersion)) throw new EntitlementError("INVALID_TEMPLATE_VERSION");
  x.name = clean(x.name, 80);
  x.description = clean(x.description, 500);
  x.tags = [...new Set((x.tags || []).slice(0, 20).map((v) => clean(v, 32)).filter(Boolean))];
  x.creatorPublicId = clean(x.creatorPublicId, 32) || null;
  x.contributionType = x.creatorPublicId && x.contributionType === "USER_SUBMISSION" ? "USER_SUBMISSION" : null;
  x.creatorSharingEnabled = x.contributionType === "USER_SUBMISSION" && x.creatorSharingEnabled !== false;
  x.offlinePolicy = { allowed: Boolean(x.offlinePolicy?.allowed), leaseHours: Math.max(0, Math.min(168, Number(x.offlinePolicy?.leaseHours) || 0)) };
  return x;
};
var validateVersion = (x) => {
  if (!safeId(x.templateId, "tpl") || !Number.isInteger(x.templateVersion) || x.templateVersion < 1 || !VERSION_STATUSES.includes(x.status)) throw new EntitlementError("INVALID_TEMPLATE_VERSION");
  return { ...x, packageSha256: null, packageSignature: null, packageKeyId: null };
};
var MemoryTemplateEntitlementRepository = class {
  constructor() {
    this.templates = /* @__PURE__ */ new Map();
    this.versions = /* @__PURE__ */ new Map();
    this.groups = /* @__PURE__ */ new Map();
    this.memberships = /* @__PURE__ */ new Map();
    this.direct = /* @__PURE__ */ new Map();
    this.groupGrants = /* @__PURE__ */ new Map();
    this.audits = [];
    this.epochs = /* @__PURE__ */ new Map();
    this.publishOperations = /* @__PURE__ */ new Map();
  }
  async saveTemplate(x) {
    this.templates.set(x.templateId, structuredClone(x));
    return x;
  }
  async getTemplate(id) {
    return structuredClone(this.templates.get(id) || null);
  }
  async listCandidateTemplateIds({ subjectId, internal = false, anonymous = false, groupIds = [] }) {
    const ids = [];
    for (const x of this.templates.values()) if ((anonymous ? ["PUBLIC"] : ["PUBLIC", "AUTHENTICATED"]).includes(x.visibility) || internal && x.visibility === "INTERNAL") ids.push(x.templateId);
    if (!anonymous) {
      for (const x of this.direct.values()) if (x.subjectId === subjectId) ids.push(x.templateId);
      for (const x of this.groupGrants.values()) if (groupIds.includes(x.groupId)) ids.push(x.templateId);
    }
    return [...new Set(ids)];
  }
  async listCandidatePage(input) {
    const all = (await this.listCandidateTemplateIds(input)).sort(), offset = input.cursor ? Number(JSON.parse(atob(input.cursor)).offset) : 0, ids = all.slice(offset, offset + input.limit);
    return { ids, nextCursor: offset + ids.length < all.length ? btoa(JSON.stringify({ offset: offset + ids.length })) : null };
  }
  async saveVersion(x) {
    const k = `${x.templateId}|${x.templateVersion}`, old = this.versions.get(k);
    if (old?.status === "PUBLISHED" && JSON.stringify(old) !== JSON.stringify(x)) throw new EntitlementError("TEMPLATE_VERSION_CONFLICT", 409);
    if (old && !(old.status === "FAILED" && old.deletedAt)) throw new EntitlementError("TEMPLATE_VERSION_CONFLICT", 409);
    this.versions.set(k, structuredClone(x));
    return x;
  }
  async getVersion(id, v) {
    return structuredClone(this.versions.get(`${id}|${v}`) || null);
  }
  async updateVersion(x) {
    const k = `${x.templateId}|${x.templateVersion}`, old = this.versions.get(k);
    if (!old) throw new EntitlementError("TEMPLATE_VERSION_NOT_FOUND", 404);
    if (old.status === "PUBLISHED") throw new EntitlementError("TEMPLATE_VERSION_CONFLICT", 409);
    this.versions.set(k, structuredClone(x));
    return x;
  }
  async saveGroup(x) {
    this.groups.set(x.groupId, structuredClone(x));
    return x;
  }
  async getGroup(id) {
    return structuredClone(this.groups.get(id) || null);
  }
  async upsertDirectGrant(x) {
    const k = `${x.subjectId}|${x.templateId}`, old = this.direct.get(k);
    if (old?.enabled && !old.revokedAt) return structuredClone(old);
    this.direct.set(k, structuredClone(x));
    return x;
  }
  async getDirectGrant(s, t) {
    return structuredClone(this.direct.get(`${s}|${t}`) || null);
  }
  async upsertMembership(x) {
    const k = `${x.groupId}|${x.subjectId}`, old = this.memberships.get(k);
    if (old?.enabled && !old.revokedAt) return structuredClone(old);
    this.memberships.set(k, structuredClone(x));
    return x;
  }
  async listMemberships(s) {
    return [...this.memberships.values()].filter((x) => x.subjectId === s).map((x) => structuredClone(x));
  }
  async upsertGroupGrant(x) {
    const k = `${x.groupId}|${x.templateId}`, old = this.groupGrants.get(k);
    if (old?.enabled && !old.revokedAt) return structuredClone(old);
    this.groupGrants.set(k, structuredClone(x));
    return x;
  }
  async listGroupGrants(ids, t) {
    return [...this.groupGrants.values()].filter((x) => ids.includes(x.groupId) && (!t || x.templateId === t)).map((x) => structuredClone(x));
  }
  async revoke(kind, key, actor, now) {
    const map = this[kind], x = map.get(key);
    if (x) {
      x.enabled = false;
      x.revokedAt = now;
      x.revokedBy = actor;
      map.set(key, x);
    }
    return x || null;
  }
  async revokeDirect(s, t, a, n) {
    return this.revoke("direct", `${s}|${t}`, a, n);
  }
  async revokeMembership(g, s, a, n) {
    return this.revoke("memberships", `${g}|${s}`, a, n);
  }
  async revokeGroupGrant(g, t, a, n) {
    return this.revoke("groupGrants", `${g}|${t}`, a, n);
  }
  async retireVersion(id, v) {
    const x = this.versions.get(`${id}|${v}`);
    if (!x || x.status !== "PUBLISHED") throw new EntitlementError("TEMPLATE_VERSION_NOT_PUBLISHED", 409);
    x.status = "RETIRED";
    this.versions.set(`${id}|${v}`, x);
    return structuredClone(x);
  }
  async appendAudit(x) {
    this.audits.push(Object.freeze(structuredClone(x)));
  }
  async bumpEpoch(id) {
    const n = (this.epochs.get(id) || 0) + 1;
    this.epochs.set(id, n);
    return n;
  }
  async getEpoch(id) {
    return this.epochs.get(id) || 0;
  }
  async savePublishOperation(x) {
    this.publishOperations.set(x.operationId, structuredClone(x));
    return x;
  }
  async getPublishOperation(id) {
    return structuredClone(this.publishOperations.get(id) || null);
  }
  async listPublishOperations(statuses = []) {
    return [...this.publishOperations.values()].filter((x) => !statuses.length || statuses.includes(x.status)).map((x) => structuredClone(x));
  }
  async isObjectReferenced(ref) {
    return [...this.versions.values()].some((x) => ["PUBLISHED", "RETIRED"].includes(x.status) && x.internalObjectRef === ref);
  }
  async commitPublished({ version, template, audit, operation }) {
    const vk = `${version.templateId}|${version.templateVersion}`, oldV = this.versions.get(vk), oldT = this.templates.get(template.templateId), auditLength = this.audits.length;
    try {
      if (oldV?.status === "PUBLISHED") {
        if (oldV.artifactSha256 !== version.artifactSha256) throw new EntitlementError("TEMPLATE_VERSION_CONFLICT", 409);
        return oldV;
      }
      this.versions.set(vk, structuredClone(version));
      this.templates.set(template.templateId, structuredClone({ ...template, latestVersion: Math.max(Number(oldT?.latestVersion) || 0, Number(template.latestVersion) || 0) }));
      this.audits.push(Object.freeze(structuredClone(audit)));
      this.publishOperations.set(operation.operationId, structuredClone(operation));
      return version;
    } catch (error) {
      oldV ? this.versions.set(vk, oldV) : this.versions.delete(vk);
      oldT ? this.templates.set(template.templateId, oldT) : this.templates.delete(template.templateId);
      this.audits.length = auditLength;
      throw error;
    }
  }
};
var publicTemplate = (x) => ({ templateId: x.templateId, latestVersion: x.latestVersion, minimumSupportedVersion: x.minimumSupportedVersion, updatePolicy: x.updatePolicy, name: x.name, description: x.description, category: x.category, tags: x.tags, badge: x.contributionType === "USER_SUBMISSION" ? "contribution" : "official", contributionType: x.contributionType || null, creatorPublicId: x.creatorPublicId || null, creatorSharingEnabled: Boolean(x.creatorSharingEnabled), updatedAt: x.updatedAt, offlinePolicy: x.offlinePolicy });
var TemplateEntitlementService = class {
  constructor({ repository, now = () => Date.now() }) {
    this.repository = repository;
    this.now = now;
  }
  async context(subject, templateId) {
    const template = await this.repository.getTemplate(templateId), memberships = await this.repository.listMemberships(subject.subjectId), groupIds = memberships.map((x) => x.groupId), groups = (await Promise.all(groupIds.map((x) => this.repository.getGroup(x)))).filter(Boolean), directGrant = await this.repository.getDirectGrant(subject.subjectId, templateId), groupGrants = await this.repository.listGroupGrants(groupIds, templateId);
    return { template, subject, directGrant, memberships, groups, groupGrants, now: this.now() };
  }
  async detail(subject, templateId) {
    const ctx = await this.context(subject, templateId);
    if (!evaluateTemplateAccess(ctx).allowed) throw new EntitlementError("TEMPLATE_NOT_AVAILABLE", 404);
    const version = await this.repository.getVersion(templateId, Number(ctx.template.latestVersion));
    return { ...publicTemplate(ctx.template), previewLayout: version?.previewLayout || null };
  }
  async catalog(subject, { category = "all", scope = "all", limit = 20, cursor = null } = {}) {
    if (!CATEGORIES.includes(category)) throw new EntitlementError("INVALID_CATEGORY");
    limit = Math.max(1, Math.min(50, Number(limit) || 20));
    const memberships = subject.anonymous === true ? [] : await this.repository.listMemberships(subject.subjectId), groups = (await Promise.all(memberships.map((x) => this.repository.getGroup(x.groupId)))).filter(Boolean);
    let page;
    try {
      page = await this.repository.listCandidatePage({ subjectId: subject.subjectId, internal: subject.internal === true, anonymous: subject.anonymous === true, groupIds: groups.map((x) => x.groupId), limit, cursor });
    } catch {
      throw new EntitlementError("INVALID_CURSOR");
    }
    const items = (await Promise.all(page.ids.map(async (id) => {
      try {
        const item = await this.detail(subject, id), raw = await this.repository.getTemplate(id), direct = await this.repository.getDirectGrant(subject.subjectId, id), categoryMatch = category === "creative" ? raw.creatorPublicId === subject.publicId : category === "shared" ? raw.contributionType === "USER_SUBMISSION" && raw.creatorPublicId !== subject.publicId && active(direct, this.now()) : category === "all" || item.category === category;
        return scope === "exclusive" && !["USER_RESTRICTED", "GROUP_RESTRICTED"].includes(raw.visibility) || !categoryMatch ? null : item;
      } catch {
        return null;
      }
    }))).filter(Boolean);
    return { items, nextCursor: page.nextCursor };
  }
  async createTemplate(input, actor) {
    const now = this.now(), x = validateTemplate({ ...input, latestVersion: input.latestVersion ?? 0, minimumSupportedVersion: input.minimumSupportedVersion ?? 1, accessPolicyVersion: 1, enabled: input.enabled !== false, sortOrder: Number(input.sortOrder) || 0, createdAt: now, updatedAt: now, publishedAt: 0 });
    await this.repository.saveTemplate(x);
    await this.audit("TEMPLATE_CREATED", actor, { templateId: x.templateId });
    return x;
  }
  async createVersion(templateId, input, actor) {
    const template = await this.repository.getTemplate(templateId);
    if (!template) throw new EntitlementError("TEMPLATE_NOT_AVAILABLE", 404);
    const expected = Math.max(0, ...[...this.repository.versions?.values?.() || []].filter((x) => x.templateId === templateId).map((x) => x.templateVersion)) + 1, version = validateVersion({ templateId, templateVersion: input.templateVersion ?? expected, status: "DRAFT", createdAt: this.now(), publishedAt: null, createdBy: actor, packageSha256: null, packageSignature: null, packageKeyId: null, draft: { layout: structuredClone(input.layout), assets: structuredClone(input.assets || []) } });
    await this.repository.saveVersion(version);
    await this.audit("TEMPLATE_VERSION_CREATED", actor, { templateId, templateVersion: version.templateVersion });
    return version;
  }
  async publishVersion(templateId, v, actor) {
    const version = await this.repository.getVersion(templateId, v);
    if (!version || version.status !== "DRAFT") throw new EntitlementError("TEMPLATE_VERSION_CONFLICT", 409);
    version.status = "PUBLISHED";
    version.publishedAt = this.now();
    await this.repository.updateVersion(version);
    const template = await this.repository.getTemplate(templateId);
    template.latestVersion = Math.max(template.latestVersion, v);
    if (!await this.repository.getVersion(templateId, template.latestVersion)) throw new EntitlementError("TEMPLATE_VERSION_NOT_FOUND");
    template.updatedAt = this.now();
    template.publishedAt = version.publishedAt;
    await this.repository.saveTemplate(template);
    await this.audit("TEMPLATE_VERSION_PUBLISHED", actor, { templateId, templateVersion: v });
    return version;
  }
  async retireVersion(templateId, v, actor) {
    const x = await this.repository.retireVersion(templateId, v, this.now());
    await this.audit("TEMPLATE_VERSION_RETIRED", actor, { templateId, templateVersion: v });
    return x;
  }
  async updateTemplate(templateId, patch, actor) {
    const old = await this.repository.getTemplate(templateId);
    if (!old) throw new EntitlementError("TEMPLATE_NOT_AVAILABLE", 404);
    const next = validateTemplate({ ...old, ...patch, templateId, updatedAt: this.now() });
    if (next.latestVersion > 0) {
      const v = await this.repository.getVersion(templateId, next.latestVersion);
      if (!v || v.status !== "PUBLISHED") throw new EntitlementError("TEMPLATE_VERSION_NOT_PUBLISHED", 409);
    }
    await this.repository.saveTemplate(next);
    if (old.enabled !== next.enabled || old.visibility !== next.visibility) await this.repository.bumpEpoch(templateId);
    await this.audit("TEMPLATE_UPDATED", actor, { templateId });
    return next;
  }
  async grantUser(templateId, subjectId, actor, expiresAt = null) {
    if (!await this.repository.getTemplate(templateId)) throw new EntitlementError("TEMPLATE_NOT_AVAILABLE", 404);
    const old = await this.repository.getDirectGrant(subjectId, templateId);
    if (active(old, this.now())) return old;
    const now = this.now(), x = await this.repository.upsertDirectGrant({ grantId: await derivedId("grt", `${subjectId}:${templateId}`), templateId, subjectId, grantedAt: now, expiresAt, grantedBy: actor, enabled: true, revokedAt: null, revokedBy: null });
    await this.repository.bumpEpoch(templateId);
    await this.audit("GRANT_USER", actor, { templateId, subjectId });
    return x;
  }
  async createGroup(input, actor) {
    const now = this.now(), x = { groupId: input.groupId || randomId("grp"), name: clean(input.name, 80), enabled: true, createdAt: now, updatedAt: now };
    await this.repository.saveGroup(x);
    await this.audit("CREATE_GROUP", actor, { groupId: x.groupId });
    return x;
  }
  async updateGroup(groupId, patch, actor) {
    const old = await this.repository.getGroup(groupId);
    if (!old) throw new EntitlementError("GROUP_NOT_FOUND", 404);
    const x = { ...old, ...patch, groupId, name: clean(patch.name ?? old.name, 80), updatedAt: this.now() };
    await this.repository.saveGroup(x);
    if (old.enabled !== x.enabled) await this.repository.bumpEpoch(`group:${groupId}`);
    await this.audit(old.enabled === true && x.enabled === false ? "DISABLE_GROUP" : "UPDATE_GROUP", actor, { groupId });
    return x;
  }
  async listUserAccess(subject) {
    const memberships = await this.repository.listMemberships(subject.subjectId), groupIds = memberships.map((x) => x.groupId), groups = (await Promise.all(groupIds.map((x) => this.repository.getGroup(x)))).filter(Boolean), out = [];
    let cursor = null;
    do {
      const page = await this.repository.listCandidatePage({ subjectId: subject.subjectId, internal: subject.internal === true, anonymous: false, groupIds, limit: 50, cursor });
      for (const templateId of page.ids) {
        const ctx = await this.context(subject, templateId), access = evaluateTemplateAccess(ctx);
        if (access.allowed) out.push({ ...publicTemplate(ctx.template), accessType: access.entitlementType, expiresAt: access.expiresAt });
      }
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  }
  async addMember(groupId, subjectId, actor, expiresAt = null) {
    if (!await this.repository.getGroup(groupId)) throw new EntitlementError("GROUP_NOT_FOUND", 404);
    const now = this.now(), x = await this.repository.upsertMembership({ groupId, subjectId, grantedAt: now, expiresAt, grantedBy: actor, enabled: true, revokedAt: null, revokedBy: null });
    await this.repository.bumpEpoch(`subject:${subjectId}`);
    await this.audit("ADD_MEMBER", actor, { groupId, subjectId });
    return x;
  }
  async grantGroup(templateId, groupId, actor, expiresAt = null) {
    if (!await this.repository.getTemplate(templateId)) throw new EntitlementError("TEMPLATE_NOT_AVAILABLE", 404);
    if (!await this.repository.getGroup(groupId)) throw new EntitlementError("GROUP_NOT_FOUND", 404);
    const now = this.now(), x = await this.repository.upsertGroupGrant({ grantId: await derivedId("grt", `${groupId}:${templateId}`), templateId, groupId, grantedAt: now, expiresAt, grantedBy: actor, enabled: true, revokedAt: null, revokedBy: null });
    await this.repository.bumpEpoch(templateId);
    await this.audit("GRANT_GROUP", actor, { templateId, groupId });
    return x;
  }
  async revokeUser(templateId, subjectId, actor) {
    const x = await this.repository.revokeDirect(subjectId, templateId, actor, this.now());
    if (x) {
      await this.repository.bumpEpoch(templateId);
      await this.audit("REVOKE_USER", actor, { templateId, subjectId });
    }
    return x;
  }
  async removeMember(groupId, subjectId, actor) {
    const x = await this.repository.revokeMembership(groupId, subjectId, actor, this.now());
    if (x) {
      await this.repository.bumpEpoch(`subject:${subjectId}`);
      await this.audit("REMOVE_MEMBER", actor, { groupId, subjectId });
    }
    return x;
  }
  async revokeGroup(templateId, groupId, actor) {
    const x = await this.repository.revokeGroupGrant(groupId, templateId, actor, this.now());
    if (x) {
      await this.repository.bumpEpoch(templateId);
      await this.audit("REVOKE_GROUP", actor, { templateId, groupId });
    }
    return x;
  }
  async audit(eventType, actorId, data) {
    await this.repository.appendAudit({ eventId: randomId("evt"), eventType, actorId, timestamp: this.now(), ...data });
  }
};
export {
  AlibabaEsaTemplateRepository,
  CloudflareD1TemplateRepository,
  DockerSqliteTemplateRepository,
  EdgeOneTemplateRepository,
  EntitlementError,
  KvTemplateEntitlementRepository,
  MemoryTemplateEntitlementRepository,
  SqlTemplateEntitlementRepository,
  TEMPLATE_SQL,
  TEMPLATE_UPDATE_POLICY,
  TEMPLATE_VERSION_STATUS,
  TEMPLATE_VISIBILITY,
  TemplateEntitlementService,
  createTemplateHttpHandler,
  evaluateTemplateAccess,
  validateTemplate,
  validateVersion
};
//# sourceMappingURL=index.js.map

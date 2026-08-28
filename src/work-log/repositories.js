import {
  WorkLogError,
  normalizeJiluCode,
  normalizeProjectName,
  transitionAllowed,
  validateCaptureSnapshot,
} from "./core.js";
import { validateProjectGeofenceInput } from "./project-geofence-core.js";
const json = (value) => JSON.stringify(value ?? null),
  parse = (value) => (value == null ? null : JSON.parse(value));
const resultChanges = (result) =>
  Number(result?.meta?.changes ?? result?.changes ?? 0);
const row = (value) => {
  if (Array.isArray(value?.results)) return value.results[0] || null;
  if (Array.isArray(value?.result)) return value.result[0] || null;
  return value || null;
};
export class D1WorkLogRepository {
  constructor(
    db,
    {
      now = () => Date.now(),
      idGenerator = (prefix) =>
        `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`,
    } = {},
  ) {
    this.db = db;
    this.now = now;
    this.id = idGenerator;
  }
  async first(sql, ...params) {
    return row(
      await this.db
        .prepare(sql)
        .bind(...params)
        .all(),
    );
  }
  async insertIdempotentCapture({ subjectId, snapshot, payloadDigest }) {
    const v = validateCaptureSnapshot(snapshot),
      c = v.snapshot.capture,
      t = v.snapshot.template || {},
      p = v.snapshot.project || {},
      prov = v.snapshot.provenance || {},
      existing = await this.first(
        "SELECT * FROM capture_events WHERE subject_id=? AND client_capture_id=?",
        subjectId,
        v.clientCaptureId,
      );
    if (existing) {
      if (existing.payload_digest !== payloadDigest)
        throw new WorkLogError("CAPTURE_IDEMPOTENCY_CONFLICT", 409);
      return { status: "ALREADY_EXISTS", capture: existing };
    }
    if (
      await this.first(
        "SELECT capture_id FROM capture_events WHERE jilu_code=?",
        v.jiluCode,
      )
    )
      throw new WorkLogError("JILU_CODE_COLLISION", 409);
    const now = this.now(),
      captureId = this.id("capr"),
      stmt = this.db
        .prepare(
          `INSERT INTO capture_events(capture_id,subject_id,client_capture_id,jilu_code,schema_version,captured_at,timezone,utc_offset_minutes,local_date,template_id,template_version,template_name_snapshot,template_source,project_id,project_name_snapshot,location_json,weather_json,fields_json,rendered_json,photo_sha256,photo_storage_state,provenance_client_task_id,provenance_record_id,provenance_linked_at,payload_digest,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'LOCAL_ONLY',?,?,?,?,?,?)`,
        )
        .bind(
          captureId,
          subjectId,
          v.clientCaptureId,
          v.jiluCode,
          c.capturedAt,
          c.timezone ?? null,
          c.utcOffsetMinutes,
          v.localDate,
          t.templateId || t.customTemplateId || t.builtinId || null,
          Number(t.version) || 1,
          String(t.nameSnapshot || ""),
          String(t.origin || "BUILTIN"),
          p.projectId || null,
          p.projectNameSnapshot || null,
          json(v.snapshot.location || {}),
          v.snapshot.weather ? json(v.snapshot.weather) : null,
          json(v.snapshot.fields),
          json(v.snapshot.rendered || {}),
          v.photoSha256,
          prov.clientTaskId || null,
          prov.recordId || null,
          prov.recordId ? now : null,
          payloadDigest,
          now,
          now,
        );
    const matchStmt=Object.hasOwn(p,"projectMatchSource")?this.db.prepare("INSERT INTO capture_project_matches(subject_id,capture_id,match_source,rule_id,rule_version,matched_at) VALUES(?,?,?,?,?,?)").bind(subjectId,captureId,p.projectMatchSource||(p.projectId?"DEFAULT_PROJECT":"NONE"),p.projectMatchRuleId||null,Number.isInteger(p.projectMatchRuleVersion)?p.projectMatchRuleVersion:null,Number.isFinite(p.projectMatchedAt)?p.projectMatchedAt:null):null;
    try {
      if(matchStmt&&typeof this.db.batch==="function")await this.db.batch([stmt,matchStmt]);else{await stmt.run();if(matchStmt)await matchStmt.run()}
    } catch (error) {
      const after = await this.first(
        "SELECT * FROM capture_events WHERE subject_id=? AND client_capture_id=?",
        subjectId,
        v.clientCaptureId,
      );
      if (after && after.payload_digest === payloadDigest)
        return { status: "ALREADY_EXISTS", capture: after };
      if (
        await this.first(
          "SELECT capture_id FROM capture_events WHERE jilu_code=?",
          v.jiluCode,
        )
      )
        throw new WorkLogError("JILU_CODE_COLLISION", 409);
      throw error;
    }
    return {
      status: "CREATED",
      capture: await this.getCaptureById(subjectId, captureId),
    };
  }
  getCaptureById(subjectId, captureId) {
    return this.first(
      "SELECT * FROM capture_events WHERE subject_id=? AND capture_id=? AND deleted_at IS NULL",
      subjectId,
      captureId,
    );
  }
  getCaptureByClientCaptureId(subjectId, id) {
    return this.first(
      "SELECT * FROM capture_events WHERE subject_id=? AND client_capture_id=?",
      subjectId,
      id,
    );
  }
  getCapturesByPhotoSha(subjectId, sha) {
    return this.db
      .prepare(
        "SELECT * FROM capture_events WHERE subject_id=? AND photo_sha256=? AND deleted_at IS NULL ORDER BY captured_at DESC,capture_id DESC",
      )
      .bind(subjectId, sha)
      .all()
      .then((x) => x.results || []);
  }
  async listCaptures(
    subjectId,
    {
      from = "0000-01-01",
      to = "9999-12-31",
      projectId = null,
      limit = 50,
      offset = 0,
    } = {},
  ) {
    limit = Math.max(1, Math.min(100, Number(limit) || 50));
    offset = Math.max(0, Number(offset) || 0);
    const q = projectId
      ? this.db
          .prepare(
            "SELECT * FROM capture_events WHERE subject_id=? AND local_date BETWEEN ? AND ? AND project_id=? AND deleted_at IS NULL ORDER BY captured_at DESC,capture_id DESC LIMIT ? OFFSET ?",
          )
          .bind(subjectId, from, to, projectId, limit, offset)
      : this.db
          .prepare(
            "SELECT * FROM capture_events WHERE subject_id=? AND local_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY captured_at DESC,capture_id DESC LIMIT ? OFFSET ?",
          )
          .bind(subjectId, from, to, limit, offset);
    return (await q.all()).results || [];
  }
  async getCaptureByJiluCode(subjectId, code) {
    try {
      code = normalizeJiluCode(code);
    } catch {
      return null;
    }
    return this.first(
      "SELECT * FROM capture_events WHERE subject_id=? AND jilu_code=? AND deleted_at IS NULL",
      subjectId,
      code,
    );
  }
  async linkProvenanceRecord(
    subjectId,
    captureId,
    { clientTaskId = null, recordId },
  ) {
    const current = await this.getCaptureById(subjectId, captureId);
    if (!current) throw new WorkLogError("CAPTURE_NOT_FOUND", 404);
    if (
      current.provenance_record_id &&
      current.provenance_record_id !== recordId
    )
      throw new WorkLogError("PROVENANCE_LINK_CONFLICT", 409);
    await this.db
      .prepare(
        "UPDATE capture_events SET provenance_client_task_id=COALESCE(provenance_client_task_id,?),provenance_record_id=?,provenance_linked_at=COALESCE(provenance_linked_at,?),updated_at=? WHERE subject_id=? AND capture_id=?",
      )
      .bind(
        clientTaskId,
        recordId,
        this.now(),
        this.now(),
        subjectId,
        captureId,
      )
      .run();
    return this.getCaptureById(subjectId, captureId);
  }
  async createWorkLog(subjectId, input) {
    const now = this.now(),
      logId = input.logId || this.id("log");
    await this.db
      .prepare(
        "INSERT INTO work_logs(log_id,subject_id,local_date,timezone,title,summary,project_id,project_name_snapshot,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'DRAFT',1,?,?)",
      )
      .bind(
        logId,
        subjectId,
        input.localDate,
        input.timezone || null,
        input.title,
        input.summary || "",
        input.projectId || null,
        input.projectNameSnapshot || null,
        now,
        now,
      )
      .run();
    return this.first(
      "SELECT * FROM work_logs WHERE subject_id=? AND log_id=?",
      subjectId,
      logId,
    );
  }
  async patchWorkLog(
    subjectId,
    logId,
    patch,
    expectedVersion,
    { automatic = false } = {},
  ) {
    const current = await this.first(
      "SELECT * FROM work_logs WHERE subject_id=? AND log_id=?",
      subjectId,
      logId,
    );
    if (!current) throw new WorkLogError("WORK_LOG_NOT_FOUND", 404);
    if (current.status !== "DRAFT")
      throw new WorkLogError(
        automatic ? "WORK_LOG_FINAL" : "WORK_LOG_NOT_EDITABLE",
        409,
      );
    const r = await this.db
      .prepare(
        "UPDATE work_logs SET title=?,summary=?,version=version+1,updated_at=? WHERE subject_id=? AND log_id=? AND status='DRAFT' AND version=?",
      )
      .bind(
        patch.title ?? current.title,
        patch.summary ?? current.summary,
        this.now(),
        subjectId,
        logId,
        expectedVersion,
      )
      .run();
    if (!resultChanges(r))
      throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
    if (!automatic && patch.summary !== undefined)
      await this.db.prepare("UPDATE work_log_auto_metadata SET user_edited_summary=1,updated_at=? WHERE subject_id=? AND log_id=?").bind(this.now(),subjectId,logId).run().catch(()=>null);
    return this.first(
      "SELECT * FROM work_logs WHERE subject_id=? AND log_id=?",
      subjectId,
      logId,
    );
  }
  async finalizeWorkLog(subjectId, logId, expectedVersion) {
    const now = this.now(),
      r = await this.db
        .prepare(
          "UPDATE work_logs SET status='FINAL',version=version+1,updated_at=?,finalized_at=? WHERE subject_id=? AND log_id=? AND status='DRAFT' AND version=?",
        )
        .bind(now, now, subjectId, logId, expectedVersion)
        .run();
    if (!resultChanges(r))
      throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
    return this.first(
      "SELECT * FROM work_logs WHERE subject_id=? AND log_id=?",
      subjectId,
      logId,
    );
  }
  async getWorkLog(subjectId, logId) {
    const x = await this.first(
      "SELECT * FROM work_logs WHERE subject_id=? AND log_id=?",
      subjectId,
      logId,
    );
    return x && x.status !== "DELETED" ? x : null;
  }
  async getWorkLogExportAggregate(subjectId, logId) {
    const log = await this.getWorkLog(subjectId, logId);
    if (!log) return null;
    const items = await this.db.prepare("SELECT * FROM work_log_items WHERE subject_id=? AND log_id=? AND deleted_at IS NULL ORDER BY sort_order,item_id").bind(subjectId, logId).all();
    const links = await this.db.prepare("SELECT c.* FROM work_log_item_captures c JOIN work_log_items i ON i.subject_id=c.subject_id AND i.item_id=c.item_id WHERE c.subject_id=? AND i.log_id=? ORDER BY c.sort_order,c.capture_id").bind(subjectId, logId).all();
    return { ...log, items: items.results || [], captureAssociations: links.results || [] };
  }
  async listWorkLogs(
    subjectId,
    { status = null, limit = 50, offset = 0 } = {},
  ) {
    const q = status
      ? this.db
          .prepare(
            "SELECT * FROM work_logs WHERE subject_id=? AND status=? ORDER BY local_date DESC,log_id DESC LIMIT ? OFFSET ?",
          )
          .bind(subjectId, status, limit, offset)
      : this.db
          .prepare(
            "SELECT * FROM work_logs WHERE subject_id=? AND status!='DELETED' ORDER BY local_date DESC,log_id DESC LIMIT ? OFFSET ?",
          )
          .bind(subjectId, limit, offset);
    return (await q.all()).results || [];
  }
  async transition(subjectId, logId, to, expectedVersion) {
    const current = await this.first(
      "SELECT * FROM work_logs WHERE subject_id=? AND log_id=?",
      subjectId,
      logId,
    );
    if (!current) throw new WorkLogError("WORK_LOG_NOT_FOUND", 404);
    if (!transitionAllowed(current.status, to))
      throw new WorkLogError("WORK_LOG_TRANSITION_INVALID", 409);
    const now = this.now(),
      r = await this.db
        .prepare(
          "UPDATE work_logs SET status=?,version=version+1,updated_at=?,finalized_at=CASE WHEN ?='FINAL' THEN ? ELSE finalized_at END,deleted_at=CASE WHEN ?='DELETED' THEN ? WHEN ?='DRAFT' THEN NULL ELSE deleted_at END,delete_after=CASE WHEN ?='DELETED' THEN ? ELSE NULL END WHERE subject_id=? AND log_id=? AND version=?",
        )
        .bind(
          to,
          now,
          to,
          now,
          to,
          now,
          to,
          to,
          now + 30 * 86400000,
          subjectId,
          logId,
          expectedVersion,
        )
        .run();
    if (!resultChanges(r))
      throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
    return this.first(
      "SELECT * FROM work_logs WHERE subject_id=? AND log_id=?",
      subjectId,
      logId,
    );
  }
  archiveWorkLog(s, l, v) {
    return this.transition(s, l, "ARCHIVED", v);
  }
  softDeleteWorkLog(s, l, v) {
    return this.transition(s, l, "DELETED", v);
  }
  restoreWorkLog(s, l, v) {
    return this.transition(s, l, "DRAFT", v);
  }
  async createItem(subjectId, logId, input) {
    const log = await this.first(
      "SELECT * FROM work_logs WHERE subject_id=? AND log_id=?",
      subjectId,
      logId,
    );
    if (!log) throw new WorkLogError("WORK_LOG_NOT_FOUND", 404);
    if (log.status !== "DRAFT") throw new WorkLogError("WORK_LOG_FINAL", 409);
    const now = this.now(),
      itemId = input.itemId || this.id("item");
    await this.db
      .prepare(
        "INSERT INTO work_log_items(item_id,subject_id,log_id,category,title,content,result,note,start_at,end_at,sort_order,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?)",
      )
      .bind(
        itemId,
        subjectId,
        logId,
        input.category || "",
        input.title || "",
        input.content || "",
        input.result || "",
        input.note || "",
        input.startAt || null,
        input.endAt || null,
        input.sortOrder || 0,
        now,
        now,
      )
      .run();
    return this.first(
      "SELECT * FROM work_log_items WHERE subject_id=? AND item_id=?",
      subjectId,
      itemId,
    );
  }
  async updateItem(subjectId, logId, itemId, input, expectedVersion) {
    const item = await this.first(
        "SELECT * FROM work_log_items WHERE subject_id=? AND log_id=? AND item_id=? AND deleted_at IS NULL",
        subjectId,
        logId,
        itemId,
      ),
      log = await this.first(
        "SELECT * FROM work_logs WHERE subject_id=? AND log_id=?",
        subjectId,
        logId,
      );
    if (!item || !log) throw new WorkLogError("WORK_LOG_ITEM_NOT_FOUND", 404);
    if (log.status !== "DRAFT") throw new WorkLogError("WORK_LOG_FINAL", 409);
    if (Number.isInteger(expectedVersion) && log.version !== expectedVersion)
      throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
    await this.db
      .prepare(
        "UPDATE work_log_items SET category=?,title=?,content=?,result=?,note=?,start_at=?,end_at=?,sort_order=?,version=version+1,updated_at=? WHERE subject_id=? AND log_id=? AND item_id=?",
      )
      .bind(
        input.category ?? item.category,
        input.title ?? item.title,
        input.content ?? item.content,
        input.result ?? item.result,
        input.note ?? item.note,
        input.startAt ?? item.start_at,
        input.endAt ?? item.end_at,
        input.sortOrder ?? item.sort_order,
        this.now(),
        subjectId,
        logId,
        itemId,
      )
      .run();
    const changed=["category","title","content","result","note","startAt","endAt","sortOrder"].filter(key=>input[key]!==undefined),meta=changed.length&&await this.first("SELECT user_edited_fields_json FROM work_log_auto_item_metadata WHERE subject_id=? AND item_id=?",subjectId,itemId).catch(()=>null);
    if(meta)await this.db.prepare("UPDATE work_log_auto_item_metadata SET user_edited_fields_json=?,updated_at=? WHERE subject_id=? AND item_id=?").bind(JSON.stringify([...new Set([...JSON.parse(meta.user_edited_fields_json||"[]"),...changed])]),this.now(),subjectId,itemId).run();
    return this.first(
      "SELECT * FROM work_log_items WHERE subject_id=? AND item_id=?",
      subjectId,
      itemId,
    );
  }
  async deleteItem(subjectId, logId, itemId, expectedVersion) {
    const item = await this.first(
        "SELECT * FROM work_log_items WHERE subject_id=? AND log_id=? AND item_id=?",
        subjectId,
        logId,
        itemId,
      ),
      log = await this.first(
        "SELECT * FROM work_logs WHERE subject_id=? AND log_id=?",
        subjectId,
        logId,
      );
    if (!item || !log) throw new WorkLogError("WORK_LOG_ITEM_NOT_FOUND", 404);
    if (log.status !== "DRAFT") throw new WorkLogError("WORK_LOG_FINAL", 409);
    if (Number.isInteger(expectedVersion) && log.version !== expectedVersion)
      throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
    await this.db.batch([
      this.db
        .prepare(
          "DELETE FROM work_log_item_captures WHERE subject_id=? AND item_id=?",
        )
        .bind(subjectId, itemId),
      this.db
        .prepare(
          "UPDATE work_log_items SET deleted_at=?,updated_at=? WHERE subject_id=? AND item_id=?",
        )
        .bind(this.now(), this.now(), subjectId, itemId),
    ]);
    return true;
  }
  async attachCapture(
    subjectId,
    logId,
    itemId,
    captureId,
    expectedVersion,
    sortOrder = 0,
  ) {
    const item = await this.first(
        "SELECT i.*,l.status,l.version AS log_version FROM work_log_items i JOIN work_logs l ON l.subject_id=i.subject_id AND l.log_id=i.log_id WHERE i.subject_id=? AND i.item_id=?",
        subjectId,
        itemId,
      ),
      capture = await this.getCaptureById(subjectId, captureId);
    if (!item || !capture || item.log_id !== logId)
      throw new WorkLogError("ASSOCIATION_NOT_FOUND", 404);
    if (item.status !== "DRAFT") throw new WorkLogError("WORK_LOG_FINAL", 409);
    if (
      Number.isInteger(expectedVersion) &&
      item.log_version !== expectedVersion
    )
      throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO work_log_item_captures(subject_id,item_id,capture_id,sort_order,created_at) VALUES(?,?,?,?,?)",
      )
      .bind(subjectId, itemId, captureId, sortOrder, this.now())
      .run();
    return true;
  }
  async detachCapture(subjectId, logId, itemId, captureId, expectedVersion) {
    const item = await this.first(
      "SELECT i.*,l.status,l.version AS log_version FROM work_log_items i JOIN work_logs l ON l.subject_id=i.subject_id AND l.log_id=i.log_id WHERE i.subject_id=? AND i.log_id=? AND i.item_id=?",
      subjectId,
      logId,
      itemId,
    );
    if (!item) throw new WorkLogError("ASSOCIATION_NOT_FOUND", 404);
    if (item.status !== "DRAFT") throw new WorkLogError("WORK_LOG_FINAL", 409);
    if (
      Number.isInteger(expectedVersion) &&
      item.log_version !== expectedVersion
    )
      throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
    await this.db
      .prepare(
        "DELETE FROM work_log_item_captures WHERE subject_id=? AND item_id=? AND capture_id=?",
      )
      .bind(subjectId, itemId, captureId)
      .run();
    return true;
  }
  async createProject(subjectId, input) {
    const now = this.now(),
      projectId = input.projectId || this.id("prj"),
      name = String(input.name || "").trim(),
      normalized = normalizeProjectName(name);
    if (!name || name.length > 120)
      throw new WorkLogError("PROJECT_NAME_INVALID");
    try {
      await this.db
        .prepare(
          "INSERT INTO projects(project_id,subject_id,name,normalized_name,description,status,created_at,updated_at) VALUES(?,?,?,?,?,'ACTIVE',?,?)",
        )
        .bind(
          projectId,
          subjectId,
          name,
          normalized,
          String(input.description || ""),
          now,
          now,
        )
        .run();
    } catch (e) {
      if (/constraint|unique/i.test(String(e?.message || e)))
        throw new WorkLogError("PROJECT_NAME_CONFLICT", 409);
      throw e;
    }
    return this.getProject(subjectId, projectId);
  }
  getProject(subjectId, projectId) {
    return this.first(
      "SELECT * FROM projects WHERE subject_id=? AND project_id=?",
      subjectId,
      projectId,
    );
  }
  async listProjects(subjectId, { status = null } = {}) {
    const q = status
      ? this.db
          .prepare(
            "SELECT * FROM projects WHERE subject_id=? AND status=? ORDER BY updated_at DESC,project_id",
          )
          .bind(subjectId, status)
      : this.db
          .prepare(
            "SELECT * FROM projects WHERE subject_id=? ORDER BY updated_at DESC,project_id",
          )
          .bind(subjectId);
    return (await q.all()).results || [];
  }
  async updateProject(subjectId, projectId, input) {
    const old = await this.getProject(subjectId, projectId);
    if (!old) throw new WorkLogError("PROJECT_NOT_FOUND", 404);
    const name = String(input.name ?? old.name).trim(),
      normalized = normalizeProjectName(name);
    try {
      await this.db
        .prepare(
          "UPDATE projects SET name=?,normalized_name=?,description=?,updated_at=? WHERE subject_id=? AND project_id=?",
        )
        .bind(
          name,
          normalized,
          String(input.description ?? old.description),
          this.now(),
          subjectId,
          projectId,
        )
        .run();
    } catch (e) {
      if (/constraint|unique/i.test(String(e?.message || e)))
        throw new WorkLogError("PROJECT_NAME_CONFLICT", 409);
      throw e;
    }
    return this.getProject(subjectId, projectId);
  }
  async archiveProject(subjectId, projectId) {
    const now = this.now(),
      r = await this.db
        .prepare(
          "UPDATE projects SET status='ARCHIVED',archived_at=?,updated_at=? WHERE subject_id=? AND project_id=?",
        )
        .bind(now, now, subjectId, projectId)
        .run();
    if (!resultChanges(r)) throw new WorkLogError("PROJECT_NOT_FOUND", 404);
    return this.getProject(subjectId, projectId);
  }
  async listProjectMatchRules(subjectId) {
    const result=await this.db.prepare("SELECT g.rule_id ruleId,g.project_id projectId,p.name projectName,g.enabled,g.center_lat centerLatitude,g.center_lng centerLongitude,g.radius_m radiusMeters,g.priority,g.version ruleVersion,g.updated_at updatedAt FROM work_log_project_geofences g JOIN projects p ON p.subject_id=g.subject_id AND p.project_id=g.project_id WHERE g.subject_id=? AND g.enabled=1 AND p.status='ACTIVE' ORDER BY g.priority DESC,g.radius_m ASC,g.rule_id LIMIT 100").bind(subjectId).all();
    return (result.results||[]).map(row=>({...row,enabled:Boolean(row.enabled)}));
  }
  async getProjectGeofence(subjectId,projectId){const row=await this.first("SELECT g.*,p.name project_name,p.status project_status FROM work_log_project_geofences g JOIN projects p ON p.subject_id=g.subject_id AND p.project_id=g.project_id WHERE g.subject_id=? AND g.project_id=?",subjectId,projectId);return row?{ruleId:row.rule_id,projectId:row.project_id,projectName:row.project_name,projectStatus:row.project_status,enabled:Boolean(row.enabled),centerLatitude:row.center_lat,centerLongitude:row.center_lng,radiusMeters:row.radius_m,priority:row.priority,ruleVersion:row.version,createdAt:row.created_at,updatedAt:row.updated_at}:null}
  async upsertProjectGeofence(subjectId,projectId,input){const project=await this.getProject(subjectId,projectId);if(!project)throw new WorkLogError("PROJECT_NOT_FOUND",404);const current=await this.getProjectGeofence(subjectId,projectId),values=validateProjectGeofenceInput(input,{partial:Boolean(current)}),now=this.now();if(current){if(values.ifVersion!==current.ruleVersion)throw new WorkLogError("PROJECT_GEOFENCE_VERSION_CONFLICT",409);const result=await this.db.prepare("UPDATE work_log_project_geofences SET enabled=?,center_lat=?,center_lng=?,radius_m=?,priority=?,version=version+1,updated_at=? WHERE subject_id=? AND project_id=? AND version=?").bind((values.enabled??current.enabled)?1:0,values.centerLatitude??current.centerLatitude,values.centerLongitude??current.centerLongitude,values.radiusMeters??current.radiusMeters,values.priority??current.priority,now,subjectId,projectId,current.ruleVersion).run();if(!resultChanges(result))throw new WorkLogError("PROJECT_GEOFENCE_VERSION_CONFLICT",409)}else await this.db.prepare("INSERT INTO work_log_project_geofences(rule_id,subject_id,project_id,enabled,center_lat,center_lng,radius_m,priority,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)").bind(input.ruleId||this.id("geo"),subjectId,projectId,values.enabled?1:0,values.centerLatitude,values.centerLongitude,values.radiusMeters,values.priority,now,now).run();return this.getProjectGeofence(subjectId,projectId)}
  async createTag(subjectId, input) {
    const now = this.now(),
      tagId = input.tagId || this.id("tag"),
      name = String(input.name || "").trim(),
      normalized = normalizeProjectName(name);
    if (!name || name.length > 80) throw new WorkLogError("TAG_NAME_INVALID");
    try {
      await this.db
        .prepare(
          "INSERT INTO tags(tag_id,subject_id,name,normalized_name,created_at) VALUES(?,?,?,?,?)",
        )
        .bind(tagId, subjectId, name, normalized, now)
        .run();
    } catch (e) {
      if (/constraint|unique/i.test(String(e?.message || e)))
        throw new WorkLogError("TAG_NAME_CONFLICT", 409);
      throw e;
    }
    return this.first(
      "SELECT * FROM tags WHERE subject_id=? AND tag_id=?",
      subjectId,
      tagId,
    );
  }
  async listTags(subjectId) {
    return (
      (
        await this.db
          .prepare(
            "SELECT * FROM tags WHERE subject_id=? ORDER BY normalized_name,tag_id",
          )
          .bind(subjectId)
          .all()
      ).results || []
    );
  }
  async updateTag(subjectId, tagId, input) {
    const old = await this.first(
      "SELECT * FROM tags WHERE subject_id=? AND tag_id=?",
      subjectId,
      tagId,
    );
    if (!old) throw new WorkLogError("TAG_NOT_FOUND", 404);
    const name = String(input.name ?? old.name).trim(),
      normalized = normalizeProjectName(name);
    try {
      await this.db
        .prepare(
          "UPDATE tags SET name=?,normalized_name=? WHERE subject_id=? AND tag_id=?",
        )
        .bind(name, normalized, subjectId, tagId)
        .run();
    } catch (e) {
      if (/constraint|unique/i.test(String(e?.message || e)))
        throw new WorkLogError("TAG_NAME_CONFLICT", 409);
      throw e;
    }
    return this.first(
      "SELECT * FROM tags WHERE subject_id=? AND tag_id=?",
      subjectId,
      tagId,
    );
  }
  async deleteTag(subjectId, tagId) {
    const old = await this.first(
      "SELECT * FROM tags WHERE subject_id=? AND tag_id=?",
      subjectId,
      tagId,
    );
    if (!old) throw new WorkLogError("TAG_NOT_FOUND", 404);
    await this.db.batch([
      this.db
        .prepare("DELETE FROM work_log_tags WHERE subject_id=? AND tag_id=?")
        .bind(subjectId, tagId),
      this.db
        .prepare("DELETE FROM tags WHERE subject_id=? AND tag_id=?")
        .bind(subjectId, tagId),
    ]);
    return true;
  }
  async attachTag(subjectId, logId, tagId) {
    const log = await this.first(
        "SELECT * FROM work_logs WHERE subject_id=? AND log_id=?",
        subjectId,
        logId,
      ),
      tag = await this.first(
        "SELECT * FROM tags WHERE subject_id=? AND tag_id=?",
        subjectId,
        tagId,
      );
    if (!log || !tag) throw new WorkLogError("ASSOCIATION_NOT_FOUND", 404);
    if (log.status !== "DRAFT") throw new WorkLogError("WORK_LOG_FINAL", 409);
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO work_log_tags(subject_id,log_id,tag_id,created_at) VALUES(?,?,?,?)",
      )
      .bind(subjectId, logId, tagId, this.now())
      .run();
    return true;
  }
}
const enc = (value) => new TextEncoder().encode(JSON.stringify(value)),
  dec = (value) =>
    value
      ? JSON.parse(
          new TextDecoder().decode(
            value instanceof Uint8Array ? value : new Uint8Array(value),
          ),
        )
      : null;
export class EdgeOneBlobWorkLogRepository {
  constructor(
    store,
    {
      now = () => Date.now(),
      random = () => crypto.randomUUID().replace(/-/g, ""),
      maxRetries = 5,
    } = {},
  ) {
    this.store = store;
    this.now = now;
    this.random = random;
    this.maxRetries = maxRetries;
  }
  key(...parts) {
    return [
      "wl",
      "v1",
      ...parts.map((x) => encodeURIComponent(String(x))),
    ].join(":");
  }
  async read(key) {
    const x = await this.store
      .getWithHeaders(key, { type: "arrayBuffer" })
      .catch(() => null);
    if (!x) return null;
    const body = x.data ?? x.value ?? x;
    return {
      value: dec(body),
      etag: x.etag || x.headers?.get?.("etag") || x.metadata?.etag || null,
    };
  }
  async createOnly(key, value) {
    if (this.store.putIfAbsent) return this.store.putIfAbsent(key, enc(value));
    try {
      await this.store.set(key, enc(value), {
        onlyIf: { etagDoesNotMatch: "*" },
      });
      return true;
    } catch (e) {
      if (/precondition|exist|412/i.test(String(e?.message || e))) return false;
      throw e;
    }
  }
  async cas(key, value, etag) {
    if (this.store.compareAndSet)
      return this.store.compareAndSet(key, etag, enc(value));
    try {
      await this.store.set(key, enc(value), {
        onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: "*" },
      });
      return true;
    } catch (e) {
      if (/precondition|etag|412/i.test(String(e?.message || e))) return false;
      throw e;
    }
  }
  async insertIdempotentCapture({
    subjectId,
    snapshot,
    payloadDigest,
    simulateUnknown = false,
  }) {
    const v = validateCaptureSnapshot(snapshot),
      captureId = `capr_${this.random()}`,
      operationId = `op_${this.random()}`,
      subjectKey = this.key("subject", subjectId),
      clientKey = this.key("capture-client", subjectId, v.clientCaptureId),
      codeKey = this.key("jilu-code", v.jiluCode),
      bodyKey = this.key("capture", subjectId, captureId),
      opKey = this.key("operation", operationId),
      now = this.now();
    const prior = await this.read(clientKey);
    if (prior) {
      if (prior.value.payloadDigest !== payloadDigest)
        throw new WorkLogError("CAPTURE_IDEMPOTENCY_CONFLICT", 409);
      const body = await this.read(prior.value.bodyKey);
      return { status: "ALREADY_EXISTS", capture: body?.value };
    }
    await this.createOnly(opKey, {
      schemaVersion: 1,
      state: "PREPARED",
      operationId,
      subjectId,
      captureId,
      clientCaptureId: v.clientCaptureId,
      jiluCode: v.jiluCode,
      payloadDigest,
      createdAt: now,
    });
    if (
      !(await this.createOnly(clientKey, {
        schemaVersion: 1,
        subjectId,
        captureId,
        bodyKey,
        payloadDigest,
        operationId,
      }))
    )
      return this.insertIdempotentCapture({
        subjectId,
        snapshot,
        payloadDigest,
      });
    if (
      !(await this.createOnly(codeKey, {
        schemaVersion: 1,
        subjectId,
        captureId,
        bodyKey,
        payloadDigest,
        operationId,
      }))
    ) {
      await this.cas(
        opKey,
        {
          schemaVersion: 1,
          state: "COMPENSATION_REQUIRED",
          operationId,
          reason: "JILU_CODE_COLLISION",
        },
        (await this.read(opKey))?.etag,
      );
      throw new WorkLogError("JILU_CODE_COLLISION", 409);
    }
    const capture = {
      schemaVersion: 1,
      captureId,
      subjectId,
      clientCaptureId: v.clientCaptureId,
      jiluCode: v.jiluCode,
      localDate: v.localDate,
      payloadDigest,
      snapshot: v.snapshot,
      createdAt: now,
      updatedAt: now,
    };
    await this.createOnly(bodyKey, capture);
    let committed = false;
    for (let attempt = 0; attempt < this.maxRetries && !committed; attempt++) {
      const head = await this.read(subjectKey),
        manifest = head?.value || {
          schemaVersion: 1,
          version: 0,
          captures: [],
        };
      if (!manifest.captures.includes(captureId))
        manifest.captures = [captureId, ...manifest.captures];
      committed = await this.cas(
        subjectKey,
        { ...manifest, version: manifest.version + 1, updatedAt: now },
        head?.etag || null,
      );
    }
    if (!committed) {
      await this.cas(
        opKey,
        {
          schemaVersion: 1,
          state: "COMPENSATION_REQUIRED",
          operationId,
          reason: "MANIFEST_CONFLICT",
        },
        (await this.read(opKey))?.etag,
      );
      throw new WorkLogError("REPOSITORY_COMMIT_CONFLICT", 503);
    }
    await this.cas(
      opKey,
      {
        schemaVersion: 1,
        state: "COMMITTED",
        operationId,
        subjectId,
        captureId,
        payloadDigest,
        committedAt: now,
      },
      (await this.read(opKey))?.etag,
    );
    if (simulateUnknown)
      throw new WorkLogError("SIMULATED_UNKNOWN_RESPONSE", 503);
    return { status: "CREATED", capture };
  }
  async getCaptureByClientCaptureId(subjectId, id) {
    const claim = await this.read(this.key("capture-client", subjectId, id));
    if (!claim || claim.value.subjectId !== subjectId) return null;
    return (await this.read(claim.value.bodyKey))?.value || null;
  }
  async getCaptureById(subjectId, captureId) {
    return (
      (await this.read(this.key("capture", subjectId, captureId)))?.value ||
      null
    );
  }
  async getCaptureByJiluCode(subjectId, code) {
    try {
      code = normalizeJiluCode(code);
    } catch {
      return null;
    }
    const claim = await this.read(this.key("jilu-code", code));
    if (!claim || claim.value.subjectId !== subjectId) return null;
    return (await this.read(claim.value.bodyKey))?.value || null;
  }
  async listCaptures(subjectId, { limit = 50, offset = 0 } = {}) {
    const head = await this.read(this.key("subject", subjectId)),
      ids = (head?.value?.captures || []).slice(
        offset,
        offset + Math.min(100, limit),
      );
    return (
      await Promise.all(
        ids.map((id) => this.read(this.key("capture", subjectId, id))),
      )
    )
      .map((x) => x?.value)
      .filter(Boolean);
  }
  async getCapturesByPhotoSha(subjectId, sha) {
    return (await this.listCaptures(subjectId, { limit: 100 })).filter(
      (x) => x.snapshot?.photo?.sha256 === sha,
    );
  }
  async linkProvenanceRecord(
    subjectId,
    captureId,
    { clientTaskId = null, recordId },
  ) {
    const key = this.key("capture-link", subjectId, captureId),
      capture = await this.getCaptureById(subjectId, captureId);
    if (!capture) throw new WorkLogError("CAPTURE_NOT_FOUND", 404);
    const prior = await this.read(key);
    if (prior?.value?.recordId && prior.value.recordId !== recordId)
      throw new WorkLogError("PROVENANCE_LINK_CONFLICT", 409);
    if (!prior)
      await this.createOnly(key, {
        schemaVersion: 1,
        subjectId,
        captureId,
        clientTaskId,
        recordId,
        linkedAt: this.now(),
      });
    return {
      ...capture,
      provenanceClientTaskId: prior?.value?.clientTaskId || clientTaskId,
      provenanceRecordId: prior?.value?.recordId || recordId,
    };
  }
  async reconcile(operationId) {
    const opKey = this.key("operation", operationId),
      op = await this.read(opKey);
    if (!op) return { status: "MISSING" };
    if (op.value.state === "COMMITTED") return { status: "COMMITTED" };
    const claim = await this.read(
        this.key(
          "capture-client",
          op.value.subjectId,
          op.value.clientCaptureId,
        ),
      ),
      body = claim && (await this.read(claim.value.bodyKey));
    if (body) {
      const subjectKey = this.key("subject", op.value.subjectId),
        head = await this.read(subjectKey),
        manifest = head?.value || {
          schemaVersion: 1,
          version: 0,
          captures: [],
        };
      if (!manifest.captures.includes(op.value.captureId))
        manifest.captures.unshift(op.value.captureId);
      if (
        await this.cas(
          subjectKey,
          { ...manifest, version: manifest.version + 1, updatedAt: this.now() },
          head?.etag || null,
        )
      ) {
        await this.cas(
          opKey,
          { ...op.value, state: "COMMITTED", committedAt: this.now() },
          op.etag,
        );
        return { status: "COMMITTED" };
      }
    }
    return { status: "RETRY" };
  }
  async mutateAggregate(subjectId, logId, mutator, { create = false } = {}) {
    const headKey = this.key("log-head", subjectId, logId);
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const head = await this.read(headKey);
      if (!head && !create) throw new WorkLogError("WORK_LOG_NOT_FOUND", 404);
      const prior = head ? await this.read(head.value.objectKey) : null,
        current = prior?.value || null,
        next = mutator(current),
        version = (head?.value?.version || 0) + 1,
        objectKey = this.key("log", subjectId, logId, `v${version}`);
      await this.createOnly(objectKey, { ...next, subjectId, logId, version });
      if (
        await this.cas(
          headKey,
          {
            schemaVersion: 1,
            subjectId,
            logId,
            version,
            objectKey,
            status: next.status,
          },
          head?.etag || null,
        )
      )
        return { ...next, subjectId, logId, version };
    }
    throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
  }
  async createWorkLog(subjectId, input) {
    const logId = input.logId || `log_${this.random()}`,
      now = this.now(),
      created = await this.mutateAggregate(
        subjectId,
        logId,
        () => ({
          schemaVersion: 1,
          status: "DRAFT",
          localDate: input.localDate,
          timezone: input.timezone || null,
          title: input.title,
          summary: input.summary || "",
          projectId: input.projectId || null,
          projectNameSnapshot: input.projectNameSnapshot || null,
          items: [],
          captureAssociations: [],
          tagIds: [],
          createdAt: now,
          updatedAt: now,
          finalizedAt: null,
          deletedAt: null,
        }),
        { create: true },
      );
    const key = this.key("log-list", subjectId);
    for (let i = 0; i < this.maxRetries; i++) {
      const h = await this.read(key),
        v = h?.value || { schemaVersion: 1, version: 0, logIds: [] };
      if (
        await this.cas(
          key,
          {
            ...v,
            version: v.version + 1,
            logIds: [logId, ...v.logIds.filter((x) => x !== logId)],
          },
          h?.etag || null,
        )
      )
        break;
    }
    return created;
  }
  async getWorkLog(subjectId, logId) {
    const head = await this.read(this.key("log-head", subjectId, logId));
    if (!head) return null;
    const log = (await this.read(head.value.objectKey))?.value;
    return log && log.status !== "DELETED" ? log : null;
  }
  async listWorkLogs(
    subjectId,
    { status = null, limit = 50, offset = 0 } = {},
  ) {
    const index = await this.read(this.key("log-list", subjectId)),
      ids = (index?.value?.logIds || []).slice(
        offset,
        offset + Math.min(100, limit),
      ),
      logs = (
        await Promise.all(ids.map((id) => this.getWorkLog(subjectId, id)))
      ).filter(Boolean);
    return status ? logs.filter((x) => x.status === status) : logs;
  }
  patchWorkLog(
    subjectId,
    logId,
    patch,
    expectedVersion,
    { automatic = false } = {},
  ) {
    return this.mutateAggregate(subjectId, logId, (current) => {
      if (current.version !== expectedVersion)
        throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
      if (current.status !== "DRAFT")
        throw new WorkLogError(
          automatic ? "WORK_LOG_FINAL" : "WORK_LOG_NOT_EDITABLE",
          409,
        );
      return {
        ...current,
        title: patch.title ?? current.title,
        summary: patch.summary ?? current.summary,
        projectId: patch.projectId ?? current.projectId,
        projectNameSnapshot:
          patch.projectNameSnapshot ?? current.projectNameSnapshot,
        updatedAt: this.now(),
        userEditedSummary:
          current.autoManaged && !automatic && patch.summary !== undefined
            ? true
            : current.userEditedSummary,
      };
    });
  }
  finalizeWorkLog(subjectId, logId, expectedVersion) {
    return this.mutateAggregate(subjectId, logId, (current) => {
      if (current.version !== expectedVersion)
        throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
      if (current.status !== "DRAFT")
        throw new WorkLogError("WORK_LOG_TRANSITION_INVALID", 409);
      const now = this.now();
      return { ...current, status: "FINAL", updatedAt: now, finalizedAt: now };
    });
  }
  archiveWorkLog(subjectId, logId, expectedVersion) {
    return this.mutateAggregate(subjectId, logId, (current) => {
      if (current.version !== expectedVersion)
        throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
      if (!transitionAllowed(current.status, "ARCHIVED"))
        throw new WorkLogError("WORK_LOG_TRANSITION_INVALID", 409);
      return { ...current, status: "ARCHIVED", updatedAt: this.now() };
    });
  }
  softDeleteWorkLog(subjectId, logId, expectedVersion) {
    return this.mutateAggregate(subjectId, logId, (current) => {
      if (current.version !== expectedVersion)
        throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
      if (!transitionAllowed(current.status, "DELETED"))
        throw new WorkLogError("WORK_LOG_TRANSITION_INVALID", 409);
      const now = this.now();
      return {
        ...current,
        status: "DELETED",
        updatedAt: now,
        deletedAt: now,
        deleteAfter: now + 30 * 86400000,
      };
    });
  }
  restoreWorkLog(subjectId, logId, expectedVersion) {
    return this.mutateAggregate(subjectId, logId, (current) => {
      if (current.version !== expectedVersion)
        throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
      if (current.status !== "DELETED")
        throw new WorkLogError("WORK_LOG_TRANSITION_INVALID", 409);
      return {
        ...current,
        status: "DRAFT",
        updatedAt: this.now(),
        deletedAt: null,
        deleteAfter: null,
      };
    });
  }
  createItem(subjectId, logId, input, expectedVersion) {
    return this.mutateAggregate(subjectId, logId, (current) => {
      if (current.version !== expectedVersion)
        throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
      if (current.status !== "DRAFT")
        throw new WorkLogError("WORK_LOG_FINAL", 409);
      const item = {
        itemId: input.itemId || `item_${this.random()}`,
        category: input.category || "",
        title: input.title,
        content: input.content || "",
        result: input.result || "",
        note: input.note || "",
        startAt: input.startAt || null,
        endAt: input.endAt || null,
        sortOrder: input.sortOrder || 0,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      return {
        ...current,
        items: [...current.items, item],
        updatedAt: this.now(),
      };
    });
  }
  updateItem(subjectId, logId, itemId, input, expectedVersion) {
    return this.mutateAggregate(subjectId, logId, (current) => {
      if (current.version !== expectedVersion)
        throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
      if (current.status !== "DRAFT")
        throw new WorkLogError("WORK_LOG_FINAL", 409);
      const index = current.items.findIndex((x) => x.itemId === itemId);
      if (index < 0) throw new WorkLogError("WORK_LOG_ITEM_NOT_FOUND", 404);
      const items = [...current.items],
        old = items[index];
      items[index] = {
        ...old,
        category: input.category ?? old.category,
        title: input.title ?? old.title,
        content: input.content ?? old.content,
        result: input.result ?? old.result,
        note: input.note ?? old.note,
        startAt: input.startAt ?? old.startAt,
        endAt: input.endAt ?? old.endAt,
        sortOrder: input.sortOrder ?? old.sortOrder,
        updatedAt: this.now(),
        userEditedFields: old.autoManaged
          ? [...new Set([...(old.userEditedFields || []), ...["category","title","content","result","note","startAt","endAt","sortOrder"].filter((key) => input[key] !== undefined)])]
          : old.userEditedFields,
      };
      return { ...current, items, updatedAt: this.now() };
    });
  }
  deleteItem(subjectId, logId, itemId, expectedVersion) {
    return this.mutateAggregate(subjectId, logId, (current) => {
      if (current.version !== expectedVersion)
        throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
      if (current.status !== "DRAFT")
        throw new WorkLogError("WORK_LOG_FINAL", 409);
      if (!current.items.some((x) => x.itemId === itemId))
        throw new WorkLogError("WORK_LOG_ITEM_NOT_FOUND", 404);
      return {
        ...current,
        items: current.items.filter((x) => x.itemId !== itemId),
        captureAssociations: current.captureAssociations.filter(
          (x) => x.itemId !== itemId,
        ),
        updatedAt: this.now(),
      };
    });
  }
  async attachCapture(
    subjectId,
    logId,
    itemId,
    captureId,
    expectedVersion,
    sortOrder = 0,
  ) {
    if (!(await this.getCaptureById(subjectId, captureId)))
      throw new WorkLogError("ASSOCIATION_NOT_FOUND", 404);
    return this.mutateAggregate(subjectId, logId, (current) => {
      if (current.version !== expectedVersion)
        throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
      if (current.status !== "DRAFT")
        throw new WorkLogError("WORK_LOG_FINAL", 409);
      if (!current.items.some((x) => x.itemId === itemId))
        throw new WorkLogError("ASSOCIATION_NOT_FOUND", 404);
      return {
        ...current,
        captureAssociations: [
          ...current.captureAssociations.filter(
            (x) => !(x.itemId === itemId && x.captureId === captureId),
          ),
          { itemId, captureId, sortOrder, createdAt: this.now() },
        ],
        updatedAt: this.now(),
      };
    });
  }
  detachCapture(subjectId, logId, itemId, captureId, expectedVersion) {
    return this.mutateAggregate(subjectId, logId, (current) => {
      if (current.version !== expectedVersion)
        throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
      if (current.status !== "DRAFT")
        throw new WorkLogError("WORK_LOG_FINAL", 409);
      if (!current.items.some((x) => x.itemId === itemId))
        throw new WorkLogError("ASSOCIATION_NOT_FOUND", 404);
      return {
        ...current,
        captureAssociations: current.captureAssociations.filter(
          (x) => !(x.itemId === itemId && x.captureId === captureId),
        ),
        updatedAt: this.now(),
      };
    });
  }
  async createProject(subjectId, input) {
    const projectId = input.projectId || `prj_${this.random()}`,
      name = String(input.name || "").trim(),
      normalizedName = normalizeProjectName(name),
      claimKey = this.key("project-name", subjectId, normalizedName);
    if (!name || name.length > 120)
      throw new WorkLogError("PROJECT_NAME_INVALID");
    if (
      !(await this.createOnly(claimKey, {
        schemaVersion: 1,
        subjectId,
        projectId,
      }))
    )
      throw new WorkLogError("PROJECT_NAME_CONFLICT", 409);
    const value = {
      schemaVersion: 1,
      projectId,
      subjectId,
      name,
      normalizedName,
      description: String(input.description || ""),
      status: "ACTIVE",
      createdAt: this.now(),
      updatedAt: this.now(),
      archivedAt: null,
    };
    await this.createOnly(this.key("project", subjectId, projectId), value);
    const listKey = this.key("project-list", subjectId);
    for (let i = 0; i < this.maxRetries; i++) {
      const h = await this.read(listKey),
        v = h?.value || { schemaVersion: 1, version: 0, projectIds: [] };
      if (
        await this.cas(
          listKey,
          {
            ...v,
            version: v.version + 1,
            projectIds: [
              projectId,
              ...v.projectIds.filter((x) => x !== projectId),
            ],
          },
          h?.etag || null,
        )
      )
        break;
    }
    return value;
  }
  async getProject(subjectId, projectId) {
    return (
      (await this.read(this.key("project", subjectId, projectId)))?.value ||
      null
    );
  }
  async listProjects(subjectId, { status = null } = {}) {
    const list = await this.read(this.key("project-list", subjectId)),
      values = (
        await Promise.all(
          (list?.value?.projectIds || []).map((id) =>
            this.getProject(subjectId, id),
          ),
        )
      ).filter(Boolean);
    return status ? values.filter((x) => x.status === status) : values;
  }
  async updateProject(subjectId, projectId, input) {
    const key = this.key("project", subjectId, projectId),
      old = await this.read(key);
    if (!old) throw new WorkLogError("PROJECT_NOT_FOUND", 404);
    const name = String(input.name ?? old.value.name).trim(),
      normalizedName = normalizeProjectName(name);
    if (
      normalizedName !== old.value.normalizedName &&
      !(await this.createOnly(
        this.key("project-name", subjectId, normalizedName),
        { subjectId, projectId },
      ))
    )
      throw new WorkLogError("PROJECT_NAME_CONFLICT", 409);
    const next = {
      ...old.value,
      name,
      normalizedName,
      description: String(input.description ?? old.value.description),
      updatedAt: this.now(),
    };
    if (!(await this.cas(key, next, old.etag)))
      throw new WorkLogError("PROJECT_VERSION_CONFLICT", 409);
    return next;
  }
  async archiveProject(subjectId, projectId) {
    const key = this.key("project", subjectId, projectId),
      p = await this.read(key);
    if (!p) throw new WorkLogError("PROJECT_NOT_FOUND", 404);
    const next = {
      ...p.value,
      status: "ARCHIVED",
      archivedAt: this.now(),
      updatedAt: this.now(),
    };
    if (!(await this.cas(key, next, p.etag)))
      throw new WorkLogError("PROJECT_VERSION_CONFLICT", 409);
    return next;
  }
  async getProjectGeofence(subjectId,projectId){return (await this.read(this.key("project-geofence",subjectId,projectId)))?.value||null}
  async listProjectMatchRules(subjectId){const projects=await this.listProjects(subjectId,{status:"ACTIVE"}),rules=(await Promise.all(projects.map(project=>this.getProjectGeofence(subjectId,project.projectId)))).filter(rule=>rule?.enabled).map(rule=>({ruleId:rule.ruleId,projectId:rule.projectId,projectName:projects.find(project=>project.projectId===rule.projectId)?.name||rule.projectName,enabled:true,centerLatitude:rule.centerLatitude,centerLongitude:rule.centerLongitude,radiusMeters:rule.radiusMeters,priority:rule.priority,ruleVersion:rule.ruleVersion,updatedAt:rule.updatedAt}));return rules.sort((a,b)=>b.priority-a.priority||a.radiusMeters-b.radiusMeters||a.ruleId.localeCompare(b.ruleId)).slice(0,100)}
  async upsertProjectGeofence(subjectId,projectId,input){const project=await this.getProject(subjectId,projectId);if(!project)throw new WorkLogError("PROJECT_NOT_FOUND",404);const key=this.key("project-geofence",subjectId,projectId),current=await this.read(key),values=validateProjectGeofenceInput(input,{partial:Boolean(current)}),now=this.now();if(current&&values.ifVersion!==current.value.ruleVersion)throw new WorkLogError("PROJECT_GEOFENCE_VERSION_CONFLICT",409);const next=current?{...current.value,enabled:values.enabled??current.value.enabled,centerLatitude:values.centerLatitude??current.value.centerLatitude,centerLongitude:values.centerLongitude??current.value.centerLongitude,radiusMeters:values.radiusMeters??current.value.radiusMeters,priority:values.priority??current.value.priority,projectName:project.name,ruleVersion:current.value.ruleVersion+1,updatedAt:now}:{schemaVersion:1,ruleId:input.ruleId||`geo_${this.random()}`,subjectId,projectId,projectName:project.name,enabled:values.enabled,centerLatitude:values.centerLatitude,centerLongitude:values.centerLongitude,radiusMeters:values.radiusMeters,priority:values.priority,ruleVersion:1,createdAt:now,updatedAt:now};const ok=current?await this.cas(key,next,current.etag):await this.createOnly(key,next);if(!ok)throw new WorkLogError("PROJECT_GEOFENCE_VERSION_CONFLICT",409);return next}
  async createTag(subjectId, input) {
    const tagId = input.tagId || `tag_${this.random()}`,
      name = String(input.name || "").trim(),
      normalizedName = normalizeProjectName(name);
    if (!name || name.length > 80) throw new WorkLogError("TAG_NAME_INVALID");
    if (
      !(await this.createOnly(this.key("tag-name", subjectId, normalizedName), {
        subjectId,
        tagId,
      }))
    )
      throw new WorkLogError("TAG_NAME_CONFLICT", 409);
    const tag = {
      schemaVersion: 1,
      tagId,
      subjectId,
      name,
      normalizedName,
      createdAt: this.now(),
    };
    await this.createOnly(this.key("tag", subjectId, tagId), tag);
    const listKey = this.key("tag-list", subjectId);
    for (let i = 0; i < this.maxRetries; i++) {
      const h = await this.read(listKey),
        v = h?.value || { schemaVersion: 1, version: 0, tagIds: [] };
      if (
        await this.cas(
          listKey,
          {
            ...v,
            version: v.version + 1,
            tagIds: [tagId, ...v.tagIds.filter((x) => x !== tagId)],
          },
          h?.etag || null,
        )
      )
        break;
    }
    return tag;
  }
  async listTags(subjectId) {
    const list = await this.read(this.key("tag-list", subjectId));
    return (
      await Promise.all(
        (list?.value?.tagIds || []).map((id) =>
          this.read(this.key("tag", subjectId, id)),
        ),
      )
    )
      .map((x) => x?.value)
      .filter(Boolean);
  }
  async updateTag(subjectId, tagId, input) {
    const key = this.key("tag", subjectId, tagId),
      old = await this.read(key);
    if (!old) throw new WorkLogError("TAG_NOT_FOUND", 404);
    const name = String(input.name ?? old.value.name).trim(),
      normalizedName = normalizeProjectName(name);
    if (
      normalizedName !== old.value.normalizedName &&
      !(await this.createOnly(this.key("tag-name", subjectId, normalizedName), {
        subjectId,
        tagId,
      }))
    )
      throw new WorkLogError("TAG_NAME_CONFLICT", 409);
    const next = { ...old.value, name, normalizedName };
    if (!(await this.cas(key, next, old.etag)))
      throw new WorkLogError("TAG_VERSION_CONFLICT", 409);
    return next;
  }
  async deleteTag(subjectId, tagId) {
    const key = this.key("tag", subjectId, tagId),
      old = await this.read(key);
    if (!old) throw new WorkLogError("TAG_NOT_FOUND", 404);
    const tombstone = { ...old.value, deletedAt: this.now() };
    if (!(await this.cas(key, tombstone, old.etag)))
      throw new WorkLogError("TAG_VERSION_CONFLICT", 409);
    return true;
  }
  async attachTag(subjectId, logId, tagId, expectedVersion) {
    if (!(await this.read(this.key("tag", subjectId, tagId))))
      throw new WorkLogError("ASSOCIATION_NOT_FOUND", 404);
    return this.mutateAggregate(subjectId, logId, (current) => {
      if (current.version !== expectedVersion)
        throw new WorkLogError("WORK_LOG_VERSION_CONFLICT", 409);
      if (current.status !== "DRAFT")
        throw new WorkLogError("WORK_LOG_FINAL", 409);
      return {
        ...current,
        tagIds: [...new Set([...(current.tagIds || []), tagId])],
        updatedAt: this.now(),
      };
    });
  }
}

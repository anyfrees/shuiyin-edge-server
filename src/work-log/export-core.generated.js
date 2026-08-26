import { payloadDigest, WorkLogError } from "./core.js";

export const EXPORT_SCHEMA_VERSION = 1;
export const EXPORT_MAX_DAYS = 366;
export const EXPORT_MAX_ROWS = 100000;
export const EXPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DATE = /^20\d\d-\d\d-\d\d$/;
const ALLOWED_QUERY = new Set(["dateFrom", "dateTo", "projectId", "status", "logIds", "includeCaptures"]);
const STATUS = new Set(["DRAFT", "FINAL", "ARCHIVED", "DELETED"]);
const text = (value) => value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
const publicValue = (value) => {
  if (Array.isArray(value)) return value.map(publicValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "subjectId" && key !== "subject_id" && !/(?:localImagePath|photoBytes|base64|binary|blob|albumAsset)/i.test(key)).map(([key, child]) => [key, publicValue(child)]));
};
const days = (from, to) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

export const validateExportQuery = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !ALLOWED_QUERY.has(key))) throw new WorkLogError("EXPORT_INVALID_QUERY", 400);
  const query = {
    dateFrom: String(input.dateFrom || ""), dateTo: String(input.dateTo || ""),
    projectId: input.projectId == null || input.projectId === "" ? null : String(input.projectId),
    status: input.status == null || input.status === "" ? null : String(input.status),
    logIds: input.logIds == null ? [] : input.logIds.map(String),
    includeCaptures: input.includeCaptures !== false,
  };
  if (!DATE.test(query.dateFrom) || !DATE.test(query.dateTo) || days(query.dateFrom, query.dateTo) < 1 || days(query.dateFrom, query.dateTo) > EXPORT_MAX_DAYS) throw new WorkLogError("EXPORT_INVALID_QUERY", 400);
  if (query.status && !STATUS.has(query.status)) throw new WorkLogError("EXPORT_INVALID_QUERY", 400);
  if (!Array.isArray(input.logIds || []) || query.logIds.length > 1000 || query.logIds.some((id) => !id || id.length > 200)) throw new WorkLogError("EXPORT_INVALID_QUERY", 400);
  if (query.projectId && query.projectId.length > 200) throw new WorkLogError("EXPORT_INVALID_QUERY", 400);
  return query;
};

const normalizeItem = (item, logId) => publicValue({
  itemId: item.itemId || item.item_id, logId, category: item.category || "", title: item.title || "",
  content: item.content || "", result: item.result || "", note: item.note || "", startAt: item.startAt ?? item.start_at ?? null,
  endAt: item.endAt ?? item.end_at ?? null, sortOrder: item.sortOrder ?? item.sort_order ?? 0,
  createdAt: item.createdAt ?? item.created_at ?? null, updatedAt: item.updatedAt ?? item.updated_at ?? null,
});
const normalizeLog = (log) => publicValue({
  logId: log.logId || log.log_id, localDate: log.localDate || log.local_date, timezone: log.timezone || null,
  title: log.title || "", summary: log.summary || "", projectId: log.projectId ?? log.project_id ?? null,
  projectNameSnapshot: log.projectNameSnapshot ?? log.project_name_snapshot ?? null, status: log.status,
  version: log.version, createdAt: log.createdAt ?? log.created_at, updatedAt: log.updatedAt ?? log.updated_at,
  finalizedAt: log.finalizedAt ?? log.finalized_at ?? null, deletedAt: log.deletedAt ?? log.deleted_at ?? null,
});
const parsed = (value) => { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return null; } };
const normalizeCapture = (capture) => publicValue(capture.captureId ? capture : {
  captureId:capture.capture_id,clientCaptureId:capture.client_capture_id,jiluCode:capture.jilu_code,capturedAt:capture.captured_at,
  localDate:capture.local_date,timezone:capture.timezone,utcOffsetMinutes:capture.utc_offset_minutes,
  template:{origin:capture.template_source,templateId:capture.template_id,version:capture.template_version,nameSnapshot:capture.template_name_snapshot},
  project:{projectId:capture.project_id,projectNameSnapshot:capture.project_name_snapshot},location:parsed(capture.location_json),weather:parsed(capture.weather_json),
  fields:parsed(capture.fields_json)||[],rendered:parsed(capture.rendered_json),photoSha256:capture.photo_sha256,photoStorageState:capture.photo_storage_state,
  provenanceRecordId:capture.provenance_record_id,createdAt:capture.created_at,updatedAt:capture.updated_at,
});
const normalizeLink = (link, logId) => ({ logId, itemId: link.itemId || link.item_id, captureId: link.captureId || link.capture_id, sortOrder: link.sortOrder ?? link.sort_order ?? 0 });

export const buildExportModel = async ({ repository, subjectId, query: rawQuery, now = () => Date.now() }) => {
  const query = validateExportQuery(rawQuery), startedAt = now(), selected = [], wanted = new Set(query.logIds);
  for (let offset = 0; ; offset += 100) {
    const page = await repository.listWorkLogs(subjectId, { status: query.status, limit: 100, offset });
    for (const sourceLog of page) { const log = normalizeLog(sourceLog); if (log.localDate >= query.dateFrom && log.localDate <= query.dateTo && (!query.projectId || log.projectId === query.projectId) && (!wanted.size || wanted.has(log.logId)) && Number(log.createdAt || 0) <= startedAt) selected.push(log); }
    if (page.length < 100) break;
    if (offset + 100 > EXPORT_MAX_ROWS) throw new WorkLogError("EXPORT_TOO_LARGE", 413);
  }
  selected.sort((a, b) => String(a.localDate).localeCompare(String(b.localDate)) || String(a.logId).localeCompare(String(b.logId)));
  const logs = [], items = [], itemCaptures = [], captureIds = new Set();
  for (const chosen of selected) {
    const aggregate = repository.getWorkLogExportAggregate ? await repository.getWorkLogExportAggregate(subjectId, chosen.logId) : await repository.getWorkLog(subjectId, chosen.logId);
    const aggregateLog = aggregate && normalizeLog(aggregate);
    if (!aggregateLog || aggregateLog.version !== chosen.version) throw new WorkLogError("EXPORT_SNAPSHOT_CONFLICT", 409);
    logs.push(aggregateLog);
    for (const item of aggregate.items || []) items.push(normalizeItem(item, chosen.logId));
    for (const link of aggregate.captureAssociations || []) { const value = normalizeLink(link, chosen.logId); itemCaptures.push(value); if (query.includeCaptures) captureIds.add(value.captureId); }
  }
  const captures = [];
  if (query.includeCaptures) for (const captureId of [...captureIds].sort()) { const capture = await repository.getCaptureById(subjectId, captureId); if (capture) captures.push(normalizeCapture(capture)); }
  captures.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)) || String(a.captureId).localeCompare(String(b.captureId)));
  const fields = captures.flatMap((capture) => (capture.fields || []).map((field) => publicValue({ captureId: capture.captureId, jiluCode: capture.jiluCode, ...field })));
  const count = logs.length + items.length + itemCaptures.length + captures.length + fields.length;
  if (count > EXPORT_MAX_ROWS) throw new WorkLogError("EXPORT_TOO_LARGE", 413);
  return { format: "jilu-work-log-export", schemaVersion: EXPORT_SCHEMA_VERSION, generatedAt: new Date(startedAt).toISOString(), query, warnings: ["Spreadsheet consumers must treat all strings as data, never formulas."], logs, items, itemCaptures, captures, fields };
};

export const renderExportJson = (model) => new TextEncoder().encode(JSON.stringify(model, null, 2));
export const safeSpreadsheetText = (value) => {
  const result = text(value);
  return /^[\s]*[=+\-@\t\r]/.test(result) ? `'${result}` : result;
};
const xml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const col = (index) => { let out = ""; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out; return out; };
const worksheet = (rows) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${(rows[0] || []).map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i < 3 ? 20 : 28}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.map((row, ri) => `<row r="${ri + 1}">${row.map((value, ci) => `<c r="${col(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(safeSpreadsheetText(value))}</t></is></c>`).join("")}</row>`).join("")}</sheetData><autoFilter ref="A1:${col(Math.max(0, (rows[0]?.length || 1) - 1))}${Math.max(1, rows.length)}"/><sheetProtection sheet="0"/></worksheet>`;
const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const u16 = (n) => Uint8Array.of(n & 255, n >>> 8 & 255), u32 = (n) => Uint8Array.of(n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255);
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out; };
const zip = (files) => { const enc = new TextEncoder(), locals = [], centers = []; let offset = 0; for (const [name, body] of files) { const filename = enc.encode(name), data = typeof body === "string" ? enc.encode(body) : body, crc = crc32(data); const local = concat(u32(0x04034b50), u16(20), u16(0x800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(filename.length), u16(0), filename, data); locals.push(local); centers.push(concat(u32(0x02014b50), u16(20), u16(20), u16(0x800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(filename.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), filename)); offset += local.length; } const central = concat(...centers); return concat(...locals, central, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)); };
const value = (x) => text(x);
export const exportWorkbookRows = (model) => {
  const linksByItem = new Map(); for (const link of model.itemCaptures) { const list = linksByItem.get(link.itemId) || []; list.push(link.captureId); linksByItem.set(link.itemId, list); }
  const captureById = new Map(model.captures.map((capture) => [capture.captureId, capture]));
  const logById = new Map(model.logs.map((log) => [log.logId, log]));
  const logRows = [["日期","时区","项目","日志状态","日志类型/条目分类","标题","工作内容","处理结果","备注","开始时间","结束时间","模板摘要","迹录标识汇总","现场记录数量","标签","创建时间","更新时间"]];
  for (const item of model.items) { const log = logById.get(item.logId) || {}, ids = linksByItem.get(item.itemId) || [], captures = ids.map((id) => captureById.get(id)).filter(Boolean); logRows.push([log.localDate,log.timezone,log.projectNameSnapshot,log.status,item.category,item.title,item.content,item.result,item.note,item.startAt,item.endAt,[...new Set(captures.map((x) => x.template?.nameSnapshot).filter(Boolean))].join("; "),captures.map((x) => x.jiluCode).join("; "),captures.length,(log.tags || []).map((x) => x.name || x).join("; "),item.createdAt || log.createdAt,item.updatedAt || log.updatedAt]); }
  for (const log of model.logs.filter((x) => !model.items.some((item) => item.logId === x.logId))) logRows.push([log.localDate,log.timezone,log.projectNameSnapshot,log.status,"",log.title,log.summary,"","","","","","",0,(log.tags || []).map((x) => x.name || x).join("; "),log.createdAt,log.updatedAt]);
  const captureRows = [["captureId","clientCaptureId","jiluCode","capturedAt","localDate","timezone","project","templateOrigin","templateId","templateVersion","templateName","locationSource","locationName","address","latitude","longitude","accuracy","altitude","weather","photoSha256","photoStorageState","provenanceRecordId","renderedSummary","associatedLogIds","associatedItemIds"]];
  for (const c of model.captures) { const links = model.itemCaptures.filter((x) => x.captureId === c.captureId); captureRows.push([c.captureId,c.clientCaptureId,c.jiluCode,c.capturedAt,c.localDate,c.timezone,c.project?.projectNameSnapshot || c.projectNameSnapshot,c.template?.origin,c.template?.templateId,c.template?.version,c.template?.nameSnapshot,c.location?.source,c.location?.name,c.location?.address,c.location?.latitude,c.location?.longitude,c.location?.accuracy,c.location?.altitude,c.weather,c.photoSha256,c.photoStorageState,c.provenanceRecordId,c.rendered,links.map((x) => x.logId).join("; "),links.map((x) => x.itemId).join("; ")]); }
  const fieldRows = [["captureId","jiluCode","fieldId","labelSnapshot","type","value","visibleInPhoto","source"]]; for (const field of model.fields) fieldRows.push([field.captureId,field.jiluCode,field.fieldId,field.labelSnapshot,field.type,value(field.value),field.visibleInPhoto,field.source]);
  return [{ name: "工作日志", rows: logRows }, { name: "原始拍摄记录", rows: captureRows }, { name: "结构化字段", rows: fieldRows }];
};
export const renderExportXlsx = (model) => { const sheets = exportWorkbookRows(model), workbookSheets = sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join(""); return zip([
  ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
  ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
  ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`],
  ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
  ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16794B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0" fontId="0" fillId="0" borderId="0"/><xf xfId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`],
  ...sheets.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, worksheet(sheet.rows)]),
]); };

export class MemoryExportRepository {
  constructor() { this.jobs = new Map(); }
  async create(job) { const key = `${job.subjectId}:${job.clientExportId}`, prior = [...this.jobs.values()].find((x) => `${x.subjectId}:${x.clientExportId}` === key); if (prior) { if (prior.queryDigest !== job.queryDigest) throw new WorkLogError("EXPORT_IDEMPOTENCY_CONFLICT", 409); return prior; } this.jobs.set(job.exportId, { ...job }); return job; }
  async update(subjectId, exportId, patch) { const job = await this.get(subjectId, exportId); if (!job) throw new WorkLogError("EXPORT_NOT_FOUND", 404); Object.assign(job, patch); return job; }
  async get(subjectId, exportId) { const job = this.jobs.get(exportId); return job?.subjectId === subjectId ? job : null; }
  async list(subjectId) { return [...this.jobs.values()].filter((x) => x.subjectId === subjectId).sort((a, b) => b.createdAt - a.createdAt); }
  async listAll() { return [...this.jobs.values()]; }
}
export class MemoryArtifactStore { constructor() { this.values = new Map(); } async put(key, bytes) { this.values.set(key, bytes); } async get(key) { return this.values.get(key) || null; } async delete(key) { this.values.delete(key); } }
const publicJob = (job) => publicValue(Object.fromEntries(Object.entries(job).filter(([key]) => !["subjectId", "queryDigest", "artifactKey"].includes(key))));
export class ExportService {
  /** @param {any} options */
  constructor({ repository, jobs = new MemoryExportRepository(), artifacts = new MemoryArtifactStore(), now = () => Date.now(), retentionMs = EXPORT_RETENTION_MS, id = () => `exp_${crypto.randomUUID().replace(/-/g, "")}` }) { this.repository = repository; this.jobs = jobs; this.artifacts = artifacts; this.now = now; this.retentionMs = retentionMs; this.id = id; }
  async create(subjectId, input) { const format = String(input?.format || "").toUpperCase(); if (!new Set(["JSON", "XLSX"]).has(format)) throw new WorkLogError("EXPORT_FORMAT_UNSUPPORTED", 400); if (!input?.clientExportId || String(input.clientExportId).length > 160) throw new WorkLogError("EXPORT_INVALID_QUERY", 400); const query = validateExportQuery(input.query), queryDigest = await payloadDigest({ format, query }), createdAt = this.now(), exportId = this.id(); let job = await this.jobs.create({ exportId, subjectId, clientExportId: String(input.clientExportId), queryDigest, format, status: "PENDING", query, createdAt, startedAt: null, readyAt: null, expiresAt: null, filename: null, contentType: null, sizeBytes: null, recordCount: null, errorCode: null, artifactKey: null }); if (job.exportId !== exportId) return publicJob(job); try { job = await this.jobs.update(subjectId, exportId, { status: "RUNNING", startedAt: this.now() }); const model = await buildExportModel({ repository: this.repository, subjectId, query, now: this.now }); const bytes = format === "JSON" ? renderExportJson(model) : renderExportXlsx(model), ext = format.toLowerCase(), filename = `迹录相机-工作日志-${query.dateFrom}至${query.dateTo}.${ext}`, artifactKey = `${subjectId.replace(/[^A-Za-z0-9_-]/g, "_")}/${exportId}.${ext}`; await this.artifacts.put(artifactKey, bytes); job = await this.jobs.update(subjectId, exportId, { status: "READY", artifactKey, filename, contentType: format === "JSON" ? "application/json; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: bytes.length, recordCount: model.logs.length + model.items.length + model.captures.length + model.fields.length, readyAt: this.now(), expiresAt: this.now() + this.retentionMs }); } catch (error) { const failure = /** @type {any} */ (error); job = await this.jobs.update(subjectId, exportId, { status: "FAILED", errorCode: failure.code || "EXPORT_FAILED" }); } return publicJob(job); }
  async get(subjectId, exportId) { const job = await this.jobs.get(subjectId, exportId); if (!job) throw new WorkLogError("EXPORT_NOT_FOUND", 404); if (job.status === "READY" && job.expiresAt <= this.now()) { await this.artifacts.delete(job.artifactKey); return publicJob(await this.jobs.update(subjectId, exportId, { status: "EXPIRED" })); } return publicJob(job); }
  async list(subjectId) { const jobs = await this.jobs.list(subjectId); return Promise.all(jobs.map((job) => this.get(subjectId, job.exportId))); }
  async download(subjectId, exportId) { await this.get(subjectId, exportId); const job = await this.jobs.get(subjectId, exportId); if (job.status === "EXPIRED") throw new WorkLogError("EXPORT_EXPIRED", 410); if (job.status === "FAILED") throw new WorkLogError("EXPORT_FAILED", 409); if (job.status !== "READY") throw new WorkLogError("EXPORT_PROCESSING", 409); const bytes = await this.artifacts.get(job.artifactKey); if (!bytes) throw new WorkLogError("EXPORT_ARTIFACT_MISSING", 404); return { bytes, filename: job.filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_"), contentType: job.contentType }; }
  async cleanup() { let removed = 0; for (const job of await this.jobs.listAll()) if (job.status === "READY" && job.expiresAt <= this.now()) { await this.artifacts.delete(job.artifactKey); await this.jobs.update(job.subjectId, job.exportId, { status: "EXPIRED" }); removed++; } return removed; }
}

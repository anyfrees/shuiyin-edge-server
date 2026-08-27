import { payloadDigest, WorkLogError } from "./core.js";

const MAX_BODY = 1024 * 1024;
const forbidden = new Set([
  "subjectId",
  "subject_id",
  "publicId",
  "owner",
  "ownerId",
  "userId",
]);
const codeMap = {
  JILU_CODE_COLLISION: "JILU_CODE_CONFLICT",
  PROVENANCE_LINK_CONFLICT: "CAPTURE_PROVENANCE_CONFLICT",
};
const json = (body, status = 200, headers = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
const fail = (code, status = 400, message = code) =>
  json({ ok: false, code, message }, status);
const cleanObject = (value, name = "payload") => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WorkLogError("INVALID_PAYLOAD", 400);
  for (const key of Object.keys(value))
    if (forbidden.has(key))
      throw new WorkLogError("OWNERSHIP_FIELD_FORBIDDEN", 400);
  return value;
};
const int = (v, d, min, max) => {
  const n = v == null ? d : Number(v);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new WorkLogError("INVALID_PAYLOAD", 400);
  return n;
};
const b64e = (s) => {
  const bytes = new TextEncoder().encode(s);
  let x = "";
  for (const b of bytes) x += String.fromCharCode(b);
  return btoa(x).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const b64d = (s) => {
  const x = atob(String(s).replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(x, (c) => c.charCodeAt(0)));
};
const cursorSig = async (secret, payload) =>
  (await payloadDigest({ secret, payload })).slice(0, 32);

export class WorkLogHttpService {
  /** @param {any} options */
  constructor({
    repository,
    authenticate,
    enabled = false,
    cursorSecret = "work-log-v1-local",
    verifyProvenanceOwnership = null,
    exportService = null,
    exportEnabled = false,
    authorize = null,
    autoDraftService = null,
  }) {
    this.repository = repository;
    this.authenticate = authenticate;
    this.enabled = enabled;
    this.cursorSecret = cursorSecret;
    this.verifyProvenanceOwnership = verifyProvenanceOwnership;
    this.exportService = exportService;
    this.exportEnabled = exportEnabled;
    this.authorize = authorize || (async () => true);
    this.autoDraftService = autoDraftService;
  }
  async body(request) {
    const size = Number(request.headers.get("content-length") || 0);
    if (size > MAX_BODY) throw new WorkLogError("PAYLOAD_TOO_LARGE", 413);
    if (
      !String(request.headers.get("content-type") || "")
        .toLowerCase()
        .startsWith("application/json")
    )
      throw new WorkLogError("UNSUPPORTED_MEDIA_TYPE", 415);
    let body;
    try {
      body = await request.json();
    } catch {
      throw new WorkLogError("INVALID_PAYLOAD", 400);
    }
    if (new TextEncoder().encode(JSON.stringify(body)).length > MAX_BODY)
      throw new WorkLogError("PAYLOAD_TOO_LARGE", 413);
    return cleanObject(body);
  }
  async auth(request, miniOnly = false, exportRequired = false) {
    let value;
    try {
      value = await this.authenticate(request);
    } catch {
      throw new WorkLogError("UNAUTHORIZED", 401);
    }
    if (!value?.subjectId) throw new WorkLogError("UNAUTHORIZED", 401);
    if (miniOnly && value.authType !== "MINI")
      throw new WorkLogError("FORBIDDEN", 403);
    if (!(await this.authorize(value.subjectId, "WORK_LOG_V1")))
      throw new WorkLogError("WORK_LOG_NOT_ENTITLED", 403);
    if (exportRequired && !(await this.authorize(value.subjectId, "WORK_LOG_EXPORT_V1")))
      throw new WorkLogError("EXPORT_NOT_ENTITLED", 403);
    return value;
  }
  async encodeCursor(subjectId, filters, offset) {
    const payload = JSON.stringify({ v: 1, subjectId, filters, offset }),
      sig = await cursorSig(this.cursorSecret, payload);
    return b64e(JSON.stringify({ payload, sig }));
  }
  async decodeCursor(value, subjectId, filters) {
    if (!value) return 0;
    try {
      const x = JSON.parse(b64d(value));
      if (x.sig !== (await cursorSig(this.cursorSecret, x.payload))) throw 0;
      const p = JSON.parse(x.payload);
      if (
        p.v !== 1 ||
        p.subjectId !== subjectId ||
        JSON.stringify(p.filters) !== JSON.stringify(filters) ||
        !Number.isInteger(p.offset) ||
        p.offset < 0
      )
        throw 0;
      return p.offset;
    } catch {
      throw new WorkLogError("CURSOR_INVALID", 400);
    }
  }
  async handle(request) {
    if (!this.enabled) return fail("WORK_LOG_DISABLED", 503);
    try {
      const url = new URL(request.url),
        path = url.pathname,
        method = request.method;
      if (path === "/v1/exports" && method === "POST") {
        if (!this.exportEnabled || !this.exportService)
          throw new WorkLogError("EXPORT_DISABLED", 503);
        const { subjectId } = await this.auth(request, false, true), body = await this.body(request);
        return json({ ok: true, export: await this.exportService.create(subjectId, body) }, 202);
      }
      if (path === "/v1/exports" && method === "GET") {
        if (!this.exportEnabled || !this.exportService)
          throw new WorkLogError("EXPORT_DISABLED", 503);
        const { subjectId } = await this.auth(request, false, true);
        return json({ ok: true, items: await this.exportService.list(subjectId) });
      }
      let exportMatch = path.match(/^\/v1\/exports\/([^/]+)(\/download)?$/);
      if (exportMatch && method === "GET") {
        if (!this.exportEnabled || !this.exportService)
          throw new WorkLogError("EXPORT_DISABLED", 503);
        const { subjectId } = await this.auth(request, false, true), exportId = decodeURIComponent(exportMatch[1]);
        if (!exportMatch[2]) return json({ ok: true, export: await this.exportService.get(subjectId, exportId) });
        const artifact = await this.exportService.download(subjectId, exportId);
        return new Response(artifact.bytes, { status: 200, headers: {
          "content-type": artifact.contentType, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`,
          "cache-control": "private, no-store", "x-content-type-options": "nosniff",
        }});
      }
      if (path === "/v1/captures/batch" && method === "POST") {
        const { subjectId } = await this.auth(request, true),
          body = await this.body(request);
        if (
          body.schemaVersion !== 1 ||
          !Array.isArray(body.items) ||
          body.items.length < 1
        )
          throw new WorkLogError("INVALID_PAYLOAD", 400);
        if (body.items.length > 50)
          throw new WorkLogError("BATCH_TOO_LARGE", 413);
        const results = [];
        for (const item of body.items) {
          let clientCaptureId =
            item?.clientCaptureId ||
            item?.snapshot?.capture?.clientCaptureId ||
            null;
          try {
            cleanObject(item, "item");
            if (
              Object.keys(item).some(
                (k) =>
                  !["clientCaptureId", "payloadDigest", "snapshot"].includes(k),
              )
            )
              throw new WorkLogError("INVALID_PAYLOAD", 400);
            if (clientCaptureId !== item.snapshot?.capture?.clientCaptureId)
              throw new WorkLogError("CAPTURE_SCHEMA_INVALID", 400);
            if (
              item.snapshot?.project?.projectId &&
              !(await this.repository.getProject(
                subjectId,
                item.snapshot.project.projectId,
              ))
            )
              throw new WorkLogError("PROJECT_NOT_FOUND", 404);
            const computed = await payloadDigest(item.snapshot);
            if (item.payloadDigest !== computed)
              throw new WorkLogError("PAYLOAD_DIGEST_INVALID", 400);
            const x = await this.repository.insertIdempotentCapture({
                subjectId,
                snapshot: item.snapshot,
                payloadDigest: computed,
              }),
              c = x.capture;
            // Derived work must never change capture acceptance semantics.
            try { await this.autoDraftService?.enqueueAndProcess(subjectId, c); } catch {}
            results.push({
              clientCaptureId,
              status: x.status,
              captureId: c.captureId || c.capture_id,
              jiluCode: c.jiluCode || c.jilu_code,
            });
          } catch (error) {
            results.push({
              clientCaptureId,
              status: "REJECTED",
              code:
                codeMap[error.code] || error.code || "CAPTURE_SCHEMA_INVALID",
            });
          }
        }
        const allNew = results.every((x) => x.status === "CREATED");
        return json({ ok: true, results }, allNew ? 201 : 200);
      }
      if (path === "/v1/captures" && method === "GET") {
        const { subjectId } = await this.auth(request),
          limit = int(url.searchParams.get("limit"), 50, 1, 100),
          filters = {
            date: url.searchParams.get("date") || null,
            from: url.searchParams.get("from") || null,
            to: url.searchParams.get("to") || null,
            jiluCode: url.searchParams.get("jiluCode") || null,
            projectId: url.searchParams.get("projectId") || null,
            templateId: url.searchParams.get("templateId") || null,
          };
        if (filters.date && (filters.from || filters.to))
          throw new WorkLogError("INVALID_PAYLOAD", 400);
        const rangeStart = filters.date || filters.from,
          rangeEnd = filters.date || filters.to;
        if (
          rangeStart &&
          rangeEnd &&
          (new Date(`${rangeEnd}T00:00:00Z`) -
            new Date(`${rangeStart}T00:00:00Z`)) /
            86400000 >
            366
        )
          throw new WorkLogError("DATE_RANGE_TOO_LARGE", 400);
        const offset = await this.decodeCursor(
          url.searchParams.get("cursor"),
          subjectId,
          filters,
        );
        let items;
        if (filters.jiluCode) {
          const one = await this.repository.getCaptureByJiluCode(
            subjectId,
            filters.jiluCode,
          );
          items = one ? [one] : [];
        } else
          items = await this.repository.listCaptures(subjectId, {
            from: filters.date || filters.from || "0000-01-01",
            to: filters.date || filters.to || "9999-12-31",
            projectId: filters.projectId,
            templateId: filters.templateId,
            limit: limit + 1,
            offset,
          });
        const more = items.length > limit;
        items = items.slice(0, limit);
        return json({
          ok: true,
          items,
          nextCursor: more
            ? await this.encodeCursor(subjectId, filters, offset + limit)
            : null,
        });
      }
      let m = path.match(/^\/v1\/captures\/([^/]+)$/);
      if (m && method === "GET") {
        const { subjectId } = await this.auth(request),
          x = await this.repository.getCaptureById(
            subjectId,
            decodeURIComponent(m[1]),
          );
        return x
          ? json({ ok: true, capture: x })
          : fail("CAPTURE_NOT_FOUND", 404);
      }
      m = path.match(/^\/v1\/captures\/([^/]+)\/provenance-link$/);
      if (m && method === "PATCH") {
        const { subjectId } = await this.auth(request),
          body = await this.body(request);
        if (
          Object.keys(body).some(
            (k) => !["clientTaskId", "provenanceRecordId"].includes(k),
          ) ||
          !body.provenanceRecordId
        )
          throw new WorkLogError("INVALID_PAYLOAD", 400);
        if (
          body.projectId &&
          !(await this.repository.getProject(subjectId, body.projectId))
        )
          throw new WorkLogError("PROJECT_NOT_FOUND", 404);
        if (
          this.verifyProvenanceOwnership &&
          !(await this.verifyProvenanceOwnership(
            subjectId,
            body.provenanceRecordId,
          ))
        )
          throw new WorkLogError("CAPTURE_NOT_FOUND", 404);
        const capture = await this.repository.linkProvenanceRecord(
          subjectId,
          decodeURIComponent(m[1]),
          {
            clientTaskId: body.clientTaskId,
            recordId: body.provenanceRecordId,
          },
        );
        return json({ ok: true, capture });
      }
      if (path === "/v1/work-logs" && method === "POST") {
        const { subjectId } = await this.auth(request),
          body = await this.body(request);
        if (
          Object.keys(body).some(
            (k) =>
              ![
                "localDate",
                "timezone",
                "title",
                "summary",
                "projectId",
                "projectNameSnapshot",
              ].includes(k),
          )
        )
          throw new WorkLogError("INVALID_PAYLOAD", 400);
        return json(
          {
            ok: true,
            workLog: await this.repository.createWorkLog(subjectId, body),
          },
          201,
        );
      }
      if (path === "/v1/work-logs" && method === "GET") {
        const { subjectId } = await this.auth(request),
          limit = int(url.searchParams.get("limit"), 50, 1, 100),
          filters = { status: url.searchParams.get("status") || null },
          offset = await this.decodeCursor(
            url.searchParams.get("cursor"),
            subjectId,
            filters,
          ),
          items = await this.repository.listWorkLogs(subjectId, {
            ...filters,
            limit: limit + 1,
            offset,
          }),
          more = items.length > limit;
        return json({
          ok: true,
          items: items.slice(0, limit),
          nextCursor: more
            ? await this.encodeCursor(subjectId, filters, offset + limit)
            : null,
        });
      }
      m = path.match(/^\/v1\/work-logs\/([^/]+)$/);
      if (m && method === "GET") {
        const { subjectId } = await this.auth(request),
          x = await this.repository.getWorkLog(
            subjectId,
            decodeURIComponent(m[1]),
          );
        return x
          ? json({ ok: true, workLog: x })
          : fail("WORK_LOG_NOT_FOUND", 404);
      }
      if (m && method === "PATCH") {
        const { subjectId } = await this.auth(request),
          body = await this.body(request),
          { ifVersion, ...patch } = body;
        if (!Number.isInteger(ifVersion))
          throw new WorkLogError("INVALID_PAYLOAD", 400);
        return json({
          ok: true,
          workLog: await this.repository.patchWorkLog(
            subjectId,
            decodeURIComponent(m[1]),
            patch,
            ifVersion,
          ),
        });
      }
      if (m && method === "DELETE") {
        const { subjectId } = await this.auth(request),
          version = int(url.searchParams.get("ifVersion"), -1, 1, 2147483647);
        if (
          !(await this.repository.getWorkLog(
            subjectId,
            decodeURIComponent(m[1]),
          ))
        )
          return json(null, 204);
        await this.repository.softDeleteWorkLog(
          subjectId,
          decodeURIComponent(m[1]),
          version,
        );
        return json(null, 204);
      }
      m = path.match(/^\/v1\/work-logs\/([^/]+)\/(finalize|archive|restore)$/);
      if (m && method === "POST") {
        const { subjectId } = await this.auth(request),
          body = await this.body(request),
          v = int(body.ifVersion, -1, 1, 2147483647),
          fn = {
            finalize: "finalizeWorkLog",
            archive: "archiveWorkLog",
            restore: "restoreWorkLog",
          }[m[2]];
        if (m[2] === "finalize") {
          const current = await this.repository.getWorkLog(
            subjectId,
            decodeURIComponent(m[1]),
          );
          if (current?.status === "FINAL")
            return json({ ok: true, workLog: current });
        }
        return json({
          ok: true,
          workLog: await this.repository[fn](
            subjectId,
            decodeURIComponent(m[1]),
            v,
          ),
        });
      }
      m = path.match(/^\/v1\/work-logs\/([^/]+)\/items$/);
      if (m && method === "POST") {
        const { subjectId } = await this.auth(request),
          body = await this.body(request),
          { ifVersion, ...input } = body;
        return json(
          {
            ok: true,
            item: await this.repository.createItem(
              subjectId,
              decodeURIComponent(m[1]),
              input,
              ifVersion,
            ),
          },
          201,
        );
      }
      m = path.match(/^\/v1\/work-logs\/([^/]+)\/items\/([^/]+)$/);
      if (m && method === "PATCH") {
        const { subjectId } = await this.auth(request),
          body = await this.body(request),
          { ifVersion, ...input } = body;
        return json({
          ok: true,
          item: await this.repository.updateItem(
            subjectId,
            decodeURIComponent(m[1]),
            decodeURIComponent(m[2]),
            input,
            ifVersion,
          ),
        });
      }
      if (m && method === "DELETE") {
        const { subjectId } = await this.auth(request),
          v = int(url.searchParams.get("ifVersion"), -1, 1, 2147483647);
        await this.repository.deleteItem(
          subjectId,
          decodeURIComponent(m[1]),
          decodeURIComponent(m[2]),
          v,
        );
        return json(null, 204);
      }
      m = path.match(
        /^\/v1\/work-logs\/([^/]+)\/items\/([^/]+)\/captures\/([^/]+)$/,
      );
      if (m && method === "POST") {
        const { subjectId } = await this.auth(request),
          body = await this.body(request);
        const result = await this.repository.attachCapture(
          subjectId,
          decodeURIComponent(m[1]),
          decodeURIComponent(m[2]),
          decodeURIComponent(m[3]),
          body.ifVersion,
          body.sortOrder || 0,
        );
        return json({ ok: true, result });
      }
      if (m && method === "DELETE") {
        const { subjectId } = await this.auth(request),
          v = int(url.searchParams.get("ifVersion"), -1, 1, 2147483647);
        await this.repository.detachCapture(
          subjectId,
          decodeURIComponent(m[1]),
          decodeURIComponent(m[2]),
          decodeURIComponent(m[3]),
          v,
        );
        return json(null, 204);
      }
      if (path === "/v1/projects" && method === "GET") {
        const { subjectId } = await this.auth(request);
        return json({
          ok: true,
          items: await this.repository.listProjects(subjectId, {
            status: url.searchParams.get("status") || null,
          }),
        });
      }
      if (path === "/v1/projects" && method === "POST") {
        const { subjectId } = await this.auth(request),
          body = await this.body(request);
        return json(
          {
            ok: true,
            project: await this.repository.createProject(subjectId, body),
          },
          201,
        );
      }
      m = path.match(/^\/v1\/projects\/([^/]+)$/);
      if (m && method === "GET") {
        const { subjectId } = await this.auth(request),
          x = await this.repository.getProject(
            subjectId,
            decodeURIComponent(m[1]),
          );
        return x
          ? json({ ok: true, project: x })
          : fail("PROJECT_NOT_FOUND", 404);
      }
      if (m && method === "PATCH") {
        const { subjectId } = await this.auth(request),
          body = await this.body(request);
        return json({
          ok: true,
          project: await this.repository.updateProject(
            subjectId,
            decodeURIComponent(m[1]),
            body,
          ),
        });
      }
      if (m && method === "DELETE") {
        const { subjectId } = await this.auth(request);
        return json({
          ok: true,
          project: await this.repository.archiveProject(
            subjectId,
            decodeURIComponent(m[1]),
          ),
        });
      }
      if (path === "/v1/tags" && method === "GET") {
        const { subjectId } = await this.auth(request);
        return json({
          ok: true,
          items: await this.repository.listTags(subjectId),
        });
      }
      if (path === "/v1/tags" && method === "POST") {
        const { subjectId } = await this.auth(request),
          body = await this.body(request);
        return json(
          { ok: true, tag: await this.repository.createTag(subjectId, body) },
          201,
        );
      }
      m = path.match(/^\/v1\/tags\/([^/]+)$/);
      if (m && method === "PATCH") {
        const { subjectId } = await this.auth(request),
          body = await this.body(request);
        return json({
          ok: true,
          tag: await this.repository.updateTag(
            subjectId,
            decodeURIComponent(m[1]),
            body,
          ),
        });
      }
      if (m && method === "DELETE") {
        const { subjectId } = await this.auth(request);
        await this.repository.deleteTag(subjectId, decodeURIComponent(m[1]));
        return json(null, 204);
      }
      return fail("NOT_FOUND", 404);
    } catch (error) {
      const code = codeMap[error.code] || error.code || "INTERNAL_ERROR",
        status =
          Number(error.status) ||
          {
            UNAUTHORIZED: 401,
            FORBIDDEN: 403,
            CAPTURE_NOT_FOUND: 404,
            WORK_LOG_NOT_FOUND: 404,
            PROJECT_NOT_FOUND: 404,
            WORK_LOG_VERSION_CONFLICT: 409,
            WORK_LOG_FINAL: 409,
            CAPTURE_IDEMPOTENCY_CONFLICT: 409,
            JILU_CODE_CONFLICT: 409,
            CAPTURE_PROVENANCE_CONFLICT: 409,
          }[code] ||
          500;
      return fail(code, status);
    }
  }
}

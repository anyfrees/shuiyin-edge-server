import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_dev } from "wrangler";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  generateJiluCode,
  normalizeJiluCode,
  payloadDigest,
  validateCaptureSnapshot,
  workLogEnabled,
} from "../src/work-log/core.js";
import { EdgeOneBlobWorkLogRepository } from "../src/work-log/repositories.js";
import { WorkLogHttpService } from "../src/work-log/http-service.generated.js";
class CasBlob {
  constructor() {
    this.data = new Map();
    this.sequence = 0;
  }
  async getWithHeaders(key) {
    const x = this.data.get(key);
    return x ? { data: x.bytes, etag: x.etag } : null;
  }
  async putIfAbsent(key, bytes) {
    if (this.data.has(key)) return false;
    this.data.set(key, { bytes, etag: String(++this.sequence) });
    return true;
  }
  async compareAndSet(key, etag, bytes) {
    const x = this.data.get(key);
    if ((x?.etag || null) !== (etag || null)) return false;
    this.data.set(key, { bytes, etag: String(++this.sequence) });
    return true;
  }
}
const subject = "sub_A1234567890123456",
  subjectB = "sub_B1234567890123456";
const snapshot = (n = 1) => ({
  schemaVersion: 1,
  state: "COMMITTED",
  capture: {
    clientCaptureId: `cap_${String(n).padStart(22, "A")}`,
    jiluCode: generateJiluCode("2026-08-26", (len) =>
      Uint8Array.from({ length: len }, (_, i) => (n * 19 + i) & 255),
    ),
    sourceType: "LIVE_CAMERA",
    capturedAt: "2026-08-26T15:30:00.123Z",
    captureRequestedAt: "2026-08-26T15:30:00.000Z",
    captureCompletedAt: "2026-08-26T15:30:00.123Z",
    timezone: "Asia/Shanghai",
    utcOffsetMinutes: 480,
  },
  template: {
    origin: "BUILTIN",
    builtinId: "classic",
    templateId: null,
    customTemplateId: null,
    version: 1,
    nameSnapshot: "现场",
  },
  project: { projectId: null, projectNameSnapshot: null },
  location: {
    source: "NONE",
    name: null,
    address: null,
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    altitudeMeters: null,
  },
  weather: null,
  fields: [],
  rendered: { textSnapshot: "", lines: [] },
  photo: {
    sha256: n.toString(16).padStart(64, "0"),
    storageState: "LOCAL_ONLY",
  },
  provenance: { clientTaskId: null, recordId: null },
});
test("Edge feature flag defaults off", () => {
  assert.equal(workLogEnabled({}), false);
  assert.equal(workLogEnabled({ WORK_LOG_V1_ENABLED: "true" }), true);
});
test("Edge Jilu/digest/security vectors", async () => {
  const code = generateJiluCode("2026-08-26", (n) => new Uint8Array(n).fill(8));
  assert.equal(normalizeJiluCode(code.toLowerCase().replaceAll("-", "")), code);
  assert.equal(
    await payloadDigest({ b: "中文😀", a: [1, 2] }),
    await payloadDigest({ a: [1, 2], b: "中文😀" }),
  );
  assert.notEqual(
    await payloadDigest({ a: [1, 2] }),
    await payloadDigest({ a: [2, 1] }),
  );
  for (const mutate of [
    (s) => (s.schemaVersion = 9),
    (s) => (s.image = "x"),
    (s) => (s.fields = Array(101).fill({})),
  ]) {
    const s = snapshot();
    mutate(s);
    assert.throws(() => validateCaptureSnapshot(s));
  }
});
test("EdgeOne REP idempotency ownership collision and unknown response", async () => {
  const store = new CasBlob(),
    repo = new EdgeOneBlobWorkLogRepository(store, {
      now: () => 100,
      random: (() => {
        let n = 0;
        return () => String(++n).padStart(24, "x");
      })(),
    }),
    s = snapshot(),
    digest = await payloadDigest(s);
  const first = await repo.insertIdempotentCapture({
    subjectId: subject,
    snapshot: s,
    payloadDigest: digest,
  });
  assert.equal(first.status, "CREATED");
  assert.equal(
    (
      await repo.insertIdempotentCapture({
        subjectId: subject,
        snapshot: s,
        payloadDigest: digest,
      })
    ).status,
    "ALREADY_EXISTS",
  );
  await assert.rejects(
    repo.insertIdempotentCapture({
      subjectId: subject,
      snapshot: s,
      payloadDigest: "f".repeat(64),
    }),
    (e) => e.code === "CAPTURE_IDEMPOTENCY_CONFLICT",
  );
  assert.equal(
    await repo.getCaptureByClientCaptureId(subjectB, s.capture.clientCaptureId),
    null,
  );
  assert.equal(
    await repo.getCaptureByJiluCode(subjectB, s.capture.jiluCode),
    null,
  );
  const s2 = snapshot(2),
    d2 = await payloadDigest(s2);
  await assert.rejects(
    repo.insertIdempotentCapture({
      subjectId: subject,
      snapshot: {
        ...s2,
        capture: { ...s2.capture, jiluCode: s.capture.jiluCode },
      },
      payloadDigest: d2,
    }),
    (e) => e.code === "JILU_CODE_COLLISION",
  );
  const unknown = snapshot(3),
    du = await payloadDigest(unknown);
  await assert.rejects(
    repo.insertIdempotentCapture({
      subjectId: subject,
      snapshot: unknown,
      payloadDigest: du,
      simulateUnknown: true,
    }),
    (e) => e.code === "SIMULATED_UNKNOWN_RESPONSE",
  );
  assert.equal(
    (
      await repo.insertIdempotentCapture({
        subjectId: subject,
        snapshot: unknown,
        payloadDigest: du,
      })
    ).status,
    "ALREADY_EXISTS",
  );
});
test("EdgeOne aggregate CAS, FINAL freeze, soft delete restore", async () => {
  const repo = new EdgeOneBlobWorkLogRepository(new CasBlob(), {
      now: (() => {
        let n = 100;
        return () => ++n;
      })(),
      random: (() => {
        let n = 0;
        return () => String(++n);
      })(),
    }),
    log = await repo.createWorkLog(subject, {
      localDate: "2026-08-26",
      title: "日报",
    });
  assert.equal(log.version, 1);
  const patched = await repo.patchWorkLog(
    subject,
    log.logId,
    { summary: "ok" },
    1,
  );
  assert.equal(patched.version, 2);
  await assert.rejects(
    repo.patchWorkLog(subject, log.logId, { summary: "stale" }, 1),
    (e) => e.code === "WORK_LOG_VERSION_CONFLICT",
  );
  const itemLog = await repo.createItem(
    subject,
    log.logId,
    { itemId: "item_1", title: "工作" },
    2,
  );
  assert.equal(itemLog.items.length, 1);
  const final = await repo.finalizeWorkLog(subject, log.logId, 3);
  assert.equal(final.status, "FINAL");
  await assert.rejects(
    repo.patchWorkLog(subject, log.logId, { summary: "auto" }, 4, {
      automatic: true,
    }),
    (e) => e.code === "WORK_LOG_FINAL",
  );
  const deleted = await repo.softDeleteWorkLog(subject, log.logId, 4);
  assert.equal(deleted.status, "DELETED");
  assert.equal(
    (await repo.restoreWorkLog(subject, log.logId, 5)).status,
    "DRAFT",
  );
});
test("EdgeOne capture association, project and tag ownership", async () => {
  const repo = new EdgeOneBlobWorkLogRepository(new CasBlob()),
    s = snapshot(91),
    capture = await repo.insertIdempotentCapture({
      subjectId: subject,
      snapshot: s,
      payloadDigest: await payloadDigest(s),
    }),
    log = await repo.createWorkLog(subject, {
      localDate: "2026-08-26",
      title: "日报",
    }),
    withItem = await repo.createItem(subject, log.logId, { title: "检查" }, 1),
    linked = await repo.attachCapture(
      subject,
      log.logId,
      withItem.items[0].itemId,
      capture.capture.captureId,
      2,
    );
  assert.equal(linked.captureAssociations.length, 1);
  await assert.rejects(
    repo.attachCapture(
      subjectB,
      log.logId,
      withItem.items[0].itemId,
      capture.capture.captureId,
      3,
    ),
    (e) => e.code === "ASSOCIATION_NOT_FOUND",
  );
  const project = await repo.createProject(subject, { name: "工地 A" });
  assert.equal(await repo.getProject(subjectB, project.projectId), null);
  const geofence=await repo.upsertProjectGeofence(subject,project.projectId,{enabled:true,centerLatitude:31.8,centerLongitude:117.2,radiusMeters:500,priority:100});
  assert.equal(geofence.ruleVersion,1);
  assert.equal((await repo.listProjectMatchRules(subject))[0].projectId,project.projectId);
  await assert.rejects(repo.upsertProjectGeofence(subject,project.projectId,{ifVersion:9,enabled:false}),error=>error.code==="PROJECT_GEOFENCE_VERSION_CONFLICT");
  const tag = await repo.createTag(subject, { name: "安全" }),
    tagged = await repo.attachTag(subject, log.logId, tag.tagId, 3);
  assert.deepEqual(tagged.tagIds, [tag.tagId]);
});
test("D1 migration is additive and contains frozen constraints/indexes", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    sql = fs.readFileSync(
      path.join(root, "migrations/0004_work_log_v1.sql"),
      "utf8",
    );
  for (const expected of [
    "CREATE TABLE IF NOT EXISTS capture_events",
    "UNIQUE(subject_id, client_capture_id)",
    "jilu_code TEXT NOT NULL UNIQUE",
    "CREATE TABLE IF NOT EXISTS work_logs",
    "CREATE TABLE IF NOT EXISTS work_log_item_captures",
    "CREATE TABLE IF NOT EXISTS projects",
    "CREATE TABLE IF NOT EXISTS tags",
    "idx_wl_capture_subject_date",
  ])
    assert.ok(sql.includes(expected), expected);
  assert.equal(/\b(?:DROP|ALTER|RENAME|DELETE FROM)\b/i.test(sql), false);
  const geofenceSql=fs.readFileSync(path.join(root,"migrations/0009_work_log_project_geofence.sql"),"utf8");
  for(const expected of ["CREATE TABLE IF NOT EXISTS work_log_project_geofences","UNIQUE(subject_id, project_id)","CREATE TABLE IF NOT EXISTS capture_project_matches","idx_wl_geofence_subject_enabled"])assert.ok(geofenceSql.includes(expected),expected);
  assert.equal(/\b(?:DROP|ALTER|RENAME|DELETE FROM)\b/i.test(geofenceSql),false);
});
test("D1 repository executes ownership, idempotency, association and concurrency vectors", async (t) => {
  execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "migrations",
      "apply",
      "PROVENANCE_D1",
      "--local",
    ],
    { stdio: "ignore" },
  );
  const worker = await unstable_dev("tests/fixtures/d1-work-log-worker.js", {
    config: "wrangler.jsonc",
    local: true,
    persist: true,
    logLevel: "none",
  });
  t.after(() => worker.stop());
  const call = (action, ...args) =>
      worker
        .fetch("http://local/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, args }),
        })
        .then((r) => r.json()),
    seed = (Date.now() % 1000000) + 100,
    runSubject = `sub_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
    s = (() => {
      const value = snapshot(seed);
      value.capture.clientCaptureId = `cap_${crypto.randomUUID().replaceAll("-", "").slice(0, 22)}`;
      value.capture.jiluCode = generateJiluCode("2026-08-26");
      return value;
    })(),
    digest = await payloadDigest(s),
    created = await call("insertIdempotentCapture", {
      subjectId: runSubject,
      snapshot: s,
      payloadDigest: digest,
    });
  assert.equal(created.result?.status, "CREATED", JSON.stringify(created));
  assert.equal(
    (
      await call("insertIdempotentCapture", {
        subjectId: runSubject,
        snapshot: s,
        payloadDigest: digest,
      })
    ).result.status,
    "ALREADY_EXISTS",
  );
  assert.equal(
    (
      await call("insertIdempotentCapture", {
        subjectId: runSubject,
        snapshot: s,
        payloadDigest: "f".repeat(64),
      })
    ).code,
    "CAPTURE_IDEMPOTENCY_CONFLICT",
  );
  assert.equal(
    (await call("getCaptureById", subjectB, created.result.capture.capture_id))
      .result,
    null,
  );
  assert.equal(
    (await call("getCapturesByPhotoSha", runSubject, s.photo.sha256)).result
      .length,
    1,
  );
  const project = await call("createProject", runSubject, { name: "现场 A" });
  assert.equal(
    (await call("getProject", subjectB, project.result.project_id)).result,
    null,
  );
  const geofence=await call("upsertProjectGeofence",runSubject,project.result.project_id,{enabled:true,centerLatitude:31.8,centerLongitude:117.2,radiusMeters:500,priority:100});
  assert.equal(geofence.result.ruleVersion,1,JSON.stringify(geofence));
  assert.equal((await call("listProjectMatchRules",runSubject)).result[0].projectId,project.result.project_id);
  assert.equal((await call("listProjectMatchRules",subjectB)).result.length,0);
  assert.equal((await call("upsertProjectGeofence",runSubject,project.result.project_id,{ifVersion:99,enabled:false})).code,"PROJECT_GEOFENCE_VERSION_CONFLICT");
  const log = await call("createWorkLog", runSubject, {
      localDate: "2026-08-26",
      title: "日报",
    }),
    item = await call("createItem", runSubject, log.result.log_id, {
      title: "检查",
    });
  const tag = await call("createTag", runSubject, { name: "安全" });
  assert.equal(
    (await call("attachTag", runSubject, log.result.log_id, tag.result.tag_id))
      .ok,
    true,
  );
  assert.equal(
    (await call("attachTag", subjectB, log.result.log_id, tag.result.tag_id))
      .code,
    "ASSOCIATION_NOT_FOUND",
  );
  assert.equal(
    (
      await call(
        "attachCapture",
        runSubject,
        log.result.log_id,
        item.result.item_id,
        created.result.capture.capture_id,
        1,
      )
    ).ok,
    true,
  );
  assert.equal(
    (
      await call(
        "attachCapture",
        subjectB,
        log.result.log_id,
        item.result.item_id,
        created.result.capture.capture_id,
        1,
      )
    ).code,
    "ASSOCIATION_NOT_FOUND",
  );
  const patched = await call(
    "patchWorkLog",
    runSubject,
    log.result.log_id,
    { summary: "done" },
    1,
  );
  assert.equal(patched.result.version, 2);
  assert.equal(
    (
      await call(
        "patchWorkLog",
        runSubject,
        log.result.log_id,
        { summary: "stale" },
        1,
      )
    ).code,
    "WORK_LOG_VERSION_CONFLICT",
  );
  assert.equal(
    (await call("finalizeWorkLog", runSubject, log.result.log_id, 2)).result
      .status,
    "FINAL",
  );
});
test("shared Work Log core artifact remains byte-identical to Docker", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    edge = fs.readFileSync(path.join(root, "src/work-log/core.js")),
    docker = fs.readFileSync(
      path.resolve(root, "../shuiyin-server/src/work-log/core.js"),
    );
  assert.deepEqual(edge, docker);
});
test("generated Work Log HTTP service remains byte-identical to Docker source",()=>{const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");assert.deepEqual(fs.readFileSync(path.join(root,"src/work-log/http-service.generated.js")),fs.readFileSync(path.resolve(root,"../shuiyin-server/src/work-log/http-service.js")))});
test("HTTP provider parity: D1 and EdgeOne batch/query/error vectors", async (t) => {
  execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "migrations",
      "apply",
      "PROVENANCE_D1",
      "--local",
    ],
    { stdio: "ignore" },
  );
  const worker = await unstable_dev(
    "tests/fixtures/d1-work-log-http-worker.js",
    { config: "wrangler.jsonc", local: true, persist: true, logLevel: "none" },
  );
  t.after(() => worker.stop());
  const blobService = new WorkLogHttpService({
      repository: new EdgeOneBlobWorkLogRepository(new CasBlob()),
      enabled: true,
      cursorSecret: "http-parity-test",
      authenticate: async (req) =>
        req.headers.get("authorization") === "Bearer mini"
          ? { subjectId: "sub_http_blob", authType: "MINI" }
          : Promise.reject(Error()),
    }),
    s = snapshot(Date.now());
  s.capture.clientCaptureId = `cap_${randomBytes(16).toString("base64url")}`;
  s.capture.jiluCode = generateJiluCode("2026-08-26", (length) =>
    randomBytes(length),
  );
  const item = {
      clientCaptureId: s.capture.clientCaptureId,
      payloadDigest: await payloadDigest(s),
      snapshot: s,
    },
    invoke = async (target, path, init = {}) => {
      const request = new Request(`http://local${path}`, {
          ...init,
          headers: {
            authorization: "Bearer mini",
            ...(init.body ? { "content-type": "application/json" } : {}),
          },
        }),
        response =
          target === "d1"
            ? await worker.fetch(`http://local${path}`, {
                ...init,
                headers: Object.fromEntries(request.headers),
              })
            : await blobService.handle(request);
      return { status: response.status, body: await response.json() };
    };
  for (const target of ["d1", "blob"]) {
    const created = await invoke(target, "/v1/captures/batch", {
      method: "POST",
      body: JSON.stringify({ schemaVersion: 1, items: [item] }),
    });
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.equal(created.body.results[0].status, "CREATED");
    const replay = await invoke(target, "/v1/captures/batch", {
      method: "POST",
      body: JSON.stringify({ schemaVersion: 1, items: [item] }),
    });
    assert.equal(replay.body.results[0].status, "ALREADY_EXISTS");
    const list = await invoke(target, "/v1/captures?limit=1");
    assert.equal(list.body.items.length, 1);
    const invalid = await invoke(target, "/v1/captures?cursor=tampered");
    assert.deepEqual(
      { status: invalid.status, code: invalid.body.code },
      { status: 400, code: "CURSOR_INVALID" },
    );
  }
});

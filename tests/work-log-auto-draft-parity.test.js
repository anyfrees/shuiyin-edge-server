import test from "node:test";
import assert from "node:assert/strict";
import { unstable_dev } from "wrangler";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateJiluCode, payloadDigest } from "../src/work-log/core.js";
import { EdgeOneBlobWorkLogRepository } from "../src/work-log/repositories.js";
import { EdgeOneAutoDraftAdapter } from "../src/work-log/auto-draft-adapters.js";
class ConditionalBlob {
  constructor() {
    this.data = new Map();
    this.sequence = 0;
    this.casConflicts = 0;
  }
  async getWithHeaders(k) {
    const x = this.data.get(k);
    return x ? { data: x.bytes, etag: x.etag } : null;
  }
  async putIfAbsent(k, b) {
    if (this.data.has(k)) return false;
    this.data.set(k, { bytes: b, etag: String(++this.sequence) });
    return true;
  }
  async compareAndSet(k, e, b) {
    if (this.casConflicts-- > 0) return false;
    const x = this.data.get(k);
    if ((x?.etag || null) !== (e || null)) return false;
    this.data.set(k, { bytes: b, etag: String(++this.sequence) });
    return true;
  }
}
const subject = "sub_parity_auto_123456";
let serial = Date.now() % 1000000000;
const snap = ({
  category = "设备巡检",
  project = "A",
  date = "2026-08-27",
  at = "2026-08-27T08:00:00Z",
  location = true,
} = {}) => {
  const n = serial++;
  return {
    schemaVersion: 1,
    state: "COMMITTED",
    capture: {
      clientCaptureId: `cap_${String(n).padStart(22, "A")}`,
      jiluCode: generateJiluCode(date, (x) => randomBytes(x)),
      sourceType: "LIVE_CAMERA",
      capturedAt: at,
      captureRequestedAt: at,
      captureCompletedAt: at,
      timezone: "Asia/Shanghai",
      utcOffsetMinutes: 480,
    },
    template: {
      origin: "BUILTIN",
      builtinId: category,
      templateId: null,
      customTemplateId: null,
      version: 1,
      nameSnapshot: category,
    },
    project: { projectId: project, projectNameSnapshot: project },
    location: {
      source: location ? "GPS" : "NONE",
      name: location ? "行政楼" : null,
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
  };
};
const edgeHarness = (semanticDraft = false) => {
  const store = new ConditionalBlob(),
    repo = new EdgeOneBlobWorkLogRepository(store, {
      random: (() => {
        let n = 0;
        return () => String(++n).padStart(24, "x");
      })(),
    }),
    auto = new EdgeOneAutoDraftAdapter(repo, {
      random: (() => {
        let n = 500;
        return () => String(++n);
      })(),
      semanticDraft,
    });
  return {
    store,
    repo,
    auto,
    add: async (s, o) => {
      const c = await repo.insertIdempotentCapture({
        subjectId: subject,
        snapshot: s,
        payloadDigest: await payloadDigest(s),
      });
      return {
        capture: c,
        auto: await auto.enqueueAndProcess(subject, c.capture, o),
      };
    },
  };
};
const workSnap = (description, building, at) => {
  const value = snap({ category: "工作记录", at });
  value.fields = [
    {
      fieldId: "building",
      labelSnapshot: "楼栋",
      type: "text",
      value: building,
      visibleInPhoto: true,
      source: "USER",
    },
    {
      fieldId: "note",
      labelSnapshot: "说明",
      type: "note",
      value: description,
      visibleInPhoto: true,
      source: "USER",
    },
  ];
  return value;
};
const semantic = (logs) =>
  logs.map((l) => ({
    date: l.localDate || l.local_date,
    project: l.projectId || l.project_id,
    status: l.status,
    auto: Boolean(l.autoManaged || l.origin),
    items: (l.items || [])
      .map((i) => ({
        category: i.category,
        title: i.title,
        content: i.content,
        links: (l.captureAssociations || l.associations || []).filter(
          (x) => (x.itemId || x.item_id) === (i.itemId || i.item_id),
        ).length,
      }))
      .sort((a, b) => a.category.localeCompare(b.category, "zh-CN")),
  }));
test("PARITY-AUTO EdgeOne scenarios, CAS, recovery, replay and no-photo", async () => {
  const e = edgeHarness();
  let first;
  for (const [category, count, hour] of [
    ["设备巡检", 4, 8],
    ["网络故障处理", 3, 9],
    ["活动保障", 3, 10],
  ])
    for (let i = 0; i < count; i++) {
      const x = await e.add(
        snap({
          category,
          at: `2026-08-27T${String(hour).padStart(2, "0")}:${String(i * 10).padStart(2, "0")}:00Z`,
        }),
      );
      first ||= x;
    }
  let logs = await e.repo.listWorkLogs(subject, { limit: 20 });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].items.length, 3);
  assert.equal(logs[0].captureAssociations.length, 10);
  for (let i = 0; i < 10; i++)
    await e.auto.enqueueAndProcess(subject, first.capture.capture);
  logs = await e.repo.listWorkLogs(subject, { limit: 20 });
  assert.equal(logs[0].captureAssociations.length, 10);
  const late = await e.add(snap({ at: "2026-08-27T11:30:00Z" }));
  logs = await e.repo.listWorkLogs(subject, { limit: 20 });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].items.length, 4);
  const log = logs[0];
  await e.repo.patchWorkLog(
    subject,
    log.logId,
    { summary: "用户摘要" },
    log.version,
  );
  let edited = await e.repo.getWorkLog(subject, log.logId),
    item = edited.items[0];
  await e.repo.updateItem(
    subject,
    log.logId,
    item.itemId,
    { title: "用户标题", content: "用户内容", result: "用户结果" },
    edited.version,
  );
  await e.add(snap({ category: item.category, at: "2026-08-27T11:40:00Z" }));
  edited = await e.repo.getWorkLog(subject, log.logId);
  assert.equal(edited.summary, "用户摘要");
  item = edited.items.find((x) => x.itemId === item.itemId);
  assert.equal(item.content, "用户内容");
  assert.equal(item.result, "用户结果");
  const beforeFinal = await e.repo.getWorkLog(subject, log.logId);
  await e.repo.finalizeWorkLog(subject, log.logId, beforeFinal.version);
  await e.add(snap({ at: "2026-08-27T12:00:00Z", location: false }));
  logs = await e.repo.listWorkLogs(subject, { limit: 20 });
  assert.equal(logs.length, 2);
  assert.equal(logs.filter((x) => x.status === "FINAL").length, 1);
  const partial = await e.add(snap({ project: "B" }), { failAfterDraft: true });
  assert.equal(partial.auto.status, "RETRY_WAIT");
  await e.auto.reconcile({ subjectId: subject });
  logs = await e.repo.listWorkLogs(subject, { limit: 20 });
  assert.equal(logs.length, 2);
  assert.ok(logs.some((x) => x.items.some((item) => item.autoGroupingKey?.includes("|B|"))));
  assert.equal(
    [...e.store.data.keys()].some((k) => /image|photo-bytes|album/i.test(k)),
    false,
  );
  assert.equal(semantic(logs).length, 2);
});
test("PARITY-AUTO EdgeOne 20 concurrent and CAS conflict", async () => {
  const e = edgeHarness();
  e.store.casConflicts = 3;
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      e.add(
        snap({
          category: ["设备巡检", "网络故障处理", "活动保障"][i % 3],
          at: `2026-08-27T08:${String(i).padStart(2, "0")}:00Z`,
        }),
      ),
    ),
  );
  const logs = await e.repo.listWorkLogs(subject, { limit: 20 });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].captureAssociations.length, 20);
});
test("PARITY-AUTO Wrangler real D1 canonical, edit, FINAL, fault and reconciliation", async (t) => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
    { cwd: root, stdio: "ignore" },
  );
  const worker = await unstable_dev("tests/fixtures/d1-auto-draft-worker.js", {
    config: "wrangler.jsonc",
    local: true,
    persist: true,
    logLevel: "none",
  });
  t.after(() => worker.stop());
  const runSubject = `sub_${randomBytes(12).toString("hex")}`,
    call = (action, ...args) =>
      worker
        .fetch("http://local/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, args }),
        })
        .then((r) => r.json()),
    add = async (s, o) =>
      call(
        "captureAndProcess",
        {
          subjectId: runSubject,
          snapshot: s,
          payloadDigest: await payloadDigest(s),
        },
        o,
      );
  let first;
  for (const [category, count, hour] of [
    ["设备巡检", 4, 8],
    ["网络故障处理", 3, 9],
    ["活动保障", 3, 10],
  ])
    for (let i = 0; i < count; i++) {
      const x = await add(
        snap({
          category,
          at: `2026-08-27T${String(hour).padStart(2, "0")}:${String(i * 10).padStart(2, "0")}:00Z`,
        }),
      );
      assert.equal(x.ok, true, JSON.stringify(x));
      first ||= x;
    }
  let logs = (await call("aggregate", runSubject)).result;
  assert.equal(logs.length, 1);
  assert.equal(logs[0].items.length, 3);
  assert.equal(logs[0].associations.length, 10);
  for (let i = 0; i < 10; i++) await add(first.result.capture.capture);
  logs = (await call("aggregate", runSubject)).result;
  assert.equal(logs[0].associations.length, 10);
  await call("editSummary", runSubject, logs[0].log_id, "用户摘要");
  const item = logs[0].items[0];
  await call("editItem", runSubject, logs[0].log_id, item.item_id, {
    content: "用户内容",
  });
  await add(snap({ category: item.category, at: "2026-08-27T10:20:00Z" }));
  logs = (await call("aggregate", runSubject)).result;
  assert.equal(logs[0].summary, "用户摘要");
  assert.equal(
    logs[0].items.find((x) => x.item_id === item.item_id).content,
    "用户内容",
  );
  await call("finalize", runSubject, logs[0].log_id);
  const fault = await add(snap({ at: "2026-08-27T12:00:00Z" }), {
    failAfterDraft: true,
  });
  assert.equal(fault.result.auto.status, "RETRY_WAIT");
  await call("reconcile", { subjectId: runSubject });
  logs = (await call("aggregate", runSubject)).result;
  assert.equal(logs.length, 2);
  assert.equal(logs.filter((x) => x.status === "FINAL").length, 1);
});

test("PARITY-AUTO Wrangler D1 gap, project/date and 20 concurrent", async (t) => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
    { cwd: root, stdio: "ignore" },
  );
  const worker = await unstable_dev("tests/fixtures/d1-auto-draft-worker.js", {
    config: "wrangler.jsonc",
    local: true,
    persist: true,
    logLevel: "none",
  });
  t.after(() => worker.stop());
  const runSubject = `sub_${randomBytes(12).toString("hex")}`,
    call = (action, ...args) =>
      worker
        .fetch("http://local/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, args }),
        })
        .then((r) => r.json()),
    add = async (s, o) =>
      call(
        "captureAndProcess",
        {
          subjectId: runSubject,
          snapshot: s,
          payloadDigest: await payloadDigest(s),
        },
        o,
      );
  const inputs = [
    snap({ at: "2026-08-27T08:00:00Z" }),
    snap({ at: "2026-08-27T08:15:00Z" }),
    snap({ at: "2026-08-27T08:40:00Z" }),
    snap({ at: "2026-08-27T11:30:00Z" }),
  ];
  for (const s of inputs) assert.equal((await add(s)).ok, true);
  let logs = (await call("aggregate", runSubject)).result;
  assert.equal(logs.length, 1);
  assert.equal(logs[0].items.length, 2);
  await add(snap({ project: "B" }));
  await add(
    snap({ project: "A", date: "2026-08-28", at: "2026-08-28T08:00:00Z" }),
  );
  logs = (await call("aggregate", runSubject)).result;
  assert.equal(logs.length, 2);
  assert.equal(logs.filter((x) => x.local_date === "2026-08-27").length, 1);
  assert.equal(logs.find((x) => x.local_date === "2026-08-27").items.length, 3);
  const concurrentSubject = `sub_${randomBytes(12).toString("hex")}`,
    addConcurrent = async (s) =>
      call("captureAndProcess", {
        subjectId: concurrentSubject,
        snapshot: s,
        payloadDigest: await payloadDigest(s),
      });
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      addConcurrent(
        snap({
          category: ["设备巡检", "网络故障处理", "活动保障"][i % 3],
          at: `2026-08-27T08:${String(i).padStart(2, "0")}:00Z`,
        }),
      ),
    ),
  );
  assert.ok(results.every((x) => x.ok));
  logs = (await call("aggregate", concurrentSubject)).result;
  assert.equal(logs.length, 1);
  assert.equal(
    logs.reduce((n, l) => n + l.associations.length, 0),
    20,
  );
  const replaySubject = `sub_${randomBytes(12).toString("hex")}`,
    replaySnapshot = snap(),
    replay = async () =>
      call(
        "captureAndProcess",
        {
          subjectId: replaySubject,
          snapshot: replaySnapshot,
          payloadDigest: await payloadDigest(replaySnapshot),
        },
        { simulateUnknown: true },
      );
  for (let i = 0; i < 10; i++) assert.equal((await replay()).ok, true);
  logs = (await call("aggregate", replaySubject)).result;
  assert.equal(logs.length, 1);
  assert.equal(logs[0].associations.length, 1);
});

test("PARITY-AUTO failure isolation keeps Capture CREATED", async () => {
  const { WorkLogHttpService } =
      await import("../src/work-log/http-service.generated.js"),
    e = edgeHarness(),
    service = new WorkLogHttpService({
      repository: e.repo,
      enabled: true,
      authenticate: async () => ({ subjectId: subject, authType: "MINI" }),
      autoDraftService: {
        enqueueAndProcess() {
          throw new Error("AUTO_STORAGE_DOWN");
        },
      },
    }),
    s = snap({ project: null }),
    digest = await payloadDigest(s);
  const response = await service.handle(
      new Request("http://local/v1/captures/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          items: [
            {
              clientCaptureId: s.capture.clientCaptureId,
              payloadDigest: digest,
              snapshot: s,
            },
          ],
        }),
      }),
    ),
    body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.results[0].status, "CREATED");
  assert.ok(
    await e.repo.getCaptureByClientCaptureId(
      subject,
      s.capture.clientCaptureId,
    ),
  );
});
test("RUNTIME-PARITY EdgeOne activates historical facts and preserves no-op replay", async () => {
  const e = edgeHarness(false),
    first = await e.add(workSnap("显示屏断电", "食堂", "2026-08-27T08:00:00Z"));
  let log = (await e.repo.listWorkLogs(subject, { limit: 20 }))[0];
  const old = log.items[0].content;
  e.auto.semanticDraft = true;
  await e.add(workSnap("监控故障，更换", "运动馆", "2026-08-27T09:10:00Z"));
  log = await e.repo.getWorkLog(subject, log.logId);
  assert.notEqual(log.items[0].content, old);
  assert.match(log.summary, /记录食堂显示屏断电情况/);
  assert.match(log.summary, /运动馆监控设备出现故障，现场对相关设备进行更换/);
  for (const item of log.items) {
    assert.equal(item.plannerVersion, "WORK_LOG_CHINESE_PLANNER_V1");
    assert.match(item.factDigest, /^facts-v1-/);
  }
  const before = JSON.stringify(log);
  await e.auto.enqueueAndProcess(subject, first.capture.capture);
  assert.equal(
    JSON.stringify(await e.repo.getWorkLog(subject, log.logId)),
    before,
  );
  await e.repo.patchWorkLog(
    subject,
    log.logId,
    { summary: "人工摘要" },
    log.version,
  );
  let edited = await e.repo.getWorkLog(subject, log.logId),
    editedItem = edited.items[0];
  await e.repo.updateItem(
    subject,
    log.logId,
    editedItem.itemId,
    { content: "人工正文" },
    edited.version,
  );
  await e.add(workSnap("显示屏断电", "报告厅", "2026-08-27T08:20:00Z"));
  edited = await e.repo.getWorkLog(subject, log.logId);
  assert.equal(edited.summary, "人工摘要");
  assert.equal(
    edited.items.find((x) => x.itemId === editedItem.itemId).content,
    "人工正文",
  );
  const finalBefore = JSON.stringify(edited);
  await e.repo.finalizeWorkLog(subject, log.logId, edited.version);
  await e.add(workSnap("设备巡检", "行政楼", "2026-08-27T12:00:00Z"));
  const finalAfter = await e.repo.getWorkLog(subject, log.logId);
  assert.equal(finalAfter.status, "FINAL");
  assert.equal(finalAfter.summary, "人工摘要");
  assert.equal(
    finalAfter.items.find((x) => x.itemId === editedItem.itemId).content,
    "人工正文",
  );
  assert.notEqual(JSON.stringify(finalAfter), finalBefore);
});
test("RUNTIME-PARITY Wrangler D1 and EdgeOne historical outputs are byte-identical", async (t) => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
    { cwd: root, stdio: "ignore" },
  );
  const worker = await unstable_dev("tests/fixtures/d1-auto-draft-worker.js", {
    config: "wrangler.jsonc",
    local: true,
    persist: true,
    logLevel: "none",
  });
  t.after(() => worker.stop());
  const runSubject = `sub_${randomBytes(12).toString("hex")}`,
    call = (action, ...args) =>
      worker
        .fetch("http://local/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, args }),
        })
        .then((r) => r.json()),
    add = async (s, semanticDraft) =>
      call(
        "captureAndProcess",
        {
          subjectId: runSubject,
          snapshot: s,
          payloadDigest: await payloadDigest(s),
        },
        null,
        { runtimeConfig: { semanticDraft } },
      );
  const one = workSnap("显示屏断电", "食堂", "2026-08-27T08:00:00Z"),
    two = workSnap("监控故障，更换", "运动馆", "2026-08-27T09:10:00Z");
  await add(one, false);
  await add(two, true);
  const log = (await call("aggregate", runSubject)).result[0];
  assert.match(log.summary, /记录食堂显示屏断电情况/);
  assert.match(log.summary, /运动馆监控设备出现故障，现场对相关设备进行更换/);
  for (const item of log.items) {
    const generated = JSON.parse(item.generated_fields_json);
    assert.equal(generated.plannerVersion, "WORK_LOG_CHINESE_PLANNER_V1");
    assert.match(generated.factDigest, /^facts-v1-/);
  }
  const edge = edgeHarness(false);
  await edge.add(one);
  edge.auto.semanticDraft = true;
  await edge.add(two);
  const edgeLog = (await edge.repo.listWorkLogs(subject, { limit: 20 }))[0],
    project = (value) => ({
      summary: value.summary,
      items: value.items
        .map((item) => {
          const generated = item.generated_fields_json
            ? JSON.parse(item.generated_fields_json)
            : item;
          return {
            title: item.title,
            content: item.content,
            factDigest: generated.factDigest,
            plannerVersion: generated.plannerVersion,
          };
        })
        .sort((a, b) => a.title.localeCompare(b.title, "zh-CN")),
    });
  assert.deepEqual(project(log), project(edgeLog));
  await call("editSummary", runSubject, log.log_id, "人工摘要");
  const d1Item = log.items[0];
  await call("editItem", runSubject, log.log_id, d1Item.item_id, {
    content: "人工正文",
  });
  await add(workSnap("显示屏断电", "报告厅", "2026-08-27T08:20:00Z"), true);
  const protectedLog = (await call("aggregate", runSubject)).result.find(
    (x) => x.log_id === log.log_id,
  );
  assert.equal(protectedLog.summary, "人工摘要");
  assert.equal(
    protectedLog.items.find((x) => x.item_id === d1Item.item_id).content,
    "人工正文",
  );
  await call("finalize", runSubject, log.log_id);
  await add(workSnap("设备巡检", "行政楼", "2026-08-27T12:00:00Z"), true);
  const afterFinal = (await call("aggregate", runSubject)).result;
  assert.equal(afterFinal.filter((x) => x.status === "FINAL").length, 1);
  assert.equal(afterFinal.length, 2);
  const concurrentSubject = `sub_${randomBytes(12).toString("hex")}`,
    concurrent = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const value = workSnap(
          "设备巡检",
          `楼栋${i + 1}`,
          `2026-08-27T08:${String(i).padStart(2, "0")}:00Z`,
        );
        return call(
          "captureAndProcess",
          {
            subjectId: concurrentSubject,
            snapshot: value,
            payloadDigest: await payloadDigest(value),
          },
          null,
          { runtimeConfig: { semanticDraft: true } },
        );
      }),
    );
  assert.ok(concurrent.every((x) => x.ok));
  const concurrentLog = (await call("aggregate", concurrentSubject)).result[0];
  assert.equal(concurrentLog.associations.length, 20);
  assert.equal(concurrentLog.items.length, 1);
  assert.match(concurrentLog.summary, /设备进行巡检/);
});
test("RUNTIME-LIFE EdgeOne semantic 20 concurrent captures keep facts and summary", async () => {
  const e = edgeHarness(true),
    results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        e.add(
          workSnap(
            "设备巡检",
            `楼栋${i + 1}`,
            `2026-08-27T08:${String(i).padStart(2, "0")}:00Z`,
          ),
        ),
      ),
    );
  assert.ok(
    results.every(
      (x) => x.auto.status === "COMPLETED" || x.auto.status === "RETRY_WAIT",
    ),
  );
  await e.auto.reconcile({ subjectId: subject });
  const logs = await e.repo.listWorkLogs(subject, { limit: 20 }),
    log = logs[0];
  assert.equal(log.captureAssociations.length, 20);
  assert.equal(log.items.length, 1);
  assert.match(log.summary, /设备进行巡检/);
  assert.match(log.items[0].factDigest, /^facts-v1-/);
});

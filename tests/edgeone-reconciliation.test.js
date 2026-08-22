import test from "node:test";
import assert from "node:assert/strict";
import { EdgeOneBlobProvenanceCommitRepository } from "../src/provenance-repositories.js";
class Blob {
  data = new Map();
  fail = true;
  async set(k, v, o = {}) {
    if (this.fail && k.includes("/band/")) {
      this.fail = false;
      throw new Error("INDEX_FAIL");
    }
    if (o.onlyIfNew && this.data.has(k)) throw new Error("EXISTS");
    this.data.set(k, v);
  }
  async get(k) {
    const v = this.data.get(k);
    return v
      ? {
          arrayBuffer: async () =>
            v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength),
        }
      : null;
  }
  async delete(k) {
    this.data.delete(k);
  }
  async list({prefix='',limit=1000}) {
    const objects=[...this.data.keys()].filter(key=>key.startsWith(prefix)).sort().slice(0,limit).map(key=>({key}));
    return {objects,list_complete:objects.length<limit};
  }
}
test("EdgeOne authoritative success survives partial index failure and reconciliation is idempotent", async () => {
  const blob = new Blob(),
    repository = new EdgeOneBlobProvenanceCommitRepository(blob),
    record = {
      recordId: "rec_reconcile_123456789",
      binding: {
        sha256: "a".repeat(64),
        blindMarkerId: "1".repeat(32),
        dhash256: "b".repeat(64),
        phash256: "c".repeat(64),
      },
    },
    commit = {
      subjectId: "sub_reconcile_subject",
      clientTaskId: "task_reconcile_1234",
      ticketId: "tkt_reconcile_123456",
      registrationRequestDigest: "d".repeat(64),
      record,
      recordDigest: "e".repeat(64),
      receipt: {},
      serverReceivedAt: 1,
    },
    result = await repository.commitRegistration(commit);
  assert.equal(result.result, "CREATED");
  assert.equal(result.indexStatus, "INDEX_RECONCILIATION_REQUIRED");
  assert.equal(await repository.reconcile(record.recordId), true);
  assert.equal(await repository.reconcile(record.recordId), true);
  assert.equal(
    [...blob.data.keys()].filter((k) => k.includes("/band/")).length,
    8,
  );
  assert.equal(
    (await repository.getRecordById(record.recordId)).recordId,
    record.recordId,
  );
  assert.deepEqual((await repository.findByFileSha256(record.binding.sha256)).records,[{recordId:record.recordId}]);
  assert.deepEqual((await repository.findByMarkerId(record.binding.blindMarkerId)).records,[{recordId:record.recordId}]);
  assert.equal((await repository.findVisualCandidates(record.binding.dhash256)).records[0].recordId,record.recordId);
});

test("EdgeOne conditional store resolves 100 same-ticket calls to one immutable winner", async () => {
  const blob = new Blob();
  blob.fail = false;
  const repository = new EdgeOneBlobProvenanceCommitRepository(blob),
    record = {
      recordId: "rec_edge_concurrent_123",
      binding: {
        sha256: "a".repeat(64),
        blindMarkerId: "2".repeat(32),
        dhash256: "b".repeat(64),
        phash256: "c".repeat(64),
      },
    },
    base = {
      subjectId: "sub_edge_concurrent",
      clientTaskId: "task_edge_concurrent",
      ticketId: "tkt_edge_concurrent_123",
      registrationRequestDigest: "d".repeat(64),
      record,
      recordDigest: "e".repeat(64),
      receipt: {},
      serverReceivedAt: 1,
    },
    same = await Promise.all(
      Array.from({ length: 100 }, () => repository.commitRegistration(base)),
    );
  assert.equal(same.filter((x) => x.result === "CREATED").length, 1);
  assert.equal(same.filter((x) => x.result === "IDEMPOTENT_REPLAY").length, 99);
  const alternate = {
    ...base,
    registrationRequestDigest: "f".repeat(64),
    record: { ...record, recordId: "rec_edge_loser_123456" },
  };
  assert.equal(
    (await repository.commitRegistration(alternate)).result,
    "CONFLICT",
  );
  assert.equal(
    [...blob.data.keys()].filter((k) => k.includes("/commits/ticket/")).length,
    1,
  );
  const conflictBlob = new Blob();
  conflictBlob.fail = false;
  const conflictRepository = new EdgeOneBlobProvenanceCommitRepository(conflictBlob),
    left = { ...base, ticketId: "tkt_edge_conflict_123", clientTaskId: "task_edge_left_123" },
    right = { ...left, registrationRequestDigest: "f".repeat(64), record: { ...record, recordId: "rec_edge_right_123456" } },
    mixed = await Promise.all(Array.from({ length: 100 }, (_, index) => conflictRepository.commitRegistration(index % 2 ? left : right)));
  assert.equal(mixed.filter((x) => x.result === "CREATED").length, 1);
  assert.equal(mixed.filter((x) => x.result === "CONFLICT").length, 50);
  assert.equal(mixed.filter((x) => x.result === "IDEMPOTENT_REPLAY").length, 49);
});

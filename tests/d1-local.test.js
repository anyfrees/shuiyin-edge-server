import test from "node:test";
import assert from "node:assert/strict";
import { unstable_dev } from "wrangler";
import {
  CaptureTicketRuntimeService,
  ticketDigest,
} from "../src/provenance-core.generated.js";
const b64 = (b) => Buffer.from(b).toString("base64url"),
  keys = async (purpose, keyId) => {
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
  hashes = Array.from({ length: 16 }, (_, i) =>
    i.toString(16).padStart(64, "0"),
  ),regional={algorithm:'regional-integrity-v3',grid:{columns:4,rows:4},descriptorFormat:'hybrid-normalized-patch-8x8-residual4x4-v1-base64url',blocks:Array.from({length:16},(_,index)=>({index,descriptor:Buffer.alloc(80,index).toString('base64url')}))},watermark={algorithm:'watermark-integrity-v2',grid:{columns:4,rows:3},descriptorFormat:'int8-normalized-patch-8x8-base64url',blocks:Array.from({length:12},(_,index)=>({index,descriptor:Buffer.alloc(64,index).toString('base64url')}))};
test("Wrangler local D1 migration and authoritative registration transaction", async (t) => {
  const worker = await unstable_dev(
    "tests/fixtures/d1-registration-worker.js",
    { config: "wrangler.jsonc", local: true, persist: true, logLevel: "none" },
  );
  t.after(() => worker.stop());
  const capture = await keys("capture-ticket-signing", "d1-cap"),
    receipt = await keys("provenance-receipt-signing", "d1-receipt"),
    subject = { subjectId: `sub_d1_${Date.now()}_subject`, status: "active" },
    ticket = (
      await new CaptureTicketRuntimeService({ keys: [capture] }).issue(
        subject,
        { kind: "online" },
      )
    ).tickets[0],
    digest = await ticketDigest(ticket),
    request = {
      clientTaskId: `task_d1_${Date.now()}_123`,
      draft: {
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
          name: "d1",
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
        integrity: structuredClone(regional),
        watermarkIntegrity: structuredClone(watermark),
        rendererVersion: 2,
        privacyLevel: "private",
      },
      ticket,
    },
    payload = {
      subject,
      request,
      captureKeys: [capture],
      receiptKeys: [receipt],
    },
    call = () =>
      worker
        .fetch("http://local/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
        .then((r) => r.json()),
    concurrent = await Promise.all(Array.from({ length: 20 }, call)),
    first = concurrent.find((x) => x.result === "CREATED"),
    replays = concurrent.filter((x) => x.result === "IDEMPOTENT_REPLAY");
  assert.ok(first, JSON.stringify(concurrent));
  assert.equal(replays.length, 19);
  assert.equal(new Set(concurrent.map((x) => x.recordId)).size, 1);
  assert.equal(concurrent.every((x) => JSON.stringify(x.receipt) === JSON.stringify(first.receipt)), true);
  await worker.stop();const reopened=await unstable_dev('tests/fixtures/d1-registration-worker.js',{config:'wrangler.jsonc',local:true,persist:true,logLevel:'none'});t.after(()=>reopened.stop());const verified=await reopened.fetch('http://local/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'verify',receiptKeys:[receipt],request:{protocolVersion:2,file:{algorithm:'sha256-v1',sha256:'a'.repeat(64)},fingerprints:{dhash:{algorithm:'dhash256-v2',value:'b'.repeat(64)},phash:{algorithm:'phash256-v1',value:'c'.repeat(64)},regional,watermark:{...watermark,bounds:{x:.1,y:.7,width:.8,height:.2}}},blindMarker:{algorithm:'jilu-blind-v2',protocolVersion:2,extracted:true,markerId:ticket.markerId,ticketDigest:digest,flags:1,crcValid:true,confidence:.9}}})}).then(r=>r.json());
  assert.equal(verified.status,'EXACT_FILE',JSON.stringify(verified));
  const reopenedRecord=await reopened.fetch('http://local/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'get',recordId:first.recordId})}).then(r=>r.json());assert.deepEqual(reopenedRecord.integrity.blocks,regional.blocks);assert.deepEqual(reopenedRecord.watermarkIntegrity.blocks,watermark.blocks);assert.equal(reopenedRecord.recordDigest,first.recordDigest);assert.deepEqual(reopenedRecord.receipt,first.receipt);
  assert.equal(JSON.stringify(verified).includes('latitude'),false);
});

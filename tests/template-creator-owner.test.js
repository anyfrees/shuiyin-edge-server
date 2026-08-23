import assert from "node:assert/strict";
import test from "node:test";
import { MemoryTemplateEntitlementRepository, TemplateEntitlementService } from "../src/template-entitlement-core.generated.js";

test("creator keeps implicit access when a published contribution becomes restricted", async () => {
  const repository = new MemoryTemplateEntitlementRepository(), service = new TemplateEntitlementService({ repository, now: () => 1000 });
  const subject = { subjectId: "sub_creator", publicId: "JL-CREATOR", status: "active", internal: false, anonymous: false };
  await service.createTemplate({ templateId: "tpl_creator_owned", visibility: "USER_RESTRICTED", category: "general", name: "创作模板", description: "", tags: [], minimumSupportedVersion: 1, updatePolicy: "PROMPT", contributionType: "USER_SUBMISSION", creatorPublicId: subject.publicId, creatorSharingEnabled: true, offlinePolicy: { allowed: true, leaseHours: 168 } }, "admin");
  await service.createVersion("tpl_creator_owned", { templateVersion: 1, layout: { canvas: { width: 320, height: 180 }, fields: [] }, assets: [] }, "admin");
  await service.publishVersion("tpl_creator_owned", 1, "admin");
  assert.equal((await service.catalog(subject, { category: "creative" })).items[0].templateId, "tpl_creator_owned");
  assert.equal((await service.detail(subject, "tpl_creator_owned")).templateId, "tpl_creator_owned");
  await assert.rejects(() => service.detail({ ...subject, subjectId: "sub_other", publicId: "JL-OTHER" }, "tpl_creator_owned"), error => error.code === "TEMPLATE_NOT_AVAILABLE");
});

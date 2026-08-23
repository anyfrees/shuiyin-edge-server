import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTemplateAccess } from "../src/template-entitlement-core.generated.js";

const now = 1_000;
const subject = { subjectId: "sub_union", status: "active", internal: false };
const template = { templateId: "tpl_union", visibility: "USER_RESTRICTED", enabled: true, latestVersion: 1 };
const active = (extra = {}) => ({ enabled: true, expiresAt: null, revokedAt: null, ...extra });

test("direct and group grants form an independent union", () => {
  const group = { groupId: "grp_union", enabled: true };
  const membership = active({ groupId: group.groupId, subjectId: subject.subjectId });
  const groupGrant = active({ groupId: group.groupId, templateId: template.templateId });
  assert.equal(evaluateTemplateAccess({ template, subject, memberships: [membership], groups: [group], groupGrants: [groupGrant], now }).entitlementType, "GROUP_RESTRICTED");
  assert.equal(evaluateTemplateAccess({ template, subject, memberships: [{ ...membership, enabled: false, revokedAt: now }], groups: [group], groupGrants: [groupGrant], now }).allowed, false);
  assert.equal(evaluateTemplateAccess({ template: { ...template, visibility: "GROUP_RESTRICTED" }, subject, directGrant: active({ subjectId: subject.subjectId, templateId: template.templateId }), memberships: [{ ...membership, enabled: false, revokedAt: now }], groups: [group], groupGrants: [groupGrant], now }).entitlementType, "USER_RESTRICTED");
});

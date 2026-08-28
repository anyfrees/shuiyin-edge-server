import { aggregateAtomicWorkFacts, atomicFactDigest, normalizeAtomicWorkFacts, planWorkLogItem, planWorkLogSummary, semanticDraftForCaptures, WORK_LOG_CHINESE_PLANNER_VERSION } from "./chinese-draft-planner.generated.js";

const parse = (value, fallback) => { try { return JSON.parse(value || "") } catch { return fallback } };
const editedFields = (item) => parse(item.userEditedFieldsJson ?? item.user_edited_fields_json, []);
const generatedFields = (item) => parse(item.generatedFieldsJson ?? item.generated_fields_json, {});
const capturesOf = (item) => item.captures || [];

export const rebuildWorkLogItemFacts = (item = {}) => {
  const captures = capturesOf(item);
  const generated = generatedFields(item);
  let facts, source, recoverable = false;
  if (captures.length) { facts = semanticDraftForCaptures(captures).atomicFacts; source = "CAPTURE_STRUCTURED_FACTS"; recoverable = true; }
  else if (generated.atomicFacts) { facts = normalizeAtomicWorkFacts({ atomicFacts:generated.atomicFacts }); source = "ITEM_NORMALIZED_FACTS"; recoverable = true; }
  else { facts = normalizeAtomicWorkFacts({ category:item.category,title:item.title,content:item.content,result:item.result,firstCaptureAt:item.firstCaptureAt ?? item.first_capture_at }); source = "LEGACY_PRESENTATION_FALLBACK"; }
  const plan = planWorkLogItem({ category:item.category, atomicFacts:facts });
  return { ...plan,factDigest:atomicFactDigest(plan.facts),rebuildSource:"FACT_REBUILD",factSource:source,recoverable,userEditedFields:editedFields(item) };
};

export const rebuildWorkLogFacts = (items = []) => {
  const rebuiltItems=items.map(rebuildWorkLogItemFacts),facts=aggregateAtomicWorkFacts(rebuiltItems.map((item)=>({atomicFacts:item.facts}))),planned=planWorkLogSummary(rebuiltItems.map((item,index)=>({category:items[index]?.category,atomicFacts:item.facts,firstCaptureAt:items[index]?.firstCaptureAt??items[index]?.first_capture_at})));
  return { plannerVersion:WORK_LOG_CHINESE_PLANNER_VERSION,origin:"RULE_GENERATED",rebuildSource:"FACT_REBUILD",facts,factDigest:atomicFactDigest(facts),summary:planned.summary,items:rebuiltItems };
};

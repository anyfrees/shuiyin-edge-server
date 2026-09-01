import { assertSemanticFactSafety } from "./semantic-fact-safety.js";

export const WORK_LOG_DAILY_REPORT_REALIZER_VERSION = "WORK_LOG_DAILY_REPORT_REALIZER_V1";

const clean = (value) => String(value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set((values || []).map(clean).filter(Boolean))];
const terminalPunctuation = /[。！？；.!?;]+$/u;
const punctuate = (value) => {
  const text = clean(value), terminal = text.match(terminalPunctuation)?.[0] || "";
  const mark = /[!！]/u.test(terminal) ? "！" : /[?？]/u.test(terminal) ? "？" : "。";
  return `${text.replace(terminalPunctuation, "")}${mark}`;
};
export const PHRASE_COMPLETENESS = Object.freeze({
  BARE_PHRASE:"BARE_PHRASE",
  CLAUSE:"CLAUSE",
  COMPLETE_DESCRIPTION:"COMPLETE_DESCRIPTION",
  COMPLETE_SENTENCE:"COMPLETE_SENTENCE",
});
export const RESULT_SEMANTIC_CLASS = Object.freeze({
  ACTION_COMPLETION_RESULT:"ACTION_COMPLETION_RESULT",
  STATE_CHANGE_RESULT:"STATE_CHANGE_RESULT",
  CURRENT_STATE_RESULT:"CURRENT_STATE_RESULT",
  NEGATIVE_RESULT:"NEGATIVE_RESULT",
  INDEPENDENT_RESULT:"INDEPENDENT_RESULT",
  UNKNOWN_RESULT:"UNKNOWN_RESULT",
});
const ACTION_CLASS_BY_TERM = new Map([
  ["修复","REPAIR"],["维修","REPAIR"],["处理","HANDLE"],["更换","REPLACE"],
  ["办理","REGISTER"],["调试","DEBUG"],["排查","INSPECT"],["检查","CHECK"],
  ["盘点","INVENTORY"],["恢复","RESTORE"],
]);
export const canonicalActionClass = (value) => ACTION_CLASS_BY_TERM.get(clean(value)) || "OTHER";
export const classifyActionResult = ({action, result} = {}) => {
  const actionText = clean(action), resultText = clean(result), actionClass = canonicalActionClass(actionText);
  const completion = resultText.match(/^已(?:经)?(修复|维修|处理|更换|办理)$/u);
  const resultActionClass = canonicalActionClass(completion?.[1]);
  let resultClass = RESULT_SEMANTIC_CLASS.UNKNOWN_RESULT;
  if (/(?:暂未|尚未|仍未|未恢复|仍异常|仍存在|待处理|未解决)/u.test(resultText)) resultClass = RESULT_SEMANTIC_CLASS.NEGATIVE_RESULT;
  else if (/(?:目前|当前|暂时).*(?:正常|可用|稳定)|目前测试正常/u.test(resultText)) resultClass = RESULT_SEMANTIC_CLASS.CURRENT_STATE_RESULT;
  else if (completion && resultActionClass === actionClass && actionClass !== "OTHER") resultClass = RESULT_SEMANTIC_CLASS.ACTION_COMPLETION_RESULT;
  else if (/(?:恢复(?:正常|供电|运行)|正常运行|问题(?:已)?解决|故障原因(?:已)?定位|原因(?:已)?定位)/u.test(resultText)) resultClass = RESULT_SEMANTIC_CLASS.STATE_CHANGE_RESULT;
  else if (/(?:共?确认\s*\d+|数量(?:已)?确认|状态(?:已)?确认)/u.test(resultText)) resultClass = RESULT_SEMANTIC_CLASS.INDEPENDENT_RESULT;
  const overlap = resultClass === RESULT_SEMANTIC_CLASS.ACTION_COMPLETION_RESULT;
  return {
    actionClass,
    resultClass,
    overlap,
    reason:overlap ? `RESULT_COMPLETION_MORPHOLOGY_MATCHES_${actionClass}` : "RESULT_CONTAINS_INDEPENDENT_OR_UNKNOWN_INFORMATION",
  };
};
const actionLead = /^(?:现场)?(?:完成|开展|检查|巡检|排查|调试|处理|保障|记录|办理|更换|维修|重启|恢复|核对|针对)/u;
const predicateShape = /(?:不显示|未开|未恢复|仍未|暂未|异常|离线|掉线|断电|断网|黑屏|中断|损坏|松动|故障|恢复|进行(?:检查|巡检|排查|调试|处理|保障|更换|维修|重启)|已(?:完成|恢复|解决|处理))/u;
const semanticRoleOf = (source, facts) => clean(source.semanticRole || source.semantic_role ||
  (facts?.provenance || []).map((entry) => clean(entry?.semanticRole || entry?.semantic_role || entry?.role)).find(Boolean)).toUpperCase();

export const classifyPhraseCompleteness = ({ text, semanticRole = "", source = "" } = {}) => {
  const value = clean(text), role = clean(semanticRole).toUpperCase(), origin = clean(source).toUpperCase();
  const body = value.replace(terminalPunctuation, ""), hasTerminal = terminalPunctuation.test(value);
  const clauses = body.split(/[，,；;]/u).map(clean).filter(Boolean);
  const isDescription = role === "DESCRIPTION" || origin === "DESCRIPTION";
  if (!value || role === "ISSUE") return PHRASE_COMPLETENESS.BARE_PHRASE;
  const completeShape = actionLead.test(body) || /进行(?:检查|巡检|排查|调试|处理|保障|更换|维修|重启)/u.test(body) ||
    (clauses.length >= 2 && clauses.every((part) => predicateShape.test(part)));
  if (isDescription && completeShape) return hasTerminal ? PHRASE_COMPLETENESS.COMPLETE_SENTENCE : PHRASE_COMPLETENESS.COMPLETE_DESCRIPTION;
  if (predicateShape.test(body) && !/(?:情况|工作|业务)$/u.test(body)) return PHRASE_COMPLETENESS.CLAUSE;
  return PHRASE_COMPLETENESS.BARE_PHRASE;
};
const locationsText = (values, max = 4) => {
  const locations = unique(values);
  return locations.length > max ? `${locations.slice(0, max).join("、")}等区域` : locations.join("、");
};
const objectText = (value) => clean(value).replace("教室班主任监控相机", "教室监控相机");
const issueCore = (object, issue) => {
  const stem = objectText(object).replace(/(?:相关)?(?:设备|业务|相机)$/u, "");
  return stem && clean(issue).startsWith(stem) ? clean(issue).slice(stem.length) : clean(issue);
};
const issuePhrase = (object, issue) => {
  const core = issueCore(object, issue);
  if (core === "故障") return `${objectText(object)}出现故障`;
  if (core === "异常") return `${objectText(object)}出现异常`;
  return `${objectText(object)}${core}`;
};
const naturalDescription = (source, facts) => {
  const explicitRole = semanticRoleOf(source, facts);
  for (const value of unique(facts.descriptions)) {
    if (value.includes("确保")) continue;
    const semanticRole = explicitRole || (unique(facts.actions).some((action) => value.includes(action)) ? "DESCRIPTION" : "");
    const phraseType = classifyPhraseCompleteness({text:value, semanticRole, source:semanticRole});
    if (phraseType === PHRASE_COMPLETENESS.COMPLETE_DESCRIPTION || phraseType === PHRASE_COMPLETENESS.COMPLETE_SENTENCE)
      return {value, phraseType, semanticRole};
  }
  return null;
};

export const realizeDailyReportEntry = (source = {}) => {
  const facts = source.facts || source.atomicFacts || source;
  const actions = unique(facts.actions), objects = unique(facts.objects), issues = unique(facts.issues);
  const results = unique(facts.results), negatives = unique(facts.negativeStatuses);
  const purposes = unique(facts.purposes), quantities = unique(facts.quantities);
  const location = locationsText(facts.locations), object = objectText(objects[0]);
  const action = actions[0], pending=(facts.actionStates||[]).find(entry=>entry.state==="PENDING"||entry.state==="PLANNED"), issue = issues[0], result = results[0], negative = negatives[0];
  const resultSemantic = classifyActionResult({action,result});
  const purpose = purposes[0], quantity = quantities[0], natural = naturalDescription(source, facts);
  let text, wrapperApplied = false;

  if (natural) text = natural.value;
  else if (action === "办理") text = `办理${object || clean(source.category)}`;
  else if (action === "盘点") {
    const target = `${location}${object}${quantity || ""}` || clean(source.category);
    text = `${target}进行设备数量盘点`;
    if (purpose) text += `，${purpose}`;
  } else if (action === "巡检" && !issue) {
    const target = `${location}${object || "相关设备"}` || clean(source.category);
    text = `${target}进行巡检`;
    if (!purpose) text += "，检查设备运行情况";
    else text += `，${purpose}`;
  } else if (issue && action) {
    const subject = `${location}${issuePhrase(object, issue) || "故障"}`;
    text = `${subject}${/(?:故障|异常|离线|断电|断网|中断|损坏)$/u.test(subject) ? "" : "情况"}`;
    text += action === "更换" ? "，现场对相关设备进行更换" : `，现场进行${action}`;
    if (purpose) text += `，${purpose}`;
  } else if (issue) {
    const subject = `${location}${issuePhrase(object, issue)}`;
    text = /(?:故障|异常|离线|断电|断网|中断|损坏)$/u.test(subject)
      ? (/断电$/u.test(subject) ? `记录${subject}情况` : `${subject}，现场记录故障情况`)
      : `记录${subject}情况`;
  } else if (action) {
    const target = `${location}${object}${quantity || ""}`;
    text = target ? `${target}进行${action}` : `${action}${object || clean(source.category)}`;
    if (purpose) text += `，${purpose}`;
  } else {
    const description = unique(facts.descriptions)[0] || clean(source.category) || "现场工作情况";
    const descriptionBody = description.replace(terminalPunctuation, "");
    text = /(?:情况|工作|业务)$/u.test(descriptionBody) ? `记录${descriptionBody}` : `记录${descriptionBody}情况`;
    wrapperApplied = true;
  }

  if (result && !text.includes(result) && !resultSemantic.overlap) {
    text += action && resultSemantic.resultClass !== RESULT_SEMANTIC_CLASS.CURRENT_STATE_RESULT ? `，${action}完成后${result}` : `，${result}`;
  }
  if (negative && !text.includes(negative)) text += `，目前${negative}`;
  if (pending && !text.includes(pending.evidence)) text += `，${pending.evidence}`;

  const candidateText=punctuate(text);
  assertSemanticFactSafety({sourceFacts:facts,candidateText});
  return {
    itemKey: clean(source.itemKey || source.itemId || source.item_id),
    order: Number(source.order || 0),
    text: candidateText,
    factDigest: clean(source.factDigest),
    generatorVersion: WORK_LOG_DAILY_REPORT_REALIZER_VERSION,
    phraseType:natural?.phraseType || classifyPhraseCompleteness({text:unique(facts.descriptions)[0],semanticRole:semanticRoleOf(source,facts)}),
    semanticRole:natural?.semanticRole || semanticRoleOf(source,facts),
    wrapperApplied,
    resultSemantic,
    suppressedRedundantResult:Boolean(result && !text.includes(result) && resultSemantic.overlap),
  };
};

export const realizeStructuredDailyReport = (items = []) => {
  const entries = items.map((item, index) => ({
    ...realizeDailyReportEntry({ ...item, order:index + 1 }),
    stableIndex:index,
    firstCaptureAt:clean(item.firstCaptureAt || item.first_capture_at),
  })).sort((a, b) => a.firstCaptureAt.localeCompare(b.firstCaptureAt) || a.stableIndex - b.stableIndex)
    .map((entry, index) => ({ ...entry, order:index + 1 }));
  return {
    generatorVersion:WORK_LOG_DAILY_REPORT_REALIZER_VERSION,
    entries,
    summary:entries.map((entry) => `${entry.order}、${entry.text}`).join("\n"),
  };
};

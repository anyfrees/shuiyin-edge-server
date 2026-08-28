const clean = (value, fallback = "") => String(value ?? fallback).trim();
export const autoDraftEnabled = (env = {}) =>
  clean(env.WORK_LOG_AUTO_DRAFT_V1_ENABLED).toLowerCase() === "true";
export const aiRefinementEnabled = (env = {}) =>
  clean(env.WORK_LOG_AI_REFINEMENT_V1_ENABLED).toLowerCase() === "true";

const CATEGORY_LABELS = new Set(["事项", "工作事项", "类别", "类型", "说明", "备注", "问题原因", "活动主题"]);
const GENERIC_CATEGORY_VALUES = new Set(["现场记录", "工作记录", "水印模板"]);
const fieldCategory = (capture) => {
  for (const field of capture.fields || []) {
    const label = clean(field?.labelSnapshot || field?.label_snapshot);
    const raw = Array.isArray(field?.value) && field.value.length === 1 ? field.value[0] : field?.value;
    const value = clean(raw);
    if (CATEGORY_LABELS.has(label) && value && value.length <= 40 && !/[\r\n]/.test(value) && !GENERIC_CATEGORY_VALUES.has(value)) return value;
  }
  return "";
};
export const captureCategory = (capture) =>
  fieldCategory(capture) || clean(capture.template?.nameSnapshot || capture.template_name_snapshot, "现场记录").slice(0, 100);

export const workLogGroupingKey = (capture) => {
  const project = clean(capture.project?.projectId || capture.project_id, "none");
  return [capture.subjectId || capture.subject_id, capture.localDate || capture.local_date, project].join("|");
};

export const itemGroupingKey = (capture) => {
  const log = workLogGroupingKey(capture);
  const template = clean(capture.template?.templateId || capture.template_id, "none");
  return [log, captureCategory(capture), template].join("|");
};

export const captureGroupingKey = itemGroupingKey;

const factLines = (capture) => (capture.fields || []).filter((field) => field?.value !== null && field?.value !== undefined && clean(field.value) !== "").slice(0, 8).map((field) => `${clean(field.labelSnapshot, "记录")}: ${Array.isArray(field.value) ? field.value.join("、") : clean(field.value)}`);

export const ruleBasedDraft = (capture, count = 1) => {
  const category = captureCategory(capture), project = clean(capture.project?.projectNameSnapshot || capture.project_name_snapshot), location = clean(capture.location?.name || capture.location_name);
  const facts = factLines(capture);
  return {
    logTitle: `${capture.localDate || capture.local_date} 工作记录`,
    summary: [`已记录 ${count} 条${category}`, project && `项目：${project}`].filter(Boolean).join("；"),
    category,
    itemTitle: category,
    content: [location && `地点：${location}`, ...facts].filter(Boolean).join("\n"),
    result: "",
    note: "",
  };
};

const joinChinese = (values) => values.length < 2 ? (values[0] || "") : `${values.slice(0, -1).join("、")}及${values.at(-1)}`;
export const ruleBasedSummary = (entries) => {
  const items = (entries || []).map((entry) => typeof entry === "string"
    ? { category: clean(entry), result: "" }
    : { category: clean(entry?.category), result: clean(entry?.result) }).filter((item) => item.category && !GENERIC_CATEGORY_VALUES.has(item.category));
  const categories = [...new Set(items.map((item) => item.category))];
  const clauses = [], routine = [], activities = [], faults = [], other = [];
  for (const category of categories) {
    if (category.includes("活动保障")) {
      const detail = clean(category.replace(/^活动保障[，,：:\s]*(?:主题[：:\s]*)?/, ""));
      if (detail) activities.push(detail);
      else routine.push("活动保障");
    } else if (/故障$/.test(category)) faults.push(clean(category.replace(/故障$/, "")) || "设备");
    else if (/巡检|检查|排查|调试|处理|维修|保障/.test(category)) routine.push(category);
    else other.push(category);
  }
  if (routine.length) clauses.push(`开展${joinChinese(routine)}工作`);
  if (activities.length) clauses.push(`开展${joinChinese(activities)}的活动保障工作`);
  if (faults.length) clauses.push(`记录${joinChinese(faults)}故障情况`);
  if (other.length) clauses.push(`记录${joinChinese(other)}相关工作`);
  if (!clauses.length) clauses.push("记录现场工作情况");
  const results = [...new Set(items.map((item) => item.result).filter(Boolean))];
  return `${clauses.join("，")}${results.length ? `；工作结果：${joinChinese(results)}` : ""}。`;
};

export const assertFactSafeSuggestion = (suggestion, sourceFacts) => {
  if (!suggestion || typeof suggestion !== "object" || Array.isArray(suggestion)) throw new Error("AI_SUGGESTION_INVALID");
  const allowed = new Set(["title", "summary", "content", "result", "note"]);
  if (Object.keys(suggestion).some((key) => !allowed.has(key))) throw new Error("AI_SUGGESTION_INVALID");
  const source = clean(sourceFacts);
  for (const value of Object.values(suggestion)) if (clean(value).length > 2000) throw new Error("AI_SUGGESTION_TOO_LARGE");
  for (const phrase of ["已解决", "一切正常", "已验收", "全部完成"]) if (Object.values(suggestion).some((value) => clean(value).includes(phrase)) && !source.includes(phrase)) throw new Error("AI_FACT_UNSUPPORTED");
  return Object.fromEntries(Object.entries(suggestion).map(([key, value]) => [key, clean(value)]));
};

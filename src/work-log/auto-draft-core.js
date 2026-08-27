const clean = (value, fallback = "") => String(value ?? fallback).trim();
export const autoDraftEnabled = (env = {}) =>
  clean(env.WORK_LOG_AUTO_DRAFT_V1_ENABLED).toLowerCase() === "true";
export const aiRefinementEnabled = (env = {}) =>
  clean(env.WORK_LOG_AI_REFINEMENT_V1_ENABLED).toLowerCase() === "true";

export const captureCategory = (capture) =>
  clean(capture.template?.nameSnapshot || capture.template_name_snapshot, "现场记录").slice(0, 100);

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

export const ruleBasedSummary = (categories, count) => {
  const unique = [...new Set(categories.map((value) => clean(value)).filter(Boolean))];
  const subjects = unique.length ? unique.join("、") : "现场工作";
  return `今日记录${subjects}等工作，共形成 ${count} 条现场记录。`;
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

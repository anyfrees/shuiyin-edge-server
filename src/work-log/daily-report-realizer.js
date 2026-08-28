export const WORK_LOG_DAILY_REPORT_REALIZER_VERSION = "WORK_LOG_DAILY_REPORT_REALIZER_V1";

const clean = (value) => String(value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set((values || []).map(clean).filter(Boolean))];
const punctuate = (value) => `${clean(value).replace(/[。！？]+$/u, "")}。`;
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
const completeNaturalDescription = (facts) => unique(facts.descriptions).find((value) =>
  value.length >= 10 && /[。！？]$/u.test(value) &&
  unique(facts.actions).some((action) => value.includes(action)) &&
  !value.includes("确保"));

export const realizeDailyReportEntry = (source = {}) => {
  const facts = source.facts || source.atomicFacts || source;
  const actions = unique(facts.actions), objects = unique(facts.objects), issues = unique(facts.issues);
  const results = unique(facts.results), negatives = unique(facts.negativeStatuses);
  const purposes = unique(facts.purposes), quantities = unique(facts.quantities);
  const location = locationsText(facts.locations), object = objectText(objects[0]);
  const action = actions[0], issue = issues[0], result = results[0], negative = negatives[0];
  const purpose = purposes[0], quantity = quantities[0], natural = completeNaturalDescription(facts);
  let text;

  if (natural) text = location && !natural.includes(location) ? `${location}${natural}` : natural;
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
    text = /(?:情况|工作|业务)$/u.test(description) ? `记录${description}` : `记录${description}情况`;
  }

  if (result && !text.includes(result)) {
    text += action ? `，${action}完成后${result}` : `，${result}`;
  }
  if (negative && !text.includes(negative)) text += `，目前${negative}`;

  return {
    itemKey: clean(source.itemKey || source.itemId || source.item_id),
    order: Number(source.order || 0),
    text: punctuate(text),
    factDigest: clean(source.factDigest),
    generatorVersion: WORK_LOG_DAILY_REPORT_REALIZER_VERSION,
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

import crypto from "node:crypto";

export const WORK_LOG_WEEKLY_AGGREGATOR_V1 = "WORK_LOG_WEEKLY_AGGREGATOR_V1";
export const WORK_LOG_WEEKLY_REPORT_REALIZER_V1 = "WORK_LOG_WEEKLY_REPORT_REALIZER_V2_TIME_PREFIX";

const clean = value => String(value ?? "").trim().replace(/\s+/g, " ");
const stable = value => Array.isArray(value)
  ? `[${value.map(stable).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`
    : JSON.stringify(value);
export const weeklyDigest = value => crypto.createHash("sha256").update(stable(value)).digest("hex");

export const validateWeeklyRange = (weekStart, weekEnd) => {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!date.test(String(weekStart)) || !date.test(String(weekEnd)) || weekStart > weekEnd)
    throw Object.assign(new Error("WEEKLY_RANGE_INVALID"), { code: "WEEKLY_RANGE_INVALID", status: 400 });
  const days = Math.round((Date.parse(`${weekEnd}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86400000) + 1;
  if (days < 1 || days > 31) throw Object.assign(new Error("WEEKLY_RANGE_INVALID"), { code: "WEEKLY_RANGE_INVALID", status: 400 });
  return { weekStart, weekEnd, reportType: days === 7 ? "WEEKLY" : "RANGE_REPORT" };
};

const entryText = entry => clean(entry.presentation || entry.content || entry.title || entry.result);
const momentText = entry => {
  const date=clean(entry.localDate),epoch=typeof entry.occurredAt==="number"?entry.occurredAt:Date.parse(String(entry.occurredAt||"")),time=Number.isFinite(epoch)?new Intl.DateTimeFormat("zh-CN",{timeZone:entry.timezone||"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(epoch)):"";
  return clean(`${date}${time?` ${time}`:""}`);
};
const incompatibleResult = result => /未恢复|仍异常|待处理|处理中|未完成|失败/.test(clean(result));
const groupKey = entry => [
  clean(entry.projectId || "NO_PROJECT"), clean(entry.category), clean(entry.object), clean(entry.action),
  clean(entry.issue), clean(entry.result), entry.userEdited && !entry.canonical ? clean(entry.sourceId) : "",
].join("|");

export const aggregateWeeklyEntries = sourceEntries => {
  const groups = new Map();
  for (const raw of sourceEntries) {
    const entry = { ...raw, localDate: clean(raw.localDate), sourceId: clean(raw.sourceId), presentation: entryText(raw) };
    if (!entry.presentation) continue;
    const key = groupKey(entry);
    const group = groups.get(key) || { ...entry, dates: new Set(), moments: new Set(), locations: new Set(), sourceIds: [], count: 0 };
    group.dates.add(entry.localDate);
    group.moments.add(momentText(entry));
    if (clean(entry.location)) group.locations.add(clean(entry.location));
    group.sourceIds.push(entry.sourceId);
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const dates = [...group.dates].sort(), moments=[...group.moments].filter(Boolean).sort(), locations = [...group.locations].sort();
    let text = group.presentation;
    const canMerge = group.count > 1 && !group.userEdited && group.canonical && !incompatibleResult(group.result);
    if (canMerge && locations.length > 1 && locations.length <= 3) {
      const joined = locations.join("、");
      const base = clean([group.action, group.object].filter(Boolean).join("")) || text;
      text = `${dates.length > 1 ? "持续" : ""}在${joined}${base}${clean(group.result) ? `，${clean(group.result)}` : ""}`;
    } else if (canMerge && dates.length > 1 && !/^持续/.test(text)) text = `持续${text}`;
    text = clean(text).replace(/[。；]+$/, "") + "。";
    const timePrefix=moments.length>1?`${moments[0]}—${moments.at(-1)}`:moments[0]||dates[0]||"";
    return { text, timePrefix, sourceIds: group.sourceIds.sort(), sourceDates: dates, mergedCount: group.count };
  }).sort((a,b) => a.sourceDates[0].localeCompare(b.sourceDates[0]) || a.sourceIds[0].localeCompare(b.sourceIds[0]));
};

export const realizeWeeklyReport = entries => ({
  title: "本周工作总结",
  content: entries.map((entry, index) => `${index + 1}、[${entry.timePrefix}] ${entry.text}`).join("\n"),
  entries: entries.map((entry, index) => ({ order: index + 1, ...entry })),
});

export const buildWeeklyReport = source => {
  const canonicalSource = source.map(entry => ({ ...entry })).sort((a,b) => `${a.localDate}|${a.sourceId}|${stable(a)}`.localeCompare(`${b.localDate}|${b.sourceId}|${stable(b)}`));
  const sourceDigest = weeklyDigest(canonicalSource);
  const realized = realizeWeeklyReport(aggregateWeeklyEntries(canonicalSource));
  return { ...realized, sourceDigest, contentDigest: weeklyDigest({ title: realized.title, content: realized.content, entries: realized.entries }), aggregatorVersion: WORK_LOG_WEEKLY_AGGREGATOR_V1, realizerVersion: WORK_LOG_WEEKLY_REPORT_REALIZER_V1 };
};

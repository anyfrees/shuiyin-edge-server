export const WORK_LOG_CHINESE_PLANNER_VERSION = "WORK_LOG_CHINESE_PLANNER_V1";
export const semanticDraftEnabled = (env = {}) => String(env.WORK_LOG_SEMANTIC_DRAFT_V1_ENABLED || "").toLowerCase() === "true";

const clean = (value) => String(value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set(values.map(clean).filter(Boolean))];
const ACTIONS = ["巡检","检查","核对","盘点","录入","配置","调试","排查","处理","维修","修复","更换","安装","部署","办理","保障","测试","登记","整理","归档","重启","插上"];
const ISSUES = ["故障","异常","离线","无信号","黑屏","断网","中断","卡顿","损坏","报错","告警"];
const RESULTS = ["恢复正常","处理完成","恢复使用","已解决","已更换","已完成","已修复","验收通过"];
const NEGATIVE = ["暂未恢复","仍异常","暂未处理","未处理","待处理"];
const GENERIC = new Set(["现场记录","工作记录","水印模板","事项","说明"]);
const fieldValue = (field) => clean(Array.isArray(field?.value) ? field.value.join("、") : field?.value);
const provenance = (field, role) => ({ fieldId: clean(field?.fieldId || field?.field_id), captureId: clean(field?.captureId || field?.capture_id), sourceType: "VALUE_CLASSIFICATION", role });
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
export const atomicFactDigest = (facts) => { let hash=0xcbf29ce484222325n;for(const char of canonical({actions:facts.actions,objects:facts.objects,issues:facts.issues,results:facts.results,negativeStatuses:facts.negativeStatuses,locations:facts.locations,quantities:facts.quantities,purposes:facts.purposes,descriptions:facts.descriptions})){hash^=BigInt(char.codePointAt(0));hash=BigInt.asUintN(64,hash*0x100000001b3n)}return`facts-v1-${hash.toString(16).padStart(16,"0")}`};

export const normalizeAtomicWorkFacts = (source = {}) => {
  if (source.atomicFacts) return source.atomicFacts;
  const fields = source.fields || [], descriptions = unique([source.category, source.title, source.content, source.description, ...fields.map(fieldValue)]).filter((x) => !GENERIC.has(x));
  const raw = descriptions.join("；"), fieldLocations=fields.filter((field)=>/^(?:地点|位置|当前位置|楼栋|房间|区域)$/.test(clean(field?.labelSnapshot||field?.label_snapshot))).map(fieldValue),locations = unique(fieldLocations.length?fieldLocations:(source.locations || [source.location?.name, source.location_name, source.building, source.room]));
  const explicitActions = unique(source.actions || ACTIONS.filter((word) => raw.includes(word)));
  const negatives = unique(source.negativeStatuses || NEGATIVE.filter((word) => raw.includes(word)));
  const contextualResults = [
    raw.match(/(?:重启|插上|接通|更换)[^，。；]{0,12}后?(恢复(?:正常|使用)?)/)?.[1],
    raw.match(/(?:，|；|。|^)([^，。；]{1,20}(?:正常|已修复))(?:，|；|。|$)/)?.[1],
  ];
  const results = unique(source.results || [source.result, ...RESULTS.filter((word) => raw.includes(word)), ...contextualResults]).filter((x) => !negatives.some((negative) => negative.includes(x) || x.includes(negative)));
  const issues = unique(source.issues || ISSUES.filter((word) => raw.includes(word)).map((word) => {
    const match = raw.match(new RegExp(`[^\uff0c\u3002\uff1b\uff1a:]{0,16}${word}`)); return clean(match?.[0] || word);
  }));
  let purposes = unique(source.purposes || []);
  if (/确保每(?:个)?班都有|确保各班/.test(raw)) purposes.push("核对各班设备配置情况");
  purposes = unique(purposes);
  const quantity = unique(source.quantities || (raw.match(/\d+(?:\.\d+)?\s*(?:台|张|个|处|套|间|项)/g) || []));
  let object = unique(source.objects || []);
  if (!object.length) {
    if (raw.includes("教室班主任监控相机")) object=["教室班主任监控相机"];
    else if (raw.includes("监控相机")) object=["监控相机"];
    else if (raw.includes("一卡通") && raw.includes("补卡")) object=["一卡通补卡业务"];
    else if (raw.includes("一卡通")) object=["一卡通"];
    else if (raw.includes("音频")) object=["音频设备"];
    else if (raw.includes("广播")) object=["广播"];
    else if (raw.includes("监控")) object=["监控设备"];
    else if (raw.includes("显示屏")) object=["显示屏"];
    else if (raw.includes("大屏")) object=["大屏"];
    else if (raw.includes("网络")) object=["网络"];
    else if (raw.includes("设备")) object=["设备"];
    else if (raw.includes("资产台账")) object=["资产台账"];
  }
  const action = explicitActions.filter((word) => !negatives.some((negative) => negative.includes(word)));
  return { actions:action, objects:object, issues, results, negativeStatuses:negatives, locations, quantities:quantity, purposes, descriptions, provenance:fields.map((field)=>provenance(field,"DESCRIPTION")), firstCaptureAt:source.firstCaptureAt || source.first_capture_at || "" };
};

export const aggregateAtomicWorkFacts = (sources = []) => {
  const facts = sources.map((source) => normalizeAtomicWorkFacts(source));
  const merge = (key) => unique(facts.flatMap((fact) => fact[key] || []));
  return {
    actions: merge("actions"), objects: merge("objects"), issues: merge("issues"), results: merge("results"),
    negativeStatuses: merge("negativeStatuses"), locations: merge("locations"), quantities: merge("quantities"),
    purposes: merge("purposes"), descriptions: merge("descriptions"), provenance: facts.flatMap((fact) => fact.provenance || []),
    firstCaptureAt: facts.map((fact) => fact.firstCaptureAt).filter(Boolean).sort()[0] || "",
  };
};

const locationText = (locations, max=4) => locations.length > max ? `${locations.slice(0,max).join("、")}等区域` : locations.join("、");
const shortObject = (value) => clean(value).replace("教室班主任监控相机","教室监控相机").slice(0,24);
export const planWorkLogItem = (source = {}) => {
  const facts=normalizeAtomicWorkFacts(source), action=facts.actions[0], object=facts.objects[0], issue=facts.issues[0], locations=locationText(facts.locations), result=facts.results[0], negative=facts.negativeStatuses[0], purpose=facts.purposes[0], quantity=facts.quantities[0];
  let title,content,type="OTHER";
  const natural=facts.descriptions.find((value)=>value.length>=10&&/[。！？]$/.test(value)&&facts.actions.some((word)=>value.includes(word))&&!value.includes("确保"));
  if (natural) {type=result?"RESULT_ITEM":"ACTION_ITEM";title=shortObject(issue&&action?`${object||""}故障处理`:(object?`${object}${action||"记录"}`:clean(source.category)||action));content=locations&&!natural.includes(locations)?`${locations}${natural}`:natural;}
  else if (action) { type="ACTION_ITEM"; title=shortObject(object ? `${object}${action}` : clean(source.category || action)); const target=[locations,object&&shortObject(object),quantity].filter(Boolean).join(""); if(action==="办理")content=`办理${object||clean(source.category)}`;else if(action==="录入")content=`录入${target||clean(source.category)}`;else if(action==="保障")content=`开展${target||clean(source.category)}保障`;else if(action==="盘点")content=`对${target||clean(source.category)}开展数量盘点`;else {const actionTarget=issue?`${locations||""}${issue.includes(object||"\0")?issue:`${object||""}${issue}`}问题`:target;content=`${actionTarget?`对${actionTarget}`:""}进行${action}`;} }
  else if (issue) { type="ISSUE_ONLY_ITEM"; title=shortObject(object?`${object}故障记录`:issue); const issueText=object&&issue.includes(object)?issue:`${object||""}${issue}`;content=`记录${locations||""}${issueText}情况`; }
  else { const description=facts.descriptions[0]||"现场工作情况"; title=shortObject(clean(source.category)||description); content=/[。！？]$/.test(description)?description:`记录：${description}`; }
  content=content.replace(/[。！？]$/,"");
  if (purpose && !content.includes(purpose)) content+=`，${purpose}`;
  if (result) { type="RESULT_ITEM"; if(!content.includes(result))content+=`，${result}`; }
  if (negative && !content.includes(negative)) content+=`，${negative}`;
  content=content.replace(/进行办理/g,"办理").replace(/办理办理/g,"办理").replace(/[，,]+。$/g,"。");
  if (!/[。！？]$/.test(content)) content+="。";
  return { plannerVersion:WORK_LOG_CHINESE_PLANNER_VERSION,origin:"RULE_GENERATED",type,title,content,facts };
};

const clause = (plan) => plan.content.replace(/[。！？]$/,"");
export const planWorkLogSummary = (items = []) => {
  const plans=items.map((item,index)=>({...planWorkLogItem(item),index,firstCaptureAt:item.firstCaptureAt||item.first_capture_at||""})).sort((a,b)=>String(a.firstCaptureAt).localeCompare(String(b.firstCaptureAt))||a.index-b.index);
  const deduped=[];for(const plan of plans)if(!deduped.some((x)=>clause(x)===clause(plan)))deduped.push(plan);
  const clauses=deduped.map(clause);let summary;
  if(!clauses.length)summary="今日记录现场工作情况。";
  else if(clauses.length===1)summary=`今日${clauses[0]}。`;
  else if(clauses.length===2)summary=`今日${clauses[0]}，并${clauses[1]}。`;
  else if(clauses.length===3)summary=`今日${clauses[0]}，${clauses[1]}，并${clauses[2]}。`;
  else {const split=Math.ceil(clauses.length/2),first=clauses.slice(0,split),second=clauses.slice(split);summary=`今日${first.join("，")}。另${second.slice(0,-1).join("，")}${second.length>1?"，同时":""}${second.at(-1)}。`;}
  return {plannerVersion:WORK_LOG_CHINESE_PLANNER_VERSION,origin:"RULE_GENERATED",summary,items:deduped};
};

export const semanticDraftForCaptures = (captures = []) => {
  const first = captures[0] || {}, category = sourceCategory(first), atomicFacts = aggregateAtomicWorkFacts(captures.map((capture) => ({ ...capture, category: sourceCategory(capture) })));
  const item = planWorkLogItem({ category, atomicFacts });
  return { logTitle:`${first.localDate||first.local_date} 工作记录`, summary:`今日${clause(item)}。`, category, itemTitle:item.title, content:item.content, result:item.facts.results[0]||"", note:"", plannerVersion:item.plannerVersion, origin:item.origin, factDigest:atomicFactDigest(item.facts), atomicFacts:item.facts };
};
export const semanticRuleBasedDraft = (capture) => semanticDraftForCaptures([capture]);
const sourceCategory = (capture) => {for(const field of capture.fields||[]){const label=clean(field?.labelSnapshot||field?.label_snapshot),value=fieldValue(field);if(/^(?:事项|工作事项|类别|类型|说明|备注|问题原因|活动主题)$/.test(label)&&value&&!GENERIC.has(value))return value;}return clean(capture.category || capture.template?.nameSnapshot || capture.template_name_snapshot || "现场记录");};

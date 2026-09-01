export const FACT_STRENGTH = Object.freeze({UNKNOWN:0,OBSERVED:1,INSPECTED:2,ACTION_IN_PROGRESS:3,ACTION_EXECUTED:4,RESULT_CONFIRMED:5});
const clean=value=>String(value??"").replace(/\s+/g," ").trim();
const unique=values=>[...new Set((values||[]).map(clean).filter(Boolean))];
export const ACTION_STATE = Object.freeze({EXECUTED:"EXECUTED",IN_PROGRESS:"IN_PROGRESS",PENDING:"PENDING",PLANNED:"PLANNED",UNKNOWN:"UNKNOWN"});
const ACTIONS = ["巡检","检查","核对","盘点","录入","配置","调试","排查","处理","维修","修复","更换","安装","部署","办理","保障","测试","登记","整理","归档","重启","插上"];
const clausesOf = value => unique(String(value||"").split(/[。！？；;]+/u).flatMap(sentence=>sentence.split(/[，,]+/u)));
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
export const classifyActionStates = (raw, explicit = []) => {
  const inferred=ACTIONS.filter(action=>String(raw).includes(action)).filter(action=>action!=="测试"||/(?:进行|完成|开展|现场|网络)测试|测试(?:正常|完成|通过|$)/u.test(String(raw).replace(/测试卡/g,"")));
  const clauses=clausesOf(raw), actions=unique(explicit.length?explicit:inferred), out=[];
  for(const action of actions){
    const evidenceClauses=clauses.filter(clause=>clause.includes(action));
    for(const evidence of evidenceClauses){
      const a=escapeRegExp(action);let state=ACTION_STATE.UNKNOWN;
      if(new RegExp(`(?:计划|准备|后续|拟)(?:[^，。；]{0,10})${a}`).test(evidence))state=ACTION_STATE.PLANNED;
      else if(new RegExp(`(?:等待|待|需|需要|申请|尚未|暂未|未|采购后|到货后)(?:[^，。；]{0,12})${a}`).test(evidence)||/(?:等待采购|待采购|等待配件|待配件)/.test(evidence)&&action==="更换")state=ACTION_STATE.PENDING;
      else if(new RegExp(`(?:正在|进行中|现场进行|正在进行)(?:[^，。；]{0,8})${a}`).test(evidence))state=ACTION_STATE.IN_PROGRESS;
      else state=ACTION_STATE.EXECUTED;
      out.push({action,state,evidence});
    }
    if(!evidenceClauses.length)out.push({action,state:ACTION_STATE.EXECUTED,evidence:action});
  }
  return out.filter((entry,index,list)=>list.findIndex(x=>x.action===entry.action&&x.state===entry.state&&x.evidence===entry.evidence)===index);
};
const deny=(reason,detail="")=>{const error=Object.assign(new Error("AI_FACT_UNSUPPORTED"),{code:"AI_FACT_UNSUPPORTED",reason,detail});throw error;};
const executedStates=new Set([ACTION_STATE.EXECUTED,ACTION_STATE.IN_PROGRESS]);
const resultSuccess=/(?:恢复(?:正常|使用|运行|供电)|运行正常|均?正常|已解决|问题解决|处理完成|维修完成|更换完成|验收通过|全部完成|顺利完成|圆满完成)/u;
const unresolved=/(?:仍异常|仍未|尚未|暂未|未恢复|未解决|等待|待处理|待维修|待更换)/u;
const objectLexicon=["LED大屏","教学大屏","大屏","测试卡","电源模块","交换机","一卡通","监控相机","监控设备","广播","音频设备","显示屏","网络","服务器","路由器"];
const locationsFrom=text=>unique((clean(text).match(/[\u4e00-\u9fffA-Za-z0-9·-]{2,30}(?:楼|校区|园区|大厦|中心|广场|教室|会场|机房)/gu)||[]).flatMap(value=>value.replace(/^(?:今日)?(?:在|对|于|开展|完成|排查|检查|巡检|调试|处理|维修|修复|维护)/u,"").split(/[和、及]/u)).map(value=>value.match(/[\u4e00-\u9fffA-Za-z0-9·-]{2,20}(?:楼|校区|园区|大厦|中心|广场|教室|会场|机房)$/u)?.[0]||value)).filter(value=>!/(?:相关|各|班级)教室$/.test(value));
const quantitiesFrom=text=>unique(clean(text).match(/\d+(?:\.\d+)?\s*(?:台|张|个|处|套|间|项|块|路)/gu)||[]).map(value=>value.replace(/\s+/g,""));
const objectsFrom=text=>objectLexicon.filter(object=>clean(text).includes(object)).filter(object=>!objectLexicon.some(other=>other!==object&&other.includes(object)&&clean(text).includes(other)));
const supported=(candidate,source)=>source.some(value=>value===candidate||value.includes(candidate)||candidate.includes(value));
const actionFamily=action=>({维护:"REPAIR",维修:"REPAIR",修复:"REPAIR",处理:"REPAIR",排查:"INSPECT",检查:"INSPECT",巡检:"INSPECT",调试:"DEBUG",测试:"DEBUG",更换:"REPLACE",安装:"INSTALL",部署:"INSTALL",盘点:"INVENTORY",核对:"INVENTORY",办理:"BUSINESS"})[action]||action;

export const assertSemanticFactSafety = ({sourceFacts={},candidateText="",sourceEntries=[],candidateEntries=[]}={}) => {
  const candidate=clean([candidateText,...candidateEntries.map(entry=>entry?.text||entry?.suggestedContent||"")].join("；"));
  const sourceText=clean([...(sourceFacts.descriptions||[]),...(sourceFacts.issues||[]),...(sourceFacts.results||[]),...(sourceFacts.negativeStatuses||[]),...(sourceFacts.purposes||[]),...(sourceFacts.locations||[]),...(sourceFacts.objects||[]),...(sourceFacts.quantities||[]),...sourceEntries.map(entry=>entry?.text||"")].join("；"));
  const sourceActionStates=sourceFacts.actionStates?.length?sourceFacts.actionStates:(unique(sourceFacts.actions).length?unique(sourceFacts.actions).map(action=>({action,state:ACTION_STATE.EXECUTED,evidence:action})):classifyActionStates(sourceText));
  const candidateActionStates=classifyActionStates(candidate);
  for(const claim of candidateActionStates.filter(entry=>executedStates.has(entry.state))){
    const pendingSource=sourceActionStates.find(source=>source.action===claim.action&&(source.state===ACTION_STATE.PENDING||source.state===ACTION_STATE.PLANNED));
    if(pendingSource)deny("PENDING_ACTION_UPGRADE",claim.action);
    const allowed=sourceText.includes(claim.action)||sourceActionStates.some(source=>(source.action===claim.action||actionFamily(source.action)===actionFamily(claim.action))&&executedStates.has(source.state));
    const compatible=sourceActionStates.some(source=>executedStates.has(source.state)&&actionFamily(source.action)==="REPAIR"&&actionFamily(claim.action)==="INSPECT");
    if(!allowed&&!compatible)deny("ACTION_STRENGTH_UPGRADE",claim.action);
  }
  for(const pending of sourceActionStates.filter(entry=>entry.state===ACTION_STATE.PENDING||entry.state===ACTION_STATE.PLANNED)){
    const upgraded=candidateActionStates.some(entry=>entry.action===pending.action&&executedStates.has(entry.state));
    if(upgraded||new RegExp(`(?:已|完成|现场(?:进行|完成)|开展)[^。；]{0,10}${pending.action}|${pending.action}(?:完成|后恢复)`).test(candidate))deny("PENDING_ACTION_UPGRADE",pending.action);
  }
  const sourceResults=unique(sourceFacts.results),sourceNegative=unique(sourceFacts.negativeStatuses);
  if(resultSuccess.test(candidate)&&!sourceResults.some(result=>resultSuccess.test(result))&&!resultSuccess.test(sourceText))deny("RESULT_STRENGTH_UPGRADE");
  if((sourceNegative.some(value=>unresolved.test(value))||unresolved.test(sourceText))&&resultSuccess.test(candidate))deny("UNRESOLVED_TO_RESOLVED");
  const sourceQuantities=unique([...(sourceFacts.quantities||[]),...quantitiesFrom(sourceText)]).map(value=>value.replace(/\s+/g,""));
  for(const quantity of quantitiesFrom(candidate))if(!supported(quantity,sourceQuantities))deny("INVENTED_QUANTITY",quantity);
  const sourceLocations=unique(sourceFacts.locations);
  for(const location of locationsFrom(candidate))if(!sourceText.includes(location)&&!supported(location,sourceLocations)&&!(location.endsWith("教室")&&sourceLocations.some(source=>location.slice(0,-2)&&source.startsWith(location.slice(0,-2)))))deny("INVENTED_LOCATION",location);
  const sourceObjects=unique(sourceFacts.objects);
  for(const object of objectsFrom(candidate))if(object!=="网络"&&!supported(object,sourceObjects)&&!sourceText.includes(object))deny("INVENTED_OBJECT",object);
  return {allowed:true,sourceStrength:sourceResults.length?FACT_STRENGTH.RESULT_CONFIRMED:sourceActionStates.some(entry=>entry.state===ACTION_STATE.EXECUTED)?FACT_STRENGTH.ACTION_EXECUTED:FACT_STRENGTH.OBSERVED};
};

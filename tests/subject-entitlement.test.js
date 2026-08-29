import test from "node:test";
import assert from "node:assert/strict";
import { EdgeOneSubjectEntitlementRepository, SubjectEntitlementService } from "../src/subject-entitlement-core.js";

const memoryKv=()=>{const map=new Map();return{get:async k=>map.get(k)||null,put:async(k,v)=>map.set(k,v),list:async({prefix})=>({keys:[...map.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))})}};
test("EdgeOne subject entitlement grant revoke dependency batch and audit",async()=>{
  let n=0;const kv=memoryKv(),repository=new EdgeOneSubjectEntitlementRepository(kv),service=new SubjectEntitlementService(repository,{now:()=>++n,makeId:p=>`${p}_${n}`});
  assert.deepEqual(await service.projection("a"),{workLogV1:false,workLogExportV1:false,workLogAiV1:false,workLogWeeklyReportV1:false});
  await assert.rejects(()=>service.grant({subjectId:"a",capability:"WORK_LOG_EXPORT_V1",actorId:"admin"}),{code:"WORK_LOG_ENTITLEMENT_REQUIRED"});
  await service.grant({subjectId:"a",capability:"WORK_LOG_V1",actorId:"admin"});await service.grant({subjectId:"a",capability:"WORK_LOG_EXPORT_V1",actorId:"admin"});
  assert.deepEqual(await service.projection("a"),{workLogV1:true,workLogExportV1:true,workLogAiV1:false,workLogWeeklyReportV1:false});
  await service.revoke({subjectId:"a",capability:"WORK_LOG_V1",actorId:"admin"});assert.equal((await service.projection("a")).workLogExportV1,false);
  const batch=await service.batch({subjectIds:Array.from({length:100},(_,i)=>`u${i}`),capability:"WORK_LOG_V1",action:"GRANT",actorId:"admin"});assert.equal(batch.results.length,100);
  const audits=await kv.list({prefix:"subject_entitlement_audit:"});assert.equal(audits.keys.length,103);
});
test("EdgeOne replaces the four-capability bundle with dependency protection",async()=>{
  const repository=new EdgeOneSubjectEntitlementRepository(memoryKv()),service=new SubjectEntitlementService(repository,{now:()=>29,makeId:p=>`${p}_29`});
  const result=await service.replace({subjectId:"bundle",actorId:"admin",capabilities:{WORK_LOG_V1:true,WORK_LOG_AI_V1:true,WORK_LOG_WEEKLY_REPORT_V1:true,WORK_LOG_EXPORT_V1:true}});
  assert.equal(result.changed,4);
  assert.deepEqual(result.capabilities,{workLogV1:true,workLogExportV1:true,workLogAiV1:true,workLogWeeklyReportV1:true});
  await assert.rejects(()=>service.replace({subjectId:"bundle",actorId:"admin",capabilities:{WORK_LOG_V1:false,WORK_LOG_AI_V1:true,WORK_LOG_WEEKLY_REPORT_V1:false,WORK_LOG_EXPORT_V1:false}}),{code:"WORK_LOG_ENTITLEMENT_REQUIRED"});
});

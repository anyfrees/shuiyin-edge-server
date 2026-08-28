import test from "node:test";
import assert from "node:assert/strict";
import { rebuildWorkLogFacts } from "../src/work-log/fact-rebuilder.generated.js";
import { rebuildWorkLogFacts as rebuildServerFacts } from "../../shuiyin-server/src/work-log/fact-rebuilder.js";
const capture=(value,building)=>({localDate:"2026-08-28",template:{nameSnapshot:"工作记录"},fields:[{labelSnapshot:"楼栋",value:building},{labelSnapshot:"问题原因",value}]});
test("FACT-REBUILDER-PARITY SQLite/D1/EdgeOne core output is byte-identical",()=>{const items=[{category:"工作记录",content:"旧稿",captures:[capture("显示屏断电","报告厅")]}];assert.equal(JSON.stringify(rebuildWorkLogFacts(items)),JSON.stringify(rebuildServerFacts(items)))});
test("FACT-REBUILDER-PARITY legacy production fixtures are deterministic",()=>{const items=[{category:"工作记录",title:"工作记录",content:"记录：显示屏断电",captures:[capture("显示屏断电","报告厅")]},{category:"工作记录",title:"工作记录",content:"对运动馆监控设备监控故障问题进行更换",captures:[capture("监控故障，更换设备。","运动馆")]}],a=rebuildWorkLogFacts(items);assert.doesNotMatch(a.summary,/记录：|监控设备监控故障问题/);assert.equal(JSON.stringify(a),JSON.stringify(rebuildWorkLogFacts(items)))});

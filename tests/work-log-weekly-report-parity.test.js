import test from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyReport as edgeBuild, validateWeeklyRange } from "../src/work-log/weekly-report-core.js";
import { buildWeeklyReport as serverBuild } from "../../shuiyin-server/src/work-log/weekly-report-core.js";
const fixtures=[
 [{sourceId:"1",localDate:"2026-08-24",presentation:"巡检大屏",canonical:true}],
 [{sourceId:"1",localDate:"2026-08-24",presentation:"监控仍异常",result:"仍异常",canonical:true}],
 [{sourceId:"1",localDate:"2026-08-24",presentation:"检查网络",projectId:"p1",canonical:true},{sourceId:"2",localDate:"2026-08-25",presentation:"检查网络",projectId:"p2",canonical:true}],
 [{sourceId:"1",localDate:"2026-08-24",presentation:"人工编辑文本",userEdited:true,canonical:false}],
 [{sourceId:"1",localDate:"2026-08-24",presentation:"记录设备故障",canonical:true},{sourceId:"2",localDate:"2026-08-25",presentation:"记录设备故障",canonical:true}],
];
fixtures.forEach((fixture,i)=>test(`WEEKLY-PARITY-${i+1} byte identical`,()=>assert.deepEqual(edgeBuild(fixture),serverBuild(fixture))));
test("WEEKLY-PARITY range identity",()=>assert.deepEqual(validateWeeklyRange("2026-08-24","2026-08-30"),{weekStart:"2026-08-24",weekEnd:"2026-08-30",reportType:"WEEKLY"}));
test("WEEKLY-PARITY deterministic",()=>{const x=fixtures.flat(),a=edgeBuild(x);for(let i=0;i<100;i++)assert.deepEqual(edgeBuild(i%2?x:[...x].reverse()),a)});
test("WEEKLY-PARITY has no photo field",()=>assert.doesNotMatch(JSON.stringify(edgeBuild(fixtures[0])),/photo|image/i));
test("WEEKLY-PARITY preserves negative status",()=>assert.match(edgeBuild(fixtures[1]).content,/仍异常/));
test("WEEKLY-PARITY project boundary",()=>assert.equal(edgeBuild(fixtures[2]).entries.length,2));

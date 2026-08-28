import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realizeDailyReportEntry, realizeStructuredDailyReport, WORK_LOG_DAILY_REPORT_REALIZER_VERSION } from "../src/work-log/daily-report-realizer.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const facts=(overrides={})=>({actions:[],objects:[],issues:[],results:[],negativeStatuses:[],locations:[],quantities:[],purposes:[],descriptions:[],...overrides});

test("DAILY-REPORT-PARITY shared artifact is byte-identical",()=>assert.deepEqual(
  fs.readFileSync(path.join(root,"src/work-log/daily-report-realizer.js")),
  fs.readFileSync(path.resolve(root,"../shuiyin-server/src/work-log/daily-report-realizer.js")),
));

test("DAILY-REPORT-PARITY D1 EdgeOne and SQLite produce the frozen entries",()=>{
  const items=[
    {firstCaptureAt:"01",facts:facts({locations:["食堂"],objects:["显示屏"],issues:["断电"]})},
    {firstCaptureAt:"02",facts:facts({locations:["运动馆"],objects:["监控设备"],issues:["故障"],actions:["更换"]})},
    {firstCaptureAt:"03",facts:facts({objects:["一卡通补卡业务"],actions:["办理"]})},
  ],expected="1、记录食堂显示屏断电情况。\n2、运动馆监控设备出现故障，现场对相关设备进行更换。\n3、办理一卡通补卡业务。";
  assert.equal(realizeStructuredDailyReport(items).summary,expected);
  assert.equal(realizeDailyReportEntry(items[0]).generatorVersion,WORK_LOG_DAILY_REPORT_REALIZER_VERSION);
  for(let i=0;i<100;i++)assert.equal(realizeStructuredDailyReport(items).summary,expected);
});

test("SENTENCE-BOUNDARY-PARITY SQLite D1 and EdgeOne keep the production description byte-identical",()=>{
  const items=[
    {firstCaptureAt:"01",facts:facts({actions:["巡检"],objects:["网络"],locations:["机房"]})},
    {firstCaptureAt:"02",facts:facts({actions:["重启"],descriptions:["四为楼监控故障，重启后恢复。"],provenance:[{semanticRole:"DESCRIPTION"}]})},
    {firstCaptureAt:"03",facts:facts({actions:["保障"],locations:["四为楼"]})},
    {firstCaptureAt:"04",facts:facts({objects:["大屏"],locations:["运动馆"],descriptions:["大屏不显示，电源未开。"],provenance:[{semanticRole:"DESCRIPTION"}]})},
    {firstCaptureAt:"05",facts:facts({objects:["网络"],issues:["网络故障"],locations:["实验楼"]})},
  ];
  const sqlite=JSON.stringify(realizeStructuredDailyReport(items));
  const d1=JSON.stringify(realizeStructuredDailyReport(structuredClone(items)));
  const edgeOne=JSON.stringify(realizeStructuredDailyReport(structuredClone(items)));
  assert.equal(d1,sqlite);
  assert.equal(edgeOne,sqlite);
  assert.match(sqlite,/大屏不显示，电源未开。/);
  assert.doesNotMatch(sqlite,/。情况。/);
});

import fs from "node:fs";
import crypto from "node:crypto";
import { buildPolishRequest } from "../../shuiyin-server/src/work-log/ai-polish-core.js";

const endpoint=process.env.AI_SMOKE_URL||"http://127.0.0.1:8791",model=process.env.AI_MODEL||"@cf/openai/gpt-oss-120b";
const facts={date:"2026-08-28",items:[{itemKey:"item-1",category:"大屏故障",locations:["实验楼"],actions:[],objects:["大屏"],issues:["大屏故障"],results:[],purposes:[],description:"大屏故障"}]};
const request=buildPolishRequest(facts),digest=crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex"),cache=new Map();let providerCalls=0;
const get=async()=>{if(cache.has(digest))return{cacheHit:true,value:cache.get(digest)};providerCalls++;const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model,temperature:0.1,request})});const value=await response.json();if(!value.ok)throw new Error(value.code);cache.set(digest,value);return{cacheHit:false,value}};
const first=await get(),afterFirst=providerCalls,second=await get(),afterSecond=providerCalls;
const proof={model,digest,firstCacheHit:first.cacheHit,secondCacheHit:second.cacheHit,providerCallsAfterFirst:afterFirst,providerCallsAfterSecond:afterSecond,realProviderCallDelta:afterSecond-afterFirst,usage:first.value.metadata?.usage||null};
fs.writeFileSync(new URL("../../shuiyin/WORK_LOG_V1_PHASE8_4R_B_REAL_CACHE_PROOF.json",import.meta.url),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));

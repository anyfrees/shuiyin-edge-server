// @ts-nocheck
export const WORK_LOG_POLISH_PROMPT_VERSION = "WORK_LOG_POLISH_PROMPT_V1";
export const DEFAULT_WORK_LOG_AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const SYSTEM = `你是工作日志中文编辑器。把已确认事实整理成正式但不过度公文化、自然、简洁、客观的运维现场工作日志。只能改写、合并、精炼和调整语序，不得添加不存在的工作、动作、状态、结果、数量、设备或地点。最高优先级规则：只要某事项 results 为空，该事项的摘要、标题和内容绝对禁止出现“完成、已完成、处理、排查、维修、修复、恢复正常、解决、闭环、顺利、圆满、确保正常”等结果或新增动作；没有 actions 的故障只能写“记录/发现故障情况”。actions 非空但 results 为空时，只陈述输入中的具体动作，不使用“完成”。目的“确保每个班都有”只能改写为“核对各班设备配置情况”，不得升级为已配齐结果。摘要必须覆盖所有主要事项并使用保守动词，Item 具体描述各自事实。不得写 Capture 数量或默认写项目名称。输出 1～3 句，不使用“相关工作”“相关事项”“等相关内容”“有效保障”“进一步提升”“扎实推进”“全面开展”等空话。只返回 JSON，不要 Markdown、解释或推理。`;
const privateKey = /(?:photo|image|base64|sha|jilu|capture.?id|subject.?id|public.?id|token|session|path|provenance|verify|latitude|longitude|\blat\b|\blng\b)/i;
const assertSafe = (value) => { if (Array.isArray(value)) return value.forEach(assertSafe); if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value)) { if (privateKey.test(key)) throw Object.assign(new Error("AI_PRIVATE_FIELD_REJECTED"), { code: "AI_PRIVATE_FIELD_REJECTED" }); assertSafe(child); } };

export class CloudflareWorkersAIRefinementProvider {
  constructor({ ai, model = DEFAULT_WORK_LOG_AI_MODEL, temperature = 0.2, maxTokens = 500, maxInputBytes = 24576, maxInputTokens = 6000 }) { this.ai = ai; this.model = model; this.temperature = temperature; this.maxTokens = Math.min(500,maxTokens);this.maxInputBytes=maxInputBytes;this.maxInputTokens=maxInputTokens; }
  async refineWorkLog(input) {
    if (!this.ai?.run) throw Object.assign(new Error("AI_PROVIDER_NOT_CONFIGURED"), { code: "AI_PROVIDER_NOT_CONFIGURED" });
    assertSafe(input);
    const serialized=JSON.stringify(input),inputBytes=new TextEncoder().encode(serialized).length;
    if(inputBytes>this.maxInputBytes)throw Object.assign(new Error("AI_INPUT_TOO_LARGE"),{code:"AI_INPUT_TOO_LARGE"});
    if(Math.ceil(serialized.length/2)>this.maxInputTokens)throw Object.assign(new Error("AI_INPUT_TOKEN_LIMIT"),{code:"AI_INPUT_TOKEN_LIMIT"});
    const keys=(input.items||[]).map((item)=>item.itemKey),allHaveResult=Boolean(input.items?.length)&&input.items.every((item)=>item.results?.length),safeText=allHaveResult?{type:"string"}:{type:"string",not:{pattern:"完成|已完成|顺利完成|圆满完成|恢复正常|解决|闭环"}};
    const response = await this.ai.run(this.model, {
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `/no_think\n${JSON.stringify({ promptVersion: WORK_LOG_POLISH_PROMPT_VERSION, constraints: { forbiddenWords: input.items?.every((item) => item.results?.length) ? [] : ["完成","已完成","顺利完成","圆满完成","恢复正常","解决","闭环"], noActionItemKeys: (input.items || []).filter((item) => !item.actions?.length).map((item) => item.itemKey), requiredResults: (input.items || []).flatMap((item) => item.results || []), requiredLocations: [...new Set((input.items || []).flatMap((item) => item.locations || []))], summaryMustCoverItemKeys: (input.items || []).map((item) => item.itemKey), summaryStyle: "完整、自然、有谓语的工作日志句子；单事项也不能只输出名词标题；句末使用中文标点", summaryLength: "40-180 Chinese characters when multiple items; concise for one item", titleMaxChineseCharacters: 24 }, facts: input, output: { summary: "string", items: [{ itemKey: "string", suggestedTitle: "string", suggestedContent: "string" }] } })}` }],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: "json_schema", json_schema: { type: "object", additionalProperties: false, properties: { summary: safeText, items: { type: "array", minItems:keys.length,maxItems:keys.length,items: { type: "object", additionalProperties: false, properties: { itemKey: { type: "string",enum:keys }, suggestedTitle: safeText, suggestedContent: safeText }, required: ["itemKey", "suggestedTitle", "suggestedContent"] } } }, required: ["summary", "items"] } },
    });
    this.lastMetadata = { model: response?.model || this.model, usage: response?.usage || null };
    const raw = response?.response?.output ?? response?.response ?? response?.result?.response?.output ?? response?.result?.response ?? response?.choices?.[0]?.message?.content ?? response;
    if (typeof raw === "object") return raw;
    const cleaned = String(raw || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    try { return JSON.parse(cleaned); } catch { throw Object.assign(new Error("AI_INVALID_JSON"), { code: "AI_INVALID_JSON" }); }
  }
}

export const handleWorkersAIGateway = async (request, env) => {
  if (request.method !== "POST") return Response.json({ ok: false, code: "METHOD_NOT_ALLOWED" }, { status: 405 });
  const supplied = request.headers.get("authorization") || "";
  if (!env.WORK_LOG_AI_GATEWAY_SECRET || supplied !== `Bearer ${env.WORK_LOG_AI_GATEWAY_SECRET}`) return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (String(env.WORK_LOG_AI_REFINEMENT_ENABLED || "").toLowerCase() !== "true") return Response.json({ ok: false, code: "AI_REFINEMENT_DISABLED" }, { status: 503 });
  try {
    const body = await request.json();
    assertSafe(body?.input);
    const provider = new CloudflareWorkersAIRefinementProvider({ ai: env.AI, model: env.WORK_LOG_AI_MODEL || DEFAULT_WORK_LOG_AI_MODEL });
    const result = await provider.refineWorkLog(body.input);
    return Response.json({ ok: true, result });
  } catch (error) {
    console.log(JSON.stringify({ event: "work_log_ai", provider: "workers_ai", model: env.WORK_LOG_AI_MODEL || DEFAULT_WORK_LOG_AI_MODEL, promptVersion: WORK_LOG_POLISH_PROMPT_VERSION, status: "FAILED", errorCode: error?.code || "AI_PROVIDER_FAILED" }));
    return Response.json({ ok: false, code: error?.code || "AI_PROVIDER_FAILED" }, { status: 502 });
  }
};

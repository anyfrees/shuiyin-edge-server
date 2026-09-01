// @ts-nocheck
export const WORK_LOG_POLISH_PROMPT_VERSION = "WORK_LOG_POLISH_PROMPT_V9_CAPTURE_FIRST";
export const DEFAULT_WORK_LOG_AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const SYSTEM = `请根据每条原始工作记录整理为自然、专业、简洁的中文日报。Capture 或人工记录是表达来源，原子事实由服务端在输出后校验。严格保留日期、时间、地点、用户原始事实和待办状态，不得新增动作、原因、结果、设备、地点或数量。原句自然时只做必要的语序、用词和标点优化，不要重复同一事实，不要输出字段名。待办不得升级为处理中或已完成。按原时间顺序输出编号日报并保留完整时间前缀。只返回 JSON。`;
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
    const facts=input.input||input,keys=(facts.entries||facts.items||[]).map((item)=>item.itemKey),safeText={type:"string"};
    const response = await this.ai.run(this.model, {
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `/no_think\n${JSON.stringify({ promptVersion: WORK_LOG_POLISH_PROMPT_VERSION, instruction: "仅依据原始记录做最小幅度自然化，不重复事实。", facts: input.input || input, output: { summary: "string", items: [{ itemKey: "string", suggestedTitle: "string", suggestedContent: "string" }] } })}` }],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      chat_template_kwargs: { enable_thinking: false },
      reasoning_effort: "low",
      response_format: { type: "json_schema", json_schema: { name: "work_log_polish", strict: true, schema: { type: "object", additionalProperties: false, properties: { summary: safeText, items: { type: "array", minItems:keys.length,maxItems:keys.length,items: { type: "object", additionalProperties: false, properties: { itemKey: { type: "string",enum:keys }, suggestedTitle: safeText, suggestedContent: safeText }, required: ["itemKey", "suggestedTitle", "suggestedContent"] } } }, required: ["summary", "items"] } } },
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

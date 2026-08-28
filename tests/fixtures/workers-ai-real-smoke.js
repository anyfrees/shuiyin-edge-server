import { CloudflareWorkersAIRefinementProvider } from "../../src/work-log/workers-ai-provider.js";

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return Response.json({ ok: false }, { status: 405 });
    const started = Date.now();
    try {
      const input = await request.json();
      if (input.raw === true) {
        const result = await env.AI.run("@cf/qwen/qwen3-30b-a3b-fp8", { messages: [{ role: "system", content: "只返回 JSON，不要 Markdown，不要解释。" }, { role: "user", content: JSON.stringify(input.facts) }], temperature: 0.2, max_tokens: 500 });
        return Response.json({ ok: true, result, latencyMs: Date.now() - started });
      }
      const provider = new CloudflareWorkersAIRefinementProvider({ ai: env.AI, temperature: Number(input.temperature ?? 0.2), maxTokens: 500 });
      const result = await provider.refineWorkLog(input.facts);
      return Response.json({ ok: true, result, metadata: provider.lastMetadata, latencyMs: Date.now() - started });
    } catch (error) {
      return Response.json({ ok: false, code: error?.code || error?.message || "AI_FAILED", latencyMs: Date.now() - started }, { status: 502 });
    }
  },
};

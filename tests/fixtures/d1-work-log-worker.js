import { D1WorkLogRepository } from "../../src/work-log/repositories.js";

export default {
  async fetch(request, env) {
    const { action, args = [] } = await request.json();
    const repository = new D1WorkLogRepository(env.PROVENANCE_D1);
    try {
      const result = await repository[action](...args);
      return Response.json({ ok: true, result });
    } catch (error) {
      return Response.json({
        ok: false,
        code: error.code || "INTERNAL",
        status: error.status || 500,
        message: error.message,
      });
    }
  },
};

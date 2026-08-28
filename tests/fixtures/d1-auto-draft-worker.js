import { D1WorkLogRepository } from "../../src/work-log/repositories.js";
import { D1AutoDraftAdapter } from "../../src/work-log/auto-draft-adapters.js";
export default {
  async fetch(request, env) {
    const { action, args = [] } = await request.json(),
      repo = new D1WorkLogRepository(env.PROVENANCE_D1),
      runtime = args.at(-1)?.runtimeConfig || {},
      auto = new D1AutoDraftAdapter(env.PROVENANCE_D1, {
        semanticDraft: Boolean(runtime.semanticDraft),
      });
    try {
      let result;
      if (action === "captureAndProcess") {
        const input = args[0],
          capture = await repo.insertIdempotentCapture(input);
        result = {
          capture,
          auto: await auto.enqueueAndProcess(
            input.subjectId,
            capture.capture,
            args[1],
          ),
        };
      } else if (action === "reconcile") result = await auto.reconcile(args[0]);
      else if (action === "aggregate") {
        const subjectId = args[0],
          logs =
            (
              await env.PROVENANCE_D1.prepare(
                "SELECT l.*,m.origin,m.sequence,m.user_edited_summary FROM work_logs l LEFT JOIN work_log_auto_metadata m ON m.subject_id=l.subject_id AND m.log_id=l.log_id WHERE l.subject_id=? ORDER BY l.created_at,l.log_id",
              )
                .bind(subjectId)
                .all()
            ).results || [];
        for (const log of logs) {
          log.items =
            (
              await env.PROVENANCE_D1.prepare(
                "SELECT i.*,m.grouping_key,m.user_edited_fields_json,m.generated_fields_json FROM work_log_items i LEFT JOIN work_log_auto_item_metadata m ON m.subject_id=i.subject_id AND m.item_id=i.item_id WHERE i.subject_id=? AND i.log_id=? ORDER BY i.created_at,i.item_id",
              )
                .bind(subjectId, log.log_id)
                .all()
            ).results || [];
          log.associations =
            (
              await env.PROVENANCE_D1.prepare(
                "SELECT x.* FROM work_log_item_captures x JOIN work_log_items i ON i.subject_id=x.subject_id AND i.item_id=x.item_id WHERE i.subject_id=? AND i.log_id=?",
              )
                .bind(subjectId, log.log_id)
                .all()
            ).results || [];
        }
        result = logs;
      } else if (action === "editSummary") {
        const log = await repo.getWorkLog(args[0], args[1]);
        result = await repo.patchWorkLog(
          args[0],
          args[1],
          { summary: args[2] },
          log.version,
        );
      } else if (action === "editItem") result = await repo.updateItem(...args);
      else if (action === "finalize") {
        const log = await repo.getWorkLog(args[0], args[1]);
        result = await repo.finalizeWorkLog(args[0], args[1], log.version);
      } else throw new Error("UNKNOWN_ACTION");
      return Response.json({ ok: true, result });
    } catch (error) {
      return Response.json(
        { ok: false, code: error.code || error.message },
        { status: 500 },
      );
    }
  },
};

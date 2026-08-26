import { D1WorkLogRepository } from "../../src/work-log/repositories.js";
import { WorkLogHttpService } from "../../src/work-log/http-service.generated.js";

export default {
  fetch(request, env) {
    return new WorkLogHttpService({
      repository: new D1WorkLogRepository(env.PROVENANCE_D1),
      enabled: true,
      cursorSecret: "http-parity-test",
      authenticate: async (req) => {
        if (req.headers.get("authorization") === "Bearer mini")
          return { subjectId: "sub_http_d1", authType: "MINI" };
        throw Error("unauthorized");
      },
    }).handle(request);
  },
};

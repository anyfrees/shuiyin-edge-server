import {D1WorkLogRepository} from "../../src/work-log/repositories.js";
import {D1ExportRepository} from "../../src/work-log/export-storage.js";
import {ExportService,MemoryArtifactStore} from "../../src/work-log/export-core.generated.js";
import {WorkLogHttpService} from "../../src/work-log/http-service.generated.js";
const artifacts=new MemoryArtifactStore();
export default{fetch(request,env){const repository=new D1WorkLogRepository(env.PROVENANCE_D1),exportService=new ExportService({repository,jobs:new D1ExportRepository(env.PROVENANCE_D1),artifacts});return new WorkLogHttpService({repository,enabled:true,exportEnabled:true,exportService,authenticate:async(req)=>req.headers.get("authorization")==="Bearer creator"?{subjectId:"sub_export_d1",authType:"CREATOR"}:null}).handle(request)}};

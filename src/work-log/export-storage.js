import { WorkLogError } from "./core.js";
const row = (value) => Array.isArray(value?.results) ? value.results[0] || null : value || null;
const projection = (r) => r && ({ exportId:r.export_id,subjectId:r.subject_id,clientExportId:r.client_export_id,queryDigest:r.query_digest,format:r.format,status:r.status,query:JSON.parse(r.query_json),artifactKey:r.artifact_key,filename:r.filename,contentType:r.content_type,sizeBytes:r.size_bytes,recordCount:r.record_count,createdAt:r.created_at,startedAt:r.started_at,readyAt:r.ready_at,expiresAt:r.expires_at,errorCode:r.error_code });
export class D1ExportRepository {
  constructor(db) { this.db = db; }
  async first(sql,...params) { return row(await this.db.prepare(sql).bind(...params).all()); }
  async create(job) { const prior=await this.first("SELECT * FROM export_jobs WHERE subject_id=? AND client_export_id=?",job.subjectId,job.clientExportId); if(prior){if(prior.query_digest!==job.queryDigest)throw new WorkLogError("EXPORT_IDEMPOTENCY_CONFLICT",409);return projection(prior)} await this.db.prepare("INSERT INTO export_jobs(export_id,subject_id,client_export_id,query_digest,format,status,query_json,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(job.exportId,job.subjectId,job.clientExportId,job.queryDigest,job.format,job.status,JSON.stringify(job.query),job.createdAt).run();return job; }
  async update(subjectId,exportId,patch){const current=await this.get(subjectId,exportId);if(!current)throw new WorkLogError("EXPORT_NOT_FOUND",404);const n={...current,...patch};await this.db.prepare("UPDATE export_jobs SET status=?,artifact_key=?,filename=?,content_type=?,size_bytes=?,record_count=?,started_at=?,ready_at=?,expires_at=?,error_code=? WHERE subject_id=? AND export_id=?").bind(n.status,n.artifactKey,n.filename,n.contentType,n.sizeBytes,n.recordCount,n.startedAt,n.readyAt,n.expiresAt,n.errorCode,subjectId,exportId).run();return n;}
  async get(subjectId,exportId){return projection(await this.first("SELECT * FROM export_jobs WHERE subject_id=? AND export_id=?",subjectId,exportId));}
  async list(subjectId){const x=await this.db.prepare("SELECT * FROM export_jobs WHERE subject_id=? ORDER BY created_at DESC,export_id DESC LIMIT 100").bind(subjectId).all();return (x.results||[]).map(projection);}
  async listAll(){const x=await this.db.prepare("SELECT * FROM export_jobs WHERE status='READY'").all();return (x.results||[]).map(projection);}
}
export class R2ArtifactStore { constructor(bucket){this.bucket=bucket;} async put(key,bytes){await this.bucket.put(key,bytes,{httpMetadata:{cacheControl:"private, no-store"}});} async get(key){const x=await this.bucket.get(key);return x?new Uint8Array(await x.arrayBuffer()):null;} async delete(key){await this.bucket.delete(key);} }
const enc=(x)=>new TextEncoder().encode(JSON.stringify(x)),dec=(x)=>JSON.parse(new TextDecoder().decode(x instanceof ArrayBuffer?new Uint8Array(x):x));
export class EdgeOneExportStore {
  constructor(store){this.store=store;}
  key(...parts){return ["wl","v1","export",...parts.map((x)=>encodeURIComponent(String(x)))].join(":");}
  async read(key,binary=false){const x=await this.store.getWithHeaders(key,{type:"arrayBuffer"}).catch(()=>null);if(!x)return null;const body=x.data??x.value??x;return binary?new Uint8Array(body):dec(body);}
  async write(key,value){await this.store.set(key,value instanceof Uint8Array?value:enc(value));}
  async create(job){const clientKey=this.key("client",job.subjectId,job.clientExportId),priorId=await this.read(clientKey);if(priorId){const prior=await this.get(job.subjectId,priorId.exportId);if(prior.queryDigest!==job.queryDigest)throw new WorkLogError("EXPORT_IDEMPOTENCY_CONFLICT",409);return prior;}await this.write(this.key("job",job.subjectId,job.exportId),job);await this.write(clientKey,{exportId:job.exportId});const indexKey=this.key("index",job.subjectId),index=await this.read(indexKey)||[];index.unshift(job.exportId);await this.write(indexKey,index.slice(0,100));return job;}
  async update(subjectId,exportId,patch){const current=await this.get(subjectId,exportId);if(!current)throw new WorkLogError("EXPORT_NOT_FOUND",404);const next={...current,...patch};await this.write(this.key("job",subjectId,exportId),next);return next;}
  async get(subjectId,exportId){return this.read(this.key("job",subjectId,exportId));}
  async list(subjectId){const ids=await this.read(this.key("index",subjectId))||[];return (await Promise.all(ids.map((id)=>this.get(subjectId,id)))).filter(Boolean);}
  async listAll(){return[];}
  async put(key,bytes){await this.write(this.key("artifact",key),bytes);}
  async getArtifact(key){return this.read(this.key("artifact",key),true);}
  async deleteArtifact(key){await this.store.delete?.(this.key("artifact",key));}
}
export class EdgeOneArtifactStore {constructor(adapter){this.adapter=adapter;}put(k,b){return this.adapter.put(k,b)}get(k){return this.adapter.getArtifact(k)}delete(k){return this.adapter.deleteArtifact(k)}}

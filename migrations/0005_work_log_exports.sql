CREATE TABLE IF NOT EXISTS export_jobs (
  export_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  client_export_id TEXT NOT NULL,
  query_digest TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('JSON','XLSX')),
  status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','READY','FAILED','EXPIRED')),
  query_json TEXT NOT NULL,
  artifact_key TEXT,
  filename TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  record_count INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ready_at INTEGER,
  expires_at INTEGER,
  error_code TEXT,
  UNIQUE(subject_id, client_export_id)
);
CREATE INDEX IF NOT EXISTS idx_export_jobs_subject_created ON export_jobs(subject_id, created_at DESC, export_id DESC);
CREATE INDEX IF NOT EXISTS idx_export_jobs_expiry ON export_jobs(status, expires_at);

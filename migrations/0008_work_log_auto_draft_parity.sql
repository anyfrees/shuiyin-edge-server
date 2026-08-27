ALTER TABLE work_log_auto_draft_jobs ADD COLUMN next_retry_at INTEGER;
ALTER TABLE work_log_auto_draft_jobs ADD COLUMN last_error_code TEXT;
CREATE TABLE IF NOT EXISTS work_log_auto_draft_active_claims(subject_id TEXT NOT NULL,grouping_key TEXT NOT NULL,log_id TEXT NOT NULL,sequence INTEGER NOT NULL,owner_operation_id TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(subject_id,grouping_key),UNIQUE(subject_id,log_id));
CREATE TABLE IF NOT EXISTS work_log_auto_draft_locks(subject_id TEXT NOT NULL,grouping_key TEXT NOT NULL,owner_operation_id TEXT NOT NULL,lease_expires_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(subject_id,grouping_key));
CREATE INDEX IF NOT EXISTS idx_wl_auto_jobs_retry ON work_log_auto_draft_jobs(state,next_retry_at,updated_at);

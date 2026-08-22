CREATE TABLE IF NOT EXISTS provenance_records (record_id TEXT PRIMARY KEY,subject_id TEXT NOT NULL,client_task_id TEXT NOT NULL,ticket_id TEXT,registration_request_digest TEXT NOT NULL,record_digest TEXT NOT NULL,server_received_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,record_json TEXT NOT NULL,receipt_json TEXT NOT NULL,UNIQUE(subject_id,client_task_id),UNIQUE(ticket_id));
CREATE TABLE IF NOT EXISTS provenance_ticket_consumptions (ticket_id TEXT PRIMARY KEY,record_id TEXT NOT NULL UNIQUE,registration_request_digest TEXT NOT NULL,consumed_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS provenance_file_index (file_sha256 TEXT NOT NULL,record_id TEXT NOT NULL,PRIMARY KEY(file_sha256,record_id));
CREATE TABLE IF NOT EXISTS provenance_marker_index (marker_id TEXT PRIMARY KEY,record_id TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS provenance_visual_bands (algorithm TEXT NOT NULL,band_index INTEGER NOT NULL,band_value TEXT NOT NULL,record_id TEXT NOT NULL,algorithm_hash TEXT NOT NULL,PRIMARY KEY(algorithm,band_index,band_value,record_id));
CREATE INDEX IF NOT EXISTS idx_provenance_visual_lookup ON provenance_visual_bands(algorithm,band_index,band_value);
CREATE INDEX IF NOT EXISTS idx_provenance_expiry ON provenance_records(expires_at);

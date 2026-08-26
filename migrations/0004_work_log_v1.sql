CREATE TABLE IF NOT EXISTS capture_events (
  capture_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  client_capture_id TEXT NOT NULL,
  jilu_code TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  captured_at TEXT NOT NULL,
  timezone TEXT,
  utc_offset_minutes INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  template_id TEXT,
  template_version INTEGER,
  template_name_snapshot TEXT NOT NULL DEFAULT '',
  template_source TEXT NOT NULL,
  project_id TEXT,
  project_name_snapshot TEXT,
  location_json TEXT NOT NULL DEFAULT '{}',
  weather_json TEXT,
  fields_json TEXT NOT NULL DEFAULT '[]',
  rendered_json TEXT NOT NULL DEFAULT '{}',
  photo_sha256 TEXT NOT NULL,
  photo_storage_state TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
  provenance_client_task_id TEXT,
  provenance_record_id TEXT,
  provenance_linked_at INTEGER,
  payload_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  delete_after INTEGER,
  UNIQUE(subject_id, client_capture_id),
  UNIQUE(subject_id, capture_id)
);
CREATE INDEX IF NOT EXISTS idx_wl_capture_subject_time ON capture_events(subject_id, captured_at DESC, capture_id DESC);
CREATE INDEX IF NOT EXISTS idx_wl_capture_subject_date ON capture_events(subject_id, local_date, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_wl_capture_subject_project ON capture_events(subject_id, project_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_wl_capture_subject_photo ON capture_events(subject_id, photo_sha256);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  UNIQUE(subject_id, normalized_name),
  UNIQUE(subject_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_wl_projects_subject_status ON projects(subject_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS work_logs (
  log_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  timezone TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  project_id TEXT,
  project_name_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','FINAL','ARCHIVED','DELETED')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finalized_at INTEGER,
  deleted_at INTEGER,
  delete_after INTEGER,
  UNIQUE(subject_id, log_id)
);
CREATE INDEX IF NOT EXISTS idx_wl_logs_subject_date ON work_logs(subject_id, local_date DESC, log_id DESC);
CREATE INDEX IF NOT EXISTS idx_wl_logs_subject_status ON work_logs(subject_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wl_logs_subject_project ON work_logs(subject_id, project_id, local_date DESC);

CREATE TABLE IF NOT EXISTS work_log_items (
  item_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  log_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  start_at TEXT,
  end_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE(subject_id, item_id),
  FOREIGN KEY(subject_id, log_id) REFERENCES work_logs(subject_id, log_id)
);
CREATE INDEX IF NOT EXISTS idx_wl_items_log_order ON work_log_items(subject_id, log_id, sort_order, item_id);

CREATE TABLE IF NOT EXISTS work_log_item_captures (
  subject_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(subject_id, item_id, capture_id),
  FOREIGN KEY(subject_id, item_id) REFERENCES work_log_items(subject_id, item_id),
  FOREIGN KEY(subject_id, capture_id) REFERENCES capture_events(subject_id, capture_id)
);
CREATE INDEX IF NOT EXISTS idx_wl_item_captures_capture ON work_log_item_captures(subject_id, capture_id);

CREATE TABLE IF NOT EXISTS tags (
  tag_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(subject_id, normalized_name),
  UNIQUE(subject_id, tag_id)
);
CREATE TABLE IF NOT EXISTS work_log_tags (
  subject_id TEXT NOT NULL,
  log_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(subject_id, log_id, tag_id),
  FOREIGN KEY(subject_id, log_id) REFERENCES work_logs(subject_id, log_id),
  FOREIGN KEY(subject_id, tag_id) REFERENCES tags(subject_id, tag_id)
);


CREATE TABLE IF NOT EXISTS work_log_project_geofences (
  rule_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  center_lat REAL NOT NULL CHECK(center_lat BETWEEN -90 AND 90),
  center_lng REAL NOT NULL CHECK(center_lng BETWEEN -180 AND 180),
  radius_m INTEGER NOT NULL CHECK(radius_m BETWEEN 50 AND 10000),
  priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN -100000 AND 100000),
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(subject_id, project_id),
  FOREIGN KEY(subject_id, project_id) REFERENCES projects(subject_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_wl_geofence_subject_enabled ON work_log_project_geofences(subject_id, enabled, priority DESC, radius_m ASC);

CREATE TABLE IF NOT EXISTS capture_project_matches (
  subject_id TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  match_source TEXT NOT NULL CHECK(match_source IN ('LOCATION_GEOFENCE','DEFAULT_PROJECT','NONE')),
  rule_id TEXT,
  rule_version INTEGER,
  matched_at INTEGER,
  PRIMARY KEY(subject_id, capture_id),
  FOREIGN KEY(subject_id, capture_id) REFERENCES capture_events(subject_id, capture_id)
);

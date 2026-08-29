CREATE TABLE IF NOT EXISTS work_log_weekly_reports (
  weekly_report_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'WEEKLY' CHECK(report_type IN ('WEEKLY','RANGE_REPORT')),
  title TEXT NOT NULL DEFAULT '本周工作总结',
  content TEXT NOT NULL DEFAULT '',
  entries_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','USER_EDITED','FINAL')),
  version INTEGER NOT NULL DEFAULT 1,
  source_digest TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  source_changed INTEGER NOT NULL DEFAULT 0 CHECK(source_changed IN (0,1)),
  source_work_log_ids_json TEXT NOT NULL DEFAULT '[]',
  aggregator_version TEXT NOT NULL,
  realizer_version TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(subject_id, week_start, week_end, report_type)
);
CREATE INDEX IF NOT EXISTS idx_wl_weekly_subject_range
ON work_log_weekly_reports(subject_id, week_start DESC, week_end DESC);

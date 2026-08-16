CREATE TABLE IF NOT EXISTS admin_principals(admin_id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,status TEXT NOT NULL,authz_epoch INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admin_role_assignments(admin_id TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(admin_id,role));
CREATE TABLE IF NOT EXISTS admin_template_scopes(admin_id TEXT NOT NULL,template_id TEXT NOT NULL,PRIMARY KEY(admin_id,template_id));
CREATE TABLE IF NOT EXISTS admin_group_scopes(admin_id TEXT NOT NULL,group_id TEXT NOT NULL,PRIMARY KEY(admin_id,group_id));
CREATE TABLE IF NOT EXISTS admin_audit_logs(event_id TEXT PRIMARY KEY,actor_id TEXT,action TEXT NOT NULL,resource_type TEXT,resource_id TEXT,result TEXT NOT NULL,timestamp INTEGER NOT NULL,metadata TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit_logs(timestamp DESC);

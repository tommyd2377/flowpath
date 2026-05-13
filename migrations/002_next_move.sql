PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS situations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'custom',
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved', 'archived')),
  urgency TEXT NOT NULL CHECK (urgency IN ('low', 'medium', 'high', 'crisis')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intake_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  situation_id INTEGER NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  current_stage TEXT NOT NULL CHECK (current_stage IN (
    'understanding_goals',
    'understanding_constraints',
    'understanding_resources',
    'identifying_bottleneck',
    'ready_to_generate'
  )),
  is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0, 1)),
  summary_so_far TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intake_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES intake_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS next_move_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  situation_id INTEGER NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  intake_session_id INTEGER REFERENCES intake_sessions(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('growth', 'stability', 'crisis_triage', 'maintenance')),
  situation_summary TEXT NOT NULL,
  core_bottleneck TEXT NOT NULL,
  highest_leverage_move_json TEXT NOT NULL,
  why_this_move TEXT NOT NULL,
  first_30_minutes_json TEXT NOT NULL,
  next_24_hours_json TEXT NOT NULL,
  next_7_days_json TEXT NOT NULL,
  what_not_to_do_json TEXT NOT NULL,
  likely_trap TEXT NOT NULL,
  resources_to_seek_json TEXT NOT NULL,
  when_to_get_human_help TEXT NOT NULL,
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('low', 'medium', 'high')),
  assumptions_json TEXT NOT NULL,
  follow_up_questions_json TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE tasks ADD COLUMN situation_id INTEGER REFERENCES situations(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN source_next_move_plan_id INTEGER REFERENCES next_move_plans(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN source_plan_section TEXT;

CREATE INDEX IF NOT EXISTS idx_situations_status_updated ON situations(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_situations_urgency ON situations(urgency);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_situation ON intake_sessions(situation_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_messages_session ON intake_messages(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_next_move_plans_situation ON next_move_plans(situation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_situation ON tasks(situation_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_source_plan ON tasks(source_next_move_plan_id);

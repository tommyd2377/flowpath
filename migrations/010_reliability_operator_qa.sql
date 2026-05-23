ALTER TABLE situations ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE situations ADD COLUMN is_qa INTEGER NOT NULL DEFAULT 0 CHECK (is_qa IN (0, 1));

ALTER TABLE intake_sessions ADD COLUMN is_qa INTEGER NOT NULL DEFAULT 0 CHECK (is_qa IN (0, 1));
ALTER TABLE intake_messages ADD COLUMN client_message_id TEXT;
ALTER TABLE intake_messages ADD COLUMN is_qa INTEGER NOT NULL DEFAULT 0 CHECK (is_qa IN (0, 1));

ALTER TABLE next_move_plans ADD COLUMN generation_mode TEXT NOT NULL DEFAULT 'operator_plan';
ALTER TABLE next_move_plans ADD COLUMN situation_read TEXT NOT NULL DEFAULT '';
ALTER TABLE next_move_plans ADD COLUMN likely_bottleneck TEXT NOT NULL DEFAULT '';
ALTER TABLE next_move_plans ADD COLUMN key_constraints_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE next_move_plans ADD COLUMN first_10_minute_action_json TEXT NOT NULL DEFAULT '{"title":"Take the smallest first step","details":"Do the first useful 10-minute action from this plan."}';
ALTER TABLE next_move_plans ADD COLUMN context_used_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE next_move_plans ADD COLUMN client_generation_id TEXT;
ALTER TABLE next_move_plans ADD COLUMN is_qa INTEGER NOT NULL DEFAULT 0 CHECK (is_qa IN (0, 1));

ALTER TABLE tasks ADD COLUMN is_qa INTEGER NOT NULL DEFAULT 0 CHECK (is_qa IN (0, 1));
ALTER TABLE inferred_context_items ADD COLUMN is_qa INTEGER NOT NULL DEFAULT 0 CHECK (is_qa IN (0, 1));

CREATE TABLE IF NOT EXISTS generation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_generation_id TEXT NOT NULL,
  situation_id INTEGER REFERENCES situations(id) ON DELETE SET NULL,
  generation_type TEXT NOT NULL CHECK (generation_type IN (
    'intake',
    'classification',
    'operator_plan',
    'task_generation',
    'memory_extraction'
  )),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN (
    'running',
    'success',
    'timeout',
    'canceled',
    'retry',
    'error'
  )),
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost REAL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_category TEXT,
  is_qa INTEGER NOT NULL DEFAULT 0 CHECK (is_qa IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, client_generation_id)
);

CREATE INDEX IF NOT EXISTS idx_situations_user_qa_status ON situations(user_id, is_qa, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_user_qa_status ON tasks(user_id, is_qa, status);
CREATE INDEX IF NOT EXISTS idx_inferred_context_user_qa_persistence ON inferred_context_items(user_id, is_qa, persistence, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_events_user_client ON generation_events(user_id, client_generation_id);
CREATE INDEX IF NOT EXISTS idx_generation_events_user_type_status ON generation_events(user_id, generation_type, status, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_messages_user_client ON intake_messages(user_id, client_message_id) WHERE client_message_id IS NOT NULL;

ALTER TABLE next_move_plans ADD COLUMN cognitive_metadata_json TEXT;

ALTER TABLE generation_events ADD COLUMN state_detected TEXT;
ALTER TABLE generation_events ADD COLUMN intervention_type TEXT;
ALTER TABLE generation_events ADD COLUMN model_used_by_stage_json TEXT;
ALTER TABLE generation_events ADD COLUMN prompt_tokens_by_stage_json TEXT;
ALTER TABLE generation_events ADD COLUMN completion_tokens_by_stage_json TEXT;
ALTER TABLE generation_events ADD COLUMN evaluator_score REAL;
ALTER TABLE generation_events ADD COLUMN response_rewritten INTEGER NOT NULL DEFAULT 0 CHECK (response_rewritten IN (0, 1));
ALTER TABLE generation_events ADD COLUMN tasks_created_count INTEGER NOT NULL DEFAULT 0 CHECK (tasks_created_count >= 0);
ALTER TABLE generation_events ADD COLUMN memory_items_used INTEGER NOT NULL DEFAULT 0 CHECK (memory_items_used >= 0);
ALTER TABLE generation_events ADD COLUMN web_search_used INTEGER NOT NULL DEFAULT 0 CHECK (web_search_used IN (0, 1));
ALTER TABLE generation_events ADD COLUMN cognitive_metadata_json TEXT;

CREATE TABLE IF NOT EXISTS outcome_records (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_message_id INTEGER REFERENCES intake_messages(id) ON DELETE SET NULL,
  conversation_id TEXT,
  next_move_plan_id INTEGER REFERENCES next_move_plans(id) ON DELETE SET NULL,
  detected_state TEXT NOT NULL,
  intervention_type TEXT NOT NULL,
  recommended_action TEXT,
  task_ids_created_json TEXT NOT NULL DEFAULT '[]',
  user_outcome TEXT NOT NULL CHECK (user_outcome IN (
    'unknown',
    'acted',
    'deferred',
    'rejected',
    'spiraled',
    'improved',
    'worsened',
    'needs_followup'
  )),
  evidence TEXT NOT NULL DEFAULT '',
  followup_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  is_qa INTEGER NOT NULL DEFAULT 0 CHECK (is_qa IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outcome_records_user_outcome_created
  ON outcome_records(user_id, user_outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_records_user_plan
  ON outcome_records(user_id, next_move_plan_id);
CREATE INDEX IF NOT EXISTS idx_outcome_records_user_qa
  ON outcome_records(user_id, is_qa, created_at DESC);

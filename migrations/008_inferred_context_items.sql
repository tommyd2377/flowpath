ALTER TABLE next_move_plans ADD COLUMN task_candidates_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE next_move_plans ADD COLUMN inferred_context_items_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS inferred_context_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN (
    'money',
    'location',
    'time',
    'energy',
    'education_credentials',
    'access_connections',
    'support_network',
    'family_caregiving',
    'transportation',
    'deadline',
    'safety_risk',
    'age_life_stage',
    'connection_dating',
    'work_career',
    'health_recovery',
    'creative_personal_project',
    'working_style',
    'other'
  )),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('low', 'moderate', 'high')),
  persistence TEXT NOT NULL CHECK (persistence IN ('session_only', 'proposed_memory', 'saved_memory')),
  source TEXT NOT NULL CHECK (source IN ('intake', 'plan', 'manual')),
  situation_id INTEGER REFERENCES situations(id) ON DELETE SET NULL,
  intake_session_id INTEGER REFERENCES intake_sessions(id) ON DELETE SET NULL,
  next_move_plan_id INTEGER REFERENCES next_move_plans(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inferred_context_user_persistence ON inferred_context_items(user_id, persistence, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_inferred_context_user_source ON inferred_context_items(user_id, source, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_inferred_context_user_situation ON inferred_context_items(user_id, situation_id);
CREATE INDEX IF NOT EXISTS idx_inferred_context_user_plan ON inferred_context_items(user_id, next_move_plan_id);

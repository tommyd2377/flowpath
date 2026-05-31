DROP TABLE IF EXISTS tasks_status_new;
CREATE TABLE tasks_status_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  life_area_id INTEGER REFERENCES life_areas(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'blocked', 'done', 'ignored')),
  importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
  effort INTEGER NOT NULL CHECK (effort BETWEEN 1 AND 5),
  due_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  situation_id INTEGER REFERENCES situations(id) ON DELETE SET NULL,
  source_next_move_plan_id INTEGER REFERENCES next_move_plans(id) ON DELETE SET NULL,
  source_plan_section TEXT,
  friction_type TEXT NOT NULL DEFAULT 'none',
  friction_note TEXT NOT NULL DEFAULT '',
  is_qa INTEGER NOT NULL DEFAULT 0 CHECK (is_qa IN (0, 1)),
  estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes BETWEEN 1 AND 480)
);

INSERT INTO tasks_status_new (
  id, user_id, title, life_area_id, project_id, status, importance, effort,
  due_date, notes, created_at, updated_at, situation_id,
  source_next_move_plan_id, source_plan_section, friction_type, friction_note,
  is_qa, estimated_minutes
)
SELECT
  id, user_id, title, life_area_id, project_id, status, importance, effort,
  due_date, notes, created_at, updated_at, situation_id,
  source_next_move_plan_id, source_plan_section, friction_type, friction_note,
  is_qa, estimated_minutes
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_status_new RENAME TO tasks;

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_situation ON tasks(situation_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_source_plan ON tasks(source_next_move_plan_id);
CREATE INDEX IF NOT EXISTS idx_tasks_friction ON tasks(friction_type, status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_project ON tasks(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_situation ON tasks(user_id, situation_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_source_plan ON tasks(user_id, source_next_move_plan_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_friction ON tasks(user_id, friction_type, status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_qa_status ON tasks(user_id, is_qa, status);

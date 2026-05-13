PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  personal_profile TEXT NOT NULL DEFAULT '',
  current_season TEXT NOT NULL DEFAULT '',
  core_priorities TEXT NOT NULL DEFAULT '',
  constraints TEXT NOT NULL DEFAULT '',
  operating_principles TEXT NOT NULL DEFAULT '',
  remember TEXT NOT NULL DEFAULT '',
  challenge_on TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS life_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  priority_level TEXT NOT NULL CHECK (priority_level IN ('low', 'medium', 'high')),
  desired_outcome TEXT NOT NULL DEFAULT '',
  current_bottleneck TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  life_area_id INTEGER REFERENCES life_areas(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'someday', 'done')),
  description TEXT NOT NULL DEFAULT '',
  next_milestone TEXT NOT NULL DEFAULT '',
  current_bottleneck TEXT NOT NULL DEFAULT '',
  why_it_matters TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  life_area_id INTEGER REFERENCES life_areas(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'done', 'ignored')),
  importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
  effort INTEGER NOT NULL CHECK (effort BETWEEN 1 AND 5),
  due_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkin_date TEXT NOT NULL,
  energy_level INTEGER NOT NULL CHECK (energy_level BETWEEN 1 AND 10),
  mood TEXT NOT NULL DEFAULT '',
  sleep TEXT NOT NULL DEFAULT '',
  health_status TEXT NOT NULL DEFAULT '',
  main_thing TEXT NOT NULL DEFAULT '',
  resistance TEXT NOT NULL DEFAULT '',
  brain_dump TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date TEXT NOT NULL,
  checkin_id INTEGER REFERENCES checkins(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  today_theme TEXT NOT NULL,
  honest_read TEXT NOT NULL,
  top_3_actions_json TEXT NOT NULL,
  avoid_today TEXT NOT NULL,
  optional_if_energy_is_high TEXT NOT NULL,
  minimum_viable_day TEXT NOT NULL,
  evening_review_prompt TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkins_date_created ON checkins(checkin_date, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plans_date_created ON plans(plan_date, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clerk_user_id TEXT UNIQUE,
  email TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'user')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO users (id, role, created_at, updated_at)
VALUES (
  1,
  'owner',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(id) DO NOTHING;

DROP TABLE IF EXISTS profile_auth_new;
CREATE TABLE profile_auth_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
INSERT INTO profile_auth_new (
  id, user_id, personal_profile, current_season, core_priorities, constraints,
  operating_principles, remember, challenge_on, created_at, updated_at
)
SELECT
  id, 1, personal_profile, current_season, core_priorities, constraints,
  operating_principles, remember, challenge_on, created_at, updated_at
FROM profile;
DROP TABLE profile;
ALTER TABLE profile_auth_new RENAME TO profile;

DROP TABLE IF EXISTS life_areas_auth_new;
CREATE TABLE life_areas_auth_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority_level TEXT NOT NULL CHECK (priority_level IN ('low', 'medium', 'high')),
  desired_outcome TEXT NOT NULL DEFAULT '',
  current_bottleneck TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO life_areas_auth_new (
  id, user_id, name, description, priority_level, desired_outcome,
  current_bottleneck, created_at, updated_at
)
SELECT
  id, 1, name, description, priority_level, desired_outcome,
  current_bottleneck, created_at, updated_at
FROM life_areas;
DROP TABLE life_areas;
ALTER TABLE life_areas_auth_new RENAME TO life_areas;

DROP TABLE IF EXISTS projects_auth_new;
CREATE TABLE projects_auth_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
INSERT INTO projects_auth_new (
  id, user_id, name, life_area_id, status, description, next_milestone,
  current_bottleneck, why_it_matters, created_at, updated_at
)
SELECT
  id, 1, name, life_area_id, status, description, next_milestone,
  current_bottleneck, why_it_matters, created_at, updated_at
FROM projects;
DROP TABLE projects;
ALTER TABLE projects_auth_new RENAME TO projects;

DROP TABLE IF EXISTS situations_auth_new;
CREATE TABLE situations_auth_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'custom',
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved', 'archived')),
  urgency TEXT NOT NULL CHECK (urgency IN ('low', 'medium', 'high', 'crisis')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO situations_auth_new (
  id, user_id, title, category, status, urgency, created_at, updated_at
)
SELECT id, 1, title, category, status, urgency, created_at, updated_at
FROM situations;
DROP TABLE situations;
ALTER TABLE situations_auth_new RENAME TO situations;

DROP TABLE IF EXISTS next_move_plans_auth_new;
CREATE TABLE next_move_plans_auth_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  created_at TEXT NOT NULL,
  recommendation_basis_json TEXT NOT NULL DEFAULT '[]',
  restraint_guidance_json TEXT NOT NULL DEFAULT '{"should_push":true,"reason":"This plan was created before restraint guidance was stored.","minimum_viable_move":"Do the smallest useful version of the highest-leverage move.","recovery_move":"Protect basic recovery before adding more work.","scope_boundary":"Do not expand the plan beyond the current situation."}',
  friction_pattern TEXT NOT NULL DEFAULT 'No friction pattern was stored for this older plan.',
  local_reality_scout_json TEXT NOT NULL DEFAULT '{"used_web_search":false,"location_basis":"","findings":[],"missing_location_question":""}',
  safety_boundary_json TEXT NOT NULL DEFAULT '{"risk_level":"low","professional_help_signal":"Use appropriate human or professional help when the situation exceeds planning support.","do_not_rely_on_ai_for":"Do not rely on FlowPath for legal, medical, financial, emergency, or crisis decisions.","urgent_support_guidance":"If there is immediate danger, contact local emergency services or a trusted person nearby now."}'
);
INSERT INTO next_move_plans_auth_new (
  id, user_id, situation_id, intake_session_id, model, mode, situation_summary,
  core_bottleneck, highest_leverage_move_json, why_this_move,
  first_30_minutes_json, next_24_hours_json, next_7_days_json,
  what_not_to_do_json, likely_trap, resources_to_seek_json,
  when_to_get_human_help, confidence_level, assumptions_json,
  follow_up_questions_json, raw_json, created_at, recommendation_basis_json,
  restraint_guidance_json, friction_pattern, local_reality_scout_json,
  safety_boundary_json
)
SELECT
  id, 1, situation_id, intake_session_id, model, mode, situation_summary,
  core_bottleneck, highest_leverage_move_json, why_this_move,
  first_30_minutes_json, next_24_hours_json, next_7_days_json,
  what_not_to_do_json, likely_trap, resources_to_seek_json,
  when_to_get_human_help, confidence_level, assumptions_json,
  follow_up_questions_json, raw_json, created_at, recommendation_basis_json,
  restraint_guidance_json, friction_pattern, local_reality_scout_json,
  safety_boundary_json
FROM next_move_plans;
DROP TABLE next_move_plans;
ALTER TABLE next_move_plans_auth_new RENAME TO next_move_plans;

DROP TABLE IF EXISTS intake_sessions_auth_new;
CREATE TABLE intake_sessions_auth_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
INSERT INTO intake_sessions_auth_new (
  id, user_id, situation_id, current_stage, is_complete, summary_so_far,
  created_at, updated_at
)
SELECT
  id, 1, situation_id, current_stage, is_complete, summary_so_far,
  created_at, updated_at
FROM intake_sessions;
DROP TABLE intake_sessions;
ALTER TABLE intake_sessions_auth_new RENAME TO intake_sessions;

DROP TABLE IF EXISTS intake_messages_auth_new;
CREATE TABLE intake_messages_auth_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES intake_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO intake_messages_auth_new (
  id, user_id, session_id, role, content, created_at
)
SELECT id, 1, session_id, role, content, created_at
FROM intake_messages;
DROP TABLE intake_messages;
ALTER TABLE intake_messages_auth_new RENAME TO intake_messages;

DROP TABLE IF EXISTS tasks_auth_new;
CREATE TABLE tasks_auth_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  life_area_id INTEGER REFERENCES life_areas(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'done', 'ignored')),
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
  friction_note TEXT NOT NULL DEFAULT ''
);
INSERT INTO tasks_auth_new (
  id, user_id, title, life_area_id, project_id, status, importance, effort,
  due_date, notes, created_at, updated_at, situation_id,
  source_next_move_plan_id, source_plan_section, friction_type, friction_note
)
SELECT
  id, 1, title, life_area_id, project_id, status, importance, effort,
  due_date, notes, created_at, updated_at, situation_id,
  source_next_move_plan_id, source_plan_section, friction_type, friction_note
FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_auth_new RENAME TO tasks;

DROP TABLE IF EXISTS checkins_auth_new;
CREATE TABLE checkins_auth_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
INSERT INTO checkins_auth_new (
  id, user_id, checkin_date, energy_level, mood, sleep, health_status,
  main_thing, resistance, brain_dump, created_at
)
SELECT
  id, 1, checkin_date, energy_level, mood, sleep, health_status,
  main_thing, resistance, brain_dump, created_at
FROM checkins;
DROP TABLE checkins;
ALTER TABLE checkins_auth_new RENAME TO checkins;

DROP TABLE IF EXISTS plans_auth_new;
CREATE TABLE plans_auth_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  created_at TEXT NOT NULL,
  recommendation_basis_json TEXT NOT NULL DEFAULT '[]',
  restraint_guidance_json TEXT NOT NULL DEFAULT '{"should_push":true,"reason":"This plan was created before restraint guidance was stored.","minimum_viable_move":"Do the smallest useful version of the top action.","recovery_move":"Protect basic recovery before adding more work.","scope_boundary":"Do not expand the plan beyond today."}',
  friction_pattern TEXT NOT NULL DEFAULT 'No friction pattern was stored for this older plan.',
  local_reality_scout_json TEXT NOT NULL DEFAULT '{"used_web_search":false,"location_basis":"","findings":[],"missing_location_question":""}',
  human_help_boundary TEXT NOT NULL DEFAULT 'Use appropriate human, professional, or emergency help when the situation exceeds planning support.'
);
INSERT INTO plans_auth_new (
  id, user_id, plan_date, checkin_id, model, today_theme, honest_read,
  top_3_actions_json, avoid_today, optional_if_energy_is_high,
  minimum_viable_day, evening_review_prompt, raw_json, created_at,
  recommendation_basis_json, restraint_guidance_json, friction_pattern,
  local_reality_scout_json, human_help_boundary
)
SELECT
  id, 1, plan_date, checkin_id, model, today_theme, honest_read,
  top_3_actions_json, avoid_today, optional_if_energy_is_high,
  minimum_viable_day, evening_review_prompt, raw_json, created_at,
  recommendation_basis_json, restraint_guidance_json, friction_pattern,
  local_reality_scout_json, human_help_boundary
FROM plans;
DROP TABLE plans;
ALTER TABLE plans_auth_new RENAME TO plans;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_user ON profile(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_life_areas_user_name ON life_areas(user_id, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_life_areas_user_priority ON life_areas(user_id, priority_level);
CREATE INDEX IF NOT EXISTS idx_projects_user_status ON projects(user_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_user_life_area ON projects(user_id, life_area_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_project ON tasks(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_situation ON tasks(user_id, situation_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_source_plan ON tasks(user_id, source_next_move_plan_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_friction ON tasks(user_id, friction_type, status);
CREATE INDEX IF NOT EXISTS idx_checkins_user_date_created ON checkins(user_id, checkin_date, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plans_user_date_created ON plans(user_id, plan_date, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_situations_user_status_updated ON situations(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_situations_user_urgency ON situations(user_id, urgency);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_user_situation ON intake_sessions(user_id, situation_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_messages_user_session ON intake_messages(user_id, session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_next_move_plans_user_situation ON next_move_plans(user_id, situation_id, created_at DESC);

PRAGMA foreign_keys = ON;

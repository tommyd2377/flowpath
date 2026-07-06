PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS outcome_harness_events_new (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  situation_id INTEGER REFERENCES situations(id) ON DELETE SET NULL,
  conversation_id TEXT,
  message_id INTEGER REFERENCES intake_messages(id) ON DELETE SET NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  plan_id INTEGER REFERENCES next_move_plans(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'suggested_action_shown',
    'suggested_action_accepted',
    'suggested_action_edited',
    'suggested_action_dismissed',
    'suggested_action_completed',
    'suggested_action_ignored',
    'task_created_from_ai',
    'task_created_manually',
    'task_edited',
    'task_completed',
    'task_dismissed',
    'plan_generated',
    'plan_regenerated',
    'intake_question_answered',
    'intake_skipped_generate_now',
    'user_reported_helpful',
    'user_reported_not_helpful',
    'user_reported_acted',
    'user_reported_deferred',
    'user_reported_still_stuck',
    'user_repeated_same_loop',
    'evaluator_rewrite_triggered',
    'web_search_used',
    'memory_used',
    'escalation_triggered',
    'first_intake_question_shown',
    'first_intake_abandoned',
    'situation_edited_before_answering',
    'created_new_situation_before_answering',
    'board_edited_before_answering',
    'created_new_board_before_answering',
    'move_map_branch_expanded',
    'move_map_action_leaf_reached'
  )),
  source TEXT NOT NULL CHECK (source IN (
    'first_intake',
    'followup_intake',
    'next_move_plan',
    'suggested_action',
    'task_deck',
    'check_in',
    'manual_user_feedback',
    'system_inference',
    'move_map'
  )),
  state_detected TEXT,
  intervention_type TEXT,
  domain TEXT,
  subtype TEXT,
  question_purpose TEXT,
  model_used TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT,
  is_qa INTEGER NOT NULL DEFAULT 0 CHECK (is_qa IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO outcome_harness_events_new (
  id, user_id, situation_id, conversation_id, message_id, task_id, plan_id,
  event_type, source, state_detected, intervention_type, domain, subtype,
  question_purpose, model_used, metadata_json, dedupe_key, is_qa, created_at,
  updated_at
)
SELECT
  id, user_id, situation_id, conversation_id, message_id, task_id, plan_id,
  event_type, source, state_detected, intervention_type, domain, subtype,
  question_purpose, model_used, metadata_json, dedupe_key, is_qa, created_at,
  updated_at
FROM outcome_harness_events;

DROP TABLE outcome_harness_events;
ALTER TABLE outcome_harness_events_new RENAME TO outcome_harness_events;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outcome_harness_events_user_dedupe
  ON outcome_harness_events(user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outcome_harness_events_user_created
  ON outcome_harness_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_harness_events_user_type_created
  ON outcome_harness_events(user_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_harness_events_user_plan
  ON outcome_harness_events(user_id, plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_harness_events_user_task
  ON outcome_harness_events(user_id, task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_harness_events_user_context
  ON outcome_harness_events(user_id, domain, subtype, intervention_type);
CREATE INDEX IF NOT EXISTS idx_outcome_harness_events_user_qa
  ON outcome_harness_events(user_id, is_qa, created_at DESC);

PRAGMA foreign_keys = ON;

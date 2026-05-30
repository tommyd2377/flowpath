CREATE TABLE IF NOT EXISTS outcome_harness_events (
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
    'created_new_situation_before_answering'
  )),
  source TEXT NOT NULL CHECK (source IN (
    'first_intake',
    'followup_intake',
    'next_move_plan',
    'suggested_action',
    'task_deck',
    'check_in',
    'manual_user_feedback',
    'system_inference'
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

CREATE TABLE IF NOT EXISTS intervention_effectiveness_summaries (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  subtype TEXT NOT NULL,
  intervention_type TEXT NOT NULL,
  shown_count INTEGER NOT NULL DEFAULT 0 CHECK (shown_count >= 0),
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  dismissed_count INTEGER NOT NULL DEFAULT 0 CHECK (dismissed_count >= 0),
  not_useful_count INTEGER NOT NULL DEFAULT 0 CHECK (not_useful_count >= 0),
  edited_count INTEGER NOT NULL DEFAULT 0 CHECK (edited_count >= 0),
  ignored_count INTEGER NOT NULL DEFAULT 0 CHECK (ignored_count >= 0),
  reported_helpful_count INTEGER NOT NULL DEFAULT 0 CHECK (reported_helpful_count >= 0),
  reported_still_stuck_count INTEGER NOT NULL DEFAULT 0 CHECK (reported_still_stuck_count >= 0),
  repeated_loop_count INTEGER NOT NULL DEFAULT 0 CHECK (repeated_loop_count >= 0),
  last_used_at TEXT,
  effectiveness_score INTEGER NOT NULL DEFAULT 0 CHECK (effectiveness_score BETWEEN -100 AND 100),
  is_qa INTEGER NOT NULL DEFAULT 0 CHECK (is_qa IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, is_qa, domain, subtype, intervention_type)
);

CREATE INDEX IF NOT EXISTS idx_intervention_effectiveness_user_score
  ON intervention_effectiveness_summaries(user_id, is_qa, effectiveness_score DESC);
CREATE INDEX IF NOT EXISTS idx_intervention_effectiveness_user_context
  ON intervention_effectiveness_summaries(user_id, is_qa, domain, subtype);

ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes BETWEEN 1 AND 480);

ALTER TABLE generation_events ADD COLUMN outcome_harness_context_included INTEGER NOT NULL DEFAULT 0 CHECK (outcome_harness_context_included IN (0, 1));
ALTER TABLE generation_events ADD COLUMN historical_effectiveness_influenced_intervention INTEGER NOT NULL DEFAULT 0 CHECK (historical_effectiveness_influenced_intervention IN (0, 1));

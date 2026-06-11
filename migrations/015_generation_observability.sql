ALTER TABLE generation_events ADD COLUMN plan_id INTEGER REFERENCES next_move_plans(id) ON DELETE SET NULL;
ALTER TABLE generation_events ADD COLUMN task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE generation_events ADD COLUMN flow_type TEXT;
ALTER TABLE generation_events ADD COLUMN flow_status TEXT;
ALTER TABLE generation_events ADD COLUMN model_role TEXT;
ALTER TABLE generation_events ADD COLUMN cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0);
ALTER TABLE generation_events ADD COLUMN total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0);
ALTER TABLE generation_events ADD COLUMN estimated_cost_usd REAL CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0);
ALTER TABLE generation_events ADD COLUMN web_search_call_count INTEGER CHECK (web_search_call_count IS NULL OR web_search_call_count >= 0);
ALTER TABLE generation_events ADD COLUMN web_search_decision_reason TEXT;
ALTER TABLE generation_events ADD COLUMN used_evaluator INTEGER NOT NULL DEFAULT 0 CHECK (used_evaluator IN (0, 1));
ALTER TABLE generation_events ADD COLUMN evaluator_triggered_revision INTEGER NOT NULL DEFAULT 0 CHECK (evaluator_triggered_revision IN (0, 1));
ALTER TABLE generation_events ADD COLUMN safety_route_triggered INTEGER NOT NULL DEFAULT 0 CHECK (safety_route_triggered IN (0, 1));
ALTER TABLE generation_events ADD COLUMN safety_route_type TEXT;
ALTER TABLE generation_events ADD COLUMN quota_tier TEXT;
ALTER TABLE generation_events ADD COLUMN quota_usage_type TEXT;
ALTER TABLE generation_events ADD COLUMN error_message_sanitized TEXT;
ALTER TABLE generation_events ADD COLUMN structural_counts_json TEXT;

CREATE INDEX IF NOT EXISTS idx_generation_events_user_flow_started
  ON generation_events(user_id, flow_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_events_user_flow_status
  ON generation_events(user_id, flow_type, flow_status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_events_plan
  ON generation_events(user_id, plan_id, started_at DESC);

ALTER TABLE inferred_context_items
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE inferred_context_items
  ADD COLUMN confidence TEXT NOT NULL DEFAULT 'medium';

ALTER TABLE inferred_context_items
  ADD COLUMN superseded_by_id INTEGER;

ALTER TABLE inferred_context_items
  ADD COLUMN last_confirmed_at TEXT;

ALTER TABLE inferred_context_items
  ADD COLUMN reconciliation_note TEXT;

CREATE INDEX IF NOT EXISTS idx_inferred_context_user_status
  ON inferred_context_items(user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_inferred_context_user_superseded
  ON inferred_context_items(user_id, superseded_by_id);

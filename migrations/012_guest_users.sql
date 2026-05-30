ALTER TABLE users ADD COLUMN guest_session_id TEXT;
ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0 CHECK (is_guest IN (0, 1));

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_guest_session
  ON users(guest_session_id)
  WHERE guest_session_id IS NOT NULL;

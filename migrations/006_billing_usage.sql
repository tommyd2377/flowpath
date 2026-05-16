ALTER TABLE users ADD COLUMN plan_tier TEXT NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'core', 'internal_unlimited', 'pro', 'sponsored'));
ALTER TABLE users ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'none' CHECK (billing_status IN ('none', 'active', 'trialing', 'past_due', 'canceled', 'incomplete'));
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN stripe_price_id TEXT;
ALTER TABLE users ADD COLUMN current_period_start TEXT;
ALTER TABLE users ADD COLUMN current_period_end TEXT;
ALTER TABLE users ADD COLUMN internal_unlimited INTEGER NOT NULL DEFAULT 0 CHECK (internal_unlimited IN (0, 1));

CREATE TABLE IF NOT EXISTS monthly_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  usage_type TEXT NOT NULL CHECK (usage_type IN ('today_checkin', 'next_move_plan', 'lightweight_assist')),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  estimated_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (estimated_input_tokens >= 0),
  estimated_output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (estimated_output_tokens >= 0),
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cost_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, period_start, usage_type)
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_monthly_usage_user_period ON monthly_usage(user_id, period_start);

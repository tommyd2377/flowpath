import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";

const dbPath = path.join(os.tmpdir(), `flowpath-billing-${process.pid}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.APP_TIMEZONE = "UTC";
process.env.INTERNAL_UNLIMITED_EMAILS = "allowlisted@example.com";

let db: Awaited<typeof import("@/lib/db")>;
let usage: Awaited<typeof import("./usage")>;
let stripeBilling: Awaited<typeof import("./stripe")>;

async function createSchema() {
  await db.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clerk_user_id TEXT UNIQUE,
    email TEXT UNIQUE,
    guest_session_id TEXT UNIQUE,
    is_guest INTEGER NOT NULL DEFAULT 0,
    role TEXT NOT NULL DEFAULT 'user',
    plan_tier TEXT NOT NULL DEFAULT 'free',
    billing_status TEXT NOT NULL DEFAULT 'none',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_price_id TEXT,
    current_period_start TEXT,
    current_period_end TEXT,
    internal_unlimited INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  await db.run(`CREATE TABLE monthly_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    usage_type TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, period_start, usage_type)
  )`);
  await db.run(`CREATE TABLE stripe_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    processed_at TEXT NOT NULL
  )`);
  await db.run(`CREATE TABLE situations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'custom',
    status TEXT NOT NULL DEFAULT 'active',
    urgency TEXT NOT NULL DEFAULT 'medium',
    is_qa INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  await db.run(`CREATE TABLE next_move_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    situation_id INTEGER NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
    is_qa INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);
}

async function insertUser({
  id,
  email = `user-${id}@example.com`,
  planTier = "free",
  billingStatus = "none",
  customerId = null,
  subscriptionId = null,
  internalUnlimited = 0,
  isGuest = 0,
}: {
  id: number;
  email?: string | null;
  planTier?: string;
  billingStatus?: string;
  customerId?: string | null;
  subscriptionId?: string | null;
  internalUnlimited?: number;
  isGuest?: number;
}) {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO users (
      id, email, role, plan_tier, billing_status, stripe_customer_id,
      stripe_subscription_id, internal_unlimited, is_guest, created_at, updated_at
    ) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      email,
      planTier,
      billingStatus,
      customerId,
      subscriptionId,
      internalUnlimited,
      isGuest,
      now,
      now,
    ],
  );
}

async function setUsage(userId: number, usageType: string, count: number) {
  const { periodStart, periodEnd } = usage.getUsagePeriod();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO monthly_usage (
      user_id, period_start, period_end, usage_type, count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, periodStart, periodEnd, usageType, count, now, now],
  );
}

function subscriptionEvent({
  id,
  customer,
  status,
  price = "price_core_test",
}: {
  id: string;
  customer: string;
  status: string;
  price?: string;
}) {
  return {
    id: `evt_${id}_${status}`,
    type: "customer.subscription.updated",
    created: 1_765_000_000,
    data: {
      object: {
        id,
        customer,
        status,
        metadata: {},
        items: {
          data: [
            {
              current_period_start: 1_765_000_000,
              current_period_end: 1_767_592_000,
              price: { id: price },
            },
          ],
        },
      },
    },
  } as never;
}

before(async () => {
  db = await import("@/lib/db");
  usage = await import("./usage");
  stripeBilling = await import("./stripe");
  await createSchema();
});

beforeEach(async () => {
  await db.run("DELETE FROM next_move_plans");
  await db.run("DELETE FROM situations");
  await db.run("DELETE FROM stripe_events");
  await db.run("DELETE FROM monthly_usage");
  await db.run("DELETE FROM users");
});

after(() => {
  db.db.close();
  fs.rmSync(dbPath, { force: true });
});

test("free user can use a feature within quota and is blocked after quota", async () => {
  await insertUser({ id: 1 });

  const firstDecision = await usage.canUseFeature(1, "next_move_plan");
  assert.equal(firstDecision.allowed, true);
  assert.equal(firstDecision.remaining, 1);

  await usage.incrementUsage(1, "next_move_plan", {
    inputTokens: 100,
    outputTokens: 50,
  });

  const secondDecision = await usage.canUseFeature(1, "next_move_plan");
  assert.equal(secondDecision.allowed, false);
  assert.equal(secondDecision.used, 1);
  assert.equal(secondDecision.remaining, 0);
  await assert.rejects(
    () => usage.assertCanUseFeature(1, "next_move_plan"),
    /free monthly FlowPath usage is used up/,
  );
});

test("guest user gets guest limits and signup-oriented quota copy", async () => {
  await insertUser({ id: 8, email: null, isGuest: 1 });
  await setUsage(8, "today_checkin", 1);

  const decision = await usage.canUseFeature(8, "today_checkin");
  assert.equal(decision.allowed, false);
  assert.equal(decision.limit, 1);
  assert.match(decision.upgradeMessage, /Create a free account/);

  const summary = await usage.getBillingSummary(8);
  assert.equal(summary.is_guest, true);
  assert.equal(
    summary.usage.find((item) => item.usage_type === "today_checkin")?.limit,
    1,
  );
});

test("guest can finish the first situation intake even after lightweight quota", async () => {
  await insertUser({ id: 18, email: null, isGuest: 1 });
  await setUsage(18, "lightweight_assist", 5);
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO situations (
      id, user_id, title, description, category, status, urgency, created_at, updated_at
    ) VALUES (101, 18, 'First guest intake', 'First guest intake', 'custom', 'active', 'medium', ?, ?)`,
    [now, now],
  );
  await db.run(
    `INSERT INTO situations (
      id, user_id, title, description, category, status, urgency, created_at, updated_at
    ) VALUES (102, 18, 'Second guest intake', 'Second guest intake', 'custom', 'active', 'medium', ?, ?)`,
    [now, now],
  );

  const blockedAssist = await usage.canUseFeature(18, "lightweight_assist");
  assert.equal(blockedAssist.allowed, false);
  assert.equal(await usage.canUseGuestFirstSituationIntake(18, 101), true);
  assert.equal(await usage.canUseGuestFirstSituationIntake(18, 102), false);

  await db.run(
    "INSERT INTO next_move_plans (user_id, situation_id, created_at) VALUES (18, 101, ?)",
    [now],
  );
  assert.equal(await usage.canUseGuestFirstSituationIntake(18, 101), false);
});

test("core user has the higher quota", async () => {
  await insertUser({ id: 2, planTier: "core", billingStatus: "active" });
  await setUsage(2, "next_move_plan", 19);

  const beforeLimit = await usage.canUseFeature(2, "next_move_plan");
  assert.equal(beforeLimit.allowed, true);
  assert.equal(beforeLimit.remaining, 1);

  await usage.incrementUsage(2, "next_move_plan");
  const atLimit = await usage.canUseFeature(2, "next_move_plan");
  assert.equal(atLimit.allowed, false);
  assert.equal(atLimit.used, 20);
});

test("internal unlimited users are never blocked", async () => {
  await insertUser({ id: 3, internalUnlimited: 1 });
  await setUsage(3, "lightweight_assist", 999);

  const decision = await usage.canUseFeature(3, "lightweight_assist");
  assert.equal(decision.allowed, true);
  assert.equal(decision.limit, null);
  assert.equal(decision.remaining, null);
});

test("internal unlimited env allowlist is honored", async () => {
  await insertUser({ id: 4, email: "allowlisted@example.com" });
  await setUsage(4, "today_checkin", 999);

  const decision = await usage.canUseFeature(4, "today_checkin");
  assert.equal(decision.allowed, true);
  assert.equal(decision.planTier, "internal_unlimited");
});

test("webhook activates a core subscription", async () => {
  await insertUser({ id: 5, customerId: "cus_active" });

  await stripeBilling.handleStripeEvent(
    subscriptionEvent({
      id: "sub_active",
      customer: "cus_active",
      status: "active",
    }),
  );

  const user = await usage.getBillingUser(5);
  assert.equal(user?.plan_tier, "core");
  assert.equal(user?.billing_status, "active");
  assert.equal(user?.stripe_subscription_id, "sub_active");
  assert.equal(user?.stripe_price_id, "price_core_test");
});

test("webhook cancellation downgrades a normal user to free", async () => {
  await insertUser({
    id: 6,
    planTier: "core",
    billingStatus: "active",
    customerId: "cus_cancel",
    subscriptionId: "sub_cancel",
  });

  await stripeBilling.handleStripeEvent(
    subscriptionEvent({
      id: "sub_cancel",
      customer: "cus_cancel",
      status: "canceled",
    }),
  );

  const user = await usage.getBillingUser(6);
  assert.equal(user?.plan_tier, "free");
  assert.equal(user?.billing_status, "canceled");
});

test("webhook cancellation does not downgrade internal unlimited users", async () => {
  await insertUser({
    id: 7,
    planTier: "internal_unlimited",
    billingStatus: "none",
    customerId: "cus_internal",
    subscriptionId: "sub_internal",
    internalUnlimited: 1,
  });

  await stripeBilling.handleStripeEvent(
    subscriptionEvent({
      id: "sub_internal",
      customer: "cus_internal",
      status: "canceled",
    }),
  );

  const user = await usage.getBillingUser(7);
  assert.equal(user?.plan_tier, "internal_unlimited");
  assert.equal(user?.internal_unlimited, true);
  assert.equal(user?.billing_status, "canceled");
});

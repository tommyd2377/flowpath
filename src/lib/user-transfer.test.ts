import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const dbPath = path.join(os.tmpdir(), `flowpath-user-transfer-${process.pid}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.APP_TIMEZONE = "UTC";

let db: Awaited<typeof import("@/lib/db")>;
let repository: Awaited<typeof import("./repository")>;
let userTransfer: Awaited<typeof import("./user-transfer")>;

function splitStatements(sql: string) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyMigrations() {
  const migrationsDirectory = path.resolve(process.cwd(), "migrations");
  const files = fs
    .readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDirectory, file), "utf8");
    for (const statement of splitStatements(sql)) {
      await db.run(statement);
    }
  }
}

async function insertUser({
  id,
  clerkUserId = null,
  email = null,
  guestSessionId = null,
  isGuest = 0,
}: {
  id: number;
  clerkUserId?: string | null;
  email?: string | null;
  guestSessionId?: string | null;
  isGuest?: number;
}) {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO users (
      id, clerk_user_id, email, guest_session_id, is_guest, role, plan_tier,
      billing_status, internal_unlimited, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'user', 'free', 'none', 0, ?, ?)`,
    [id, clerkUserId, email, guestSessionId, isGuest, now, now],
  );
}

before(async () => {
  db = await import("@/lib/db");
  repository = await import("./repository");
  userTransfer = await import("./user-transfer");
  await applyMigrations();
});

after(() => {
  db.db.close();
  fs.rmSync(dbPath, { force: true });
});

test("guest intake data is transferred into an existing signed-in user", async () => {
  await insertUser({
    id: 201,
    clerkUserId: "user_existing",
    email: "existing@example.com",
  });
  await insertUser({
    id: 202,
    guestSessionId: "guest_session_transfer_test_123456",
    isGuest: 1,
  });

  await repository.getProfile(201);
  await repository.updateProfile(202, {
    personal_profile: "Guest profile note",
    current_season: "",
    core_priorities: "",
    constraints: "",
    operating_principles: "",
    remember: "",
    challenge_on: "",
    context_constraints: {},
  });
  const situation = await repository.createSituation(202, {
    title: "Guest intake should survive sign in",
    description: "I answered a lot of intake questions as a guest.",
    category: "work_career",
    urgency: "medium",
  });
  const session = await repository.getOrCreateIntakeSession(202, situation.id);
  await repository.addIntakeMessage(
    202,
    session.id,
    "assistant",
    "What is the main constraint?",
  );
  await repository.addIntakeMessage(202, session.id, "user", "Time and focus.", {
    clientMessageId: "guest-transfer-message",
  });
  const { periodStart, periodEnd } = (await import("./billing/usage")).getUsagePeriod();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO monthly_usage (
      user_id, period_start, period_end, usage_type, count, created_at, updated_at
    ) VALUES (202, ?, ?, 'lightweight_assist', 2, ?, ?)`,
    [periodStart, periodEnd, now, now],
  );

  const transferred = await userTransfer.transferGuestUserDataToUser(202, 201);

  assert.equal(transferred, true);
  assert.equal(await db.first("SELECT id FROM users WHERE id = 202"), null);
  const situations = await repository.listSituations(201);
  assert.equal(
    situations.some((item) => item.title === "Guest intake should survive sign in"),
    true,
  );
  const transferredSession = await repository.getLatestIntakeSession(
    201,
    situation.id,
  );
  assert.ok(transferredSession);
  const messages = await repository.listIntakeMessages(201, transferredSession.id);
  assert.deepEqual(
    messages.map((message) => message.content),
    ["What is the main constraint?", "Time and focus."],
  );
  assert.equal((await repository.getProfile(201)).personal_profile, "Guest profile note");
  const usageRow = await db.first<{ count: number }>(
    `SELECT count FROM monthly_usage
    WHERE user_id = 201 AND usage_type = 'lightweight_assist'`,
  );
  assert.equal(usageRow?.count, 2);
});

test("duplicate signed-in user data is transferred into a canonical user", async () => {
  await insertUser({
    id: 301,
    clerkUserId: "user_canonical",
    email: "canonical@example.com",
  });
  await insertUser({
    id: 302,
    clerkUserId: "user_duplicate",
    email: "duplicate@example.com",
  });

  await repository.getProfile(301);
  await repository.updateProfile(302, {
    personal_profile: "Duplicate profile note",
    current_season: "",
    core_priorities: "",
    constraints: "",
    operating_principles: "",
    remember: "",
    challenge_on: "",
    context_constraints: {},
  });
  const situation = await repository.createSituation(302, {
    title: "Duplicate user situation should be recovered",
    description: "This data was attached to a duplicate signed-in row.",
    category: "custom",
    urgency: "medium",
  });
  const session = await repository.getOrCreateIntakeSession(302, situation.id);
  await repository.addIntakeMessage(
    302,
    session.id,
    "assistant",
    "What needs to be recovered?",
  );
  await repository.addIntakeMessage(302, session.id, "user", "The intake thread.", {
    clientMessageId: "duplicate-transfer-message",
  });

  const transferred = await userTransfer.transferDuplicateUserDataToUser(302, 301);

  assert.equal(transferred, true);
  assert.equal(await db.first("SELECT id FROM users WHERE id = 302"), null);
  const situations = await repository.listSituations(301);
  assert.equal(
    situations.some(
      (item) => item.title === "Duplicate user situation should be recovered",
    ),
    true,
  );
  const transferredSession = await repository.getLatestIntakeSession(
    301,
    situation.id,
  );
  assert.ok(transferredSession);
  const messages = await repository.listIntakeMessages(301, transferredSession.id);
  assert.deepEqual(
    messages.map((message) => message.content),
    ["What needs to be recovered?", "The intake thread."],
  );
  assert.equal(
    (await repository.getProfile(301)).personal_profile,
    "Duplicate profile note",
  );
});

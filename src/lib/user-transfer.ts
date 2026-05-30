import { first, run } from "./db";
import { nowIso } from "./time";

type UserRow = {
  id: number;
  is_guest: number;
};

type ProfileRow = {
  id: number;
  user_id: number;
  personal_profile: string;
  current_season: string;
  core_priorities: string;
  constraints: string;
  operating_principles: string;
  remember: string;
  challenge_on: string;
};

const profileTextColumns = [
  "personal_profile",
  "current_season",
  "core_priorities",
  "constraints",
  "operating_principles",
  "remember",
  "challenge_on",
] as const;

const simpleUserScopedTables = [
  "life_areas",
  "projects",
  "situations",
  "intake_sessions",
  "intake_messages",
  "next_move_plans",
  "tasks",
  "checkins",
  "plans",
  "inferred_context_items",
  "generation_events",
  "outcome_records",
  "outcome_harness_events",
] as const;

async function mergeProfile(guestUserId: number, targetUserId: number) {
  const guestProfile = await first<ProfileRow>(
    "SELECT * FROM profile WHERE user_id = ?",
    [guestUserId],
  );
  if (!guestProfile) return;

  const targetProfile = await first<ProfileRow>(
    "SELECT * FROM profile WHERE user_id = ?",
    [targetUserId],
  );
  if (!targetProfile) {
    await run("UPDATE profile SET user_id = ?, updated_at = ? WHERE user_id = ?", [
      targetUserId,
      nowIso(),
      guestUserId,
    ]);
    return;
  }

  await run(
    `UPDATE profile SET
      personal_profile = CASE WHEN trim(personal_profile) = '' THEN ? ELSE personal_profile END,
      current_season = CASE WHEN trim(current_season) = '' THEN ? ELSE current_season END,
      core_priorities = CASE WHEN trim(core_priorities) = '' THEN ? ELSE core_priorities END,
      constraints = CASE WHEN trim(constraints) = '' THEN ? ELSE constraints END,
      operating_principles = CASE WHEN trim(operating_principles) = '' THEN ? ELSE operating_principles END,
      remember = CASE WHEN trim(remember) = '' THEN ? ELSE remember END,
      challenge_on = CASE WHEN trim(challenge_on) = '' THEN ? ELSE challenge_on END,
      updated_at = ?
    WHERE user_id = ?`,
    [
      ...profileTextColumns.map((column) => guestProfile[column]),
      nowIso(),
      targetUserId,
    ],
  );
  await run("DELETE FROM profile WHERE user_id = ?", [guestUserId]);
}

async function mergeMonthlyUsage(guestUserId: number, targetUserId: number) {
  await run(
    `INSERT INTO monthly_usage (
      user_id, period_start, period_end, usage_type, count,
      estimated_input_tokens, estimated_output_tokens, estimated_cost_cents,
      created_at, updated_at
    )
    SELECT
      ?, period_start, period_end, usage_type, count,
      estimated_input_tokens, estimated_output_tokens, estimated_cost_cents,
      created_at, updated_at
    FROM monthly_usage
    WHERE user_id = ?
    ON CONFLICT(user_id, period_start, usage_type) DO UPDATE SET
      count = monthly_usage.count + excluded.count,
      estimated_input_tokens = monthly_usage.estimated_input_tokens + excluded.estimated_input_tokens,
      estimated_output_tokens = monthly_usage.estimated_output_tokens + excluded.estimated_output_tokens,
      estimated_cost_cents = monthly_usage.estimated_cost_cents + excluded.estimated_cost_cents,
      period_end = excluded.period_end,
      updated_at = excluded.updated_at`,
    [targetUserId, guestUserId],
  );
  await run("DELETE FROM monthly_usage WHERE user_id = ?", [guestUserId]);
}

async function avoidUserScopedUniqueCollisions(
  guestUserId: number,
  targetUserId: number,
) {
  await run(
    `UPDATE life_areas
    SET name = name || ' (guest ' || id || ')'
    WHERE user_id = ?
      AND EXISTS (
        SELECT 1 FROM life_areas existing
        WHERE existing.user_id = ?
          AND lower(existing.name) = lower(life_areas.name)
      )`,
    [guestUserId, targetUserId],
  );
  await run(
    `UPDATE intake_messages
    SET client_message_id = client_message_id || ':guest:' || id
    WHERE user_id = ?
      AND client_message_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM intake_messages existing
        WHERE existing.user_id = ?
          AND existing.client_message_id = intake_messages.client_message_id
      )`,
    [guestUserId, targetUserId],
  );
  await run(
    `UPDATE generation_events
    SET client_generation_id = client_generation_id || ':guest:' || id
    WHERE user_id = ?
      AND EXISTS (
        SELECT 1 FROM generation_events existing
        WHERE existing.user_id = ?
          AND existing.client_generation_id = generation_events.client_generation_id
      )`,
    [guestUserId, targetUserId],
  );
  await run(
    `UPDATE outcome_harness_events
    SET dedupe_key = dedupe_key || ':guest:' || id
    WHERE user_id = ?
      AND dedupe_key IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM outcome_harness_events existing
        WHERE existing.user_id = ?
          AND existing.dedupe_key = outcome_harness_events.dedupe_key
      )`,
    [guestUserId, targetUserId],
  );
}

export async function transferGuestUserDataToUser(
  guestUserId: number,
  targetUserId: number,
) {
  return transferUserDataToUser(guestUserId, targetUserId, true);
}

export async function transferDuplicateUserDataToUser(
  sourceUserId: number,
  targetUserId: number,
) {
  return transferUserDataToUser(sourceUserId, targetUserId, false);
}

async function transferUserDataToUser(
  sourceUserId: number,
  targetUserId: number,
  requireGuestSource: boolean,
) {
  if (sourceUserId === targetUserId) return false;

  const [source, target] = await Promise.all([
    first<UserRow>("SELECT id, is_guest FROM users WHERE id = ?", [sourceUserId]),
    first<UserRow>("SELECT id, is_guest FROM users WHERE id = ?", [targetUserId]),
  ]);
  if (!source || !target || (requireGuestSource && !source.is_guest)) return false;

  await mergeProfile(sourceUserId, targetUserId);
  await mergeMonthlyUsage(sourceUserId, targetUserId);
  await avoidUserScopedUniqueCollisions(sourceUserId, targetUserId);

  for (const table of simpleUserScopedTables) {
    await run(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`, [
      targetUserId,
      sourceUserId,
    ]);
  }

  await run(
    "UPDATE OR IGNORE intervention_effectiveness_summaries SET user_id = ? WHERE user_id = ?",
    [targetUserId, sourceUserId],
  );
  await run("DELETE FROM intervention_effectiveness_summaries WHERE user_id = ?", [
    sourceUserId,
  ]);
  await run("DELETE FROM users WHERE id = ?", [sourceUserId]);
  return true;
}

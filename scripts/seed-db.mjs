import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const databaseUrl = process.env.DATABASE_URL || "file:./data/flowpath.db";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined;
const OWNER_USER_ID = 1;

function ensureLocalDirectory(url) {
  if (!url.startsWith("file:")) return;
  const rawPath = url.slice("file:".length);
  if (!rawPath || rawPath === ":memory:") return;
  const databasePath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), rawPath);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
}

const now = new Date().toISOString();

const profile = {
  personal_profile:
    "I am using FlowPath to decide what to do next. Include my city, region/state/province, and country only when I want location-specific advice. I care about useful work, financial stability, real-world connection, creative or craft progress, and keeping life manageable.",
  current_season:
    "A decision season: choose sustainable next moves, protect stability, build useful proof, and keep meaningful goals moving without creating a fantasy workload.",
  core_priorities:
    "Protect stability, improve work and money options, build real-world connection, make progress on meaningful craft, and avoid drifting into planning as a substitute for action.",
  constraints:
    "Energy varies day to day. The plan should respect body status, sleep, real deadlines, and emotional resistance. No calendar, Notion, or external memory access is assumed.",
  operating_principles:
    "Choose leverage over volume. Make the next step small enough to actually do. Prefer shipped artifacts and outreach over endless polishing. Leave room for recovery.",
  remember:
    "The app only knows what is saved here, in projects, tasks, check-ins, and previous plans. Durable personal context should be pasted into this page.",
  challenge_on:
    "Challenge avoidance, over-planning, hiding inside product work, and treating every day like it needs to be a huge push.",
};

const lifeAreas = [
  ["Work / Money / Career", "Jobs, income, freelancing, business ideas, skill-building, proof, and opportunity.", "high", "Increase economic agency and decision clarity.", "Choosing the next move that creates stability or future options."],
  ["People / Community / Belonging", "Friendship, dating, professional peers, collaborators, community, and real-world connection.", "medium", "Build more repeatable human connection.", "Finding realistic environments and follow-up moves."],
  ["Craft / Creativity / Personal Mastery", "Writing, art, music, design, sports, serious hobbies, learning, and meaningful practice.", "medium", "Make steady progress without assuming professionalization.", "Reducing vague ambition into the next practice or project move."],
  ["Stability", "Urgent obligations, housing, health-adjacent capacity, deadlines, and basic needs.", "high", "Protect the board before adding risky moves.", "Separating immediate risk reduction from longer-range strategy."],
  ["Life Maintenance", "Errands, systems, paperwork, home, and logistics.", "low", "Keep small obligations from becoming friction.", "Letting maintenance tasks pile up."],
];

const projectSeeds = [
  ["Income lane test", "Work / Money / Career", "active", "Compare one practical income path against current constraints.", "Run a small two-week test with clear feedback.", "Avoiding broad career rumination.", "It can create stability and future options."],
  ["Proof asset", "Work / Money / Career", "active", "Create one credible artifact aimed at a specific opportunity type.", "Choose the proof target and make a rough first version.", "Building proof before asking for access.", "Proof makes outreach more realistic."],
  ["Recurring social container", "People / Community / Belonging", "active", "Find a repeatable real-world setting where connection can compound.", "Choose one setting to attend three times before judging.", "Avoiding one-off events with no follow-up path.", "Repeated exposure creates more realistic relationships."],
  ["Craft practice block", "Craft / Creativity / Personal Mastery", "active", "Protect a meaningful practice without assuming it must become paid work.", "Define the next 90-minute practice or project move.", "Letting the goal stay too abstract.", "Practice compounds when the move is small enough to start."],
  ["Stability check", "Stability", "active", "Name the immediate risk or obligation that needs protection.", "Pick the smallest move that lowers risk this week.", "Confusing urgent stability with long-range strategy.", "A safer board creates better future moves."],
];

ensureLocalDirectory(databaseUrl);
const client = createClient({ url: databaseUrl, authToken });

async function getLifeAreaId(name) {
  const result = await client.execute({
    sql: "SELECT id FROM life_areas WHERE user_id = ? AND name = ? COLLATE NOCASE",
    args: [OWNER_USER_ID, name],
  });
  return result.rows[0]?.id;
}

try {
  await client.execute({
    sql: `INSERT INTO users (id, role, created_at, updated_at)
    VALUES (?, 'owner', ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    args: [OWNER_USER_ID, now, now],
  });

  await client.execute({
    sql: `INSERT INTO profile (
      user_id, personal_profile, current_season, core_priorities, constraints,
      operating_principles, remember, challenge_on, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO NOTHING`,
    args: [
      OWNER_USER_ID,
      profile.personal_profile,
      profile.current_season,
      profile.core_priorities,
      profile.constraints,
      profile.operating_principles,
      profile.remember,
      profile.challenge_on,
      now,
      now,
    ],
  });

  for (const area of lifeAreas) {
    await client.execute({
      sql: `INSERT INTO life_areas (
        user_id, name, description, priority_level, desired_outcome, current_bottleneck, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`,
      args: [OWNER_USER_ID, ...area, now, now],
    });
  }

  for (const project of projectSeeds) {
    const [name, areaName, status, description, milestone, bottleneck, why] = project;
    const lifeAreaId = await getLifeAreaId(areaName);
    await client.execute({
      sql: `INSERT INTO projects (
        user_id, name, life_area_id, status, description, next_milestone,
        current_bottleneck, why_it_matters, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM projects WHERE user_id = ? AND name = ? COLLATE NOCASE
      )`,
      args: [
        OWNER_USER_ID,
        name,
        lifeAreaId ?? null,
        status,
        description,
        milestone,
        bottleneck,
        why,
        now,
        now,
        OWNER_USER_ID,
        name,
      ],
    });
  }

  console.log("Seed data ready.");
} finally {
  client.close();
}

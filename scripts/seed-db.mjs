import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const databaseUrl = process.env.DATABASE_URL || "file:./data/flowpath.db";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined;

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
    "I am using FlowPath as a private operating dashboard. Include my city, region/state/province, and country here when I want location-specific advice. I care about work momentum, health, creative output, acting opportunities, money stability, relationships, and keeping life administratively sane.",
  current_season:
    "A building season: ship useful projects, rebuild energy and body trust, and keep creative pipelines alive without creating a fantasy workload.",
  core_priorities:
    "Protect health, grow FlowTime, make FlowPath useful, keep screenwriting and acting moving through concrete next steps, and avoid drifting into planning as a substitute for distribution.",
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
  ["FlowTime", "Work and distribution around FlowTime.", "high", "Create steady traction and useful shipping cadence.", "Turning product work into visible distribution."],
  ["Health", "Recovery, body signals, sleep, stress, and medical basics.", "high", "Feel physically trustworthy and stable.", "Balancing ambition with actual capacity."],
  ["Fitness", "Strength, mobility, conditioning, and sustainable training.", "medium", "Rebuild consistency without overreaching.", "Finding the smallest reliable workout floor."],
  ["Screenwriting", "Scripts, story development, rewrites, and creative output.", "medium", "Keep writing projects alive through concrete pages and decisions.", "Reducing vague creative pressure into a next scene or beat."],
  ["Acting", "Auditions, student films, practice, reels, and acting pipeline.", "medium", "Create real reps and visible opportunities.", "Moving from intention to outreach and submissions."],
  ["Money", "Income, runway, spending, and business fundamentals.", "high", "Increase financial stability and decision clarity.", "Avoiding ambiguity around highest leverage money moves."],
  ["Social / Relationships", "Friendships, family, dating, community, and connection.", "medium", "Stay meaningfully connected without overextending.", "Initiating simply and consistently."],
  ["Admin / Life Maintenance", "Errands, systems, paperwork, home, and logistics.", "low", "Keep life from becoming friction.", "Letting small maintenance tasks pile up."],
];

const projectSeeds = [
  ["FlowTime", "FlowTime", "active", "Primary work/product focus.", "Identify and execute the next highest-leverage distribution or product move.", "Choosing distribution versus product polish.", "It is a core work bet."],
  ["FlowPath", "FlowTime", "active", "Personal AI prioritization dashboard.", "Get a private MVP online and actually use it for daily decisions.", "Keeping v1 simple enough to ship.", "It helps choose better days instead of collecting more tasks."],
  ["Under the Arcadian Sky", "Screenwriting", "active", "Screenwriting project.", "Define or complete the next concrete story beat, scene, or revision pass.", "Avoiding vague creative fog.", "It keeps a meaningful creative project moving."],
  ["Lovelacers", "Screenwriting", "paused", "Creative project to keep warm.", "Clarify the next decision when it becomes active again.", "Competing creative attention.", "It may become an important future creative lane."],
  ["Acting / student film pipeline", "Acting", "active", "Build reps through student films and practical acting opportunities.", "Find or submit to one concrete opportunity.", "Turning interest into external action.", "Reps and footage compound."],
  ["Health rebuild", "Health", "active", "Rebuild health, energy, and body confidence.", "Pick the safest useful health action for today.", "Overcorrecting or under-listening to body signals.", "Everything else gets easier when health is steadier."],
];

ensureLocalDirectory(databaseUrl);
const client = createClient({ url: databaseUrl, authToken });

async function getLifeAreaId(name) {
  const result = await client.execute({
    sql: "SELECT id FROM life_areas WHERE name = ?",
    args: [name],
  });
  return result.rows[0]?.id;
}

try {
  await client.execute({
    sql: `INSERT INTO profile (
      id, personal_profile, current_season, core_priorities, constraints,
      operating_principles, remember, challenge_on, created_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    args: [
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
        name, description, priority_level, desired_outcome, current_bottleneck, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO NOTHING`,
      args: [...area, now, now],
    });
  }

  for (const project of projectSeeds) {
    const [name, areaName, status, description, milestone, bottleneck, why] = project;
    const lifeAreaId = await getLifeAreaId(areaName);
    await client.execute({
      sql: `INSERT INTO projects (
        name, life_area_id, status, description, next_milestone,
        current_bottleneck, why_it_matters, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = ?)`,
      args: [
        name,
        lifeAreaId ?? null,
        status,
        description,
        milestone,
        bottleneck,
        why,
        now,
        now,
        name,
      ],
    });
  }

  console.log("Seed data ready.");
} finally {
  client.close();
}

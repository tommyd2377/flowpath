import assert from "node:assert/strict";
import test from "node:test";

import { rankTasks } from "./task-ranking";
import type { Task } from "./types";

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Task",
    life_area_id: null,
    project_id: null,
    situation_id: null,
    source_next_move_plan_id: null,
    source_plan_section: null,
    status: "open",
    importance: 3,
    effort: 3,
    friction_type: "none",
    friction_note: "",
    estimated_minutes: null,
    due_date: null,
    notes: "",
    created_at: "2026-05-16T00:00:00.000Z",
    updated_at: "2026-05-16T00:00:00.000Z",
    ...overrides,
  };
}

test("tasks from multiple situations are globally ranked by leverage and urgency", () => {
  const ranked = rankTasks(
    [
      task({
        id: 1,
        title: "Low leverage social admin",
        situation_title: "Social life",
        situation_urgency: "medium",
        importance: 2,
        effort: 4,
      }),
      task({
        id: 2,
        title: "Send targeted proof asset",
        situation_title: "Job search",
        situation_urgency: "high",
        source_next_move_plan_id: 10,
        source_plan_section: "immediate_next_action",
        importance: 5,
        effort: 1,
      }),
    ],
    "2026-05-17",
  );

  assert.equal(ranked[0].id, 2);
  assert.match(ranked[0].rank_reason ?? "", /high urgency situation/);
  assert.match(ranked[0].rank_reason ?? "", /Next Move plan/);
  assert.equal(ranked[0].situation_title, "Job search");
});

test("outcome context favors shorter accepted patterns", () => {
  const ranked = rankTasks(
    [
      task({
        id: 1,
        title: "Large useful action",
        importance: 4,
        effort: 2,
        estimated_minutes: 90,
      }),
      task({
        id: 2,
        title: "Small starter action",
        importance: 4,
        effort: 2,
        estimated_minutes: 15,
      }),
    ],
    "2026-05-17",
    { userPrefersShorterTasks: true, editedTasksDownCount: 2 },
  );

  assert.equal(ranked[0].id, 2);
  assert.match(ranked[0].rank_reason ?? "", /shorter-action/);
});

test("immediate plan tasks outrank same-situation follow-up and supporting tasks", () => {
  const ranked = rankTasks(
    [
      task({
        id: 1,
        title: "Optional research list",
        source_next_move_plan_id: 10,
        source_plan_section: "supporting",
        situation_id: 7,
        situation_title: "Job search",
        situation_urgency: "high",
        importance: 4,
        effort: 2,
        created_at: "2026-05-17T03:00:00.000Z",
      }),
      task({
        id: 2,
        title: "Send the tailored proof asset",
        source_next_move_plan_id: 10,
        source_plan_section: "immediate_next_action",
        situation_id: 7,
        situation_title: "Job search",
        situation_urgency: "high",
        importance: 4,
        effort: 2,
        created_at: "2026-05-17T01:00:00.000Z",
      }),
      task({
        id: 3,
        title: "Follow up tomorrow",
        source_next_move_plan_id: 10,
        source_plan_section: "follow_up",
        situation_id: 7,
        situation_title: "Job search",
        situation_urgency: "high",
        importance: 4,
        effort: 2,
        created_at: "2026-05-17T02:00:00.000Z",
      }),
    ],
    "2026-05-17",
  );

  assert.deepEqual(
    ranked.map((item) => item.id),
    [2, 3, 1],
  );
});

test("outcome context lowers tasks from ignored plans", () => {
  const ranked = rankTasks(
    [
      task({
        id: 1,
        title: "Task from ignored plan",
        importance: 5,
        effort: 1,
        source_next_move_plan_id: 22,
      }),
      task({
        id: 2,
        title: "Fresh task",
        importance: 5,
        effort: 1,
      }),
    ],
    "2026-05-17",
    { ignoredPlanIds: [22] },
  );

  assert.equal(ranked[0].id, 2);
});

test("active status order keeps blocked tasks behind actionable tasks", () => {
  const ranked = rankTasks(
    [
      task({ id: 1, title: "Completed", status: "done", importance: 5 }),
      task({ id: 2, title: "Blocked", status: "blocked", importance: 5 }),
      task({ id: 3, title: "Not started", status: "open", importance: 3 }),
      task({ id: 4, title: "In progress", status: "in_progress", importance: 2 }),
      task({ id: 5, title: "No longer relevant", status: "ignored", importance: 5 }),
    ],
    "2026-05-17",
  );

  assert.deepEqual(
    ranked.map((item) => item.id),
    [4, 3, 2, 5, 1],
  );
});

test("blocked friction falls behind actionable work unless it is the unblocker", () => {
  const rankedWithoutUnblocker = rankTasks(
    [
      task({
        id: 1,
        title: "Waiting on bank callback",
        situation_title: "Money stability",
        situation_urgency: "high",
        importance: 5,
        effort: 1,
        friction_type: "blocked",
        friction_note: "Blocked by another person.",
      }),
      task({
        id: 2,
        title: "Prepare the account questions",
        situation_title: "Money stability",
        situation_urgency: "high",
        importance: 4,
        effort: 2,
      }),
    ],
    "2026-05-17",
  );

  assert.equal(rankedWithoutUnblocker[0].id, 2);

  const rankedWithUnblocker = rankTasks(
    [
      task({
        id: 1,
        title: "Unblock bank access",
        situation_title: "Money stability",
        situation_urgency: "high",
        importance: 4,
        effort: 1,
        friction_type: "blocked",
        friction_note: "Needed before the account cleanup can move.",
      }),
      task({
        id: 2,
        title: "Prepare the account questions",
        situation_title: "Money stability",
        situation_urgency: "high",
        importance: 4,
        effort: 2,
      }),
    ],
    "2026-05-17",
  );

  assert.equal(rankedWithUnblocker[0].id, 1);
  assert.match(rankedWithUnblocker[0].rank_reason ?? "", /unblocks progress/);
});

test("deadline and unblocker signals can lift a task above creation order", () => {
  const ranked = rankTasks(
    [
      task({
        id: 1,
        title: "Nice-to-have cleanup",
        importance: 4,
        effort: 2,
        created_at: "2026-05-17T01:00:00.000Z",
      }),
      task({
        id: 2,
        title: "Unblock application deadline",
        importance: 4,
        effort: 2,
        due_date: "2026-05-18",
        notes: "Needed before the next application can move.",
        created_at: "2026-05-16T01:00:00.000Z",
      }),
    ],
    "2026-05-17",
  );

  assert.equal(ranked[0].id, 2);
  assert.match(ranked[0].rank_reason ?? "", /deadline soon/);
});

test("lower-urgency deadlines and unblockers can surface above later high-urgency tasks", () => {
  const ranked = rankTasks(
    [
      task({
        id: 1,
        title: "Review a later career idea",
        situation_title: "Career",
        situation_urgency: "high",
        importance: 4,
        effort: 2,
      }),
      task({
        id: 2,
        title: "Unblock overdue rent paperwork",
        situation_title: "Money stability",
        situation_urgency: "low",
        importance: 4,
        effort: 2,
        due_date: "2026-05-18",
        notes: "Needed before the rent assistance deadline can move.",
      }),
    ],
    "2026-05-17",
  );

  assert.equal(ranked[0].id, 2);
  assert.match(ranked[0].rank_reason ?? "", /deadline soon/);
});

test("stability risk language improves rank without hard-coding a category hierarchy", () => {
  const stabilityRanked = rankTasks(
    [
      task({
        id: 1,
        title: "Choose a gym playlist",
        situation_title: "Fitness",
        situation_urgency: "medium",
        importance: 3,
        effort: 2,
      }),
      task({
        id: 2,
        title: "Call utility about overdue bill risk",
        situation_title: "Money stability",
        situation_urgency: "medium",
        importance: 3,
        effort: 2,
      }),
    ],
    "2026-05-17",
  );

  assert.equal(stabilityRanked[0].id, 2);
  assert.match(stabilityRanked[0].rank_reason ?? "", /stability or risk signal/);

  const healthRanked = rankTasks(
    [
      task({
        id: 1,
        title: "Review budget categories",
        situation_title: "Money stability",
        situation_urgency: "medium",
        importance: 3,
        effort: 2,
      }),
      task({
        id: 2,
        title: "Schedule medical appointment before deadline",
        situation_title: "Health",
        situation_urgency: "medium",
        importance: 4,
        effort: 2,
        due_date: "2026-05-18",
      }),
    ],
    "2026-05-17",
  );

  assert.equal(healthRanked[0].id, 2);
});

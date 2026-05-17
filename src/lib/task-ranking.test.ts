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

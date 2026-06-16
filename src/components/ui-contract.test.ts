import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("Today no longer renders the daily check-in workflow", () => {
  const source = readSource("src/components/today-dashboard.tsx");

  assert.doesNotMatch(source, /Daily Check-In/);
  assert.doesNotMatch(source, /Save Check-In/);
  assert.match(source, /Your next move/);
  assert.match(source, /Do this next/);
  assert.match(source, /Task Queue/);
  assert.doesNotMatch(source, /Recent Next Move plan/);
});

test("primary navigation is simplified and secondary destinations are demoted", () => {
  const source = readSource("src/components/app-shell.tsx");

  assert.match(source, /label: "Today"/);
  assert.match(source, /label: "Situations"/);
  assert.match(source, /label: "Tasks"/);
  assert.match(source, /label: "Memory"/);
  assert.doesNotMatch(source, /label: "Find My Next Move"/);
  assert.doesNotMatch(source, /Memory \/ Profile/);
  assert.match(source, /secondaryLinks/);
});

test("Memory is card-first and manual editing is secondary", () => {
  const source = readSource("src/components/profile-editor.tsx");

  assert.match(source, /What FlowPath knows/);
  assert.match(source, /Proposed Memory/);
  assert.match(source, /Saved Memory/);
  assert.match(source, /Situation Notes/);
  assert.match(source, /placeholders, not saved memory/);
});

test("New Situation uses a guided stepper and broad categories", () => {
  const source = readSource("src/components/next-move-flow.tsx");

  assert.match(source, /Category/);
  assert.match(source, /Description/);
  assert.match(source, /Intake/);
  assert.match(source, /Plan/);
  assert.match(source, /Work \/ Career/);
  assert.match(source, /Money \/ Stability/);
  assert.match(source, /Relationships \/ Connection/);
  assert.match(source, /Something Else/);
  assert.doesNotMatch(source, /I want sexual connection safely and respectfully/);
});

test("New Situation shows saved plan state instead of quota CTA after generation", () => {
  const source = readSource("src/components/next-move-flow.tsx");

  assert.match(source, /Plan generated/);
  assert.match(source, /Your Next Move Plan is saved and ranked tasks are ready below/);
  assert.match(source, /!detail\.latestPlan/);
  assert.doesNotMatch(source, /Generate updated plan/);
});

test("Task feedback gives deterministic confirmation copy", () => {
  const source = readSource("src/components/tasks-manager.tsx");

  assert.match(source, /Marked complete: it is out of the active queue/);
  assert.match(source, /blocked friction, not a failure/);
  assert.match(source, /ignored plan suggestions as lower priority/);
  assert.match(source, /Ask FlowPath to revise/);
  assert.match(source, /Talk to FlowPath about this task/);
  assert.doesNotMatch(source, /Need Help/);
  assert.doesNotMatch(source, /<Pencil/);
  assert.doesNotMatch(source, /Task feedback saved/);
});

test("Task revision uses the cheap revision model role", () => {
  const routeSource = readSource("src/app/api/tasks/[id]/revise/route.ts");
  const modelSource = readSource("src/lib/flowpath-ai.ts");

  assert.match(routeSource, /flow_type: "task_revision"/);
  assert.match(routeSource, /model_role: "revision_standard"/);
  assert.match(modelSource, /getModelForRole\(modelRole\)/);
  assert.match(modelSource, /flowpath_task_revision/);
});

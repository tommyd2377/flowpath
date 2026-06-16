import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("Today no longer renders the daily check-in workflow", () => {
  const source = readSource("src/components/today-dashboard.tsx");
  const copySource = readSource("src/lib/founder-wedge.ts");

  assert.doesNotMatch(source, /Daily Check-In/);
  assert.doesNotMatch(source, /Save Check-In/);
  assert.match(copySource, /Founder Next Move/);
  assert.match(source, /Do this next/);
  assert.match(source, /Ranked Startup Tasks/);
  assert.doesNotMatch(source, /Recent Next Move plan/);
});

test("primary navigation is simplified and secondary destinations are demoted", () => {
  const source = readSource("src/components/app-shell.tsx");

  assert.match(source, /label: "Today"/);
  assert.match(source, /label: "Startup Situations"/);
  assert.match(source, /label: "Ranked Startup Tasks"/);
  assert.match(source, /label: "Founder Memory"/);
  assert.doesNotMatch(source, /label: "Find My Next Move"/);
  assert.doesNotMatch(source, /Memory \/ Profile/);
  assert.match(source, /secondaryLinks/);
});

test("Memory is card-first and manual editing is secondary", () => {
  const source = readSource("src/components/profile-editor.tsx");

  assert.match(source, /title="Founder Memory"/);
  assert.match(source, /Proposed Founder Memory/);
  assert.match(source, /Saved Founder Memory/);
  assert.match(source, /Situation Notes/);
  assert.match(source, /placeholders, not saved memory/);
});

test("New Situation uses a guided stepper and founder categories", () => {
  const source = readSource("src/components/next-move-flow.tsx");
  const copySource = readSource("src/lib/founder-wedge.ts");

  assert.match(source, /Bottleneck/);
  assert.match(source, /Context/);
  assert.match(source, /Intake/);
  assert.match(source, /Next move/);
  assert.match(copySource, /First Customers/);
  assert.match(copySource, /Positioning \/ Wedge/);
  assert.match(copySource, /Cofounder \/ Collaborator Search/);
  assert.match(copySource, /Other Startup Bottleneck/);
  assert.doesNotMatch(source, /Work \/ Career/);
  assert.doesNotMatch(source, /I want sexual connection safely and respectfully/);
});

test("New Situation shows saved plan state instead of quota CTA after generation", () => {
  const source = readSource("src/components/next-move-flow.tsx");

  assert.match(source, /Plan generated/);
  assert.match(source, /Your Founder Next Move Plan is saved and ranked startup tasks are ready below/);
  assert.match(source, /!detail\.latestPlan/);
  assert.doesNotMatch(source, /Generate updated plan/);
});

test("Task feedback gives deterministic confirmation copy", () => {
  const source = readSource("src/components/tasks-manager.tsx");

  assert.match(source, /Marked complete: it is out of the active startup queue/);
  assert.match(source, /blocked friction, not a failure/);
  assert.match(source, /ignored plan suggestions as lower priority/);
  assert.match(source, /Ask FlowPath to revise/);
  assert.match(source, /Report outcome or revise this task/);
  assert.doesNotMatch(source, /Need Help/);
  assert.doesNotMatch(source, /<Pencil/);
  assert.doesNotMatch(source, /Task feedback saved/);
});

test("Streamdown wrapper centralizes AI markdown rendering", () => {
  const source = readSource("src/components/flowpath-markdown.tsx");

  assert.match(source, /Streamdown/);
  assert.match(source, /createMermaidPlugin/);
  assert.match(source, /linkSafety/);
  assert.match(source, /caret/);
  assert.match(source, /isSafeHref/);
});

test("Task revision uses the cheap revision model role", () => {
  const routeSource = readSource("src/app/api/tasks/[id]/revise/route.ts");
  const modelSource = readSource("src/lib/flowpath-ai.ts");

  assert.match(routeSource, /flow_type: "task_revision"/);
  assert.match(routeSource, /model_role: "revision_standard"/);
  assert.match(modelSource, /getModelForRole\(modelRole\)/);
  assert.match(modelSource, /flowpath_task_revision/);
});

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
  assert.match(source, /What are you trying to figure out\?/);
  assert.match(source, /ENTRY_DOMAINS/);
  assert.match(source, /Do this next/);
  assert.match(source, /Task Queue/);
  assert.match(source, /hasStarted/);
  assert.match(source, /Active Boards/);
  assert.doesNotMatch(source, /Active Situations/);
  assert.doesNotMatch(source, /Recent Next Move plan/);
});

test("primary navigation is simplified and secondary destinations are demoted", () => {
  const source = readSource("src/components/app-shell.tsx");

  assert.match(source, /label: "Today"/);
  assert.match(source, /label: "Boards"/);
  assert.match(source, /label: "Tasks"/);
  assert.match(source, /label: "Memory"/);
  assert.doesNotMatch(source, /label: "Situations"/);
  assert.doesNotMatch(source, /label: "Find My Next Move"/);
  assert.doesNotMatch(source, /Memory \/ Profile/);
  assert.doesNotMatch(source, /label: "Billing"/);
  assert.doesNotMatch(source, /Presented by Thomas DeVito/);
  assert.match(source, /secondaryLinks/);
});

test("Memory is one bank with conversational correction", () => {
  const source = readSource("src/components/profile-editor.tsx");

  assert.match(source, /What FlowPath Knows/);
  assert.match(source, /one coherent memory/i);
  assert.match(source, /Tell FlowPath what is wrong, outdated, missing, or no longer true/);
  assert.match(source, /Keep/);
  assert.match(source, /This is wrong/);
  assert.match(source, /Forget/);
  assert.doesNotMatch(source, /Proposed Memory/);
  assert.doesNotMatch(source, /Saved Memory/);
  assert.doesNotMatch(source, /Situation Notes/);
  assert.doesNotMatch(source, /Manual profile notes/);
  assert.doesNotMatch(source, /Edit broad constraints/);
});

test("New board uses selected-domain intake without manual title or urgency", () => {
  const source = readSource("src/components/next-move-flow.tsx");

  assert.match(source, /Domain/);
  assert.match(source, /Current position/);
  assert.match(source, /Interview/);
  assert.match(source, /Move Map/);
  assert.match(source, /What are you trying to figure out\?/);
  assert.match(source, /ENTRY_DOMAINS/);
  assert.match(source, /domainFirstQuestions/);
  assert.match(source, /domainFirstAnswerPlaceholders/);
  assert.match(source, /Change domain/);
  assert.match(source, /SelectedDomainForm/);
  assert.doesNotMatch(source, /Optional short title/);
  assert.doesNotMatch(source, /Optional urgency/);
  assert.doesNotMatch(source, /SITUATION_TITLE_MAX/);
  assert.doesNotMatch(source, /Something Else/);
  assert.doesNotMatch(source, /Next Move limit reached/);
  assert.doesNotMatch(source, /I want sexual connection safely and respectfully/);
});

test("New board opens the board detail Move Map after generation", () => {
  const source = readSource("src/components/next-move-flow.tsx");

  assert.match(source, /openBoardMoveMap/);
  assert.match(source, /Board ready\. Opening the Move Map/);
  assert.match(source, /Open Move Map/);
  assert.match(source, /Move Map ready/);
  assert.match(source, /Generate Move Map/);
  assert.doesNotMatch(source, /NextMovePlanCard/);
  assert.doesNotMatch(source, /RelatedTasksCard/);
  assert.doesNotMatch(source, /Your best move is saved and ranked tasks are ready below/);
  assert.doesNotMatch(source, /Generate updated plan/);
});

test("Board API routes use the Board adapter boundary", () => {
  const collectionRoute = readSource("src/app/api/boards/route.ts");
  const detailRoute = readSource("src/app/api/boards/[id]/route.ts");
  const adapter = readSource("src/lib/boards.ts");

  assert.match(collectionRoute, /from "@\/lib\/boards"/);
  assert.match(detailRoute, /from "@\/lib\/boards"/);
  assert.match(adapter, /export type Board = Situation/);
  assert.match(adapter, /getBoardDetail/);
  assert.match(adapter, /situation: board/);
  assert.doesNotMatch(collectionRoute, /createSituation as createBoard/);
  assert.doesNotMatch(detailRoute, /getSituation as getBoard/);
});

test("Board detail supports conversational board updates", () => {
  const source = readSource("src/components/board-detail-view.tsx");

  assert.match(source, /Tell FlowPath what changed/);
  assert.match(source, /board-update/);
  assert.match(source, /Update and recalculate/);
  assert.match(source, /BoardSnapshot/);
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

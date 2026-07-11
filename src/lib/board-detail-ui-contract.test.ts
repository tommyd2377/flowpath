import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const detailPath = path.resolve(
  process.cwd(),
  "src/components/board-detail-view.tsx",
);
const treePath = path.resolve(process.cwd(), "src/components/decision-tree-map.tsx");

test("board detail keeps the tree-first contract", () => {
  const source = fs.readFileSync(detailPath, "utf8");
  const updateIndex = source.indexOf("Tell FlowPath what changed");
  const treeIndex = source.indexOf("<DecisionTreeMap");
  const drawerIndex = source.indexOf("<BoardDetailsDrawer");
  const drawerBodyIndex = source.indexOf("function BoardDetailsDrawer");

  assert.ok(updateIndex > -1);
  assert.ok(treeIndex > -1);
  assert.ok(updateIndex < treeIndex);
  assert.ok(drawerIndex > treeIndex);
  assert.ok(drawerBodyIndex > drawerIndex);
  assert.equal(source.includes("RecommendedMoveCard"), false);
  assert.equal(source.includes("SituationTaskQueue"), false);
  assert.equal(source.includes("<CurrentNextAction"), false);
  assert.equal(source.includes("data-testid=\"CurrentNextAction\""), false);
  assert.equal(source.includes("<CollapsibleSection"), false);
  assert.match(source, /boardDisplayTitle/);
  assert.match(source, /boardMeta=/);
  assert.match(source, /BoardDetailsDrawer/);
  assert.match(source, /Board actions/);
  assert.doesNotMatch(source, /Update map/);
  assert.doesNotMatch(source, /Generate map/);
  assert.match(source, /Plan Details/);
  assert.match(source, /Reasoning Details/);
  assert.equal(source.includes("Related task queue"), false);
  assert.equal(source.includes("Operator Analysis"), false);
  assert.equal(source.includes("Full Plan"), false);
});

test("move map exposes visual tree nodes, embedded action controls, and search status", () => {
  const source = fs.readFileSync(treePath, "utf8");

  assert.match(source, /data-testid="MoveMap"/);
  assert.match(source, /boardTitle/);
  assert.match(source, /boardMeta/);
  assert.match(source, /lg:flex-row/);
  assert.match(source, /HorizontalConnector/);
  assert.match(source, /DiagramNode/);
  assert.match(source, /BranchPath/);
  assert.match(source, /Next action/);
  assert.match(source, /First action:/);
  assert.match(source, /Success:/);
  assert.match(source, /If blocked:/);
  assert.match(source, /Continue this path/);
  assert.match(source, /Choose this path/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /DecisionNodeView/);
  assert.match(source, /Alternate path/);
  assert.match(source, /Check before continuing/);
  assert.match(source, /Return to recommended path/);
  assert.match(source, /I&amp;apos;m blocked|I&apos;m blocked/);
  assert.match(source, /Change this/);
  assert.match(source, /Open tasks/);
  assert.match(source, /Search used/);
  assert.match(source, /Local\/current options are not verified/);
  assert.doesNotMatch(source, /Root decision/);
  assert.doesNotMatch(source, /Available paths/);
  assert.doesNotMatch(source, /Next fork/);
  assert.doesNotMatch(source, /Frontier \/ Next action/);
  assert.equal(source.includes("node.question"), false);
  assert.equal(source.includes("Selected node"), false);
  assert.equal(source.includes("Start"), false);
});

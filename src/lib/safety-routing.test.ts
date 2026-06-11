import assert from "node:assert/strict";
import test from "node:test";

import { buildSafetyRoutedPlan, safetyRouteFromText } from "./safety-routing";

test("safety router detects high-confidence self-harm and builds a valid safety plan", () => {
  const decision = safetyRouteFromText({
    text: "I can't stay safe tonight and I am thinking about ending my life.",
  });

  assert.equal(decision.triggered, true);
  assert.equal(decision.confidence, "high");
  assert.equal(decision.routeType, "self_harm_or_suicide");
  assert.equal(decision.planBehavior, "human_help_only");

  const plan = buildSafetyRoutedPlan(
    {
      title: "I can't stay safe tonight",
      description: "",
      category: "health_recovery",
      urgency: "crisis",
    },
    decision,
  );
  assert.equal(plan.mode, "crisis_triage");
  assert.equal(plan.task_candidates.length, 1);
  assert.match(plan.safety_boundary.urgent_support_guidance, /988|emergency/i);
});

test("safety router flags medium-risk housing situations without forcing human-only", () => {
  const decision = safetyRouteFromText({
    text: "I got an eviction notice and I am worried about housing.",
  });

  assert.equal(decision.triggered, true);
  assert.equal(decision.confidence, "medium");
  assert.equal(decision.routeType, "housing_or_physical_safety_emergency");
  assert.equal(decision.planBehavior, "safety_boundary");
});

test("safety router leaves ordinary planning alone", () => {
  const decision = safetyRouteFromText({
    text: "I need to pick the next step for my portfolio project.",
  });

  assert.equal(decision.triggered, false);
  assert.equal(decision.planBehavior, "normal");
});

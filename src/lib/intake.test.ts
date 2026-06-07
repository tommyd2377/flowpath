import assert from "node:assert/strict";
import test from "node:test";

import { buildIntakeRoutingMetadata, classifySituationDomain } from "./intake";
import { interviewerOutputSchema } from "./schemas";

test("intake routing metadata is classification-only and does not create question text", () => {
  const metadata = buildIntakeRoutingMetadata({
    title: "I need to onboard friend groups to try my screen-time app together.",
    description:
      "One-on-one Reddit outreach is not working, and I need a group onboarding path.",
    category: "creative_project",
    urgency: "medium",
  });

  assert.deepEqual(metadata, {
    domain: "founder_product_validation",
    subtype: "founder_product_validation",
    questionPurpose: "clarify_goal",
  });
  assert.equal("question" in metadata, false);
});

test("crisis language routes to safety metadata before ordinary planning", () => {
  const route = classifySituationDomain({
    title: "I want to not be alive anymore",
    description: "I feel ashamed and stuck.",
    category: "relationships_connection",
    urgency: "medium",
  });
  const metadata = buildIntakeRoutingMetadata({
    title: "I want to not be alive anymore",
    description: "I feel ashamed and stuck.",
    category: "relationships_connection",
    urgency: "medium",
  });

  assert.equal(route.domain, "crisis_safety");
  assert.equal(metadata.questionPurpose, "clarify_risk_or_safety");
});

test("follow-up interviewer schema remains structured for model-generated turns", () => {
  const parsed = interviewerOutputSchema.parse({
    question: "What constraint matters most?",
    current_stage: "understanding_constraints",
    is_complete: false,
    summary_so_far: "The user is deciding what to do next.",
    recommended_urgency: null,
    recommended_mode: null,
    inferred_context_items: [],
  });

  assert.equal(parsed.question, "What constraint matters most?");
});

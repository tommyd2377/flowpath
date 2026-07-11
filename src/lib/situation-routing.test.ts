import assert from "node:assert/strict";
import test from "node:test";

import { comparativeScenarioFixtures } from "./scenario-fixtures";
import { classifySituationDomain } from "./situation-routing";

test("comparative scenario fixtures route to expected domains", () => {
  for (const fixture of comparativeScenarioFixtures) {
    const route = classifySituationDomain({
      title: fixture.name,
      description: fixture.text,
      category: "custom",
      urgency: "medium",
    });

    assert.equal(route.domain, fixture.expectedDomain, fixture.name);
  }
});

test("open loops fixture routes to open-loop prioritization, not money", () => {
  const fixture = comparativeScenarioFixtures.find((item) => item.id === 7);
  assert.ok(fixture);

  const route = classifySituationDomain({
    title: fixture.name,
    description: fixture.text,
    category: "overwhelm",
    urgency: "medium",
  });

  assert.equal(route.domain, "open_loops_prioritization");
});

test("money and housing fixtures use domain-specific routes", () => {
  const money = comparativeScenarioFixtures.find((item) => item.id === 3);
  const housing = comparativeScenarioFixtures.find((item) => item.id === 6);
  assert.ok(money);
  assert.ok(housing);

  assert.equal(
    classifySituationDomain({
      title: money.name,
      description: money.text,
      category: "money_stability",
      urgency: "medium",
    }).domain,
    "work_money_career",
  );
  assert.equal(
    classifySituationDomain({
      title: housing.name,
      description: housing.text,
      category: "housing",
      urgency: "medium",
    }).domain,
    "urgent_stability",
  );
});

test("self-harm-adjacent language routes to crisis safety", () => {
  const result = classifySituationDomain({
    title: "I want to not be alive anymore",
    description: "",
    category: "relationships_connection",
    urgency: "medium",
  });

  assert.equal(result.domain, "crisis_safety");
});

test("broad operations language routes to work and opportunity strategy", () => {
  const result = classifySituationDomain({
    title: "I manage a restaurant and want to move into operations.",
    description: "I am comparing logistics, vendor management, and training roles.",
    category: "creative_project",
    urgency: "medium",
  });

  assert.equal(result.domain, "work_money_career");
});

test("urgent and crisis routing override the selected entry domain", () => {
  assert.equal(
    classifySituationDomain({
      title: "Court filing deadline",
      description: "Court paperwork is due in two days.",
      category: "work_money_career",
      urgency: "high",
    }).domain,
    "urgent_stability",
  );
  assert.equal(
    classifySituationDomain({
      title: "Immediate safety risk",
      description: "I cannot stay safe right now.",
      category: "people_community_belonging",
      urgency: "crisis",
    }).domain,
    "crisis_safety",
  );
});

test("fitness training remains craft rather than career", () => {
  const result = classifySituationDomain({
    title: "Improve my fitness training",
    description: "I want better swimming technique and a repeatable practice.",
    category: "custom",
    urgency: "medium",
  });

  assert.equal(result.domain, "craft_creativity_mastery");
});

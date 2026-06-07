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
    "money_career_stabilization",
  );
  assert.equal(
    classifySituationDomain({
      title: housing.name,
      description: housing.text,
      category: "housing",
      urgency: "medium",
    }).domain,
    "housing_high_stakes",
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

test("product onboarding language routes to founder/product validation", () => {
  const result = classifySituationDomain({
    title: "I built an app and need friend groups to try it out.",
    description: "Reddit one-on-one outreach is not working for onboarding.",
    category: "creative_project",
    urgency: "medium",
  });

  assert.equal(result.domain, "founder_product_validation");
});

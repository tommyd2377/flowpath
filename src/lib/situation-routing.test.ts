import assert from "node:assert/strict";
import test from "node:test";

import { comparativeScenarioFixtures } from "./scenario-fixtures";
import {
  buildFirstIntakePlan,
  buildDomainAppropriateFirstQuestion,
  classifySituationDomain,
} from "./situation-routing";

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

test("open loops fixture does not trigger a money-specific first question", () => {
  const fixture = comparativeScenarioFixtures.find((item) => item.id === 7);
  assert.ok(fixture);

  const question = buildDomainAppropriateFirstQuestion({
    title: fixture.name,
    description: fixture.text,
    category: "overwhelm",
    urgency: "medium",
  });

  assert.doesNotMatch(question, /money situation/i);
  assert.match(question, /pressure|avoiding|highest payoff|triaged first/i);
});

test("money and housing fixtures use domain-specific safe questions", () => {
  const money = comparativeScenarioFixtures.find((item) => item.id === 3);
  const housing = comparativeScenarioFixtures.find((item) => item.id === 6);
  assert.ok(money);
  assert.ok(housing);

  assert.match(
    buildDomainAppropriateFirstQuestion({
      title: money.name,
      description: money.text,
      category: "money_stability",
      urgency: "medium",
    }),
    /financial decision|amount|timeline|downside risk|budget choice/i,
  );
  assert.match(
    buildDomainAppropriateFirstQuestion({
      title: housing.name,
      description: housing.text,
      category: "housing",
      urgency: "medium",
    }),
    /rent or housing decision|timeline|document|landlord/i,
  );
});

test("first intake planner exposes subtype and genericity metadata", () => {
  const result = buildFirstIntakePlan({
    title: "I'm trying to decide if I should ask my doctor for a generic prescription for Propecia.",
    description: "",
    category: "health_recovery",
    urgency: "low",
  });

  assert.equal(result.domain, "health");
  assert.equal(result.subtype, "routine_medication_discussion");
  assert.equal(result.questionPurpose, "clarify_decision");
  assert.notEqual(result.genericityRisk, "high");
  assert.match(result.missingInfoTarget, /medication decision/i);
});

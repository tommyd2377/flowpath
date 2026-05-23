import assert from "node:assert/strict";
import test from "node:test";

import { comparativeScenarioFixtures } from "./scenario-fixtures";
import {
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
  assert.match(question, /simpler|protected|health, work, money, and relationships/i);
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
    /money, income, or runway/i,
  );
  assert.match(
    buildDomainAppropriateFirstQuestion({
      title: housing.name,
      description: housing.text,
      category: "housing",
      urgency: "medium",
    }),
    /housing deadline|risk level/i,
  );
});

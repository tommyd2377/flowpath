import assert from "node:assert/strict";
import test from "node:test";

import { buildFirstIntakeQuestion } from "./intake";

test("buildFirstIntakeQuestion uses the situation category without placeholder memory", () => {
  const question = buildFirstIntakeQuestion(
    {
      title: "I am trying to build a business",
      category: "business",
      urgency: "medium",
    },
  );

  assert.match(question, /product decision|business situation/);
  assert.doesNotMatch(question, /Paste durable context/);
});

test("buildFirstIntakeQuestion does not expose saved profile context", () => {
  const question = buildFirstIntakeQuestion(
    {
      title: "Get momentum on acting",
      category: "creative",
      urgency: "medium",
    },
  );

  assert.doesNotMatch(question, /Using your saved context/);
  assert.doesNotMatch(question, /training and rebuilding stamina/);
  assert.doesNotMatch(question, /acting reps, health, and steady income/);
  assert.match(question, /creative\/project situation|creative situation/);
});

test("buildFirstIntakeQuestion lets high urgency shape the first question", () => {
  const question = buildFirstIntakeQuestion(
    {
      title: "Apartment problem",
      category: "housing",
      urgency: "high",
    },
  );

  assert.match(question, /housing deadline|less risky or more under control/);
});

test("buildFirstIntakeQuestion does not expose saved structured constraints", () => {
  const question = buildFirstIntakeQuestion(
    {
      title: "Career move",
      category: "career",
      urgency: "medium",
    },
  );

  assert.doesNotMatch(question, /money pressure: tight/);
  assert.doesNotMatch(question, /runway: 1_to_3_months/);
  assert.match(question, /career or job-search situation|career situation/);
});

test("buildFirstIntakeQuestion asks a specific social connection question", () => {
  const question = buildFirstIntakeQuestion(
    {
      title: "I feel lonely and isolated",
      category: "social",
      urgency: "medium",
    },
  );

  assert.match(question, /Which feels closest right now/);
  assert.match(question, /not enough people in your life/);
  assert.match(question, /people around you but not enough closeness/);
});

test("buildFirstIntakeQuestion frames dating and sexual connection around consent and safety", () => {
  const question = buildFirstIntakeQuestion(
    {
      title: "I want sexual connection safely and respectfully",
      category: "sexual_connection",
      urgency: "medium",
    },
  );

  assert.match(question, /what kind of connection/i);
  assert.match(question, /consent, boundary, or safety constraints/i);
  assert.doesNotMatch(question, /sexual history/i);
});

test("buildFirstIntakeQuestion routes crisis and immediate danger copy", () => {
  assert.match(
    buildFirstIntakeQuestion(
      {
        title: "I feel suicidal and need crisis support",
        category: "social",
        urgency: "medium",
      },
    ),
    /call or text 988/i,
  );
  assert.match(
    buildFirstIntakeQuestion(
      {
        title: "Someone is in immediate danger",
        category: "social",
        urgency: "medium",
      },
    ),
    /call 911 or your local emergency number/i,
  );
});

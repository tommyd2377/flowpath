import assert from "node:assert/strict";
import test from "node:test";

import {
  entryDomainFromText,
  entryDomainTitle,
  inferBoardTitle,
  inferMemoryCategoryFromText,
  inferSecondaryDomainIds,
} from "./entry-domains";

test("specific activities use the same broad domain and title behavior", () => {
  const primary = "craft_creativity_mastery";
  const activities = ["tennis", "pickleball", "fencing"];
  const titleShapes = activities.map((activity) => {
    const text = `I want to start ${activity} and meet people nearby.`;
    assert.deepEqual(inferSecondaryDomainIds(primary, text), [
      "people_community_belonging",
    ]);
    assert.equal(entryDomainTitle(primary), "Craft, Creativity, or Personal Mastery");
    return inferBoardTitle(primary, text).replace(new RegExp(activity, "i"), "[activity]");
  });

  assert.equal(new Set(titleShapes).size, 1);
  assert.doesNotMatch(titleShapes[0], /use \[activity\] to build local community/i);
});

test("craft routing recognizes broad peer categories without a privileged hobby", () => {
  const signals = [
    "sport",
    "activity",
    "hobby",
    "practice",
    "class",
    "skill",
    "craft",
    "creative",
    "art",
    "music",
    "dance",
    "fitness",
    "training",
    "writing",
  ];

  for (const signal of signals) {
    assert.equal(entryDomainFromText(`I want to improve my ${signal}`), "craft_creativity_mastery");
    assert.equal(
      inferMemoryCategoryFromText(`My ${signal} matters to this board`),
      "creative_personal_project",
    );
  }
});

test("urgent stability titles stay broad and process-oriented", () => {
  const raw =
    "I have a court paperwork deadline in a few days and I'm overwhelmed. I need help figuring out the safest next move.";

  const title = inferBoardTitle("work_money_career", raw);

  assert.equal(title, "Court paperwork deadline triage");
  assert.doesNotMatch(title, /\bI\b|overwhelmed|\.\.\./i);
  assert.ok(title.length <= 64);
  assert.equal(
    inferBoardTitle("work_money_career", "I need to confirm a court filing deadline."),
    "Court paperwork deadline triage",
  );
  assert.equal(
    inferBoardTitle("work_money_career", "My legal paperwork is due soon."),
    "Legal paperwork deadline triage",
  );
  assert.equal(
    inferBoardTitle("work_money_career", "My power shutoff notice is due this week."),
    "Utility shutoff triage",
  );
  assert.equal(
    inferBoardTitle("work_money_career", "I need food access before I run out of groceries."),
    "Food access triage",
  );
});

test("repeatable-practice fallback is medium-neutral", () => {
  const titles = ["writing", "pottery", "music"].map((medium) =>
    inferBoardTitle(
      "craft_creativity_mastery",
      `I want to build a consistent ${medium} practice.`,
    ),
  );

  assert.deepEqual(titles, [
    "Build a repeatable practice",
    "Build a repeatable practice",
    "Build a repeatable practice",
  ]);
});

test("specific user wording is cleaned without a handwritten topic title", () => {
  assert.equal(
    inferBoardTitle(
      "craft_creativity_mastery",
      "I want to keep writing private and non-commercial for now.",
    ),
    "Keep writing private and non-commercial for now",
  );
});

test("title cleanup does not invent a location", () => {
  const withoutLocation = inferBoardTitle(
    "people_community_belonging",
    "I want to meet people after moving somewhere new.",
  );
  const withLocation = inferBoardTitle(
    "people_community_belonging",
    "I want to meet people after moving to Tacoma.",
  );

  assert.doesNotMatch(withoutLocation, /Tacoma|Brooklyn|Bed-Stuy/i);
  assert.match(withLocation, /Tacoma/);
});

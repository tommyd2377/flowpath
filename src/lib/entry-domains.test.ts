import assert from "node:assert/strict";
import test from "node:test";

import {
  entryDomainTitle,
  inferBoardTitle,
  inferSecondaryDomainIds,
} from "./entry-domains";

test("tennis overlap keeps craft primary and adds people as secondary", () => {
  const primary = "craft_creativity_mastery";
  const text = "I want to play tennis and meet people nearby.";

  assert.equal(inferBoardTitle(primary, text), "Use tennis to build local community");
  assert.deepEqual(inferSecondaryDomainIds(primary, text), [
    "people_community_belonging",
  ]);
  assert.equal(entryDomainTitle(primary), "Craft, Creativity, or Personal Mastery");
});

test("board title inference uses readable domain-specific titles", () => {
  assert.equal(
    inferBoardTitle(
      "work_money_career",
      "I need to choose between freelancing and job search.",
    ),
    "Choose between freelancing and job search",
  );
  assert.equal(
    inferBoardTitle(
      "people_community_belonging",
      "I moved to a new city and want to meet people.",
    ),
    "Meet people after moving to a new city",
  );
});

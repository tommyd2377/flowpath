import assert from "node:assert/strict";
import test from "node:test";

import {
  countWebSearchCalls,
  sanitizeGenerationError,
  webSearchDecisionReason,
} from "./generation-observability";

test("sanitized generation errors do not include raw private content", () => {
  const error = new Error(
    "Zod parse failed for user text: my bank account is 123456789 and I feel stuck",
  );
  const sanitized = sanitizeGenerationError(error);

  assert.equal(sanitized.errorCategory, "schema_parse_error");
  assert.equal(
    sanitized.errorMessageSanitized,
    "The generation response did not match the expected schema.",
  );
  assert.doesNotMatch(sanitized.errorMessageSanitized, /123456789|bank account|stuck/i);
});

test("web search decision reasons stay enum-shaped", () => {
  assert.equal(
    webSearchDecisionReason({
      should_use_web_search: true,
      reason: "Pricing changes.",
      triggers: ["pricing_or_recommendations"],
      blocked_by_policy: false,
    }),
    "pricing_or_recommendations",
  );

  assert.equal(
    webSearchDecisionReason(
      {
        should_use_web_search: false,
        reason: "Not available.",
        triggers: [],
        blocked_by_policy: false,
      },
      false,
    ),
    "unavailable_for_tier",
  );
});

test("web search call counter walks response objects without stringifying content", () => {
  const response = {
    output: [
      { type: "message", content: [{ text: "No search here." }] },
      { type: "web_search_call", action: { query: "current docs" } },
      {
        type: "tool_result",
        nested: [{ type: "web_search_call", action: { query: "pricing" } }],
      },
    ],
  };

  assert.equal(countWebSearchCalls(response), 2);
});

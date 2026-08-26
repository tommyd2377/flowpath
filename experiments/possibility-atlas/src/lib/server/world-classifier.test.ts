import assert from "node:assert/strict";
import test from "node:test";

import type { HeadlineItem } from "../contracts";
import type { WorldClassificationModelOutput } from "../world-contracts";
import { AtlasApiError } from "./http";
import { MockResponsesAdapter } from "./openai-test-fixtures";
import {
  classifyWorldHeadlinesWithOpenAI,
  createWorldClassificationRequest,
  materializeWorldClassification,
  WORLD_CLASSIFICATION_MODEL,
  WORLD_CLASSIFICATION_TIMEOUT_MS,
  worldFeedFingerprint,
} from "./world-classifier";

const ids = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
] as const;

function headline(index: number): HeadlineItem {
  return {
    id: `world-headline-${index}`,
    title: `World event reporting ${index}`,
    publisher: `Publisher ${index}`,
    publisherUrl: `https://publisher-${index}.example/`,
    googleNewsUrl: `https://news.google.com/rss/articles/world-${index}`,
    publishedAt: `2026-08-25T1${index}:00:00.000Z`,
  };
}

const headlines = [headline(1), headline(2), headline(3)];

function output(): WorldClassificationModelOutput {
  return {
    groups: [
      {
        existingEventId: null,
        canonicalTitle: "One consequential world event",
        summary: "Two current headlines describe one unresolved event.",
        dimensions: {
          impact: 3,
          branchability: 3,
          connectivity: 2,
          uncertainty: 2,
        },
        headlines: [
          { headlineId: headlines[0].id, role: "root" },
          { headlineId: headlines[1].id, role: "supporting" },
        ],
      },
    ],
    standaloneHeadlineIds: [headlines[2].id],
  };
}

test("world classification uses one strict tool-free Terra request", async () => {
  const adapter = new MockResponsesAdapter({
    status: "completed",
    output_parsed: output(),
    output: [],
  });
  let eventIndex = 0;
  const result = await classifyWorldHeadlinesWithOpenAI({
    installationId: "20000000-0000-4000-8000-000000000001",
    headlines,
    existingEvents: [],
    feedFingerprint: worldFeedFingerprint(headlines),
    scannedAt: "2026-08-25T16:00:00.000Z",
    adapter,
    createId: () => ids[eventIndex++],
  });

  assert.equal(adapter.calls.length, 1);
  const call = adapter.calls[0];
  assert.equal(call.request.model, WORLD_CLASSIFICATION_MODEL);
  assert.equal(call.request.store, false);
  assert.deepEqual(call.request.reasoning, { effort: "low" });
  assert.equal(Object.hasOwn(call.request, "tools"), false);
  assert.equal(Object.hasOwn(call.request, "tool_choice"), false);
  assert.equal(Object.hasOwn(call.request, "previous_response_id"), false);
  assert.equal(call.options.timeout, WORLD_CLASSIFICATION_TIMEOUT_MS);
  assert.equal(call.options.maxRetries, 0);
  const format = call.request.text.format as Record<string, unknown>;
  assert.equal(format.type, "json_schema");
  assert.equal(format.strict, true);
  assert.equal(result.groups[0]?.eventId, ids[0]);
  assert.equal(result.groups[0]?.headlines.length, 2);
});

test("request serializes only enumerated existing event IDs", () => {
  const request = createWorldClassificationRequest({
    installationId: "20000000-0000-4000-8000-000000000001",
    headlines,
    existingEvents: [],
  });
  const body = request.input[1]?.content ?? "";
  assert.match(body, /everyHeadlineExactlyOnce/);
  assert.match(body, /world-headline-1/);
  assert.doesNotMatch(body, /OPENAI_API_KEY/);
});

test("rejects incomplete, duplicate, unknown, and multi-root classification atomically", () => {
  const invalidCases: WorldClassificationModelOutput[] = [];

  const missing = output();
  missing.standaloneHeadlineIds = [];
  invalidCases.push(missing);

  const duplicate = output();
  duplicate.standaloneHeadlineIds = [headlines[1].id, headlines[2].id];
  invalidCases.push(duplicate);

  const unknown = output();
  unknown.standaloneHeadlineIds = ["unknown-headline", headlines[2].id];
  invalidCases.push(unknown);

  const multiRoot = output();
  multiRoot.groups[0]!.headlines[1]!.role = "root";
  invalidCases.push(multiRoot);

  for (const candidate of invalidCases) {
    assert.throws(
      () =>
        materializeWorldClassification({
          output: candidate,
          headlines,
          existingEvents: [],
          feedFingerprint: worldFeedFingerprint(headlines),
          scannedAt: "2026-08-25T16:00:00.000Z",
          model: WORLD_CLASSIFICATION_MODEL,
          createId: () => ids[0],
        }),
      (error: unknown) =>
        error instanceof AtlasApiError && error.code === "model_output_invalid",
    );
  }
});

test("rejects unknown and reused existing event IDs", () => {
  const candidate = output();
  candidate.groups[0]!.existingEventId = ids[0];
  assert.throws(
    () =>
      materializeWorldClassification({
        output: candidate,
        headlines,
        existingEvents: [],
        feedFingerprint: worldFeedFingerprint(headlines),
        scannedAt: "2026-08-25T16:00:00.000Z",
        model: WORLD_CLASSIFICATION_MODEL,
      }),
    /unknown or reused/i,
  );
});

test("refusal and incomplete output make no repair call", async () => {
  for (const response of [
    {
      status: "completed",
      output_parsed: output(),
      output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }],
    },
    {
      status: "incomplete",
      output_parsed: output(),
      output: [],
      incomplete_details: { reason: "max_output_tokens" },
    },
  ]) {
    const adapter = new MockResponsesAdapter(response);
    await assert.rejects(() =>
      classifyWorldHeadlinesWithOpenAI({
        installationId: "20000000-0000-4000-8000-000000000001",
        headlines,
        existingEvents: [],
        feedFingerprint: worldFeedFingerprint(headlines),
        scannedAt: "2026-08-25T16:00:00.000Z",
        adapter,
      }),
    );
    assert.equal(adapter.calls.length, 1);
  }
});

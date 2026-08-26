import assert from "node:assert/strict";
import test from "node:test";

import { RegisterAtlasRequestSchema } from "../contracts";
import { AtlasApiError, errorResponse, parseJsonRequest } from "./http";

test("typed errors preserve call consumption without exposing their cause", async () => {
  const response = errorResponse(
    new AtlasApiError({
      code: "model_incomplete",
      message: "The analysis service returned an incomplete result.",
      status: 502,
      retryable: true,
      callConsumed: true,
      cause: new Error("secret upstream payload"),
    }),
  );
  const body = (await response.json()) as {
    error: { code: string; message: string; callConsumed: boolean };
  };

  assert.equal(response.status, 502);
  assert.equal(body.error.code, "model_incomplete");
  assert.equal(body.error.callConsumed, true);
  assert.doesNotMatch(JSON.stringify(body), /secret upstream payload/i);
});

test("unexpected errors are sanitized as non-call-consuming internal errors", async () => {
  const response = errorResponse(new Error("database password and stack"));
  const body = (await response.json()) as {
    error: { code: string; message: string; callConsumed: boolean };
  };

  assert.equal(response.status, 500);
  assert.equal(body.error.code, "internal_error");
  assert.equal(body.error.callConsumed, false);
  assert.doesNotMatch(JSON.stringify(body), /password|stack/i);
});

test("registration can use its bounded larger body limit for a near-max graph", async () => {
  const graphId = "80000000-0000-4000-8000-000000000001";
  const ids = Array.from(
    { length: 64 },
    (_, index) =>
      `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  const nodes = Object.fromEntries(
    ids.map((id, index) => {
      const parentIndex = index < 3 ? -1 : Math.floor((index - 3) / 5);
      const depth =
        parentIndex < 0
          ? 1
          : Math.min(
              5,
              2 + Math.floor(Math.log(Math.max(1, parentIndex + 1)) / Math.log(5)),
            );
      const childIds = ids.slice(3 + index * 5, 3 + index * 5 + 5);
      return [
        id,
        {
          id,
          parentId: parentIndex < 0 ? graphId : ids[parentIndex],
          depth,
          title: `Possibility ${index}`,
          summary: "S".repeat(420),
          whyPlausible: "P".repeat(420),
          keyAssumption: "A".repeat(280),
          watchFor: ["W".repeat(180), "X".repeat(180), "Y".repeat(180)],
          lessLikelyIf: "L".repeat(280),
          horizon: "H".repeat(100),
          childIds,
          status: depth === 5 ? "leaf" : "ready",
          errorMessage: null,
          leafReason: depth === 5 ? "Maximum atlas depth reached." : null,
        },
      ];
    }),
  );
  const headline = {
    id: "headline-register-max",
    title: "A large saved atlas remains resumable",
    publisher: "Fixture News",
    publisherUrl: "https://fixture.example/",
    googleNewsUrl: "https://news.google.com/rss/articles/register-max",
    publishedAt: "2026-08-25T12:00:00.000Z",
  };
  const body = JSON.stringify({
    installationId: "10000000-0000-4000-8000-000000000001",
    expectedMode: "fixture",
    graph: {
      id: graphId,
      createdAt: "2026-08-25T12:00:00.000Z",
      updatedAt: "2026-08-25T12:00:00.000Z",
      headline,
      status: "ready",
      snapshot: {
        id: "70000000-0000-4000-8000-000000000001",
        headline,
        capturedAt: "2026-08-25T12:00:00.000Z",
        verificationStatus: "corroborated",
        summary: "Verified snapshot.",
        facts: [{ text: "Verified fact.", sourceIds: ["s01"] }],
        uncertainties: [],
        sources: [
          {
            id: "s01",
            title: "Fixture source",
            url: "https://fixture.example/source",
            domain: "fixture.example",
          },
        ],
      },
      nodes,
      rootChildIds: ids.slice(0, 3),
      focusedNodeId: ids[0],
      callsUsed: 10,
      errorMessage: null,
      insufficientReason: null,
      insufficientSummary: null,
      insufficientSources: [],
    },
  });
  assert.ok(new TextEncoder().encode(body).byteLength > 128 * 1024);
  assert.ok(new TextEncoder().encode(body).byteLength < 512 * 1024);

  const request = () =>
    new Request("http://localhost/api/atlas/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  await assert.rejects(
    () => parseJsonRequest(request(), RegisterAtlasRequestSchema),
    (error: unknown) =>
      error instanceof AtlasApiError && error.code === "request_too_large",
  );
  const parsed = await parseJsonRequest(
    request(),
    RegisterAtlasRequestSchema,
    { maxBytes: 512 * 1024 },
  );
  assert.equal(Object.keys(parsed.graph.nodes).length, 64);
});

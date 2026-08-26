import assert from "node:assert/strict";
import test from "node:test";

import type { HeadlinesResponse } from "./feed";
import { MockResponsesAdapter } from "./openai-test-fixtures";
import type {
  AtlasParsedResponse,
  AtlasRequestOptions,
  AtlasResponsesAdapter,
  AtlasResponsesRequest,
} from "./openai-client";
import { resetAtlasRequestGuardForTests } from "./request-guard";
import { createFixtureWorldClassification, WORLD_FIXTURE_HEADLINES } from "./world-fixtures";
import { refreshWorldCatalog, resetWorldRefreshForTests } from "./world-refresh";
import { createMemoryWorldRepository } from "./world-repository";

const installationId = "20000000-0000-4000-8000-000000000001";

function feed(): HeadlinesResponse {
  return {
    ok: true,
    items: WORLD_FIXTURE_HEADLINES,
    fetchedAt: "2026-08-25T16:00:00.000Z",
    feedUpdatedAt: "2026-08-25T16:00:00.000Z",
    stale: false,
    warning: null,
  };
}

test.beforeEach(() => {
  resetAtlasRequestGuardForTests();
  resetWorldRefreshForTests();
});

test("fixture refresh builds four events without a paid call and then cache-hits", async () => {
  const repository = createMemoryWorldRepository();
  const first = await refreshWorldCatalog({
    installationId,
    mode: "fixture",
    repository,
  });
  const second = await refreshWorldCatalog({
    installationId,
    mode: "fixture",
    repository,
  });
  assert.equal(first.events.length, 4);
  assert.deepEqual(first.meta, {
    mode: "fixture",
    callConsumed: false,
    cacheStatus: "miss",
  });
  assert.equal(second.meta.cacheStatus, "hit");
  assert.equal(second.meta.callConsumed, false);
});

test("unchanged live feed short-circuits before the adapter", async () => {
  const repository = createMemoryWorldRepository();
  await repository.commitClassification(createFixtureWorldClassification());
  const adapter = new MockResponsesAdapter({
    status: "completed",
    output_parsed: { groups: [], standaloneHeadlineIds: [] },
    output: [],
  });
  const result = await refreshWorldCatalog({
    installationId,
    mode: "live",
    repository,
    adapter,
    getHeadlines: async () => feed(),
  });
  assert.equal(result.meta.cacheStatus, "hit");
  assert.equal(result.meta.callConsumed, false);
  assert.equal(adapter.calls.length, 0);
});

test("coalesces a changed feed across installations and marks the follower as a cache hit", async () => {
  const repository = createMemoryWorldRepository();
  const fixtureCommit = createFixtureWorldClassification();
  const parsed = {
    groups: fixtureCommit.groups.map((group) => ({
      existingEventId: null,
      canonicalTitle: group.canonicalTitle,
      summary: group.summary,
      dimensions: group.dimensions,
      headlines: group.headlines.map((item) => ({
        headlineId: item.headline.id,
        role: item.role,
      })),
    })),
    standaloneHeadlineIds: fixtureCommit.standaloneHeadlineIds,
  };
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: Array<{
    request: AtlasResponsesRequest;
    options: AtlasRequestOptions;
  }> = [];
  const adapter: AtlasResponsesAdapter = {
    async parse<T>(request: AtlasResponsesRequest, options: AtlasRequestOptions) {
      calls.push({ request, options });
      await blocked;
      return {
        status: "completed",
        output_parsed: parsed,
        output: [],
      } as unknown as AtlasParsedResponse<T>;
    },
  };
  const options = {
    mode: "live" as const,
    repository,
    adapter,
    getHeadlines: async () => feed(),
    now: () => new Date("2026-08-25T16:00:00.000Z"),
  };
  const leader = refreshWorldCatalog({ installationId, ...options });
  while (calls.length === 0) await Promise.resolve();
  const follower = refreshWorldCatalog({
    installationId: "20000000-0000-4000-8000-000000000002",
    ...options,
  });
  release?.();
  const [leaderResult, followerResult] = await Promise.all([leader, follower]);

  assert.equal(calls.length, 1);
  assert.deepEqual(leaderResult.meta, {
    mode: "live",
    callConsumed: true,
    cacheStatus: "miss",
  });
  assert.deepEqual(followerResult.meta, {
    mode: "live",
    callConsumed: false,
    cacheStatus: "hit",
  });
});

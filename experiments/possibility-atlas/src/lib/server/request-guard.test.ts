import assert from "node:assert/strict";
import test from "node:test";

import { AtlasApiError } from "./http";
import {
  resetAtlasRequestGuardForTests,
  runWithAtlasRequestGuard,
} from "./request-guard";

test.beforeEach(() => resetAtlasRequestGuardForTests());

test("same-key requests share in-flight work while other work is rejected", async () => {
  let release!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    release = resolve;
  });
  const first = runWithAtlasRequestGuard({
    installationId: "install",
    key: "same",
    operation: () => pending,
  });
  const duplicate = runWithAtlasRequestGuard({
    installationId: "install",
    key: "same",
    operation: async () => "should not run",
  });

  await assert.rejects(
    () =>
      runWithAtlasRequestGuard({
        installationId: "install",
        key: "different",
        operation: async () => "no",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AtlasApiError);
      assert.equal(error.code, "analysis_in_progress");
      assert.equal(error.callConsumed, false);
      return true;
    },
  );

  release("done");
  assert.deepEqual(await first, { value: "done", deduplicated: false });
  assert.deepEqual(await duplicate, { value: "done", deduplicated: true });
});

test("completed results are briefly idempotent", async () => {
  let calls = 0;
  const first = await runWithAtlasRequestGuard({
    installationId: "install",
    key: "same",
    operation: async () => {
      calls += 1;
      return "done";
    },
  });
  const second = await runWithAtlasRequestGuard({
    installationId: "install",
    key: "same",
    operation: async () => {
      calls += 1;
      return "unexpected";
    },
  });

  assert.equal(calls, 1);
  assert.equal(first.deduplicated, false);
  assert.deepEqual(second, { value: "done", deduplicated: true });
});

test("the twenty-first unique request in an hour is rate limited", async () => {
  for (let index = 0; index < 20; index += 1) {
    await runWithAtlasRequestGuard({
      installationId: "install",
      key: `key-${index}`,
      operation: async () => index,
      now: () => 1_000,
    });
  }

  await assert.rejects(
    () =>
      runWithAtlasRequestGuard({
        installationId: "install",
        key: "key-20",
        operation: async () => 20,
        now: () => 1_000,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AtlasApiError);
      assert.equal(error.code, "rate_limit_exceeded");
      assert.equal(error.status, 429);
      assert.equal(error.callConsumed, false);
      return true;
    },
  );
});

test("the seventeenth live model request for one atlas is rejected", async () => {
  for (let index = 0; index < 16; index += 1) {
    await runWithAtlasRequestGuard({
      installationId: "atlas-limit-install",
      graphId: "atlas-a",
      consumesAtlasCall: true,
      key: `atlas-a-${index}`,
      operation: async () => ({ meta: { callConsumed: true } }),
      now: () => 2_000,
    });
  }

  await assert.rejects(
    () =>
      runWithAtlasRequestGuard({
        installationId: "atlas-limit-install",
        graphId: "atlas-a",
        consumesAtlasCall: true,
        key: "atlas-a-16",
        operation: async () => ({ meta: { callConsumed: true } }),
        now: () => 2_000,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AtlasApiError);
      assert.equal(error.code, "atlas_call_limit_reached");
      assert.equal(error.callConsumed, false);
      return true;
    },
  );

  const otherAtlas = await runWithAtlasRequestGuard({
    installationId: "atlas-limit-install",
    graphId: "atlas-b",
    consumesAtlasCall: true,
    key: "atlas-b-0",
    operation: async () => ({ meta: { callConsumed: true } }),
    now: () => 2_000,
  });
  assert.equal(otherAtlas.deduplicated, false);
});

test("requests that fail before a model call do not consume the atlas budget", async () => {
  await assert.rejects(() =>
    runWithAtlasRequestGuard({
      installationId: "preflight-install",
      graphId: "atlas-a",
      consumesAtlasCall: true,
      key: "preflight-failure",
      operation: async () => {
        throw new AtlasApiError({
          code: "analysis_misconfigured",
          message: "Not configured.",
          status: 503,
          retryable: false,
          callConsumed: false,
        });
      },
    }),
  );

  const result = await runWithAtlasRequestGuard({
    installationId: "preflight-install",
    graphId: "atlas-a",
    consumesAtlasCall: true,
    key: "first-real-call",
    operation: async () => ({ meta: { callConsumed: true } }),
  });
  assert.equal(result.deduplicated, false);
});

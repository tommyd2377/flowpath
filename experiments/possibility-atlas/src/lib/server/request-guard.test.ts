import assert from "node:assert/strict";
import test from "node:test";

import { AtlasApiError } from "./http";
import {
  atlasSafetyIdentifier,
  resetAtlasRequestGuardForTests,
  runWithAtlasRequestGuard,
  seedAtlasCallCount,
} from "./request-guard";
import { createMemoryWorldRepository } from "./world-repository";

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

test("the eleventh live model request for one atlas is rejected", async () => {
  for (let index = 0; index < 10; index += 1) {
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
        key: "atlas-a-10",
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

test("restored call counts seed monotonically and preserve the ten-call cap", async () => {
  seedAtlasCallCount({
    installationId: "restored-install",
    graphId: "restored-atlas",
    callsUsed: 8,
  });
  seedAtlasCallCount({
    installationId: "restored-install",
    graphId: "restored-atlas",
    callsUsed: 3,
  });

  for (let index = 8; index < 10; index += 1) {
    await runWithAtlasRequestGuard({
      installationId: "restored-install",
      graphId: "restored-atlas",
      consumesAtlasCall: true,
      key: `restored-${index}`,
      operation: async () => ({ meta: { callConsumed: true } }),
    });
  }
  await assert.rejects(
    () =>
      runWithAtlasRequestGuard({
        installationId: "restored-install",
        graphId: "restored-atlas",
        consumesAtlasCall: true,
        key: "restored-10",
        operation: async () => ({ meta: { callConsumed: true } }),
      }),
    (error: unknown) =>
      error instanceof AtlasApiError &&
      error.code === "atlas_call_limit_reached" &&
      /10-call/.test(error.message),
  );
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

test("the persistent ledger survives guard resets and ignores browser rollback", async () => {
  const repository = createMemoryWorldRepository();
  const installationId = "persistent-install";
  const graphId = "persistent-atlas";
  await repository.seedAtlasCallUsage({
    installationKey: atlasSafetyIdentifier(installationId),
    graphId,
    callsUsed: 9,
  });

  resetAtlasRequestGuardForTests();
  seedAtlasCallCount({ installationId, graphId, callsUsed: 1 });
  await runWithAtlasRequestGuard({
    installationId,
    graphId,
    consumesAtlasCall: true,
    atlasCallLedger: repository,
    key: "persistent-tenth",
    operation: async () => ({ meta: { callConsumed: true } }),
  });

  resetAtlasRequestGuardForTests();
  seedAtlasCallCount({ installationId, graphId, callsUsed: 0 });
  await assert.rejects(
    () =>
      runWithAtlasRequestGuard({
        installationId,
        graphId,
        consumesAtlasCall: true,
        atlasCallLedger: repository,
        key: "persistent-eleventh",
        operation: async () => ({ meta: { callConsumed: true } }),
      }),
    (error: unknown) =>
      error instanceof AtlasApiError &&
      error.code === "atlas_call_limit_reached",
  );
});

test("a persistent reservation rolls back only when no model call was consumed", async () => {
  const repository = createMemoryWorldRepository();
  const installationId = "rollback-install";
  const graphId = "rollback-atlas";
  await repository.seedAtlasCallUsage({
    installationKey: atlasSafetyIdentifier(installationId),
    graphId,
    callsUsed: 9,
  });

  await assert.rejects(() =>
    runWithAtlasRequestGuard({
      installationId,
      graphId,
      consumesAtlasCall: true,
      atlasCallLedger: repository,
      key: "pre-call-failure",
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

  const final = await runWithAtlasRequestGuard({
    installationId,
    graphId,
    consumesAtlasCall: true,
    atlasCallLedger: repository,
    key: "real-tenth-call",
    operation: async () => ({ meta: { callConsumed: true } }),
  });
  assert.equal(final.deduplicated, false);
});

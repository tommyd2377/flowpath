import assert from "node:assert/strict";
import test from "node:test";

import { runAtlasModelOperation } from "./atlas-model-operation";
import { resolveOptionalRawAtlasCallLedger } from "./optional-call-ledger-core";
import { resetAtlasRequestGuardForTests } from "./request-guard";

test.beforeEach(() => {
  resetAtlasRequestGuardForTests();
});

test("raw start and expansion reach their adapters when World DB initialization fails", async () => {
  const calls: string[] = [];
  let initializationAttempts = 0;
  const failingWorldRepository = {
    async initialize() {
      initializationAttempts += 1;
      throw new Error("World database unavailable");
    },
    async reserveAtlasCallUsage() {
      throw new Error("unreachable");
    },
    async releaseAtlasCallUsage() {
      throw new Error("unreachable");
    },
  };
  const adapter = {
    async parse(kind: "start" | "expand") {
      calls.push(kind);
      return { kind, meta: { callConsumed: true } };
    },
  };

  for (const [index, kind] of (["start", "expand"] as const).entries()) {
    const result = await runAtlasModelOperation({
      installationId: `10000000-0000-4000-8000-00000000000${index + 1}`,
      graphId: `20000000-0000-4000-8000-00000000000${index + 1}`,
      key: `raw-${kind}`,
      resolveCallLedger: () =>
        resolveOptionalRawAtlasCallLedger(() => failingWorldRepository),
      operation: () => adapter.parse(kind),
    });
    assert.equal(result.value.kind, kind);
    assert.equal(result.deduplicated, false);
  }

  assert.deepEqual(calls, ["start", "expand"]);
  assert.equal(initializationAttempts, 2);
});

test("a required World ledger failure stops work before the adapter", async () => {
  let adapterCalls = 0;
  const failingWorldRepository = {
    async initialize() {
      throw new Error("World database unavailable");
    },
    async reserveAtlasCallUsage() {
      throw new Error("unreachable");
    },
    async releaseAtlasCallUsage() {
      throw new Error("unreachable");
    },
  };
  await assert.rejects(
    runAtlasModelOperation({
      installationId: "10000000-0000-4000-8000-000000000003",
      graphId: "20000000-0000-4000-8000-000000000003",
      key: "world-start",
      resolveCallLedger: async () => {
        await failingWorldRepository.initialize();
        return failingWorldRepository;
      },
      operation: async () => {
        adapterCalls += 1;
        return { meta: { callConsumed: true } };
      },
    }),
    /World database unavailable/,
  );
  assert.equal(adapterCalls, 0);
});

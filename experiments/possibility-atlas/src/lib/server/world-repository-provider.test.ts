import assert from "node:assert/strict";
import test from "node:test";

import { AtlasApiError } from "./http";
import { createFixtureWorldClassification } from "./world-fixtures";
import { createMemoryWorldRepository } from "./world-repository";
import { createWorldRepositoryProvider } from "./world-repository-provider";

test("fixture and live catalogs use distinct replayable repositories", async () => {
  let persistentCreations = 0;
  let fixtureCreations = 0;
  const provider = createWorldRepositoryProvider({
    createPersistent() {
      persistentCreations += 1;
      return createMemoryWorldRepository();
    },
    createFixture() {
      fixtureCreations += 1;
      return createMemoryWorldRepository();
    },
  });
  const fixtureEnvironment = {
    NODE_ENV: "development",
    POSSIBILITY_ATLAS_FIXTURE_MODE: "1",
  } as NodeJS.ProcessEnv;
  const liveEnvironment = {
    NODE_ENV: "development",
    POSSIBILITY_ATLAS_FIXTURE_MODE: "0",
  } as NodeJS.ProcessEnv;

  const fixture = provider.get(fixtureEnvironment);
  await fixture.commitClassification(createFixtureWorldClassification());
  assert.equal((await fixture.getCatalogSnapshot()).events.length, 4);

  const persistent = provider.get(liveEnvironment);
  assert.notEqual(persistent, fixture);
  assert.equal((await persistent.getCatalogSnapshot()).events.length, 0);
  assert.equal(provider.get(fixtureEnvironment), fixture);
  assert.equal((await provider.get(fixtureEnvironment).getCatalogSnapshot()).events.length, 4);
  assert.equal(persistentCreations, 1);
  assert.equal(fixtureCreations, 1);
});

test("production cannot select the fixture repository", () => {
  const provider = createWorldRepositoryProvider({
    createPersistent: createMemoryWorldRepository,
    createFixture: createMemoryWorldRepository,
  });
  assert.throws(
    () =>
      provider.get({
        NODE_ENV: "production",
        POSSIBILITY_ATLAS_FIXTURE_MODE: "1",
      } as NodeJS.ProcessEnv),
    (error: unknown) =>
      error instanceof AtlasApiError && error.code === "fixture_mode_forbidden",
  );
});

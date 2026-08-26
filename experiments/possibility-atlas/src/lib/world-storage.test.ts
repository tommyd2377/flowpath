import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_WORLD_JOURNEY_TRANSITIONS,
  WORLD_STORAGE_KEY,
  appendWorldJourney,
  associateWorldAtlas,
  causalContextForJourney,
  clearWorldJourney,
  createWorldStorageEnvelope,
  isStaleCausalRegistrationError,
  loadWorldStorageEnvelope,
  pruneWorldStorage,
  recordCountedRippleAnalysis,
  removeWorldAtlas,
  replaceWorldAtlas,
  saveWorldStorageEnvelope,
  setWorldJourneyExplorationMode,
  shouldResumeWorldAtlasIndependently,
  type WorldJourneyTransition,
  type WorldStorageLike,
} from "./world-storage";

const NOW = "2026-08-26T14:00:00.000Z";

function uuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

class MemoryStorage implements WorldStorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

test("only stale causal registration failures can resume independently", () => {
  assert.equal(isStaleCausalRegistrationError("causal_context_stale"), true);
  assert.equal(isStaleCausalRegistrationError("world_causal_context_changed"), true);
  assert.equal(isStaleCausalRegistrationError("atlas_mode_mismatch"), false);
  assert.equal(isStaleCausalRegistrationError(null), false);
  assert.equal(
    shouldResumeWorldAtlasIndependently({
      previousMode: "causal",
      nextMode: "independent",
      registrationFailed: true,
      failureCode: "causal_context_stale",
    }),
    true,
  );
  assert.equal(
    shouldResumeWorldAtlasIndependently({
      previousMode: "causal",
      nextMode: "independent",
      registrationFailed: true,
      failureCode: "atlas_mode_mismatch",
    }),
    false,
  );
});

function transition(index: number): WorldJourneyTransition {
  return {
    sourceEventId: uuid(index),
    sourceEventTitle: `Source event ${index}`,
    sourceScenarioNodeId: uuid(100 + index),
    sourceScenarioTitle: `Scenario ${index}`,
    sourceScenarioSummary: `Scenario ${index} changes the immediate conditions.`,
    targetEventId: uuid(index + 1),
    targetEventTitle: `Target event ${index}`,
    influence: "raises_likelihood",
    mechanism: `Scenario ${index} changes a shared dependency.`,
  };
}

test("corrupt world storage is reset without affecting the atlas envelope", () => {
  const storage = new MemoryStorage();
  storage.setItem(WORLD_STORAGE_KEY, "{not-json");
  const loaded = loadWorldStorageEnvelope(storage, NOW);
  assert.match(loaded.warning ?? "", /unreadable/i);
  assert.deepEqual(loaded.envelope.graphAssociations, {});
});

test("associations and journeys survive a browser reload", () => {
  const storage = new MemoryStorage();
  let envelope = createWorldStorageEnvelope(NOW);
  envelope = associateWorldAtlas(envelope, {
    eventId: uuid(1),
    graphId: uuid(11),
    at: NOW,
  });
  envelope = appendWorldJourney(envelope, {
    sourceGraphId: uuid(10),
    targetGraphId: uuid(11),
    transition: transition(1),
    at: NOW,
  });
  saveWorldStorageEnvelope(storage, envelope);

  const restored = loadWorldStorageEnvelope(storage);
  assert.equal(restored.envelope.atlasByEvent[uuid(1)], uuid(11));
  assert.equal(restored.envelope.journeys[uuid(11)]?.transitions.length, 1);
  assert.equal(
    restored.envelope.journeys[uuid(11)]?.transitions[0]?.sourceGraphId,
    uuid(10),
  );
});

test("journey exploration mode is explicit, durable, and clearable", () => {
  let envelope = createWorldStorageEnvelope(NOW);
  envelope = appendWorldJourney(envelope, {
    sourceGraphId: uuid(10),
    targetGraphId: uuid(11),
    transition: transition(1),
    at: NOW,
  });
  assert.equal(envelope.journeys[uuid(11)]?.explorationMode, null);

  envelope = setWorldJourneyExplorationMode(
    envelope,
    uuid(11),
    "causal",
    new Date(Date.parse(NOW) + 1_000).toISOString(),
  );
  assert.equal(envelope.journeys[uuid(11)]?.explorationMode, "causal");
  assert.deepEqual(causalContextForJourney(envelope.journeys[uuid(11)] ?? null, uuid(2)), {
    sourceGraphId: uuid(10),
    sourceEventId: uuid(1),
    sourceEventTitle: "Source event 1",
    sourceScenarioNodeId: uuid(101),
    sourceScenarioTitle: "Scenario 1",
    sourceScenarioSummary: "Scenario 1 changes the immediate conditions.",
    targetEventId: uuid(2),
    targetEventTitle: "Target event 1",
    influence: "raises_likelihood",
    mechanism: "Scenario 1 changes a shared dependency.",
  });
  assert.equal(causalContextForJourney(envelope.journeys[uuid(11)] ?? null, uuid(3)), null);

  envelope = clearWorldJourney(
    envelope,
    uuid(11),
    new Date(Date.parse(NOW) + 2_000).toISOString(),
  );
  assert.equal(envelope.journeys[uuid(11)], undefined);
});

test("restart moves an event association and its journey to the new graph", () => {
  let envelope = createWorldStorageEnvelope(NOW);
  envelope = associateWorldAtlas(envelope, {
    eventId: uuid(2),
    graphId: uuid(20),
    at: NOW,
  });
  envelope = appendWorldJourney(envelope, {
    sourceGraphId: uuid(19),
    targetGraphId: uuid(20),
    transition: transition(1),
    at: NOW,
  });
  envelope = replaceWorldAtlas(envelope, {
    previousGraphId: uuid(20),
    nextGraphId: uuid(21),
    at: new Date(Date.parse(NOW) + 1_000).toISOString(),
  });

  assert.equal(envelope.graphAssociations[uuid(20)], undefined);
  assert.equal(envelope.atlasByEvent[uuid(2)], uuid(21));
  assert.equal(envelope.journeys[uuid(20)], undefined);
  assert.equal(envelope.journeys[uuid(21)]?.transitions.length, 1);
});

test("deleting and pruning atlases remove their additive world context", () => {
  let envelope = createWorldStorageEnvelope(NOW);
  envelope = associateWorldAtlas(envelope, { eventId: uuid(1), graphId: uuid(11), at: NOW });
  envelope = associateWorldAtlas(envelope, { eventId: uuid(2), graphId: uuid(12), at: NOW });
  envelope = removeWorldAtlas(envelope, uuid(11), NOW);
  assert.equal(envelope.atlasByEvent[uuid(1)], undefined);

  envelope = pruneWorldStorage(envelope, [], NOW);
  assert.deepEqual(envelope.graphAssociations, {});
  assert.deepEqual(envelope.atlasByEvent, {});
});

test("journeys retain only the six most recent event transitions", () => {
  let envelope = createWorldStorageEnvelope(NOW);
  for (let index = 1; index <= 8; index += 1) {
    envelope = appendWorldJourney(envelope, {
      sourceGraphId: index === 1 ? uuid(50) : uuid(50 + index - 1),
      targetGraphId: uuid(50 + index),
      transition: transition(index),
      at: new Date(Date.parse(NOW) + index * 1_000).toISOString(),
    });
  }
  const finalJourney = envelope.journeys[uuid(58)];
  assert.equal(finalJourney?.transitions.length, MAX_WORLD_JOURNEY_TRANSITIONS);
  assert.equal(finalJourney?.transitions[0]?.sourceEventId, uuid(3));
  assert.equal(finalJourney?.transitions.at(-1)?.sourceEventId, uuid(8));
});

test("a paid ripple analysis is counted once and pruned with its graph", () => {
  let envelope = createWorldStorageEnvelope(NOW);
  const key = `${uuid(10)}:${uuid(20)}`;
  const first = recordCountedRippleAnalysis(envelope, key, NOW);
  assert.equal(first.newlyCounted, true);
  const replay = recordCountedRippleAnalysis(first.envelope, key, NOW);
  assert.equal(replay.newlyCounted, false);
  envelope = pruneWorldStorage(replay.envelope, [], NOW);
  assert.deepEqual(envelope.countedRippleAnalyses, []);
});

test("a consumed failed ripple attempt has a replay-safe attempt key", () => {
  const envelope = createWorldStorageEnvelope(NOW);
  const key = `${uuid(10)}:${uuid(20)}:${uuid(30)}`;
  assert.equal(key.length, 110);
  const first = recordCountedRippleAnalysis(envelope, key, NOW);
  const replay = recordCountedRippleAnalysis(first.envelope, key, NOW);
  assert.equal(first.newlyCounted, true);
  assert.equal(replay.newlyCounted, false);
  assert.deepEqual(replay.envelope.countedRippleAnalyses, [key]);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { WorldEventSummary } from "./world-contracts";
import { loadStorageEnvelope, type StorageLike } from "./storage";
import {
  RIPPLE_ACCOUNTING_JOURNAL_KEY,
  beginRippleCallAttempt,
  deleteAtlasFromBrowser,
  openWorldEvent,
  recoverRippleCallAccounting,
  recordRippleCallInBrowser,
  resolveRippleCallAttempt,
  restartWorldAtlas,
} from "./world-navigation";
import { WORLD_STORAGE_KEY, loadWorldStorageEnvelope } from "./world-storage";

const NOW = "2026-08-26T14:00:00.000Z";

function uuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class FaultStorage extends MemoryStorage {
  private failure: { key: string; writeThenThrow: boolean } | null = null;

  failNextWrite(key: string, { writeThenThrow = false } = {}) {
    this.failure = { key, writeThenThrow };
  }

  override setItem(key: string, value: string) {
    const failure = this.failure?.key === key ? this.failure : null;
    if (failure) this.failure = null;
    if (failure?.writeThenThrow) super.setItem(key, value);
    if (failure) throw new DOMException("full", "QuotaExceededError");
    super.setItem(key, value);
  }
}

const event: WorldEventSummary = {
  id: uuid(1),
  canonicalTitle: "A consequential event",
  summary: "A material change with several possible next states.",
  state: "candidate",
  revision: 1,
  leadHeadline: {
    id: "headline-001",
    title: "A consequential event is developing",
    publisher: "Example News",
    publisherUrl: "https://example.com",
    googleNewsUrl: "https://news.google.com/articles/1",
    publishedAt: NOW,
  },
  headlineIds: ["headline-001"],
  firstSeenAt: NOW,
  lastSeenAt: NOW,
  ripplePotential: "high",
  dimensions: { impact: 2, branchability: 2, connectivity: 3, uncertainty: 2 },
};

test("opening an event creates one associated atlas and reuses it later", () => {
  const storage = new MemoryStorage();
  const first = openWorldEvent(storage, event, { now: NOW, graphId: uuid(10) });
  const second = openWorldEvent(storage, event, {
    now: new Date(Date.parse(NOW) + 1_000).toISOString(),
    graphId: uuid(11),
  });

  assert.equal(first.graphId, uuid(10));
  assert.equal(first.reused, false);
  assert.equal(second.graphId, uuid(10));
  assert.equal(second.reused, true);
  assert.equal(Object.keys(loadStorageEnvelope(storage).envelope.atlases).length, 1);
  assert.equal(loadWorldStorageEnvelope(storage).envelope.atlasByEvent[event.id], uuid(10));
});

test("event revision and complete lead headline fingerprint govern atlas reuse", () => {
  const storage = new MemoryStorage();
  openWorldEvent(storage, event, { now: NOW, graphId: uuid(10) });

  const revised = {
    ...event,
    revision: 2,
    leadHeadline: {
      ...event.leadHeadline,
      title: "A consequential event has materially changed",
    },
  };
  const revisedOpen = openWorldEvent(storage, revised, {
    now: new Date(Date.parse(NOW) + 1_000).toISOString(),
    graphId: uuid(11),
  });
  assert.equal(revisedOpen.reused, false);
  assert.equal(revisedOpen.graphId, uuid(11));
  assert.deepEqual(
    loadStorageEnvelope(storage).envelope.atlases[uuid(11)]?.headline,
    revised.leadHeadline,
  );

  const sameRevisionChangedLead = {
    ...revised,
    leadHeadline: {
      ...revised.leadHeadline,
      publisherUrl: "https://updated.example.com",
    },
  };
  const leadChangedOpen = openWorldEvent(storage, sameRevisionChangedLead, {
    now: new Date(Date.parse(NOW) + 2_000).toISOString(),
    graphId: uuid(12),
  });
  assert.equal(leadChangedOpen.reused, false);
  assert.equal(leadChangedOpen.graphId, uuid(12));

  const replay = openWorldEvent(storage, sameRevisionChangedLead, {
    now: new Date(Date.parse(NOW) + 3_000).toISOString(),
    graphId: uuid(13),
  });
  assert.equal(replay.reused, true);
  assert.equal(replay.graphId, uuid(12));
});

test("legacy associations still load but are refreshed before reuse", () => {
  const storage = new MemoryStorage();
  openWorldEvent(storage, event, { now: NOW, graphId: uuid(10) });
  const legacyWorld = loadWorldStorageEnvelope(storage).envelope;
  legacyWorld.graphAssociations[uuid(10)] = {
    eventId: event.id,
    associatedAt: NOW,
  };
  storage.setItem(WORLD_STORAGE_KEY, JSON.stringify(legacyWorld));

  const opened = openWorldEvent(storage, event, {
    now: new Date(Date.parse(NOW) + 1_000).toISOString(),
    graphId: uuid(11),
  });
  assert.equal(opened.reused, false);
  assert.equal(opened.graphId, uuid(11));
});

test("opening an affected event persists the conditional journey", () => {
  const storage = new MemoryStorage();
  const source = openWorldEvent(storage, event, { now: NOW, graphId: uuid(10) });
  const target = { ...event, id: uuid(2), canonicalTitle: "Affected event" };
  const opened = openWorldEvent(storage, target, {
    now: NOW,
    graphId: uuid(11),
    sourceGraphId: source.graphId,
    transition: {
      sourceEventId: event.id,
      sourceEventTitle: event.canonicalTitle,
      sourceScenarioNodeId: uuid(20),
      sourceScenarioTitle: "Primary scenario",
      targetEventId: target.id,
      targetEventTitle: target.canonicalTitle,
      influence: "amplifies_impact",
    },
  });

  const journey = loadWorldStorageEnvelope(storage).envelope.journeys[opened.graphId];
  assert.equal(journey?.transitions.length, 1);
  assert.equal(journey?.transitions[0]?.targetEventTitle, "Affected event");
});

test("a failed world association rolls a newly created atlas back", () => {
  const storage = new FaultStorage();
  storage.failNextWrite(WORLD_STORAGE_KEY, { writeThenThrow: true });
  assert.throws(
    () => openWorldEvent(storage, event, { now: NOW, graphId: uuid(10) }),
    /full/i,
  );
  assert.deepEqual(loadStorageEnvelope(storage).envelope.atlases, {});
  assert.deepEqual(loadWorldStorageEnvelope(storage).envelope.graphAssociations, {});
});

test("a failed world restart restores both prior envelopes", () => {
  const storage = new FaultStorage();
  openWorldEvent(storage, event, { now: NOW, graphId: uuid(10) });
  storage.failNextWrite(WORLD_STORAGE_KEY, { writeThenThrow: true });
  assert.throws(
    () =>
      restartWorldAtlas(storage, {
        previousGraphId: uuid(10),
        nextGraphId: uuid(11),
        event,
        at: new Date(Date.parse(NOW) + 1_000).toISOString(),
      }),
    /full/i,
  );
  const atlases = loadStorageEnvelope(storage).envelope.atlases;
  const world = loadWorldStorageEnvelope(storage).envelope;
  assert.ok(atlases[uuid(10)]);
  assert.equal(atlases[uuid(11)], undefined);
  assert.equal(world.atlasByEvent[event.id], uuid(10));
  assert.ok(world.graphAssociations[uuid(10)]);
});

test("world restart uses the current event lead and association revision", () => {
  const storage = new MemoryStorage();
  openWorldEvent(storage, event, { now: NOW, graphId: uuid(10) });
  const currentEvent = {
    ...event,
    revision: 2,
    leadHeadline: {
      ...event.leadHeadline,
      id: "headline-002",
      title: "The current lead reporting has changed",
    },
  };
  const restarted = restartWorldAtlas(storage, {
    previousGraphId: uuid(10),
    nextGraphId: uuid(11),
    event: currentEvent,
    at: new Date(Date.parse(NOW) + 1_000).toISOString(),
  });
  assert.deepEqual(restarted.graph.headline, currentEvent.leadHeadline);
  assert.equal(
    restarted.worldEnvelope.graphAssociations[uuid(11)]?.eventRevision,
    2,
  );
});

test("a failed cross-envelope delete restores the atlas and association", () => {
  const storage = new FaultStorage();
  openWorldEvent(storage, event, { now: NOW, graphId: uuid(10) });
  storage.failNextWrite(WORLD_STORAGE_KEY, { writeThenThrow: true });
  assert.throws(
    () =>
      deleteAtlasFromBrowser(storage, {
        graphId: uuid(10),
        at: new Date(Date.parse(NOW) + 1_000).toISOString(),
      }),
    /full/i,
  );
  assert.ok(loadStorageEnvelope(storage).envelope.atlases[uuid(10)]);
  assert.equal(
    loadWorldStorageEnvelope(storage).envelope.atlasByEvent[event.id],
    uuid(10),
  );
});

test("ripple accounting recovers a failed dedupe write without double counting", () => {
  const storage = new FaultStorage();
  openWorldEvent(storage, event, { now: NOW, graphId: uuid(10) });
  const analysisKey = `${uuid(10)}:${uuid(20)}`;
  storage.failNextWrite(WORLD_STORAGE_KEY);
  assert.throws(
    () =>
      recordRippleCallInBrowser(storage, {
        graphId: uuid(10),
        analysisKey,
        at: NOW,
      }),
    /full/i,
  );

  assert.equal(loadStorageEnvelope(storage).envelope.atlases[uuid(10)]?.callsUsed, 1);
  assert.equal(
    loadWorldStorageEnvelope(storage).envelope.countedRippleAnalyses.includes(analysisKey),
    false,
  );
  assert.ok(storage.getItem(RIPPLE_ACCOUNTING_JOURNAL_KEY));

  const recovered = recordRippleCallInBrowser(storage, {
    graphId: uuid(10),
    analysisKey,
    at: NOW,
  });
  assert.equal(recovered.graph.callsUsed, 1);
  assert.equal(recovered.newlyCounted, false);
  assert.equal(recovered.worldEnvelope.countedRippleAnalyses.includes(analysisKey), true);
  assert.equal(storage.getItem(RIPPLE_ACCOUNTING_JOURNAL_KEY), null);
});

test("a pending ripple with a lost response is recovered exactly once", () => {
  const storage = new MemoryStorage();
  openWorldEvent(storage, event, { now: NOW, graphId: uuid(10) });
  const analysisKey = `${uuid(10)}:${uuid(20)}:${uuid(30)}`;
  beginRippleCallAttempt(storage, {
    graphId: uuid(10),
    analysisKey,
    at: NOW,
  });

  assert.equal(loadStorageEnvelope(storage).envelope.atlases[uuid(10)]?.callsUsed, 0);
  assert.ok(storage.getItem(RIPPLE_ACCOUNTING_JOURNAL_KEY));

  const recovered = recoverRippleCallAccounting(storage);
  assert.equal(recovered?.graph.callsUsed, 1);
  assert.equal(
    recovered?.worldEnvelope.countedRippleAnalyses.includes(analysisKey),
    true,
  );
  assert.equal(storage.getItem(RIPPLE_ACCOUNTING_JOURNAL_KEY), null);

  assert.equal(recoverRippleCallAccounting(storage), null);
  const replay = beginRippleCallAttempt(storage, {
    graphId: uuid(10),
    analysisKey,
    at: NOW,
  });
  assert.equal(replay.pending, false);
  assert.equal(replay.graph.callsUsed, 1);
});

test("a known cache hit clears its pending ripple without consuming a call", () => {
  const storage = new MemoryStorage();
  openWorldEvent(storage, event, { now: NOW, graphId: uuid(10) });
  const analysisKey = `${uuid(10)}:${uuid(20)}:${uuid(30)}`;
  beginRippleCallAttempt(storage, {
    graphId: uuid(10),
    analysisKey,
    at: NOW,
  });
  const resolved = resolveRippleCallAttempt(storage, {
    graphId: uuid(10),
    analysisKey,
    callConsumed: false,
    at: NOW,
  });
  assert.equal(resolved.graph.callsUsed, 0);
  assert.equal(storage.getItem(RIPPLE_ACCOUNTING_JOURNAL_KEY), null);
});

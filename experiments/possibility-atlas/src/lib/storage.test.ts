import assert from "node:assert/strict";
import test from "node:test";

import { MAX_ATLAS_CALLS, StorageEnvelopeSchema, type HeadlineItem } from "./contracts";
import { createAtlasGraph } from "./atlas-reducer";
import {
  ATLAS_RUNTIME_META_KEY,
  ATLAS_STORAGE_KEY,
  cacheHeadlines,
  clearAtlasStorage,
  createStorageEnvelope,
  loadStorageEnvelope,
  pruneToMaximum,
  saveStorageEnvelope,
  upsertAtlas,
  type StorageLike,
} from "./storage";
import { RIPPLE_ACCOUNTING_JOURNAL_KEY } from "./world-navigation";
import { WORLD_STORAGE_KEY } from "./world-storage";

const NOW = "2026-08-25T15:00:00.000Z";

function uuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function headline(index: number): HeadlineItem {
  return {
    id: `headline-${index.toString().padStart(3, "0")}`,
    title: `Headline ${index}`,
    publisher: "Example News",
    publisherUrl: "https://example.com",
    googleNewsUrl: `https://news.google.com/articles/${index}`,
    publishedAt: NOW,
  };
}

class MemoryStorage implements StorageLike {
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

test("corrupt storage is rejected and replaced with a valid fresh envelope", () => {
  const storage = new MemoryStorage();
  storage.setItem(ATLAS_STORAGE_KEY, "{not-json");
  const loaded = loadStorageEnvelope(storage, { installationId: uuid(900), now: NOW });
  assert.ok(loaded.warning);
  assert.equal(loaded.envelope.installationId, uuid(900));
  assert.deepEqual(loaded.envelope.atlases, {});
});

test("normal persistence validates and restores cached headlines", () => {
  const storage = new MemoryStorage();
  let envelope = createStorageEnvelope({ installationId: uuid(900), now: NOW });
  envelope = cacheHeadlines(envelope, [headline(1), headline(2)], NOW);
  saveStorageEnvelope(storage, envelope);
  const loaded = loadStorageEnvelope(storage);
  assert.equal(loaded.warning, null);
  assert.equal(loaded.envelope.lastHeadlines.length, 2);
  assert.equal(loaded.envelope.lastHeadlinesAt, NOW);
});

test("legacy v1 atlases above the new call cap are kept as exhausted", () => {
  const storage = new MemoryStorage();
  let envelope = createStorageEnvelope({ installationId: uuid(900), now: NOW });
  const saturated = createAtlasGraph({ id: uuid(1), headline: headline(1), now: NOW });
  const available = createAtlasGraph({ id: uuid(2), headline: headline(2), now: NOW });
  envelope = upsertAtlas(upsertAtlas(envelope, saturated), available);
  const legacy = JSON.parse(JSON.stringify(envelope)) as {
    atlases: Record<string, { callsUsed: number }>;
  };
  legacy.atlases[saturated.id].callsUsed = 12;
  storage.setItem(ATLAS_STORAGE_KEY, JSON.stringify(legacy));

  const loaded = loadStorageEnvelope(storage);
  assert.equal(loaded.envelope.atlases[saturated.id]?.callsUsed, MAX_ATLAS_CALLS);
  assert.equal(loaded.envelope.atlases[available.id]?.callsUsed, 0);
  assert.match(loaded.warning ?? "", /10-call limit/i);
});

test("call counts outside the legacy integer range are not silently clamped", () => {
  const storage = new MemoryStorage();
  let envelope = createStorageEnvelope({ installationId: uuid(900), now: NOW });
  const graph = createAtlasGraph({ id: uuid(1), headline: headline(1), now: NOW });
  envelope = upsertAtlas(envelope, graph);
  const malformed = JSON.parse(JSON.stringify(envelope)) as {
    atlases: Record<string, { callsUsed: number }>;
  };
  malformed.atlases[graph.id].callsUsed = 11.5;
  storage.setItem(ATLAS_STORAGE_KEY, JSON.stringify(malformed));

  const loaded = loadStorageEnvelope(storage, { installationId: uuid(901), now: NOW });
  assert.deepEqual(loaded.envelope.atlases, {});
  assert.equal(loaded.envelope.installationId, uuid(901));
  assert.match(loaded.warning ?? "", /unreadable/i);
});

test("schema-valid graphs with broken relationships are removed on load", () => {
  const storage = new MemoryStorage();
  let envelope = createStorageEnvelope({ installationId: uuid(900), now: NOW });
  const graph = createAtlasGraph({ id: uuid(1), headline: headline(1), now: NOW });
  const broken = {
    ...graph,
    rootChildIds: [uuid(2)],
  };
  envelope = StorageEnvelopeSchema.parse({
    ...envelope,
    atlases: { [graph.id]: broken },
    activeAtlasId: graph.id,
  });
  storage.setItem(ATLAS_STORAGE_KEY, JSON.stringify(envelope));

  const loaded = loadStorageEnvelope(storage);
  assert.deepEqual(loaded.envelope.atlases, {});
  assert.equal(loaded.envelope.activeAtlasId, null);
  assert.match(loaded.warning ?? "", /invalid saved atlases/i);
});

test("pruning keeps the active atlas and no more than twenty recent atlases", () => {
  let envelope = createStorageEnvelope({ installationId: uuid(900), now: NOW });
  const atlases = Object.fromEntries(
    Array.from({ length: 24 }, (_, index) => {
      const timestamp = new Date(Date.parse(NOW) + index * 1_000).toISOString();
      const atlas = createAtlasGraph({ id: uuid(index + 1), headline: headline(index), now: timestamp });
      return [atlas.id, atlas];
    }),
  );
  envelope = StorageEnvelopeSchema.parse({
    ...envelope,
    atlases,
    activeAtlasId: uuid(1),
  });
  const pruned = pruneToMaximum(envelope);
  assert.equal(Object.keys(pruned.atlases).length, 20);
  assert.ok(pruned.atlases[uuid(1)]);
  assert.ok(pruned.atlases[uuid(24)]);
});

test("quota recovery prunes oldest non-active atlases before giving up", () => {
  class QuotaStorage extends MemoryStorage {
    override setItem(key: string, value: string) {
      const parsed = JSON.parse(value) as { atlases?: Record<string, unknown> };
      if (Object.keys(parsed.atlases ?? {}).length > 2) {
        throw new DOMException("full", "QuotaExceededError");
      }
      super.setItem(key, value);
    }
  }

  const storage = new QuotaStorage();
  let envelope = createStorageEnvelope({ installationId: uuid(900), now: NOW });
  for (let index = 1; index <= 4; index += 1) {
    const timestamp = new Date(Date.parse(NOW) + index * 1_000).toISOString();
    envelope = upsertAtlas(
      envelope,
      createAtlasGraph({ id: uuid(index), headline: headline(index), now: timestamp }),
    );
  }
  const saved = saveStorageEnvelope(storage, envelope);
  assert.equal(Object.keys(saved.envelope.atlases).length, 2);
  assert.ok(saved.envelope.atlases[uuid(4)]);
  assert.equal(saved.prunedAtlasIds.length, 2);
});

test("clear browser data removes atlas, runtime, and additive world envelopes", () => {
  const storage = new MemoryStorage();
  storage.setItem(ATLAS_STORAGE_KEY, "atlas");
  storage.setItem(ATLAS_RUNTIME_META_KEY, "runtime");
  storage.setItem(WORLD_STORAGE_KEY, "world");
  storage.setItem(RIPPLE_ACCOUNTING_JOURNAL_KEY, "journal");
  clearAtlasStorage(storage);
  assert.equal(storage.getItem(ATLAS_STORAGE_KEY), null);
  assert.equal(storage.getItem(ATLAS_RUNTIME_META_KEY), null);
  assert.equal(storage.getItem(WORLD_STORAGE_KEY), null);
  assert.equal(storage.getItem(RIPPLE_ACCOUNTING_JOURNAL_KEY), null);
});

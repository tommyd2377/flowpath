import { z } from "zod";

import {
  MAX_SAVED_ATLASES,
  StorageEnvelopeSchema,
  type AtlasGraph,
  type HeadlineItem,
  type StorageEnvelope,
} from "./contracts";
import { validateAtlasGraph } from "./atlas-reducer";

export const ATLAS_STORAGE_KEY = "possibility-atlas:v1";
export const ATLAS_RUNTIME_META_KEY = "possibility-atlas:runtime:v1";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StorageLoadResult = {
  envelope: StorageEnvelope;
  warning: string | null;
};

export type StorageSaveResult = {
  envelope: StorageEnvelope;
  prunedAtlasIds: string[];
  droppedHeadlineCache: boolean;
};

const RuntimeMetaSchema = z
  .object({
    version: z.literal(1),
    fixtureGraphIds: z.array(z.string().uuid()).max(MAX_SAVED_ATLASES),
  })
  .strict();

function isQuotaError(error: unknown) {
  return (
    error instanceof DOMException
      ? error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED"
      : error instanceof Error &&
        (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

export function createStorageEnvelope({
  installationId = crypto.randomUUID(),
  now = new Date().toISOString(),
}: {
  installationId?: string;
  now?: string;
} = {}): StorageEnvelope {
  return StorageEnvelopeSchema.parse({
    version: 1,
    installationId,
    atlases: {},
    activeAtlasId: null,
    lastHeadlines: [],
    lastHeadlinesAt: null,
    updatedAt: now,
  });
}

export function parseStorageEnvelope(raw: string) {
  try {
    return StorageEnvelopeSchema.safeParse(JSON.parse(raw));
  } catch {
    return StorageEnvelopeSchema.safeParse(null);
  }
}

export function loadStorageEnvelope(
  storage: StorageLike,
  fallback?: Parameters<typeof createStorageEnvelope>[0],
): StorageLoadResult {
  try {
    const raw = storage.getItem(ATLAS_STORAGE_KEY);
    if (!raw) return { envelope: createStorageEnvelope(fallback), warning: null };
    const parsed = parseStorageEnvelope(raw);
    if (parsed.success) {
      const validAtlases: Record<string, AtlasGraph> = {};
      let removedInvalidAtlas = false;
      for (const [id, atlas] of Object.entries(parsed.data.atlases)) {
        try {
          const validated = validateAtlasGraph(atlas);
          if (validated.id !== id) throw new Error("Atlas key mismatch.");
          validAtlases[id] = validated;
        } catch {
          removedInvalidAtlas = true;
        }
      }
      const structurallyValid = StorageEnvelopeSchema.parse({
        ...parsed.data,
        atlases: validAtlases,
        activeAtlasId:
          parsed.data.activeAtlasId && validAtlases[parsed.data.activeAtlasId]
            ? parsed.data.activeAtlasId
            : null,
      });
      return {
        envelope: pruneToMaximum(structurallyValid),
        warning: removedInvalidAtlas
          ? "One or more invalid saved atlases were removed to protect this browser workspace."
          : null,
      };
    }
    return {
      envelope: createStorageEnvelope(fallback),
      warning: "Saved atlas data was unreadable, so a fresh local workspace was opened.",
    };
  } catch {
    return {
      envelope: createStorageEnvelope(fallback),
      warning: "Browser storage is unavailable. Changes may not survive a refresh.",
    };
  }
}

function atlasIdsNewestFirst(envelope: StorageEnvelope) {
  return Object.values(envelope.atlases)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((atlas) => atlas.id);
}

export function pruneToMaximum(
  envelope: StorageEnvelope,
  maximum = MAX_SAVED_ATLASES,
) {
  const newest = atlasIdsNewestFirst(envelope);
  const kept = new Set(newest.slice(0, Math.max(0, maximum)));
  if (envelope.activeAtlasId && envelope.atlases[envelope.activeAtlasId]) {
    kept.add(envelope.activeAtlasId);
    while (kept.size > maximum) {
      const removable = [...kept].reverse().find((id) => id !== envelope.activeAtlasId);
      if (!removable) break;
      kept.delete(removable);
    }
  }
  const atlases = Object.fromEntries(
    Object.entries(envelope.atlases).filter(([id]) => kept.has(id)),
  );
  return StorageEnvelopeSchema.parse({
    ...envelope,
    atlases,
    activeAtlasId:
      envelope.activeAtlasId && atlases[envelope.activeAtlasId]
        ? envelope.activeAtlasId
        : null,
  });
}

function withoutAtlas(envelope: StorageEnvelope, atlasId: string) {
  const atlases = { ...envelope.atlases };
  delete atlases[atlasId];
  return StorageEnvelopeSchema.parse({
    ...envelope,
    atlases,
    activeAtlasId: envelope.activeAtlasId === atlasId ? null : envelope.activeAtlasId,
  });
}

export function saveStorageEnvelope(
  storage: StorageLike,
  requested: StorageEnvelope,
): StorageSaveResult {
  let envelope = pruneToMaximum(StorageEnvelopeSchema.parse(requested));
  const requestedIds = new Set(Object.keys(requested.atlases));
  const prunedAtlasIds = [...requestedIds].filter((id) => !envelope.atlases[id]);
  let droppedHeadlineCache = false;

  while (true) {
    try {
      storage.setItem(ATLAS_STORAGE_KEY, JSON.stringify(envelope));
      return { envelope, prunedAtlasIds, droppedHeadlineCache };
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      const oldestRemovable = atlasIdsNewestFirst(envelope)
        .reverse()
        .find((id) => id !== envelope.activeAtlasId);
      if (oldestRemovable) {
        envelope = withoutAtlas(envelope, oldestRemovable);
        prunedAtlasIds.push(oldestRemovable);
        continue;
      }
      if (envelope.lastHeadlines.length > 0) {
        envelope = StorageEnvelopeSchema.parse({
          ...envelope,
          lastHeadlines: [],
          lastHeadlinesAt: null,
        });
        droppedHeadlineCache = true;
        continue;
      }
      throw error;
    }
  }
}

export function upsertAtlas(
  envelope: StorageEnvelope,
  atlas: AtlasGraph,
  { active = true }: { active?: boolean } = {},
) {
  return pruneToMaximum(
    StorageEnvelopeSchema.parse({
      ...envelope,
      atlases: { ...envelope.atlases, [atlas.id]: atlas },
      activeAtlasId: active ? atlas.id : envelope.activeAtlasId,
      updatedAt: atlas.updatedAt,
    }),
  );
}

export function removeAtlas(envelope: StorageEnvelope, atlasId: string, now: string) {
  return StorageEnvelopeSchema.parse({
    ...withoutAtlas(envelope, atlasId),
    updatedAt: now,
  });
}

export function clearAtlases(envelope: StorageEnvelope, now: string) {
  return StorageEnvelopeSchema.parse({
    ...envelope,
    atlases: {},
    activeAtlasId: null,
    updatedAt: now,
  });
}

export function cacheHeadlines(
  envelope: StorageEnvelope,
  headlines: HeadlineItem[],
  fetchedAt: string,
) {
  return StorageEnvelopeSchema.parse({
    ...envelope,
    lastHeadlines: headlines,
    lastHeadlinesAt: fetchedAt,
    updatedAt: fetchedAt,
  });
}

export function recentAtlases(envelope: StorageEnvelope, limit = 4) {
  return Object.values(envelope.atlases)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}

export function readFixtureGraphIds(storage: StorageLike) {
  try {
    const raw = storage.getItem(ATLAS_RUNTIME_META_KEY);
    if (!raw) return new Set<string>();
    const parsed = RuntimeMetaSchema.safeParse(JSON.parse(raw));
    return new Set(parsed.success ? parsed.data.fixtureGraphIds : []);
  } catch {
    return new Set<string>();
  }
}

export function setFixtureGraphMode(
  storage: StorageLike,
  graphId: string,
  fixture: boolean,
) {
  const ids = readFixtureGraphIds(storage);
  if (fixture) ids.add(graphId);
  else ids.delete(graphId);
  const fixtureGraphIds = [...ids].slice(-MAX_SAVED_ATLASES);
  storage.setItem(
    ATLAS_RUNTIME_META_KEY,
    JSON.stringify(RuntimeMetaSchema.parse({ version: 1, fixtureGraphIds })),
  );
}

export function clearAtlasStorage(storage: StorageLike) {
  storage.removeItem(ATLAS_STORAGE_KEY);
  storage.removeItem(ATLAS_RUNTIME_META_KEY);
  storage.removeItem("possibility-atlas:world:v1");
  storage.removeItem("possibility-atlas:ripple-accounting:v1");
}

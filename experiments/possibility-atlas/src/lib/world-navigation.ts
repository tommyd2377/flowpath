import { z } from "zod";

import type { WorldEventSummary } from "./world-contracts";
import { atlasReducer, createAtlasGraph } from "./atlas-reducer";
import {
  ATLAS_STORAGE_KEY,
  loadStorageEnvelope,
  removeAtlas,
  saveStorageEnvelope,
  upsertAtlas,
  type StorageLike,
} from "./storage";
import {
  WORLD_STORAGE_KEY,
  appendWorldJourney,
  associateWorldAtlas,
  focusWorldEvent,
  loadWorldStorageEnvelope,
  pruneWorldStorage,
  recordCountedRippleAnalysis,
  removeWorldAtlas,
  replaceWorldAtlas,
  saveWorldStorageEnvelope,
  worldLeadHeadlineFingerprint,
  type WorldJourneyTransition,
} from "./world-storage";

export const RIPPLE_ACCOUNTING_JOURNAL_KEY =
  "possibility-atlas:ripple-accounting:v1";

const RippleAccountingJournalSchema = z
  .object({
    version: z.literal(1),
    graphId: z.string().uuid(),
    analysisKey: z.string().min(73).max(110),
    previousCallsUsed: z.number().int().min(0).max(15),
    nextCallsUsed: z.number().int().min(1).max(16),
    phase: z.enum(["pending", "counting"]).default("counting"),
    at: z.string().datetime({ offset: true }),
  })
  .strict();

export type OpenWorldEventOptions = {
  transition?: WorldJourneyTransition;
  sourceGraphId?: string;
  now?: string;
  graphId?: string;
};

export function atlasHref(graphId: string, nodeId?: string | null) {
  return nodeId
    ? `/atlas/${encodeURIComponent(graphId)}?node=${encodeURIComponent(nodeId)}`
    : `/atlas/${encodeURIComponent(graphId)}`;
}

function restoreStorageValue(
  storage: StorageLike,
  key: string,
  raw: string | null,
) {
  if (raw === null) storage.removeItem(key);
  else storage.setItem(key, raw);
}

function rollbackAtlasAndWorld(
  storage: StorageLike,
  atlasRaw: string | null,
  worldRaw: string | null,
) {
  const failures: unknown[] = [];
  try {
    restoreStorageValue(storage, ATLAS_STORAGE_KEY, atlasRaw);
  } catch (error) {
    failures.push(error);
  }
  try {
    restoreStorageValue(storage, WORLD_STORAGE_KEY, worldRaw);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new Error("Browser storage changed but could not be fully restored.");
  }
}

export function openWorldEvent(
  storage: StorageLike,
  event: WorldEventSummary,
  options: OpenWorldEventOptions = {},
) {
  const now = options.now ?? new Date().toISOString();
  const atlasRaw = storage.getItem(ATLAS_STORAGE_KEY);
  const worldRaw = storage.getItem(WORLD_STORAGE_KEY);
  const atlasLoaded = loadStorageEnvelope(storage);
  const worldLoaded = loadWorldStorageEnvelope(storage, now);
  let worldEnvelope = pruneWorldStorage(
    worldLoaded.envelope,
    Object.keys(atlasLoaded.envelope.atlases),
    now,
  );

  const leadHeadlineFingerprint = worldLeadHeadlineFingerprint(event.leadHeadline);
  const reusableGraphId = worldEnvelope.atlasByEvent[event.id];
  const reusableAssociation = reusableGraphId
    ? worldEnvelope.graphAssociations[reusableGraphId]
    : null;
  let graphId =
    reusableGraphId &&
    atlasLoaded.envelope.atlases[reusableGraphId] &&
    reusableAssociation?.eventRevision === event.revision &&
    reusableAssociation.leadHeadlineFingerprint === leadHeadlineFingerprint
      ? reusableGraphId
      : null;
  let atlasEnvelope = atlasLoaded.envelope;
  let reused = Boolean(graphId);

  try {
    if (!graphId) {
      graphId = options.graphId ?? crypto.randomUUID();
      const graph = createAtlasGraph({ id: graphId, headline: event.leadHeadline, now });
      const saved = saveStorageEnvelope(storage, upsertAtlas(atlasEnvelope, graph));
      atlasEnvelope = saved.envelope;
      reused = false;
    }

    worldEnvelope = associateWorldAtlas(worldEnvelope, {
      eventId: event.id,
      graphId,
      at: now,
      eventRevision: event.revision,
      leadHeadlineFingerprint,
    });
    worldEnvelope = focusWorldEvent(worldEnvelope, event.id, now);

    if (options.transition && options.sourceGraphId) {
      worldEnvelope = appendWorldJourney(worldEnvelope, {
        sourceGraphId: options.sourceGraphId,
        targetGraphId: graphId,
        transition: options.transition,
        at: now,
      });
    }

    worldEnvelope = pruneWorldStorage(
      worldEnvelope,
      Object.keys(atlasEnvelope.atlases),
      now,
    );
    saveWorldStorageEnvelope(storage, worldEnvelope);
  } catch (error) {
    rollbackAtlasAndWorld(storage, atlasRaw, worldRaw);
    throw error;
  }

  return {
    graphId,
    href: atlasHref(graphId),
    reused,
    atlasWarning: atlasLoaded.warning,
    worldWarning: worldLoaded.warning,
  };
}

export function restartWorldAtlas(
  storage: StorageLike,
  {
    previousGraphId,
    nextGraphId,
    event,
    at,
  }: {
    previousGraphId: string;
    nextGraphId: string;
    event: WorldEventSummary;
    at: string;
  },
) {
  const atlasRaw = storage.getItem(ATLAS_STORAGE_KEY);
  const worldRaw = storage.getItem(WORLD_STORAGE_KEY);
  const atlasLoaded = loadStorageEnvelope(storage);
  const current = atlasLoaded.envelope.atlases[previousGraphId];
  if (!current) throw new Error("The atlas to restart is unavailable.");
  const worldLoaded = loadWorldStorageEnvelope(storage, at);
  const association = worldLoaded.envelope.graphAssociations[previousGraphId];
  if (!association || association.eventId !== event.id) {
    throw new Error("The World in Motion association is unavailable.");
  }

  const graph = createAtlasGraph({
    id: nextGraphId,
    headline: event.leadHeadline,
    now: at,
  });
  let atlasEnvelope = removeAtlas(atlasLoaded.envelope, previousGraphId, at);
  atlasEnvelope = upsertAtlas(atlasEnvelope, graph);
  let worldEnvelope = replaceWorldAtlas(worldLoaded.envelope, {
    previousGraphId,
    nextGraphId,
    at,
    eventRevision: event.revision,
    leadHeadlineFingerprint: worldLeadHeadlineFingerprint(event.leadHeadline),
  });

  try {
    const saved = saveStorageEnvelope(storage, atlasEnvelope);
    atlasEnvelope = saved.envelope;
    worldEnvelope = pruneWorldStorage(
      worldEnvelope,
      Object.keys(atlasEnvelope.atlases),
      at,
    );
    worldEnvelope = saveWorldStorageEnvelope(storage, worldEnvelope);
  } catch (error) {
    rollbackAtlasAndWorld(storage, atlasRaw, worldRaw);
    throw error;
  }

  return { graph, atlasEnvelope, worldEnvelope };
}

export function deleteAtlasFromBrowser(
  storage: StorageLike,
  { graphId, at }: { graphId: string; at: string },
) {
  const atlasRaw = storage.getItem(ATLAS_STORAGE_KEY);
  const worldRaw = storage.getItem(WORLD_STORAGE_KEY);
  const atlasLoaded = loadStorageEnvelope(storage);
  if (!atlasLoaded.envelope.atlases[graphId]) {
    throw new Error("The atlas to delete is unavailable.");
  }
  const worldLoaded = loadWorldStorageEnvelope(storage, at);
  const atlasEnvelope = removeAtlas(atlasLoaded.envelope, graphId, at);
  const worldEnvelope = pruneWorldStorage(
    removeWorldAtlas(worldLoaded.envelope, graphId, at),
    Object.keys(atlasEnvelope.atlases),
    at,
  );

  try {
    const saved = saveStorageEnvelope(storage, atlasEnvelope);
    const savedWorld = saveWorldStorageEnvelope(storage, worldEnvelope);
    return { atlasEnvelope: saved.envelope, worldEnvelope: savedWorld };
  } catch (error) {
    rollbackAtlasAndWorld(storage, atlasRaw, worldRaw);
    throw error;
  }
}

function readRippleJournal(storage: StorageLike) {
  const raw = storage.getItem(RIPPLE_ACCOUNTING_JOURNAL_KEY);
  if (!raw) return null;
  try {
    return RippleAccountingJournalSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("Ripple call accounting recovery data is unreadable.");
  }
}

function writeRippleJournal(
  storage: StorageLike,
  journal: z.input<typeof RippleAccountingJournalSchema>,
) {
  const parsed = RippleAccountingJournalSchema.parse(journal);
  storage.setItem(RIPPLE_ACCOUNTING_JOURNAL_KEY, JSON.stringify(parsed));
  return parsed;
}

export function beginRippleCallAttempt(
  storage: StorageLike,
  {
    graphId,
    analysisKey,
    at,
  }: { graphId: string; analysisKey: string; at: string },
) {
  recoverRippleCallAccounting(storage);
  const atlasLoaded = loadStorageEnvelope(storage);
  const worldLoaded = loadWorldStorageEnvelope(storage, at);
  const graph = atlasLoaded.envelope.atlases[graphId];
  if (!graph) throw new Error("The atlas call counter is unavailable.");
  if (worldLoaded.envelope.countedRippleAnalyses.includes(analysisKey)) {
    return {
      graph,
      atlasEnvelope: atlasLoaded.envelope,
      worldEnvelope: worldLoaded.envelope,
      pending: false,
    };
  }

  const next = atlasReducer(graph, { type: "ripple_call_recorded", at });
  writeRippleJournal(storage, {
    version: 1,
    graphId,
    analysisKey,
    previousCallsUsed: graph.callsUsed,
    nextCallsUsed: next.callsUsed,
    phase: "pending",
    at,
  });
  return {
    graph,
    atlasEnvelope: atlasLoaded.envelope,
    worldEnvelope: worldLoaded.envelope,
    pending: true,
  };
}

export function recoverRippleCallAccounting(storage: StorageLike) {
  let journal = readRippleJournal(storage);
  if (!journal) return null;
  let atlasLoaded = loadStorageEnvelope(storage);
  const worldLoaded = loadWorldStorageEnvelope(storage, journal.at);
  let graph = atlasLoaded.envelope.atlases[journal.graphId];

  if (!graph) {
    storage.removeItem(RIPPLE_ACCOUNTING_JOURNAL_KEY);
    return null;
  }
  if (worldLoaded.envelope.countedRippleAnalyses.includes(journal.analysisKey)) {
    storage.removeItem(RIPPLE_ACCOUNTING_JOURNAL_KEY);
    return { graph, atlasEnvelope: atlasLoaded.envelope, worldEnvelope: worldLoaded.envelope };
  }

  if (journal.phase === "pending") {
    const next = atlasReducer(graph, {
      type: "ripple_call_recorded",
      at: journal.at,
    });
    journal = writeRippleJournal(storage, {
      ...journal,
      phase: "counting",
      previousCallsUsed: graph.callsUsed,
      nextCallsUsed: next.callsUsed,
    });
  }

  if (graph.callsUsed < journal.previousCallsUsed) {
    throw new Error("Ripple call accounting could not be reconciled safely.");
  }

  if (graph.callsUsed === journal.previousCallsUsed) {
    graph = atlasReducer(graph, {
      type: "ripple_call_recorded",
      at: journal.at,
    });
    const saved = saveStorageEnvelope(
      storage,
      upsertAtlas(atlasLoaded.envelope, graph),
    );
    atlasLoaded = { envelope: saved.envelope, warning: atlasLoaded.warning };
  }

  if (graph.callsUsed < journal.nextCallsUsed) {
    throw new Error("Ripple call accounting could not be reconciled safely.");
  }

  const recorded = recordCountedRippleAnalysis(
    worldLoaded.envelope,
    journal.analysisKey,
    journal.at,
  );
  const worldEnvelope = pruneWorldStorage(
    recorded.envelope,
    Object.keys(atlasLoaded.envelope.atlases),
    journal.at,
  );
  saveWorldStorageEnvelope(storage, worldEnvelope);
  storage.removeItem(RIPPLE_ACCOUNTING_JOURNAL_KEY);
  return { graph, atlasEnvelope: atlasLoaded.envelope, worldEnvelope };
}

export function recordRippleCallInBrowser(
  storage: StorageLike,
  {
    graphId,
    analysisKey,
    at,
  }: { graphId: string; analysisKey: string; at: string },
) {
  const existing = readRippleJournal(storage);
  if (
    existing &&
    (existing.graphId !== graphId || existing.analysisKey !== analysisKey)
  ) {
    recoverRippleCallAccounting(storage);
  }
  const atlasLoaded = loadStorageEnvelope(storage);
  const worldLoaded = loadWorldStorageEnvelope(storage, at);
  const current = atlasLoaded.envelope.atlases[graphId];
  if (!current) throw new Error("The atlas call counter is unavailable.");
  if (worldLoaded.envelope.countedRippleAnalyses.includes(analysisKey)) {
    return {
      graph: current,
      atlasEnvelope: atlasLoaded.envelope,
      worldEnvelope: worldLoaded.envelope,
      newlyCounted: false,
    };
  }

  const matching = readRippleJournal(storage);
  if (!matching) {
    const graph = atlasReducer(current, { type: "ripple_call_recorded", at });
    writeRippleJournal(storage, {
      version: 1,
      graphId,
      analysisKey,
      previousCallsUsed: current.callsUsed,
      nextCallsUsed: graph.callsUsed,
      phase: "counting",
      at,
    });
  } else if (
    matching.graphId !== graphId ||
    matching.analysisKey !== analysisKey
  ) {
    throw new Error("Another ripple call is still awaiting reconciliation.");
  }

  const recovered = recoverRippleCallAccounting(storage);
  if (!recovered) {
    throw new Error("Ripple call accounting could not be reconciled safely.");
  }
  return {
    ...recovered,
    newlyCounted: recovered.graph.callsUsed > current.callsUsed,
  };
}

export function resolveRippleCallAttempt(
  storage: StorageLike,
  {
    graphId,
    analysisKey,
    callConsumed,
    at,
  }: {
    graphId: string;
    analysisKey: string;
    callConsumed: boolean;
    at: string;
  },
) {
  const journal = readRippleJournal(storage);
  if (
    journal &&
    journal.graphId === graphId &&
    journal.analysisKey === analysisKey &&
    !callConsumed
  ) {
    storage.removeItem(RIPPLE_ACCOUNTING_JOURNAL_KEY);
  }
  if (callConsumed) {
    return recordRippleCallInBrowser(storage, { graphId, analysisKey, at });
  }

  const atlasLoaded = loadStorageEnvelope(storage);
  const worldLoaded = loadWorldStorageEnvelope(storage, at);
  const graph = atlasLoaded.envelope.atlases[graphId];
  if (!graph) throw new Error("The atlas call counter is unavailable.");
  return {
    graph,
    atlasEnvelope: atlasLoaded.envelope,
    worldEnvelope: worldLoaded.envelope,
    newlyCounted: false,
  };
}

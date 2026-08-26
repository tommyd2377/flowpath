import { z } from "zod";

import type { HeadlineItem } from "./contracts";

export const WORLD_STORAGE_KEY = "possibility-atlas:world:v1";
export const MAX_WORLD_JOURNEY_TRANSITIONS = 6;

export type WorldStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const IsoDateSchema = z.string().datetime({ offset: true });

export const WorldGraphAssociationSchema = z
  .object({
    eventId: z.string().uuid(),
    associatedAt: IsoDateSchema,
    eventRevision: z.number().int().min(1).optional(),
    leadHeadlineFingerprint: z.string().min(1).max(1_500).optional(),
  })
  .strict();

export const WorldJourneyTransitionSchema = z
  .object({
    sourceEventId: z.string().uuid(),
    sourceEventTitle: z.string().min(1).max(240),
    sourceScenarioNodeId: z.string().uuid(),
    sourceScenarioTitle: z.string().min(1).max(100),
    targetEventId: z.string().uuid(),
    targetEventTitle: z.string().min(1).max(240),
    influence: z.enum([
      "raises_likelihood",
      "lowers_likelihood",
      "accelerates",
      "delays",
      "amplifies_impact",
      "reduces_pressure",
      "creates_dependency",
    ]),
  })
  .strict();

export const WorldJourneySchema = z
  .object({
    transitions: z
      .array(WorldJourneyTransitionSchema)
      .max(MAX_WORLD_JOURNEY_TRANSITIONS),
    updatedAt: IsoDateSchema,
  })
  .strict();

export const WorldStorageEnvelopeSchema = z
  .object({
    version: z.literal(1),
    graphAssociations: z.record(z.string().uuid(), WorldGraphAssociationSchema),
    atlasByEvent: z.record(z.string().uuid(), z.string().uuid()),
    journeys: z.record(z.string().uuid(), WorldJourneySchema),
    countedRippleAnalyses: z.array(z.string().min(73).max(110)).max(100),
    focusedEventId: z.string().uuid().nullable(),
    updatedAt: IsoDateSchema,
  })
  .strict();

export type WorldGraphAssociation = z.infer<typeof WorldGraphAssociationSchema>;
export type WorldJourneyTransition = z.infer<typeof WorldJourneyTransitionSchema>;
export type WorldJourney = z.infer<typeof WorldJourneySchema>;
export type WorldStorageEnvelope = z.infer<typeof WorldStorageEnvelopeSchema>;

export type WorldStorageLoadResult = {
  envelope: WorldStorageEnvelope;
  warning: string | null;
};

export function createWorldStorageEnvelope(
  now = new Date().toISOString(),
): WorldStorageEnvelope {
  return WorldStorageEnvelopeSchema.parse({
    version: 1,
    graphAssociations: {},
    atlasByEvent: {},
    journeys: {},
    countedRippleAnalyses: [],
    focusedEventId: null,
    updatedAt: now,
  });
}

export function parseWorldStorageEnvelope(raw: string) {
  try {
    return WorldStorageEnvelopeSchema.safeParse(JSON.parse(raw));
  } catch {
    return WorldStorageEnvelopeSchema.safeParse(null);
  }
}

export function loadWorldStorageEnvelope(
  storage: WorldStorageLike,
  now = new Date().toISOString(),
): WorldStorageLoadResult {
  try {
    const raw = storage.getItem(WORLD_STORAGE_KEY);
    if (!raw) return { envelope: createWorldStorageEnvelope(now), warning: null };
    const parsed = parseWorldStorageEnvelope(raw);
    if (parsed.success) return { envelope: parsed.data, warning: null };
    return {
      envelope: createWorldStorageEnvelope(now),
      warning: "Saved World in Motion context was unreadable, so it was reset safely.",
    };
  } catch {
    return {
      envelope: createWorldStorageEnvelope(now),
      warning: "World in Motion browser storage is unavailable.",
    };
  }
}

export function saveWorldStorageEnvelope(
  storage: WorldStorageLike,
  envelope: WorldStorageEnvelope,
) {
  const parsed = WorldStorageEnvelopeSchema.parse(envelope);
  storage.setItem(WORLD_STORAGE_KEY, JSON.stringify(parsed));
  return parsed;
}

export function worldLeadHeadlineFingerprint(headline: HeadlineItem) {
  return JSON.stringify({
    id: headline.id,
    title: headline.title,
    publisher: headline.publisher,
    publisherUrl: headline.publisherUrl,
    googleNewsUrl: headline.googleNewsUrl,
    publishedAt: headline.publishedAt,
  });
}

export function associateWorldAtlas(
  envelope: WorldStorageEnvelope,
  {
    eventId,
    graphId,
    at,
    eventRevision,
    leadHeadlineFingerprint,
  }: {
    eventId: string;
    graphId: string;
    at: string;
    eventRevision?: number;
    leadHeadlineFingerprint?: string;
  },
) {
  const graphAssociations = { ...envelope.graphAssociations };
  const atlasByEvent = { ...envelope.atlasByEvent };

  const previousGraphId = atlasByEvent[eventId];
  if (previousGraphId && previousGraphId !== graphId) {
    delete graphAssociations[previousGraphId];
  }

  graphAssociations[graphId] = {
    eventId,
    associatedAt: at,
    ...(eventRevision === undefined ? {} : { eventRevision }),
    ...(leadHeadlineFingerprint === undefined
      ? {}
      : { leadHeadlineFingerprint }),
  };
  atlasByEvent[eventId] = graphId;

  return WorldStorageEnvelopeSchema.parse({
    ...envelope,
    graphAssociations,
    atlasByEvent,
    focusedEventId: eventId,
    updatedAt: at,
  });
}

export function replaceWorldAtlas(
  envelope: WorldStorageEnvelope,
  {
    previousGraphId,
    nextGraphId,
    at,
    eventRevision,
    leadHeadlineFingerprint,
  }: {
    previousGraphId: string;
    nextGraphId: string;
    at: string;
    eventRevision?: number;
    leadHeadlineFingerprint?: string;
  },
) {
  const association = envelope.graphAssociations[previousGraphId];
  if (!association) return envelope;

  const next = removeWorldAtlas(envelope, previousGraphId, at);
  const associated = associateWorldAtlas(next, {
    eventId: association.eventId,
    graphId: nextGraphId,
    at,
    eventRevision: eventRevision ?? association.eventRevision,
    leadHeadlineFingerprint:
      leadHeadlineFingerprint ?? association.leadHeadlineFingerprint,
  });
  const journey = envelope.journeys[previousGraphId];
  if (!journey) return associated;

  return WorldStorageEnvelopeSchema.parse({
    ...associated,
    journeys: {
      ...associated.journeys,
      [nextGraphId]: { ...journey, updatedAt: at },
    },
    updatedAt: at,
  });
}

export function removeWorldAtlas(
  envelope: WorldStorageEnvelope,
  graphId: string,
  at: string,
) {
  const graphAssociations = { ...envelope.graphAssociations };
  const atlasByEvent = { ...envelope.atlasByEvent };
  const journeys = { ...envelope.journeys };
  const association = graphAssociations[graphId];

  delete graphAssociations[graphId];
  delete journeys[graphId];
  if (association && atlasByEvent[association.eventId] === graphId) {
    delete atlasByEvent[association.eventId];
  }

  return WorldStorageEnvelopeSchema.parse({
    ...envelope,
    graphAssociations,
    atlasByEvent,
    journeys,
    focusedEventId:
      association?.eventId === envelope.focusedEventId
        ? null
        : envelope.focusedEventId,
    updatedAt: at,
  });
}

export function appendWorldJourney(
  envelope: WorldStorageEnvelope,
  {
    sourceGraphId,
    targetGraphId,
    transition,
    at,
  }: {
    sourceGraphId: string;
    targetGraphId: string;
    transition: WorldJourneyTransition;
    at: string;
  },
) {
  const previous = envelope.journeys[sourceGraphId]?.transitions ?? [];
  const transitions = [...previous, WorldJourneyTransitionSchema.parse(transition)].slice(
    -MAX_WORLD_JOURNEY_TRANSITIONS,
  );
  return WorldStorageEnvelopeSchema.parse({
    ...envelope,
    journeys: {
      ...envelope.journeys,
      [targetGraphId]: { transitions, updatedAt: at },
    },
    focusedEventId: transition.targetEventId,
    updatedAt: at,
  });
}

export function focusWorldEvent(
  envelope: WorldStorageEnvelope,
  eventId: string | null,
  at: string,
) {
  return WorldStorageEnvelopeSchema.parse({
    ...envelope,
    focusedEventId: eventId,
    updatedAt: at,
  });
}

export function rippleAnalysisKey(graphId: string, scenarioNodeId: string) {
  return `${graphId}:${scenarioNodeId}`;
}

export function recordCountedRippleAnalysis(
  envelope: WorldStorageEnvelope,
  analysisKey: string,
  at: string,
) {
  if (envelope.countedRippleAnalyses.includes(analysisKey)) {
    return { envelope, newlyCounted: false } as const;
  }
  return {
    envelope: WorldStorageEnvelopeSchema.parse({
      ...envelope,
      countedRippleAnalyses: [...envelope.countedRippleAnalyses, analysisKey].slice(-100),
      updatedAt: at,
    }),
    newlyCounted: true,
  } as const;
}

export function pruneWorldStorage(
  envelope: WorldStorageEnvelope,
  validGraphIds: Iterable<string>,
  at = envelope.updatedAt,
) {
  const valid = new Set(validGraphIds);
  const graphAssociations = Object.fromEntries(
    Object.entries(envelope.graphAssociations).filter(([graphId]) => valid.has(graphId)),
  );
  const atlasByEvent = Object.fromEntries(
    Object.entries(envelope.atlasByEvent).filter(([, graphId]) => valid.has(graphId)),
  );
  const journeys = Object.fromEntries(
    Object.entries(envelope.journeys).filter(([graphId]) => valid.has(graphId)),
  );
  const countedRippleAnalyses = envelope.countedRippleAnalyses.filter((analysisKey) =>
    valid.has(analysisKey.slice(0, 36)),
  );
  const changed =
    Object.keys(graphAssociations).length !== Object.keys(envelope.graphAssociations).length ||
    Object.keys(atlasByEvent).length !== Object.keys(envelope.atlasByEvent).length ||
    Object.keys(journeys).length !== Object.keys(envelope.journeys).length ||
    countedRippleAnalyses.length !== envelope.countedRippleAnalyses.length;

  return WorldStorageEnvelopeSchema.parse({
    ...envelope,
    graphAssociations,
    atlasByEvent,
    journeys,
    countedRippleAnalyses,
    focusedEventId:
      envelope.focusedEventId && atlasByEvent[envelope.focusedEventId]
        ? envelope.focusedEventId
        : null,
    updatedAt: changed ? at : envelope.updatedAt,
  });
}

export function clearWorldStorage(storage: WorldStorageLike) {
  storage.removeItem(WORLD_STORAGE_KEY);
}

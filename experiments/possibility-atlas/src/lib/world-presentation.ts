import type {
  RippleEdge,
  WorldEventSummary,
  WorldEventsResponse,
  WorldRefreshResponse,
} from "./world-contracts";
import type { WorldJourneyTransition } from "./world-storage";

const influencePhrases: Record<RippleEdge["influence"], string> = {
  raises_likelihood: "raise the likelihood of",
  lowers_likelihood: "lower the likelihood of",
  accelerates: "accelerate",
  delays: "delay",
  amplifies_impact: "amplify the impact of",
  reduces_pressure: "reduce pressure on",
  creates_dependency: "create a dependency for",
};

export type ScenarioSources = {
  atlasGraphs?: ReadonlyArray<{
    nodes: Readonly<Record<string, { title: string }>>;
  }>;
  transitions?: ReadonlyArray<WorldJourneyTransition>;
};

export type PresentedCrossCurrent = {
  edge: RippleEdge;
  source: WorldEventSummary;
  target: WorldEventSummary;
  scenarioTitle: string | null;
};

export function eventActionLabel(event: WorldEventSummary) {
  if (event.state === "candidate") return "Verify & explore event";
  if (event.state === "verified") return "Open event atlas";
  return "Event inactive";
}

export function influencePhrase(influence: RippleEdge["influence"]) {
  return influencePhrases[influence];
}

export function formatWorldFreshness(
  value: string | null,
  now = Date.now(),
) {
  if (!value) return "No saved scan yet";
  const scannedAt = Date.parse(value);
  if (!Number.isFinite(scannedAt)) return "Saved scan available";
  const elapsed = Math.max(0, now - scannedAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function clusterCountLabel(count: number) {
  return `${count} active event ${count === 1 ? "cluster" : "clusters"}`;
}

export function worldRefreshCompletionMessage(
  result: Pick<WorldRefreshResponse, "events" | "feed" | "meta">,
) {
  const clusters = clusterCountLabel(result.events.length);
  if (result.feed.stale) {
    const warning = result.feed.warning ?? "The headline feed returned a saved fallback.";
    return `Scan paused · ${warning} The saved world snapshot was retained without reclassification; ${clusters} remain available.`;
  }
  if (result.meta.mode === "fixture") {
    return `Scan complete · ${clusters} loaded from fixture data. No paid call was used.`;
  }
  if (result.meta.cacheStatus === "hit") {
    return `Scan complete · ${clusters}. The saved clustering was retained without another model call.`;
  }
  return `Scan complete · ${clusters} built from the headline set returned by the feed.`;
}

export function resolveScenarioTitle(
  edge: RippleEdge,
  { atlasGraphs = [], transitions = [] }: ScenarioSources = {},
) {
  if (edge.sourceScenarioTitle) return edge.sourceScenarioTitle;
  for (const graph of atlasGraphs) {
    const scenario = graph.nodes[edge.sourceScenarioNodeId];
    if (scenario?.title) return scenario.title;
  }
  const transition = transitions.find(
    (item) =>
      item.sourceEventId === edge.sourceEventId &&
      item.sourceScenarioNodeId === edge.sourceScenarioNodeId &&
      item.targetEventId === edge.targetEventId,
  );
  return transition?.sourceScenarioTitle ?? null;
}

export function presentCrossCurrents(
  catalog: Pick<WorldEventsResponse, "events" | "crossCurrents"> | null,
  scenarioSources: ScenarioSources = {},
) {
  if (!catalog) return [];
  const eventsById = new Map(catalog.events.map((event) => [event.id, event]));
  return catalog.crossCurrents.flatMap((edge): PresentedCrossCurrent[] => {
    const source = eventsById.get(edge.sourceEventId);
    const target = eventsById.get(edge.targetEventId);
    if (!source || !target) return [];
    return [
      {
        edge,
        source,
        target,
        scenarioTitle: resolveScenarioTitle(edge, scenarioSources),
      },
    ];
  });
}

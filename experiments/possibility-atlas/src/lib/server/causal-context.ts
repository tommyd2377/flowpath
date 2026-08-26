import type { ExpandAtlasRequest } from "../contracts";
import type { WorldRepository } from "./world-repository";
import { AtlasApiError } from "./http";

type CausalContext = NonNullable<ExpandAtlasRequest["causalContext"]>;

function invalidCausalContext(message: string) {
  return new AtlasApiError({
    code: "causal_context_stale",
    message,
    status: 409,
    retryable: false,
    callConsumed: false,
  });
}

export async function validatePersistedCausalContext(input: {
  context: CausalContext;
  targetWorldEventId: string | null;
  repository: Pick<
    WorldRepository,
    "getCatalogMetadata" | "getRippleAnalysis" | "getWorldEvent"
  >;
}) {
  const context = input.context;
  if (
    !input.targetWorldEventId ||
    input.targetWorldEventId !== context.targetEventId ||
    context.sourceEventId === context.targetEventId
  ) {
    throw invalidCausalContext(
      "This conditional chain does not belong to the current world atlas.",
    );
  }

  const [metadata, sourceEvent, targetEvent] = await Promise.all([
    input.repository.getCatalogMetadata(),
    input.repository.getWorldEvent(context.sourceEventId),
    input.repository.getWorldEvent(context.targetEventId),
  ]);
  if (
    !sourceEvent ||
    sourceEvent.state !== "verified" ||
    sourceEvent.canonicalTitle !== context.sourceEventTitle ||
    !targetEvent ||
    targetEvent.state !== "verified" ||
    targetEvent.canonicalTitle !== context.targetEventTitle
  ) {
    throw invalidCausalContext(
      "One of the events in this conditional chain has changed.",
    );
  }

  const edges = await input.repository.getRippleAnalysis({
    graphId: context.sourceGraphId,
    scenarioNodeId: context.sourceScenarioNodeId,
    catalogVersion: metadata.catalogVersion,
  });
  const matches = edges?.filter(
    (edge) =>
      edge.sourceEventId === context.sourceEventId &&
      edge.sourceScenarioNodeId === context.sourceScenarioNodeId &&
      edge.sourceScenarioTitle === context.sourceScenarioTitle &&
      edge.sourceScenarioSummary === context.sourceScenarioSummary &&
      edge.targetEventId === context.targetEventId &&
      edge.influence === context.influence &&
      edge.mechanism === context.mechanism,
  );
  if (!matches || matches.length !== 1) {
    throw invalidCausalContext(
      "This conditional ripple is no longer available. Recheck ripple links before continuing it.",
    );
  }
  return structuredClone(context);
}

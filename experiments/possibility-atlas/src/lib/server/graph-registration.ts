import {
  RegisterAtlasRequestSchema,
  RegisterAtlasResponseSchema,
  type RegisterAtlasRequest,
  type LineageNode,
  type PossibilityNode,
} from "../contracts";
import { validatePersistedCausalContext } from "./causal-context";
import {
  createFixtureExpansionResponse,
  createFixtureStartResponse,
} from "./fixtures";
import {
  EXPANSION_PROMPT_VERSION,
  ExpansionGenerationTemplateSchema,
  expansionResponseToTemplate,
  generationCacheKey,
  generationFingerprint,
  possibilityTemplateFromNode,
  semanticExpansionSource,
  semanticSnapshotFingerprint,
  snapshotTemplateFromSnapshot,
  START_PROMPT_VERSION,
  StartGenerationTemplateSchema,
  startResponseToTemplate,
  type ExpansionGenerationTemplate,
  type StartGenerationTemplate,
} from "./generation-templates";
import {
  restoreRegisteredGraph,
  validateSavedGraphForRegistration,
} from "./graph-registry";
import { AtlasApiError } from "./http";
import { atlasSafetyIdentifier, seedAtlasCallCount } from "./request-guard";
import { createFixtureWorldClassification } from "./world-fixtures";
import type { WorldRepository } from "./world-repository";

async function getRawStartTemplate(key: string) {
  const { getRawGenerationTemplate } = await import("./raw-generation-cache");
  return getRawGenerationTemplate(key, StartGenerationTemplateSchema);
}

async function getRawExpansionTemplate(key: string) {
  const { getRawGenerationTemplate } = await import("./raw-generation-cache");
  return getRawGenerationTemplate(key, ExpansionGenerationTemplateSchema);
}

function provenanceMismatch() {
  return new AtlasApiError({
    code: "world_scenario_provenance_mismatch",
    message:
      "The saved primary scenarios do not match the verified world analysis.",
    status: 409,
    retryable: false,
    callConsumed: false,
  });
}

function graphMatchesStartTemplate(
  graph: RegisterAtlasRequest["graph"],
  template: StartGenerationTemplate,
  capturedAt?: string,
) {
  if (template.kind !== "atlas" || !graph.snapshot) return false;
  const roots = graph.rootChildIds.map((id) => graph.nodes[id]);
  if (roots.some((node) => !node)) return false;
  return (
    (!capturedAt || graph.snapshot.capturedAt === capturedAt) &&
    generationFingerprint(snapshotTemplateFromSnapshot(graph.snapshot)) ===
      generationFingerprint(template.snapshot) &&
    generationFingerprint(roots.map((node) => possibilityTemplateFromNode(node!))) ===
      generationFingerprint(template.branches)
  );
}

function lineageNodeFrom(node: PossibilityNode): LineageNode {
  return {
    id: node.id,
    parentId: node.parentId,
    depth: node.depth,
    title: node.title,
    summary: node.summary,
    whyPlausible: node.whyPlausible,
    keyAssumption: node.keyAssumption,
    horizon: node.horizon,
  };
}

function lineageForSavedNode(
  graph: RegisterAtlasRequest["graph"],
  nodeId: string,
) {
  const lineage: LineageNode[] = [];
  let current: PossibilityNode | undefined = graph.nodes[nodeId];
  while (current) {
    lineage.unshift(lineageNodeFrom(current));
    current =
      current.parentId === graph.id
        ? undefined
        : graph.nodes[current.parentId];
  }
  return lineage;
}

function completedExpansionTemplate(
  graph: RegisterAtlasRequest["graph"],
  parent: PossibilityNode,
): ExpansionGenerationTemplate | null {
  if (parent.childIds.length > 0) {
    return ExpansionGenerationTemplateSchema.parse({
      kind: "branches",
      branches: parent.childIds.map((id) =>
        possibilityTemplateFromNode(graph.nodes[id]!),
      ),
    });
  }
  if (parent.depth < 5 && parent.status === "leaf") {
    if (!parent.leafReason) {
      throw new AtlasApiError({
        code: "atlas_expansion_provenance_mismatch",
        message: "A saved terminal path is missing its original analysis.",
        status: 409,
        retryable: false,
        callConsumed: false,
      });
    }
    return ExpansionGenerationTemplateSchema.parse({
      kind: "leaf",
      reason: parent.leafReason,
    });
  }
  return null;
}

function possibleHistoricalBranchCaps(template: ExpansionGenerationTemplate) {
  const minimum = template.kind === "branches" ? template.branches.length : 3;
  return Array.from({ length: 6 - minimum }, (_, index) => minimum + index);
}

function blockSavedSubtree(
  graph: RegisterAtlasRequest["graph"],
  nodeId: string,
  blocked: Set<string>,
) {
  if (blocked.has(nodeId)) return;
  blocked.add(nodeId);
  for (const childId of graph.nodes[nodeId]?.childIds ?? []) {
    blockSavedSubtree(graph, childId, blocked);
  }
}

async function proveSavedExpansions(input: {
  graph: RegisterAtlasRequest["graph"];
  installationId: string;
  mode: "live" | "fixture";
  model: string;
  repository: WorldRepository | null;
  causalContext?: RegisterAtlasRequest["causalContext"];
}) {
  const blocked = new Set<string>();
  const visit = async (nodeId: string): Promise<void> => {
    const parent = input.graph.nodes[nodeId];
    if (!parent) return;
    const savedTemplate = completedExpansionTemplate(input.graph, parent);
    if (!savedTemplate) return;

    const lineage = lineageForSavedNode(input.graph, parent.id);
    let foundRecord = false;
    let matched = false;
    for (const maxBranches of possibleHistoricalBranchCaps(savedTemplate)) {
      const source = semanticExpansionSource({
        snapshot: input.graph.snapshot!,
        lineage,
        maxBranches,
        causalContext: input.causalContext,
      });
      let candidate: ExpansionGenerationTemplate | null = null;
      if (input.mode === "fixture") {
        candidate = expansionResponseToTemplate(
          createFixtureExpansionResponse({
            installationId: input.installationId,
            graphId: input.graph.id,
            parentId: parent.id,
            snapshot: input.graph.snapshot!,
            lineage,
            remainingNodeCapacity: maxBranches,
            ...(input.causalContext
              ? { causalContext: input.causalContext }
              : {}),
          }),
        );
      } else {
        const cacheKey = generationCacheKey({
          kind: "expand",
          model: input.model,
          promptVersion: EXPANSION_PROMPT_VERSION,
          source,
        });
        const cached = input.repository
          ? await input.repository.getGenerationTemplate(
              cacheKey,
              ExpansionGenerationTemplateSchema,
            )
          : await getRawExpansionTemplate(cacheKey);
        candidate = cached?.payload ?? null;
      }
      if (!candidate) continue;
      foundRecord = true;
      if (
        generationFingerprint(candidate) ===
        generationFingerprint(savedTemplate)
      ) {
        matched = true;
        break;
      }
    }

    if (!matched) {
      if (foundRecord || input.mode === "fixture") {
        throw new AtlasApiError({
          code: "atlas_expansion_provenance_mismatch",
          message:
            "A saved path does not match its original analysis and cannot be resumed.",
          status: 409,
          retryable: false,
          callConsumed: false,
        });
      }
      for (const childId of parent.childIds) {
        blockSavedSubtree(input.graph, childId, blocked);
      }
      return;
    }

    for (const childId of parent.childIds) await visit(childId);
  };

  for (const rootId of input.graph.rootChildIds) await visit(rootId);
  return [...blocked];
}

export async function registerSavedAtlas(
  rawInput: RegisterAtlasRequest,
  options: {
    mode: "live" | "fixture";
    getAtlasModel: () => string;
    getWorldAtlasModel: () => string;
    getWorldRepository: () => WorldRepository;
  },
) {
  const input = RegisterAtlasRequestSchema.parse(rawInput);
  if (input.expectedMode !== options.mode) {
    throw new AtlasApiError({
      code: "atlas_mode_mismatch",
      message:
        "This saved atlas was created in a different analysis mode and cannot resume here.",
      status: 409,
      retryable: false,
      callConsumed: false,
    });
  }
  validateSavedGraphForRegistration(input.graph);

  if (input.causalContext && !input.worldAssociation) {
    throw new AtlasApiError({
      code: "causal_context_stale",
      message:
        "A conditional chain can only resume inside its registered world event.",
      status: 409,
      retryable: false,
      callConsumed: false,
    });
  }

  let repository: WorldRepository | null = null;
  let model: string;
  let worldEventId: string | undefined;
  let expansionEligible = true;
  let rippleEligible = false;
  if (input.worldAssociation) {
    repository = options.getWorldRepository();
    await repository.initialize();
    let detail = await repository.getWorldEventDetail(
      input.worldAssociation.eventId,
    );
    if (!detail && options.mode === "fixture") {
      await repository.commitClassification(createFixtureWorldClassification());
      detail = await repository.getWorldEventDetail(
        input.worldAssociation.eventId,
      );
    }
    if (
      !detail ||
      (options.mode === "live" && detail.event.state !== "verified") ||
      detail.event.state === "inactive" ||
      detail.event.revision !== input.worldAssociation.eventRevision
    ) {
      throw new AtlasApiError({
        code: "world_event_changed",
        message:
          "This saved atlas belongs to an older version of the world event.",
        status: 409,
        retryable: false,
        callConsumed: false,
      });
    }
    if (
      generationFingerprint(detail.event.leadHeadline) !==
      generationFingerprint(input.graph.headline)
    ) {
      throw new AtlasApiError({
        code: "world_provenance_mismatch",
        message: "This saved atlas no longer matches the verified world event.",
        status: 409,
        retryable: false,
        callConsumed: false,
      });
    }
    worldEventId = detail.event.id;
    model = options.getWorldAtlasModel();
    if (options.mode === "fixture") {
      const expected = createFixtureStartResponse({
        installationId: input.installationId,
        graphId: input.graph.id,
        headline: detail.event.leadHeadline,
        worldEventId,
      });
      const template = startResponseToTemplate(expected);
      if (
        expected.kind !== "atlas" ||
        !graphMatchesStartTemplate(
          input.graph,
          template,
          expected.snapshot.capturedAt,
        )
      ) {
        throw provenanceMismatch();
      }
      if (detail.event.state !== "verified") {
        await repository.markEventVerified(detail.event.id, expected.snapshot);
      } else if (
        !detail.verifiedSnapshot ||
        semanticSnapshotFingerprint(detail.verifiedSnapshot) !==
          semanticSnapshotFingerprint(input.graph.snapshot!)
      ) {
        throw new AtlasApiError({
          code: "world_provenance_mismatch",
          message: "This saved atlas no longer matches the verified world event.",
          status: 409,
          retryable: false,
          callConsumed: false,
        });
      }
      rippleEligible = true;
    } else {
      if (
        !input.graph.snapshot ||
        !detail.verifiedSnapshot ||
        semanticSnapshotFingerprint(detail.verifiedSnapshot) !==
          semanticSnapshotFingerprint(input.graph.snapshot)
      ) {
        throw new AtlasApiError({
          code: "world_provenance_mismatch",
          message: "This saved atlas no longer matches the verified world event.",
          status: 409,
          retryable: false,
          callConsumed: false,
        });
      }
      const source = {
        worldEventId: detail.event.id,
        revision: detail.event.revision,
      };
      const cacheKey = generationCacheKey({
        kind: "start",
        model,
        promptVersion: START_PROMPT_VERSION,
        source,
      });
      const cached = await repository.getGenerationTemplate(
        cacheKey,
        StartGenerationTemplateSchema,
      );
      if (!cached) {
        expansionEligible = false;
      } else {
        if (!graphMatchesStartTemplate(input.graph, cached.payload, cached.createdAt)) {
          throw provenanceMismatch();
        }
        rippleEligible = true;
      }
    }
  } else {
    model = options.getAtlasModel();
    if (options.mode === "fixture") {
      const expected = createFixtureStartResponse({
        installationId: input.installationId,
        graphId: input.graph.id,
        headline: input.graph.headline,
      });
      if (
        expected.kind !== "atlas" ||
        !graphMatchesStartTemplate(
          input.graph,
          startResponseToTemplate(expected),
          expected.snapshot.capturedAt,
        )
      ) {
        throw new AtlasApiError({
          code: "atlas_provenance_mismatch",
          message: "The saved atlas does not match its original analysis.",
          status: 409,
          retryable: false,
          callConsumed: false,
        });
      }
    } else {
      const cacheKey = generationCacheKey({
        kind: "start",
        model,
        promptVersion: START_PROMPT_VERSION,
        source: input.graph.headline,
      });
      const cached = await getRawStartTemplate(cacheKey);
      if (!cached) {
        expansionEligible = false;
      } else if (
        !graphMatchesStartTemplate(input.graph, cached.payload, cached.createdAt)
      ) {
        throw new AtlasApiError({
          code: "atlas_provenance_mismatch",
          message: "The saved atlas does not match its original analysis.",
          status: 409,
          retryable: false,
          callConsumed: false,
        });
      }
    }
  }

  const causalContext = input.causalContext
    ? await validatePersistedCausalContext({
        context: input.causalContext,
        targetWorldEventId: worldEventId ?? null,
        repository: repository!,
      })
    : undefined;
  const blockedExpansionNodeIds = expansionEligible
    ? await proveSavedExpansions({
        graph: input.graph,
        installationId: input.installationId,
        mode: options.mode,
        model,
        repository,
        causalContext,
      })
    : [];

  let durableUsage = {
    callsUsed: input.graph.callsUsed,
    ownerMatches: true,
  };
  try {
    const callLedger = repository ?? options.getWorldRepository();
    await callLedger.initialize();
    durableUsage = await callLedger.seedAtlasCallUsage({
      installationKey: atlasSafetyIdentifier(input.installationId),
      graphId: input.graph.id,
      callsUsed: input.graph.callsUsed,
    });
  } catch (error) {
    if (repository) throw error;
    // Standalone headline atlases remain browsable when the additive world
    // database is unavailable. The in-process guard is seeded below.
  }
  if (!durableUsage.ownerMatches) {
    throw new AtlasApiError({
      code: "graph_conflict",
      message: "This graph identifier belongs to another local installation.",
      status: 409,
      retryable: false,
      callConsumed: false,
    });
  }

  const restored = restoreRegisteredGraph(
    { installationId: input.installationId, graph: input.graph },
    {
      mode: options.mode,
      model,
      worldEventId,
      expansionEligible,
      blockedExpansionNodeIds,
      rippleEligible,
    },
  );
  seedAtlasCallCount({
    installationId: input.installationId,
    graphId: input.graph.id,
    callsUsed: durableUsage.callsUsed,
  });
  return RegisterAtlasResponseSchema.parse({
    ok: true,
    ...restored,
    callsUsed: durableUsage.callsUsed,
  });
}

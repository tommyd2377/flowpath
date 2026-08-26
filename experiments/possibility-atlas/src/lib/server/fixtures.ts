import { createHash } from "node:crypto";

import {
  EventSnapshotSchema,
  ExpandAtlasResponseSchema,
  PossibilityNodeSchema,
  StartAtlasRequestSchema,
  StartAtlasResponseSchema,
  type ExpandAtlasResponse,
  type PossibilityNode,
  type StartAtlasResponse,
} from "../contracts";
import type { WorldEventSummary } from "../world-contracts";
import {
  RippleGenerationTemplateSchema,
  type RippleGenerationTemplate,
} from "./generation-templates";
import type { ExpandAtlasRequest } from "./branch";
import { validateExpansionContext } from "./branch";

function deterministicUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4];
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

const fixtureBranches = [
  {
    title: "Policy response accelerates",
    summary: "Public institutions respond sooner than expected, changing the near-term path.",
    whyPlausible: "The fixture assumes visible pressure creates incentives for a coordinated response.",
    keyAssumption: "Decision-makers view delay as more costly than action.",
    watchFor: ["A formal announcement", "A concrete implementation date"],
    lessLikelyIf: "Officials signal that no near-term response is planned.",
    horizon: "Coming weeks",
  },
  {
    title: "Adjustment remains gradual",
    summary: "The event matters, but institutions and affected groups adapt in smaller steps.",
    whyPlausible: "Incremental adaptation is common when incentives are mixed and details remain unsettled.",
    keyAssumption: "No single actor can force a rapid resolution.",
    watchFor: ["Pilot measures", "Revised guidance"],
    lessLikelyIf: "A binding deadline forces an immediate decision.",
    horizon: "One to three months",
  },
  {
    title: "Attention shifts elsewhere",
    summary: "A competing development reduces momentum and leaves the current event partly unresolved.",
    whyPlausible: "News and institutional attention are finite, especially without a fresh trigger.",
    keyAssumption: "No additional high-salience evidence appears.",
    watchFor: ["Falling coverage", "Postponed decisions"],
    lessLikelyIf: "New evidence renews public or institutional pressure.",
    horizon: "Next several weeks",
  },
] as const;

export function createFixtureStartResponse(
  rawInput: Parameters<typeof StartAtlasRequestSchema.parse>[0],
): StartAtlasResponse {
  const input = StartAtlasRequestSchema.parse(rawInput);
  const sources = [
    {
      id: "s01",
      title: "Fixture source A — not live reporting",
      url: `https://source-a.example/fixture/${encodeURIComponent(input.headline.id)}`,
      domain: "source-a.example",
    },
    {
      id: "s02",
      title: "Fixture source B — not live reporting",
      url: `https://source-b.example/fixture/${encodeURIComponent(input.headline.id)}`,
      domain: "source-b.example",
    },
  ];
  const snapshot = EventSnapshotSchema.parse({
    id: deterministicUuid(`${input.graphId}:snapshot`),
    headline: input.headline,
    capturedAt: "2026-08-25T16:00:00.000Z",
    verificationStatus: "corroborated",
    summary: `Fixture-only snapshot for local UI development: ${input.headline.title}`,
    facts: [
      {
        text: "This is deterministic fixture content and was not produced by a live search.",
        sourceIds: ["s01", "s02"],
      },
    ],
    uncertainties: ["Fixture mode does not verify the selected headline."],
    sources,
  });
  const nodes = fixtureBranches.map((branch, index) =>
    PossibilityNodeSchema.parse({
      id: deterministicUuid(`${input.graphId}:root:${index}`),
      parentId: input.graphId,
      depth: 1,
      ...branch,
      watchFor: [...branch.watchFor],
      childIds: [],
      status: "ready",
      errorMessage: null,
      leafReason: null,
    }),
  );
  return StartAtlasResponseSchema.parse({
    ok: true,
    kind: "atlas",
    snapshot,
    nodes,
    meta: { mode: "fixture", callConsumed: false, cacheStatus: "miss" },
  });
}

export function createFixtureExpansionResponse(
  rawInput: ExpandAtlasRequest,
): ExpandAtlasResponse {
  const { input, nextDepth, maxBranches } = validateExpansionContext(rawInput);
  const parentTitle = input.lineage.at(-1)?.title ?? "Selected path";
  const nodes: PossibilityNode[] = fixtureBranches
    .slice(0, maxBranches)
    .map((branch, index) => {
      const atDepthLimit = nextDepth === 5;
      return PossibilityNodeSchema.parse({
        id: deterministicUuid(`${input.graphId}:${input.parentId}:${nextDepth}:${index}`),
        parentId: input.parentId,
        depth: nextDepth,
        ...branch,
        title: `${branch.title} · from ${parentTitle}`.slice(0, 100),
        watchFor: [...branch.watchFor],
        childIds: [],
        status: atDepthLimit ? "leaf" : "ready",
        errorMessage: null,
        leafReason: atDepthLimit ? "Maximum atlas depth reached." : null,
      });
    });
  return ExpandAtlasResponseSchema.parse({
    ok: true,
    kind: "branches",
    parentId: input.parentId,
    nodes,
    meta: { mode: "fixture", callConsumed: false, cacheStatus: "miss" },
  });
}

export function createFixtureRippleTemplate(
  targets: WorldEventSummary[],
): RippleGenerationTemplate {
  const selected = targets.slice(0, 2);
  if (selected.length === 0) {
    return RippleGenerationTemplateSchema.parse({
      kind: "no_credible_links",
      reason: "The fixture catalog has no other eligible event to connect.",
    });
  }
  return RippleGenerationTemplateSchema.parse({
    kind: "ripples",
    links: selected.map((target, index) => ({
      targetEventId: target.id,
      influence: index === 0 ? "raises_likelihood" : "amplifies_impact",
      strength: index === 0 ? "strong" : "moderate",
      confidence: index === 0 ? "medium" : "low",
      mechanism:
        index === 0
          ? "Fixture-only: the selected scenario changes a shared economic pressure affecting the target event."
          : "Fixture-only: the scenario and target depend on overlapping institutional responses.",
      horizon: "Coming weeks",
      watchFor: ["A confirming policy announcement", "A measurable market response"],
    })),
  });
}

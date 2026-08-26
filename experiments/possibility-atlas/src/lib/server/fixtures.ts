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

type FixtureBranch = {
  title: string;
  summary: string;
  whyPlausible: string;
  keyAssumption: string;
  watchFor: readonly string[];
  lessLikelyIf: string;
  horizon: string;
};

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
] as const satisfies readonly FixtureBranch[];

const worldFixtureBranches: Record<
  string,
  readonly FixtureBranch[]
> = {
  "fixture-tariff-001": [
    {
      title: "Partners negotiate exemptions",
      summary:
        "Trading partners preserve the package while carving out product or country exemptions.",
      whyPlausible:
        "Targeted exemptions can reduce disruption without requiring either side to abandon its headline position.",
      keyAssumption: "Both sides value a negotiated off-ramp.",
      watchFor: ["Formal exemption talks", "Product-specific guidance"],
      lessLikelyIf: "Officials rule out waivers or staged implementation.",
      horizon: "Coming weeks",
    },
    {
      title: "Retaliation broadens the dispute",
      summary:
        "Affected partners answer with countermeasures that widen the number of exposed industries.",
      whyPlausible:
        "Counter-tariffs can create domestic leverage and signal that the initial package will be costly.",
      keyAssumption: "Negotiations fail to produce a credible concession.",
      watchFor: ["A retaliation list", "Industry lobbying"],
      lessLikelyIf: "A temporary standstill is announced.",
      horizon: "Two to eight weeks",
    },
    {
      title: "Implementation slips",
      summary:
        "Legal, administrative, or political constraints delay the tariff package without resolving it.",
      whyPlausible:
        "Complex customs rules and concentrated opposition can slow an announced policy.",
      keyAssumption: "Implementation details remain unsettled.",
      watchFor: ["Delayed customs guidance", "A legal challenge"],
      lessLikelyIf: "Binding collection dates and final schedules appear.",
      horizon: "One to three months",
    },
  ],
  "fixture-energy-001": [
    {
      title: "The shipping route reopens quickly",
      summary:
        "Traffic normalizes before inventories tighten enough to create a sustained energy shock.",
      whyPlausible:
        "Operators and authorities have strong incentives to restore a high-value route quickly.",
      keyAssumption: "The disruption remains operational rather than political.",
      watchFor: ["Vessel traffic resumes", "Freight rates ease"],
      lessLikelyIf: "New restrictions or damage assessments extend the closure.",
      horizon: "Days to weeks",
    },
    {
      title: "Restricted access becomes the new normal",
      summary:
        "Limited passage resumes, but inspections, insurance costs, or security rules keep capacity constrained.",
      whyPlausible:
        "A controlled-access compromise can reopen trade while the underlying dispute remains unresolved.",
      keyAssumption: "All sides prefer managed friction to a full closure.",
      watchFor: ["New transit rules", "Persistently higher insurance quotes"],
      lessLikelyIf: "Unrestricted passage is restored with security guarantees.",
      horizon: "Several weeks",
    },
    {
      title: "Disruption spreads to supply",
      summary:
        "Longer delays force rerouting or draw down inventories, pushing the event into physical energy availability.",
      whyPlausible:
        "Shipping bottlenecks become supply constraints when buffers are limited and alternate routes are slower.",
      keyAssumption: "The route remains impaired long enough to exhaust near-term buffers.",
      watchFor: ["Inventory draws", "Cargo diversions"],
      lessLikelyIf: "Spare logistics capacity absorbs delayed shipments.",
      horizon: "Two to six weeks",
    },
  ],
  "fixture-rates-001": [
    {
      title: "Rate cuts move later",
      summary:
        "Officials keep policy restrictive longer as the inflation outlook becomes less reassuring.",
      whyPlausible:
        "A less certain inflation path raises the cost of easing before price pressures are contained.",
      keyAssumption: "Incoming inflation evidence remains firm.",
      watchFor: ["Hawkish guidance", "Higher policy projections"],
      lessLikelyIf: "Several broad inflation measures cool together.",
      horizon: "Next policy meetings",
    },
    {
      title: "Officials look through the shock",
      summary:
        "The central bank treats the change as temporary and keeps its broader policy path intact.",
      whyPlausible:
        "Policy makers may avoid reacting to a narrow supply shock when demand is already slowing.",
      keyAssumption: "Longer-run expectations stay anchored.",
      watchFor: ["Temporary-shock language", "Stable longer-run expectations"],
      lessLikelyIf: "Price pressure spreads into wages or services.",
      horizon: "One to three months",
    },
    {
      title: "The committee divides",
      summary:
        "Conflicting growth and inflation signals produce a wider split over the next move.",
      whyPlausible:
        "Mixed evidence changes the balance of risks differently for officials with different mandates and forecasts.",
      keyAssumption: "Growth softens while inflation remains elevated.",
      watchFor: ["Dissenting votes", "Divergent public remarks"],
      lessLikelyIf: "New data point consistently in one direction.",
      horizon: "Coming meetings",
    },
  ],
  "fixture-election-001": [
    {
      title: "A centrist coalition forms",
      summary:
        "Mainstream parties accept a compromise platform to assemble a working majority.",
      whyPlausible:
        "Shared interest in avoiding another election can outweigh policy differences.",
      keyAssumption: "Party leaders can sell concessions internally.",
      watchFor: ["A joint negotiating text", "Cabinet allocation talks"],
      lessLikelyIf: "A major party withdraws from formal talks.",
      horizon: "Coming weeks",
    },
    {
      title: "A minority government takes office",
      summary:
        "One bloc governs without a durable majority and negotiates support vote by vote.",
      whyPlausible:
        "External support can break an impasse without a full coalition agreement.",
      keyAssumption: "Opposition parties tolerate a limited governing program.",
      watchFor: ["Confidence-and-supply talks", "A narrow policy program"],
      lessLikelyIf: "Opposition parties coordinate to block investiture.",
      horizon: "Several weeks",
    },
    {
      title: "Talks collapse into another vote",
      summary:
        "Coalition negotiations fail and constitutional deadlines push the country toward a repeat election.",
      whyPlausible:
        "Parties may prefer renewed campaigning to owning an unstable compromise.",
      keyAssumption: "No viable majority emerges before the deadline.",
      watchFor: ["Talks formally suspended", "Election preparations"],
      lessLikelyIf: "A mediator announces a shared governing framework.",
      horizon: "One to three months",
    },
  ],
};

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
  const branches = input.worldEventId
    ? (worldFixtureBranches[input.headline.id] ?? fixtureBranches)
    : fixtureBranches;
  const nodes = branches.map((branch, index) =>
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

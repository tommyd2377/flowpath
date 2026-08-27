import type { EventSnapshot, LineageNode } from "../contracts";
import type { InitialModelOutput, ModelPossibility } from "./model-contracts";
import type {
  AtlasParsedResponse,
  AtlasRequestOptions,
  AtlasResponsesAdapter,
  AtlasResponsesRequest,
} from "./openai-client";

export const TEST_UUIDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
  "00000000-0000-4000-8000-000000000006",
] as const;

export const headlineFixture = {
  id: "headline-fixture-001",
  title: "Example event changes the policy debate",
  publisher: "Example News",
  publisherUrl: "https://news.example/",
  googleNewsUrl: "https://news.google.com/rss/articles/example",
  publishedAt: "2026-08-25T12:00:00.000Z",
} as const;

export const sourceUrls = {
  alpha: "https://alpha.example/report",
  beta: "https://beta.example/briefing",
} as const;

export function modelBranch(
  index: number,
  overrides: Partial<ModelPossibility> = {},
): ModelPossibility {
  return {
    title: `Distinct path ${index}`,
    summary: `Summary for possibility path ${index}.`,
    whyPlausible: `Current evidence makes possibility path ${index} plausible.`,
    keyAssumption: `Assumption ${index} continues to hold.`,
    watchFor: [`Signal ${index}`],
    lessLikelyIf: `Counter-signal ${index} appears.`,
    horizon: "Next several weeks",
    sourceUrls: [index % 2 === 0 ? sourceUrls.beta : sourceUrls.alpha],
    ...overrides,
  };
}

export function initialParsedOutput(): InitialModelOutput {
  return {
    assessment: "corroborated" as const,
    summary: "Two independent fixture domains corroborate the core event.",
    facts: [
      {
        text: "The core event was reported by two independent domains.",
        sourceUrls: [sourceUrls.alpha, sourceUrls.beta],
      },
    ],
    uncertainties: ["The timing of any downstream response remains uncertain."],
    sources: [
      { title: "Alpha report", url: sourceUrls.alpha },
      { title: "Beta briefing", url: sourceUrls.beta },
    ],
    branches: [modelBranch(1), modelBranch(2), modelBranch(3)],
    insufficientReason: null,
  };
}

export function searchedResponse<T>(parsed: T): AtlasParsedResponse<T> {
  return {
    status: "completed",
    output_parsed: parsed,
    output: [
      {
        type: "web_search_call",
        id: "ws_fixture",
        status: "completed",
        action: {
          type: "search",
          query: "fixture query",
          sources: [
            {
              type: "url",
              url: `${sourceUrls.alpha}?utm_source=chatgpt.com`,
            },
            { type: "url", url: sourceUrls.beta },
          ],
        },
      },
      {
        type: "message",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "{}",
            annotations: [
              {
                type: "url_citation",
                url: sourceUrls.alpha,
                title: "Alpha citation title",
                start_index: 0,
                end_index: 2,
              },
              {
                type: "url_citation",
                url: sourceUrls.beta,
                title: "Beta citation title",
                start_index: 0,
                end_index: 2,
              },
            ],
          },
        ],
      },
    ],
  };
}

export class MockResponsesAdapter implements AtlasResponsesAdapter {
  readonly calls: Array<{
    request: AtlasResponsesRequest;
    options: AtlasRequestOptions;
  }> = [];

  constructor(
    private readonly responder:
      | AtlasParsedResponse<unknown>
      | ((request: AtlasResponsesRequest) => AtlasParsedResponse<unknown>),
  ) {}

  async parse<T>(request: AtlasResponsesRequest, options: AtlasRequestOptions) {
    this.calls.push({ request, options });
    const response =
      typeof this.responder === "function"
        ? this.responder(request)
        : this.responder;
    return response as AtlasParsedResponse<T>;
  }
}

export function testIdFactory() {
  let index = 0;
  return () => TEST_UUIDS[index++] ?? TEST_UUIDS[5];
}

export const snapshotFixture: EventSnapshot = {
  id: TEST_UUIDS[4],
  headline: headlineFixture,
  capturedAt: "2026-08-25T12:05:00.000Z",
  verificationStatus: "corroborated",
  summary: "Frozen fixture snapshot.",
  facts: [
    {
      text: "The event is supported by two sources.",
      sourceIds: ["s01", "s02"],
    },
  ],
  uncertainties: ["Downstream timing remains uncertain."],
  sources: [
    {
      id: "s01",
      title: "Alpha report",
      url: sourceUrls.alpha,
      domain: "alpha.example",
    },
    {
      id: "s02",
      title: "Beta briefing",
      url: sourceUrls.beta,
      domain: "beta.example",
    },
  ],
};

export function lineageNode(
  depth: 1 | 2 | 3 | 4 | 5,
  id = TEST_UUIDS[depth - 1],
  parentId =
    depth === 1
      ? "20000000-0000-4000-8000-000000000001"
      : TEST_UUIDS[depth - 2],
): LineageNode {
  return {
    id,
    parentId,
    depth,
    title: `Lineage path ${depth}`,
    summary: `Lineage summary ${depth}.`,
    whyPlausible: `Lineage evidence ${depth}.`,
    keyAssumption: `Lineage assumption ${depth}.`,
    horizon: "Next several weeks",
  };
}

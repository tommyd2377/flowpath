import { randomUUID } from "node:crypto";
import { z } from "zod";

import { HeadlineItemSchema, MAX_ATLAS_CALLS, MAX_ATLAS_NODES, type HeadlineItem, type PossibilityNode } from "./atlas/contracts";
import type { HeadlinesResponse } from "./atlas/server/feed";
import { getGenerationCacheRepository, GenerationCacheRepository } from "./atlas/server/generation-cache";
import { createGenerationService, type GenerationService } from "./atlas/server/generation-service";
import { readRegisteredGraph } from "./atlas/server/graph-registry";
import { AtlasApiError } from "./atlas/server/http";
import { atlasSafetyIdentifier } from "./atlas/server/request-guard";
import { createFollowupResearchService, type FollowupResearchService } from "./followup-research";
import { getVoiceStories, getVoiceStoryById } from "./story-catalog";
import { FIXTURE_HEADLINES, toStoryHeadline } from "./story-contracts";
import { emptyDisplay, displayResult, type ExplorationDisplay } from "./visual-contracts";

const IdSchema = z.string().uuid();
const EmptyArgs = z.object({}).strict();
const ChooseArgs = z.object({ nodeId: IdSchema }).strict();
const NavigateArgs = z.discriminatedUnion("target", [
  z.object({ target: z.literal("parent") }).strict(),
  z.object({ target: z.literal("root") }).strict(),
  z.object({ target: z.literal("node"), nodeId: IdSchema }).strict(),
]);
const CompareArgs = z.object({ nodeIds: z.array(IdSchema).min(2).max(5).refine(ids => new Set(ids).size === ids.length) }).strict();

export { FIXTURE_HEADLINES } from "./story-contracts";

export async function getVoiceHeadlines(): Promise<HeadlinesResponse> {
  if (process.env.VOICE_FIXTURE_MODE === "1") {
    if (process.env.NODE_ENV === "production") throw fail("fixture_mode_forbidden", "Fixture mode is unavailable in production.", 503);
    return { ok: true, items: structuredClone(FIXTURE_HEADLINES), fetchedAt: new Date().toISOString(), feedUpdatedAt: null, stale: false, warning: "Fixture mode: these headlines and analyses are simulated." };
  }
  const catalog = await getVoiceStories();
  return { ok: true, items: catalog.items.map(toStoryHeadline), fetchedAt: catalog.fetchedAt, feedUpdatedAt: null, stale: catalog.stale, warning: catalog.warning };
}

function fail(code: string, message: string, status = 400) {
  return new AtlasApiError({ code, message, status, retryable: false, callConsumed: false });
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw fail("invalid_exploration_request", "The requested exploration action is invalid.");
  return result.data;
}

type Story = { headline: HeadlineItem; graphId: string; focusedNodeId: string | null; visitedNodeIds: string[] };
type Graph = NonNullable<Awaited<ReturnType<typeof readRegisteredGraph>>>;
type WorkState = { epoch: number; tail: Promise<unknown>; controller: AbortController | null; selectionKey: string | null; selectionSignal: AbortSignal | null; selection: Promise<object> | null };

export function createExplorationService(options: {
  repository: GenerationCacheRepository;
  generation?: GenerationService;
  research?: FollowupResearchService;
  headlines?: () => Promise<{ items: HeadlineItem[] }>;
  now?: () => number;
}) {
  const repository = options.repository;
  const generation = options.generation ?? createGenerationService({ repository });
  const research = options.research ?? createFollowupResearchService({ repository });
  const headlines = options.headlines ?? getVoiceHeadlines;
  const now = options.now ?? Date.now;
  const work = new Map<string, WorkState>();
  const findHeadline = async (id: string) => options.headlines
    ? (await headlines()).items.find(item => item.id === id) ?? null
    : await getVoiceStoryById(id).then(story => story ? toStoryHeadline(story) : null);

  function stateFor(id: string) {
    parse(IdSchema, id);
    let state = work.get(id);
    if (!state) {
      state = { epoch: 0, tail: Promise.resolve(), controller: null, selectionKey: null, selectionSignal: null, selection: null };
      work.set(id, state);
    }
    return state;
  }

  function enqueue<T>(state: WorkState, action: () => Promise<T>): Promise<T> {
    const result = state.tail.catch(() => undefined).then(action);
    state.tail = result.catch(() => undefined);
    return result;
  }

  async function storyFor(installationId: string, headlineId?: string): Promise<Story | null> {
    parse(IdSchema, installationId);
    const stored = await repository.getVoiceStory(installationId, headlineId);
    if (!stored) return null;
    return { headline: parse(HeadlineItemSchema, stored.headline), graphId: parse(IdSchema, stored.graphId),
      focusedNodeId: parse(IdSchema.nullable(), stored.focusedNodeId),
      visitedNodeIds: parse(z.array(IdSchema).max(MAX_ATLAS_NODES), stored.visitedNodeIds),
    };
  }

  async function graphFor(installationId: string, story: Story) {
    return readRegisteredGraph({ installationId, graphId: story.graphId, headline: story.headline }, { repository });
  }

  function lineageFor(graph: Graph, story: Story, nodeId = story.focusedNodeId): PossibilityNode[] {
    const lineage: PossibilityNode[] = [];
    let cursor = nodeId;
    while (cursor && cursor !== story.graphId) {
      const node: PossibilityNode | undefined = graph.nodes[cursor];
      if (!node || lineage.length >= 5) throw fail("invalid_saved_path", "The saved path is unavailable.", 409);
      lineage.unshift(node);
      cursor = node.parentId;
    }
    return lineage;
  }

  async function resultFor(installationId: string, story: Story, graph: Graph, resumed = false) {
    const start = graph.startResponse;
    if (start.kind !== "atlas") throw fail("analysis_unavailable", "This saved story needs a new analysis.", 409);
    const currentNode = story.focusedNodeId ? graph.nodes[story.focusedNodeId] : null;
    if (story.focusedNodeId && !currentNode) throw fail("invalid_saved_path", "The saved path is unavailable.", 409);
    const choices = (currentNode ? currentNode.childIds : start.nodes.map(node => node.id)).map(id => graph.nodes[id]);
    const callsUsed = await repository.getAtlasCallsUsed(story.graphId, atlasSafetyIdentifier(installationId));
    return {
      ok: true, kind: "exploration", headline: story.headline, graphId: story.graphId,
      snapshot: start.snapshot, currentNode, lineage: lineageFor(graph, story), choices,
      visitedPaths: story.visitedNodeIds.map(id => graph.nodes[id]).filter(Boolean).map(node => ({ id: node.id, title: node.title, depth: node.depth })),
      limits: { callsUsed, maxCalls: MAX_ATLAS_CALLS, nodesUsed: Object.keys(graph.nodes).length + 1, maxNodes: MAX_ATLAS_NODES, maxDepth: 5 },
      resumed, snapshotAgeSeconds: Math.max(0, Math.round((now() - Date.parse(start.snapshot.capturedAt)) / 1000)),
      mode: start.meta.mode, possibilitiesAreSpeculative: true,
    };
  }

  async function saveStory(installationId: string, story: Story, selected: boolean) {
    return repository.saveVoiceStory({ ...story, installationId, headlineId: story.headline.id, selected });
  }

  return {
    listStories: () => getVoiceStories(),
    getStoryPreview: (headlineId: string, signal?: AbortSignal) => getVoiceStoryById(headlineId, signal),

    async getDisplay(installationId: string): Promise<ExplorationDisplay> {
      const story = await storyFor(installationId);
      if (!story) return emptyDisplay();
      const graph = await graphFor(installationId, story);
      const display = { ...emptyDisplay(), headline: story.headline, view: 'exploration' as const };
      return graph ? displayResult(display, await resultFor(installationId, story, graph, true)) : display;
    },

    async restore(installationId: string): Promise<{ selectedHeadline: HeadlineItem | null }> {
      const story = await storyFor(installationId);
      return { selectedHeadline: story?.headline ?? null };
    },

    search(installationId: string, question: string, signal?: AbortSignal, expectedHeadlineId?: string): Promise<object> {
      const state = stateFor(installationId);
      const checkedQuestion = parse(z.string().trim().min(1).max(1200), question);
      if (expectedHeadlineId !== undefined) parse(z.string().min(8).max(64), expectedHeadlineId);
      const epoch = state.epoch;
      const controller = state.controller ?? new AbortController();
      state.controller = controller;
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const current = () => {
        combined.throwIfAborted();
        if (state.epoch !== epoch) throw new DOMException("Story selection changed.", "AbortError");
      };
      return enqueue(state, async () => {
        current();
        // A failed selection may leave another story as the durable cursor. Only
        // consult the requested story's own mapping, never fall back to that cursor.
        const story = expectedHeadlineId ? await storyFor(installationId, expectedHeadlineId) : null;
        const headline = story?.headline ?? (expectedHeadlineId
          ? await findHeadline(expectedHeadlineId)
          : null);
        if (expectedHeadlineId && !headline) throw fail("headline_unavailable", "This headline is no longer available. Choose another story.", 404);
        const graph = story ? await graphFor(installationId, story) : null;
        current();
        const result = await research.search({
          installationId, question: checkedQuestion,
          context: {
            headline: headline ? parse(HeadlineItemSchema, headline) : null,
            snapshot: graph?.startResponse.kind === "atlas" ? graph.startResponse.snapshot : null,
            lineage: graph && story ? lineageFor(graph, story) : [],
          },
          signal: combined, visitKey: String(epoch), visitSignal: signal ?? controller.signal,
        });
        current();
        return result;
      });
    },

    selectStory(installationId: string, headlineId: string, signal?: AbortSignal): Promise<object> {
      const state = stateFor(installationId);
      parse(z.string().min(8).max(64), headlineId);
      signal?.throwIfAborted();
      if (state.selectionKey === headlineId && state.selection && !state.selectionSignal?.aborted) return state.selection;
      state.controller?.abort();
      const epoch = ++state.epoch;
      const controller = new AbortController();
      state.controller = controller;
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const current = () => {
        combined.throwIfAborted();
        if (state.epoch !== epoch) throw new DOMException("Story selection changed.", "AbortError");
      };
      const result = enqueue(state, async () => {
        current();
        const existing = await storyFor(installationId, headlineId);
        let story = existing;
        if (!story) {
          const headline = await findHeadline(headlineId);
          if (!headline) throw fail("headline_unavailable", "This headline is no longer available. Choose another story.", 404);
          story = { headline: parse(HeadlineItemSchema, headline), graphId: randomUUID(), focusedNodeId: null, visitedNodeIds: [] };
          current();
          // Save the stable graph mapping before generation so aborted calls are never retried with a new budget.
          await saveStory(installationId, story, false);
        }
        let graph = await graphFor(installationId, story);
        const resumed = graph !== null;
        if (!graph) {
          // A graph may have aged out under the inherited retention policy.
          story.focusedNodeId = null;
          story.visitedNodeIds = [];
          const start = await generation.start({ installationId, graphId: story.graphId, headline: story.headline }, combined);
          current();
          if (start.kind !== "atlas") throw fail("analysis_unavailable", "The analysis service did not return a possibility map.", 502);
          graph = await graphFor(installationId, story);
          if (!graph) throw fail("analysis_persistence_failed", "The completed analysis could not be restored.", 503);
        }
        current();
        await saveStory(installationId, story, true);
        current();
        return resultFor(installationId, story, graph, resumed);
      });
      state.selectionKey = headlineId;
      state.selectionSignal = combined;
      state.selection = result;
      void result.finally(() => {
        if (state.selection === result) { state.selection = null; state.selectionKey = null; state.selectionSignal = null; }
      }).catch(() => undefined);
      return result;
    },

    execute(installationId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal, expectedHeadlineId?: string): Promise<object> {
      const state = stateFor(installationId);
      if (expectedHeadlineId !== undefined) parse(z.string().min(8).max(64), expectedHeadlineId);
      const epoch = state.epoch;
      const controller = state.controller ?? new AbortController();
      state.controller = controller;
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const current = () => {
        combined.throwIfAborted();
        if (state.epoch !== epoch) throw new DOMException("Story selection changed.", "AbortError");
      };
      return enqueue(state, async () => {
        current();
        const story = await storyFor(installationId);
        if (!story) throw fail("no_story_selected", "Choose a news story to begin.", 409);
        if (expectedHeadlineId !== undefined && story.headline.id !== expectedHeadlineId) {
          throw fail("story_selection_mismatch", "The selected story is not ready. Retry that story before exploring its paths.", 409);
        }
        let graph = await graphFor(installationId, story);
        if (!graph || graph.startResponse.kind !== "atlas") throw fail("analysis_unavailable", "The story analysis is not available yet. Select the story to start it.", 409);
        if (name === "get_exploration") {
          parse(EmptyArgs, args);
          return resultFor(installationId, story, graph, true);
        }
        if (name === "compare_paths") {
          const { nodeIds } = parse(CompareArgs, args);
          const nodes = nodeIds.map(id => graph!.nodes[id]);
          if (nodes.some(node => !node)) throw fail("invalid_path", "A requested path does not belong to this story.");
          return { ...await resultFor(installationId, story, graph), comparison: nodes.map(node => ({ node, lineage: lineageFor(graph!, story, node.id) })) };
        }
        let boundary: { code: string; message: string } | null = null;
        if (name === "navigate_path") {
          const navigation = parse(NavigateArgs, args);
          if (navigation.target === "root") story.focusedNodeId = null;
          else if (navigation.target === "parent") {
            const parent = story.focusedNodeId ? graph.nodes[story.focusedNodeId]?.parentId : null;
            story.focusedNodeId = parent === story.graphId ? null : parent ?? null;
          } else {
            if (!graph.nodes[navigation.nodeId] || !story.visitedNodeIds.includes(navigation.nodeId)) throw fail("invalid_path", "That path has not been explored in this story.");
            story.focusedNodeId = navigation.nodeId;
          }
        } else if (name === "choose_path") {
          const { nodeId } = parse(ChooseArgs, args);
          const node = graph.nodes[nodeId];
          const allowed = story.focusedNodeId ? graph.nodes[story.focusedNodeId]?.childIds ?? [] : graph.startResponse.nodes.map(item => item.id);
          if (!node || (!allowed.includes(nodeId) && story.focusedNodeId !== nodeId)) throw fail("invalid_path", "Choose one of the current possibilities, or go back first.");
          if (!node.childIds.length && node.status !== "leaf" && node.depth < 5) {
            const capacity = MAX_ATLAS_NODES - Object.keys(graph.nodes).length - 1;
            const callsUsed = await repository.getAtlasCallsUsed(story.graphId, atlasSafetyIdentifier(installationId));
            if (capacity < 3) boundary = { code: "node_limit_reached", message: "This story has reached its saved-path capacity. We can discuss or compare the existing possibilities." };
            else if (callsUsed >= MAX_ATLAS_CALLS) boundary = { code: "atlas_call_limit_reached", message: "This story has reached its analysis limit. We can discuss or compare the existing possibilities." };
            if (!boundary) {
              const lineage = lineageFor(graph, story, nodeId).map(({ id, parentId, depth, title, summary, whyPlausible, keyAssumption, horizon }) => ({ id, parentId, depth, title, summary, whyPlausible, keyAssumption, horizon }));
              await generation.expand({ installationId, graphId: story.graphId, parentId: nodeId,
                snapshot: graph.startResponse.snapshot, lineage,
                remainingNodeCapacity: capacity }, combined);
              current();
              graph = await graphFor(installationId, story);
              if (!graph) throw fail("analysis_persistence_failed", "The completed path could not be restored.", 503);
            }
          }
          story.focusedNodeId = nodeId;
          if (!story.visitedNodeIds.includes(nodeId)) story.visitedNodeIds.push(nodeId);
        } else throw fail("unknown_tool", "That exploration action is unavailable.");
        current();
        await saveStory(installationId, story, true);
        current();
        return { ...await resultFor(installationId, story, graph), ...(boundary ? { boundary } : {}) };
      });
    },
  };
}

let singleton: ReturnType<typeof createExplorationService> | undefined;
function service() {
  return singleton ??= createExplorationService({ repository: getGenerationCacheRepository() });
}

export const explorationService = {
  listStories: () => service().listStories(),
  getStoryPreview: (headlineId: string, signal?: AbortSignal) => service().getStoryPreview(headlineId, signal),
  getDisplay: (installationId: string) => service().getDisplay(installationId),
  restore: (installationId: string) => service().restore(installationId),
  selectStory: (installationId: string, headlineId: string, signal?: AbortSignal) => service().selectStory(installationId, headlineId, signal),
  search: (installationId: string, question: string, signal?: AbortSignal, expectedHeadlineId?: string) => service().search(installationId, question, signal, expectedHeadlineId),
  execute: (installationId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal, expectedHeadlineId?: string) => service().execute(installationId, name, args, signal, expectedHeadlineId),
};

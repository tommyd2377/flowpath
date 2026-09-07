import { z } from 'zod';
import { EventSnapshotSchema, HeadlineItemSchema, PossibilityNodeSchema, SourceSchema } from './atlas/contracts';
import { CuratedStorySchema } from './story-contracts';

export const ExplorationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('select_story'), storyId: z.string().min(8).max(64) }).strict(),
  z.object({ type: z.literal('choose_path'), nodeId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('navigate_path'), target: z.enum(['parent', 'root', 'node']), nodeId: z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('compare_paths'), nodeIds: z.array(z.string().uuid()).min(2).max(5) }).strict(),
  z.object({ type: z.literal('show_stories') }).strict(),
  z.object({ type: z.literal('start_briefing') }).strict(),
]);
export type ExplorationAction = z.infer<typeof ExplorationActionSchema>;

export const InsightSchema = z.object({
  title: z.string().min(1).max(120), summary: z.string().min(1).max(900),
  points: z.array(z.string().min(1).max(320)).max(6),
  assumptions: z.array(z.string().min(1).max(320)).max(5),
  signals: z.array(z.string().min(1).max(320)).max(5),
}).strict();
export type ConversationInsight = z.infer<typeof InsightSchema>;

export const ExplorationDataSchema = z.object({
  kind: z.literal('exploration'), headline: HeadlineItemSchema,
  graphId: z.string().uuid().optional(), snapshot: EventSnapshotSchema.optional(),
  summary: z.string().optional(), reason: z.string().optional(), sources: z.array(SourceSchema).optional(),
  currentNode: PossibilityNodeSchema.nullable().optional(),
  lineage: z.array(PossibilityNodeSchema).max(5).optional(),
  choices: z.array(PossibilityNodeSchema).max(5).optional(),
  visitedPaths: z.array(z.object({ id: z.string().uuid(), title: z.string(), depth: z.number() })).max(64).optional(),
  limits: z.object({ callsUsed: z.number(), maxCalls: z.number(), nodesUsed: z.number(), maxNodes: z.number(), maxDepth: z.number() }).optional(),
  comparison: z.array(z.object({ node: PossibilityNodeSchema, lineage: z.array(PossibilityNodeSchema) })).max(5).optional(),
  boundary: z.object({ code: z.string(), message: z.string() }).optional(),
  resumed: z.boolean().optional(), snapshotAgeSeconds: z.number().optional(),
});
export type ExplorationData = z.infer<typeof ExplorationDataSchema>;

export const ResearchDisplaySchema = z.object({
  kind: z.literal('web_research'), status: z.enum(['supported', 'partial', 'unavailable']),
  question: z.string(), researchedAt: z.string(),
  findings: z.array(z.object({ text: z.string(), sourceIds: z.array(z.string()) })).max(6),
  implications: z.array(z.string()).max(4), uncertainties: z.array(z.string()).max(6),
  sources: z.array(SourceSchema).max(16),
});
export type ResearchDisplay = z.infer<typeof ResearchDisplaySchema>;

export const ExplorationDisplaySchema = z.object({
  headline: HeadlineItemSchema.nullable(),
  exploration: ExplorationDataSchema.nullable(),
  research: ResearchDisplaySchema.nullable(),
  insight: InsightSchema.nullable(),
  view: z.enum(['stories', 'exploration']),
  revision: z.number().int().nonnegative(),
  stories: z.array(CuratedStorySchema).max(20).optional(),
  spotlightStoryId: z.string().min(8).max(64).nullable().optional(),
  spotlightPathId: z.string().uuid().nullable().optional(),
});
export type ExplorationDisplay = z.infer<typeof ExplorationDisplaySchema>;

export function emptyDisplay(revision = 0): ExplorationDisplay {
  return { headline: null, exploration: null, research: null, insight: null, view: 'stories', revision };
}

export function displayResult(previous: ExplorationDisplay, result: object): ExplorationDisplay {
  const exploration = ExplorationDataSchema.safeParse(result);
  if (exploration.success) {
    const visiblePaths = [exploration.data.currentNode, ...(exploration.data.choices ?? []), ...(exploration.data.comparison ?? []).map(item => item.node)];
    const spotlightPathId = visiblePaths.some(node => node?.id === previous.spotlightPathId) ? previous.spotlightPathId : null;
    return { ...previous, headline: exploration.data.headline, exploration: exploration.data, insight: null, spotlightPathId };
  }
  const research = ResearchDisplaySchema.safeParse(result);
  if (research.success) return { ...previous, research: research.data, insight: null };
  return previous;
}

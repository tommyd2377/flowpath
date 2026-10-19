import { z } from 'zod';
import type { ExplorationDisplay } from './visual-contracts';

export const SCREEN_SECTIONS = ['stories', 'StoryOverview', 'PathTrail', 'ScenarioDetail', 'ChoiceCards', 'PathComparison', 'ConversationInsight', 'ResearchUpdate', 'EvidencePanel', 'ContextNote'] as const;
const SectionSchema = z.enum(SCREEN_SECTIONS);
const StoryIdsSchema = z.array(z.string().min(8).max(64)).max(20);
const CatalogTargetSchema = z.object({ id: z.string().uuid(), storyIds: StoryIdsSchema.min(1) }).strict();
export const ScrollArgsSchema = z.object({
  direction: z.enum(['down', 'up', 'next_section', 'previous_section', 'top', 'bottom', 'section']),
  section: SectionSchema.optional(),
}).strict().refine(value => (value.direction === 'section') === Boolean(value.section));
export type ScrollArgs = z.infer<typeof ScrollArgsSchema>;
export const ScreenRequestSchema = z.object({
  type: z.literal('screen_request'), requestId: z.string().uuid(), revision: z.number().int().nonnegative(),
  contextKey: z.string().max(240), scroll: ScrollArgsSchema.optional(),
  catalog: CatalogTargetSchema.optional(),
  pathId: z.string().uuid().optional(),
}).strict();
export type ScreenRequest = z.infer<typeof ScreenRequestSchema>;
export const ScreenSnapshotSchema = z.object({
  contextKey: z.string().max(240), view: z.enum(['stories', 'exploration']),
  width: z.number().int().min(1).max(30000), height: z.number().int().min(1).max(30000),
  scrollY: z.number().int().nonnegative(), atTop: z.boolean(), atBottom: z.boolean(), hidden: z.boolean(),
  visibleStoryIds: z.array(z.string().min(8).max(64)).max(20),
  fullyVisibleStoryIds: z.array(z.string().min(8).max(64)).max(20),
  storyCatalogId: z.string().uuid().optional(), renderedStoryIds: StoryIdsSchema.optional(),
  visibleSections: z.array(SectionSchema).max(10), availableSections: z.array(SectionSchema).max(10),
  visiblePathIds: z.array(z.string().uuid()).max(6).optional(),
  fullyVisiblePathIds: z.array(z.string().uuid()).max(6).optional(),
  focusedStoryId: z.string().min(8).max(64).nullable().optional(),
  focusedPathId: z.string().uuid().nullable().optional(),
  primarySection: SectionSchema.nullable().optional(),
  busy: z.boolean().optional(),
  expandedPathIds: z.array(z.string().uuid()).max(6).optional(),
}).strict();
export const ScreenReportSchema = z.object({
  requestId: z.string().uuid(), outcome: z.enum(['ok', 'boundary', 'view_changed', 'hidden', 'interrupted', 'section_unavailable']),
  screen: ScreenSnapshotSchema,
}).strict();
export type ScreenReport = z.infer<typeof ScreenReportSchema>;
export type ScreenSnapshot = z.infer<typeof ScreenSnapshotSchema>;
export const ScreenObservationSchema = z.object({ type: z.literal('observation'), sequence: z.number().int().positive(), screen: ScreenSnapshotSchema }).strict();
export const ScreenSubmissionSchema = z.union([ScreenReportSchema, ScreenObservationSchema]);

export function catalogScreenReady(screen: ScreenSnapshot, catalog: NonNullable<ScreenRequest['catalog']>) {
  return screen.view === 'stories' && !screen.hidden && screen.storyCatalogId === catalog.id
    && screen.renderedStoryIds?.length === catalog.storyIds.length
    && screen.renderedStoryIds.every((id, index) => id === catalog.storyIds[index])
    && screen.visibleStoryIds.includes(catalog.storyIds[0]);
}

export function pathScreenReady(screen: ScreenSnapshot, pathId: string) {
  return screen.view === 'exploration' && !screen.hidden && screen.visiblePathIds?.includes(pathId)
    && screen.expandedPathIds?.includes(pathId);
}

export function screenContextKey(display: ExplorationDisplay | null) {
  // A view/path change invalidates commands issued for the previous content.
  return [display?.revision ?? 0, display?.view ?? 'stories', display?.headline?.id ?? '', display?.pendingPathId ?? display?.exploration?.currentNode?.id ?? ''].join(':');
}

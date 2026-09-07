import { z } from "zod";
import { HeadlineItemSchema, type HeadlineItem } from "./atlas/contracts";

export const MAX_CURATED_STORIES = 20;
export const CuratedStorySchema = HeadlineItemSchema.extend({
  summary: z.string().min(1).max(500),
  whyItMatters: z.string().min(1).max(420),
  scope: z.enum(["us", "global", "both"]),
  headlines: z.array(HeadlineItemSchema).min(1).max(90),
  contextSources: z.array(z.object({ title: z.string().min(1).max(240), url: z.string().url().startsWith("https://") }).strict()).max(4),
}).strict();

export type CuratedStory = z.infer<typeof CuratedStorySchema>;
export const StoryCatalogResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(CuratedStorySchema).max(MAX_CURATED_STORIES),
  fetchedAt: z.string().datetime({ offset: true }),
  stale: z.boolean(),
  warning: z.string().nullable(),
  curated: z.boolean(),
}).strict();
export type StoryCatalogResponse = z.infer<typeof StoryCatalogResponseSchema>;

export function toStoryHeadline(story: CuratedStory): HeadlineItem {
  return {
    id: story.id, title: story.title, publisher: story.publisher,
    publisherUrl: story.publisherUrl, googleNewsUrl: story.googleNewsUrl,
    publishedAt: story.publishedAt,
  };
}

export const FIXTURE_HEADLINES: HeadlineItem[] = [
  { id: "voice-fixture-policy", title: "Fixture: City considers a new transit plan", publisher: "Fixture News", publisherUrl: "https://news.example", googleNewsUrl: "https://news.google.com/rss/articles/fixture-policy", publishedAt: "2026-09-05T08:00:00.000Z" },
  { id: "voice-fixture-energy", title: "Fixture: Energy researchers announce a pilot project", publisher: "Fixture Science", publisherUrl: "https://science.example", googleNewsUrl: "https://news.google.com/rss/articles/fixture-energy", publishedAt: "2026-09-05T07:00:00.000Z" },
  { id: "voice-fixture-talks", title: "Fixture: Negotiators schedule another round of talks", publisher: "Fixture World", publisherUrl: "https://world.example", googleNewsUrl: "https://news.google.com/rss/articles/fixture-talks", publishedAt: "2026-09-05T06:00:00.000Z" },
];

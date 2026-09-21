import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createClient } from "@libsql/client";

import { createStoryCatalogService, stableStoryId, StoryCatalogRepository, STORY_CACHE_TTL_MS, STORY_REFRESH_COOLDOWN_MS, STORY_RESEARCH_TIMEOUT_MS, STORY_HISTORY_LIMIT } from "../lib/story-catalog";
import { FIXTURE_HEADLINES, toStoryHeadline } from "../lib/story-contracts";
import { HeadlineItemSchema, type HeadlineItem } from "../lib/atlas/contracts";
import type { HeadlinesResponse } from "../lib/atlas/server/feed";
import type { AtlasParsedResponse, AtlasRequestOptions, AtlasResponsesAdapter, AtlasResponsesRequest } from "../lib/atlas/server/openai-client";

const SOURCE = "https://official.example/report";
const NOW = Date.parse("2026-09-05T10:00:00.000Z");

function feed(items = FIXTURE_HEADLINES): HeadlinesResponse {
  return { ok: true, items, fetchedAt: new Date(NOW).toISOString(), feedUpdatedAt: null, stale: false, warning: null };
}
function response(): AtlasParsedResponse<unknown> {
  return {
    status: "completed",
    output: [{ type: "web_search_call", status: "completed", action: { type: "search", sources: [{ url: SOURCE }] } }],
    output_parsed: {
      stories: [
        { title: "Transit policy debate", summary: "A city is considering a transit plan.", whyItMatters: "If adopted, the plan could change how people travel.", scope: "us", memberIds: ["item-001"], sourceUrls: [SOURCE] },
        { title: "New energy research", summary: "Researchers announced a pilot.", whyItMatters: "A successful pilot could inform future research.", scope: "both", memberIds: ["item-002"], sourceUrls: [] },
      ],
      sources: [{ title: "Official report", url: SOURCE }],
    },
  };
}
class Adapter implements AtlasResponsesAdapter {
  calls: Array<{ request: AtlasResponsesRequest; options: AtlasRequestOptions }> = [];
  constructor(public operation: () => Promise<AtlasParsedResponse<unknown>> = async () => response()) {}
  async parse<T>(request: AtlasResponsesRequest, options: AtlasRequestOptions): Promise<AtlasParsedResponse<T>> {
    this.calls.push({ request, options });
    return await this.operation() as AtlasParsedResponse<T>;
  }
}
function harness(t: TestContext, adapter = new Adapter()) {
  const directory = mkdtempSync(path.join(tmpdir(), "voice-catalog-"));
  const url = `file:${path.join(directory, "isolated.db")}`;
  const repository = new StoryCatalogRepository(createClient({ url }));
  let clock = NOW;
  const feeds = [{ getHeadlines: async () => feed() }];
  const createService = (store = repository) => createStoryCatalogService({ repository: store, adapter, feeds, mode: () => "live", model: "gpt-5.6-luna", now: () => clock });
  const service = createService();
  t.after(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
  return { repository, adapter, feeds, service, createService, url, setNow: (value: number) => { clock = value; } };
}

test("curates bounded, neutral stories with server-owned IDs and validated reporting provenance", async t => {
  const h = harness(t);
  const result = await h.service.getStories();
  assert.equal(result.curated, true);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].id, stableStoryId([FIXTURE_HEADLINES[0].id]));
  assert.equal(result.items[0].googleNewsUrl, FIXTURE_HEADLINES[0].googleNewsUrl);
  assert.deepEqual(result.items[0].headlines, [FIXTURE_HEADLINES[0]]);
  assert.deepEqual(result.items[0].contextSources, [{ title: "Official report", url: SOURCE }]);
  assert.equal(HeadlineItemSchema.safeParse(toStoryHeadline(result.items[0])).success, true);
  const call = h.adapter.calls[0];
  assert.equal(call.request.model, "gpt-5.6-luna");
  assert.equal(call.request.store, false);
  assert.equal(call.request.max_output_tokens, 6000);
  assert.equal(call.request.max_tool_calls, 2);
  assert.equal(call.request.tool_choice, undefined, 'additional search is optional');
  assert.deepEqual(call.request.tools, [{ type: "web_search", search_context_size: "medium" }]);
  assert.equal(call.options.timeout, STORY_RESEARCH_TIMEOUT_MS);
  assert.equal(call.options.maxRetries, 0);
  assert.match(call.request.input[0].content, /untrusted data/);
  assert.match(call.request.input[0].content, /Do not rank by clicks/);
});

test("member order changes do not change the story identity", () => {
  assert.equal(stableStoryId(["headline-b", "headline-a"]), stableStoryId(["headline-a", "headline-b"]));
  assert.notEqual(stableStoryId(["headline-a"]), stableStoryId(["headline-b"]));
});

test("fresh catalogs survive a new service instance and retain saved story lookup", async t => {
  const h = harness(t);
  const first = await h.service.getStories();
  const replacement = new StoryCatalogRepository(createClient({ url: h.url }));
  t.after(() => replacement.close());
  h.setNow(NOW + STORY_CACHE_TTL_MS - 1);
  const second = await h.createService(replacement).getStories();
  assert.deepEqual(second, first);
  assert.equal(h.adapter.calls.length, 1);
  assert.deepEqual(await h.createService(replacement).getStoryById(first.items[0].id), first.items[0]);
});

test("invalid members, repeated members and invented source URLs discard curation without retries", async t => {
  for (const invalid of ["unknown-member", "duplicate-member", "duplicate-across-stories", "invented-source", "invented-context", "missing-search", "incomplete"]) {
    const h = harness(t, new Adapter(async () => {
      const value = response();
      const payload = value.output_parsed as { stories: Array<{ memberIds: string[]; sourceUrls: string[] }>; sources: Array<{ title: string; url: string }> };
      if (invalid === "unknown-member") payload.stories[0].memberIds = ["invented-headline"];
      if (invalid === "duplicate-member") payload.stories[0].memberIds.push(payload.stories[0].memberIds[0]);
      if (invalid === "duplicate-across-stories") payload.stories[1].memberIds = payload.stories[0].memberIds;
      if (invalid === "invented-source") payload.sources[0].url = "https://invented.example/news";
      if (invalid === "invented-context") payload.stories[0].sourceUrls = ["https://invented.example/news"];
      if (invalid === "missing-search") value.output = [];
      if (invalid === "incomplete") value.status = "incomplete";
      return value;
    }));
    const result = await h.service.getStories();
    assert.equal(result.curated, false, invalid);
    assert.match(result.warning!, /uncurated/);
    assert.deepEqual(result.items.flatMap(item => item.headlines), FIXTURE_HEADLINES);
    await h.service.getStories();
    assert.equal(h.adapter.calls.length, 1, invalid);
  }
});

test("collects at most 90 deduplicated candidates across top, world and US feeds", async t => {
  const h = harness(t);
  const news = (prefix: string): HeadlineItem[] => Array.from({ length: 40 }, (_, index) => ({
    ...FIXTURE_HEADLINES[0], id: `${prefix}-headline-${index}`, googleNewsUrl: `https://news.google.com/rss/articles/${prefix}-${index}`, title: `${prefix} headline ${index}`,
  }));
  const service = createStoryCatalogService({ repository: h.repository, adapter: h.adapter, mode: () => "live", model: "gpt-5.6-luna", now: () => NOW,
    feeds: ["top", "world", "us"].map(prefix => ({ getHeadlines: async () => feed(news(prefix)) })),
  });
  await service.getStories();
  const input = JSON.parse(h.adapter.calls[0].request.input[1].content);
  assert.equal(input.candidates.length, 90);
  assert.equal(new Set(input.candidates.map((item: HeadlineItem) => item.id)).size, 90);
  assert.equal(input.candidates[0].id, 'item-001');
  assert.match(input.candidates[0].title, /^top /);
  assert.match(input.candidates[1].title, /^world /);
  assert.match(input.candidates[2].title, /^us /);
  assert.equal(input.candidates[0].googleNewsUrl, undefined);
});

test("concurrent callers share one request and one aborted page does not cancel the catalog", async t => {
  let release: ((value: AtlasParsedResponse<unknown>) => void) | undefined;
  const h = harness(t, new Adapter(() => new Promise(resolve => { release = resolve; })));
  const controller = new AbortController();
  const first = h.service.getStories(controller.signal);
  const second = h.service.getStories();
  await new Promise<void>(resolve => {
    const timer = setInterval(() => { if (release) { clearInterval(timer); resolve(); } }, 2);
  });
  controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(h.adapter.calls[0].options.signal?.aborted, false);
  assert.ok(release);
  release(response());
  assert.equal((await second).curated, true);
  assert.equal(h.adapter.calls.length, 1);
});

test("a durable global reservation blocks competing instances and survives a crashed refresh", async t => {
  const h = harness(t);
  await h.repository.claim("abandoned-process", NOW);
  const secondStore = new StoryCatalogRepository(createClient({ url: h.url }));
  t.after(() => secondStore.close());
  const second = h.createService(secondStore);
  const fallback = await second.getStories();
  assert.equal(fallback.curated, false);
  assert.deepEqual(await h.createService().getStoryById(fallback.items[0].id), fallback.items[0]);
  assert.equal(h.adapter.calls.length, 0);
  h.setNow(NOW + STORY_REFRESH_COOLDOWN_MS - 1);
  assert.equal((await h.createService().getStories()).curated, false);
  assert.equal(h.adapter.calls.length, 0);
  h.setNow(NOW + STORY_REFRESH_COOLDOWN_MS + 1);
  assert.equal((await second.getStories()).curated, true);
  assert.equal(h.adapter.calls.length, 1);
});

test("unknown story IDs do not start feed fetching or paid curation", async t => {
  const h = harness(t);
  let feedCalls = 0;
  h.feeds[0].getHeadlines = async () => { feedCalls++; return feed(); };
  assert.equal(await h.service.getStoryById("unknown-story"), null);
  assert.equal(h.adapter.calls.length, 0);
  assert.equal(feedCalls, 0);
});

test("failed curation keeps a durable cooldown across restarts and model changes", async t => {
  const h = harness(t, new Adapter(async () => { throw new Error("Simulated model outage"); }));
  await h.service.getStories();
  h.setNow(NOW + STORY_REFRESH_COOLDOWN_MS - 1);
  await createStoryCatalogService({ repository: h.repository, feeds: h.feeds, adapter: h.adapter, model: "different-model", mode: () => "live", now: () => NOW + STORY_REFRESH_COOLDOWN_MS - 1 }).getStories();
  assert.equal(h.adapter.calls.length, 1);
  h.setNow(NOW + STORY_REFRESH_COOLDOWN_MS + 1);
  await h.createService().getStories();
  assert.equal(h.adapter.calls.length, 2);
});

test("refresh failure serves an explicitly stale curated catalog without losing its original age", async t => {
  const h = harness(t);
  const first = await h.service.getStories();
  h.setNow(NOW + STORY_CACHE_TTL_MS + 1);
  h.feeds[0].getHeadlines = async () => { throw new Error("Temporary feed outage"); };
  const result = await h.service.getStories();
  assert.equal(result.curated, true);
  assert.equal(result.stale, true);
  assert.equal(result.fetchedAt, first.fetchedAt);
  assert.deepEqual(result.items, first.items);
  assert.match(result.warning!, /last curated stories/);
  assert.equal(h.adapter.calls.length, 1);
  await h.createService().getStories();
  assert.equal(h.adapter.calls.length, 1);
});

test("failed curation serves newer RSS headlines instead of yesterday's curated stories", async t => {
  const h = harness(t);
  const previous = await h.service.getStories();
  const nextDay = NOW + 20 * 60 * 60 * 1000;
  const headline = { ...FIXTURE_HEADLINES[0], id: 'today-headline-new', title: 'A new development today', publishedAt: new Date(nextDay).toISOString() };
  h.setNow(nextDay);
  h.feeds[0].getHeadlines = async () => ({ ...feed([headline]), fetchedAt: new Date(nextDay).toISOString() });
  h.adapter.operation = async () => { throw new Error('Curation unavailable'); };
  const current = await h.service.getStories();
  assert.equal(current.curated, false);
  assert.equal(current.stale, false);
  assert.equal(current.fetchedAt, new Date(nextDay).toISOString());
  assert.deepEqual(current.items.flatMap(item => item.headlines), [headline]);
  assert.equal(h.adapter.calls.length, 2);
  assert.deepEqual(await h.createService().getStories(), current);
  assert.equal(h.adapter.calls.length, 2);
  assert.deepEqual(await h.createService().getStoryById(current.items[0].id), current.items[0]);
  assert.deepEqual(await h.createService().getStoryById(previous.items[0].id), previous.items[0]);
});

test("a curation cooldown still permits fresh RSS headlines without another model request", async t => {
  const h = harness(t);
  await h.service.getStories();
  const later = NOW + STORY_CACHE_TTL_MS + 1;
  h.setNow(later);
  assert.equal(await h.repository.claim('another-process', later), true);
  const headline = { ...FIXTURE_HEADLINES[0], id: 'cooldown-headline', title: 'A newer headline during cooldown', publishedAt: new Date(later).toISOString() };
  h.feeds[0].getHeadlines = async () => ({ ...feed([headline]), fetchedAt: new Date(later).toISOString() });
  const current = await h.createService().getStories();
  assert.equal(current.curated, false);
  assert.equal(current.stale, false);
  assert.deepEqual(current.items.flatMap(item => item.headlines), [headline]);
  assert.equal(h.adapter.calls.length, 1);
  assert.deepEqual(await h.createService().getStoryById(current.items[0].id), current.items[0]);
});

test("stale RSS fallback retains the feed's actual retrieval time", async t => {
  const h = harness(t, new Adapter(async () => { throw new Error('Curation unavailable'); }));
  h.setNow(NOW + 60 * 60 * 1000);
  h.feeds[0].getHeadlines = async () => ({ ...feed(), stale: true });
  const result = await h.service.getStories();
  assert.equal(result.curated, false);
  assert.equal(result.stale, true);
  assert.equal(result.fetchedAt, new Date(NOW).toISOString());
});

test("fixture mode bypasses feeds, persistence and model adapters and preserves fixture IDs", async () => {
  const service = createStoryCatalogService({ repository: () => { throw new Error("Must not open a database"); }, mode: () => "fixture", feeds: [{ getHeadlines: async () => { throw new Error("Must not fetch"); } }], adapter: new Adapter(async () => { throw new Error("Must not use a paid adapter"); }), now: () => NOW });
  const result = await service.getStories();
  assert.deepEqual(result.items.map(toStoryHeadline), FIXTURE_HEADLINES);
  assert.deepEqual(await service.getStoryById(FIXTURE_HEADLINES[0].id), result.items[0]);
});

test("disabled analysis or unavailable durable guard permits only uncurated fallback", async t => {
  const h = harness(t);
  const service = createStoryCatalogService({ repository: h.repository, feeds: h.feeds, adapter: h.adapter, mode: () => { throw new Error("Disabled"); }, now: () => NOW });
  assert.equal((await service.getStories()).curated, false);
  const failedStore = createStoryCatalogService({ repository: () => { throw new Error("Storage unavailable"); }, feeds: h.feeds, adapter: h.adapter, mode: () => "live", now: () => NOW });
  assert.equal((await failedStore.getStories()).curated, false);
  assert.equal(h.adapter.calls.length, 0);
});

test("catalog history is bounded and rejects attempts to finish another owner's reservation", async t => {
  const h = harness(t);
  const catalog = await h.service.getStories();
  for (let index = 0; index < STORY_HISTORY_LIMIT + 2; index++) {
    const now = NOW + (index + 1) * (STORY_CACHE_TTL_MS + 1);
    const owner = randomUUID();
    assert.equal(await h.repository.claim(owner, now), true);
    await h.repository.finish("wrong-owner", now, "test", { ...catalog, items: [] });
    await h.repository.finish(owner, now, "test", { ...catalog, fetchedAt: new Date(now).toISOString() });
  }
  const client = createClient({ url: h.url });
  t.after(() => client.close());
  const result = await client.execute("SELECT COUNT(*) AS count FROM voice_story_catalogs");
  assert.equal(result.rows[0].count, STORY_HISTORY_LIMIT);
  assert.equal((await h.repository.latest("test"))?.items.length, 2);
});

test('headline-grounded summaries and significance do not require additional web results', async t => {
  for (const output of [[], [{ type: 'web_search_call', status: 'failed' }]]) {
    const h = harness(t, new Adapter(async () => {
      const value = response();
      const payload = value.output_parsed as { stories: Array<{ sourceUrls: string[] }>; sources: unknown[] };
      value.output = output;
      payload.sources = [];
      payload.stories.forEach(story => { story.sourceUrls = []; });
      return value;
    }));
    const catalog = await h.service.getStories();
    assert.equal(catalog.curated, true);
    assert.equal(catalog.warning, null);
    assert.match(catalog.items[0].whyItMatters, /could change/);
    assert.equal(catalog.items[0].contextSources.length, 0);
    assert.equal(h.adapter.calls.length, 1);
  }
});

test('curation preserves the RSS retrieval time instead of pretending old feeds were updated', async t => {
  const h = harness(t);
  h.setNow(NOW + 60 * 60 * 1000);
  h.feeds[0].getHeadlines = async () => ({ ...feed(), stale: true });
  const catalog = await h.service.getStories();
  assert.equal(catalog.curated, true);
  assert.equal(catalog.stale, true);
  assert.equal(catalog.fetchedAt, new Date(NOW).toISOString());
});

test('repeated refresh requests retain the real timestamp and shared paid-call cooldown', async t => {
  const h = harness(t);
  const first = await h.service.getStories();
  h.setNow(NOW + 60_000);
  for (let i = 0; i < 4; i++) assert.deepEqual(await h.createService().getStories(), first);
  assert.equal(h.adapter.calls.length, 1);
});

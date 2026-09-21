import assert from 'node:assert/strict';
import test from 'node:test';
import type WebSocket from 'ws';
import { createRealtimeControl } from '../lib/realtime-control';
import type { ExplorationBackend, VoiceStatus } from '../lib/voice-tools';
import { FIXTURE_HEADLINES, type StoryCatalogResponse } from '../lib/story-contracts';
import { FakeLiveSocket, flushLive, liveAnswer, liveTool } from './helpers/live-fixture';
const catalog: StoryCatalogResponse = { ok: true, curated: true, fetchedAt: '2026-09-11T00:00:00Z', stale: false, warning: null,
  items: FIXTURE_HEADLINES.map(headline => ({ ...headline, summary: headline.title, whyItMatters: 'A possible development.', scope: 'both', headlines: [headline], contextSources: [] })) };
async function setup(output: unknown[] = [liveAnswer()], overrides: Partial<ExplorationBackend> = {}) {
  const socket = new FakeLiveSocket(), events: VoiceStatus[] = [], requests: Record<string, unknown>[] = [], selected: string[] = [];
  const control = createRealtimeControl({ callId: 'live_fixture', apiKey: 'synthetic', installationId: 'fixture', onFatal() {},
    socketFactory: url => { assert.equal(url, 'wss://api.openai.com/v1/live/sessions/live_fixture/attach'); return socket as unknown as WebSocket; },
    fetch: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ status: 'completed', output: requests.length === 1 ? output : [liveAnswer()] }); },
    exploration: { listStories: async () => catalog, getStoryPreview: async id => catalog.items.find(x => x.id === id) ?? null,
      selectStory: async (_installation, id) => { selected.push(id); return { headline: FIXTURE_HEADLINES.find(h => h.id === id) }; },
      search: async () => ({ answer: 'Verified finding.' }), execute: async () => ({ status: 'ready' }), ...overrides },
  });
  control.subscribe(event => events.push(event)); socket.open(); await control.ready;
  return { control, socket, events, requests, selected };
}
test('Live delegates news reasoning to Luna with current app context', async t => {
  const h = await setup(); t.after(() => h.control.close()); h.socket.user('What does this mean?'); await flushLive();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].model, 'gpt-5.6-luna');
  assert.match(JSON.stringify(h.requests[0].input), /What does this mean/); assert.ok(h.socket.sent.some(x => x.type === 'session.commentary.append'));
});
test('headlines tool retains publisher attribution and updates the grid', async t => {
  const h = await setup([liveTool('list_stories', {})]); t.after(() => h.control.close()); h.socket.user('Show the news'); await flushLive();
  assert.equal(h.requests.length, 2); assert.match(JSON.stringify(h.requests[1].input), /publisher/);
  assert.ok(h.events.some(x => x.type === 'display' && x.display.stories?.length === catalog.items.length));
});
test('navigation-only requests complete silently without a redundant generation', async t => {
  const h = await setup([liveTool('show_stories', {})]); t.after(() => h.control.close()); h.socket.user('Back to headlines'); await flushLive();
  assert.equal(h.requests.length, 1); assert.ok(!h.socket.sent.some(x => x.type === 'session.commentary.append'));
});
test('selecting a different story suppresses stale research results', async t => {
  let finish!: (value: object) => void;
  const h = await setup([], { selectStory: async (_installation, id) => id === catalog.items[0].id ? new Promise(resolve => { finish = resolve; }) : { headline: FIXTURE_HEADLINES[1] } });
  t.after(() => h.control.close()); h.control.selectStory(catalog.items[0].id); await flushLive(); h.control.selectStory(catalog.items[1].id); await flushLive();
  finish({ headline: FIXTURE_HEADLINES[0] }); await flushLive();
  const last = h.events.findLast(x => x.type === 'display'); assert.ok(last?.type === 'display'); assert.equal(last.display.headline?.id, FIXTURE_HEADLINES[1].id);
});
test('opening briefing is requested once and advances on browser audio quiet, never a backend event', async t => {
  const h = await setup(); t.after(() => h.control.close()); h.control.act?.({ type: 'start_briefing' }); h.control.act?.({ type: 'start_briefing' }); await flushLive();
  const count = () => h.socket.sent.filter(x => x.type === 'session.commentary.append').length;
  const initial = count(); assert.ok(initial > 0); assert.equal(h.requests.length, 0);
  h.socket.frame({ type: 'response.done', response: { status: 'completed' } }); assert.equal(count(), initial);
  h.control.observeAudio?.({ inputActive: false, outputActive: true }); h.control.observeAudio?.({ inputActive: false, outputActive: false }); assert.ok(count() > initial);
  h.control.observeAudio?.({ inputActive: true, outputActive: true }); const stopped = count(); h.control.observeAudio?.({ inputActive: false, outputActive: false }); assert.equal(count(), stopped);
});
test('scroll tool waits for a browser result and does not invent a successful move', async t => {
  const h = await setup([liveTool('scroll_page', { direction: 'down', continueDiscussion: true })]); t.after(() => h.control.close()); h.socket.user('Scroll down and discuss'); await flushLive();
  const request = h.events.find(x => x.type === 'screen_request'); assert.ok(request?.type === 'screen_request'); assert.equal(h.requests.length, 1);
  await h.control.close(); assert.ok(!h.socket.sent.some(x => x.type === 'session.commentary.append'));
});
test('an unknown backend function never calls app research or selection', async t => {
  const h = await setup([liveTool('invent_tool', {})]); t.after(() => h.control.close()); h.socket.user('Try it'); await flushLive(); assert.equal(h.selected.length, 0); assert.equal(h.requests.length, 1);
});

test('spoken refresh updates catalog metadata and completes silently without a second reasoning call', async t => {
  let refreshes = 0;
  const h = await setup([liveTool('refresh_stories', {})], { listStories: async () => { refreshes++; return catalog; } });
  t.after(() => h.control.close());
  h.socket.user('Refresh the news'); await flushLive();
  assert.equal(refreshes, 1);
  assert.equal(h.requests.length, 1);
  const shown = h.events.findLast(x => x.type === 'display');
  assert.ok(shown?.type === 'display');
  assert.equal(shown.display.storyCatalog?.fetchedAt, catalog.fetchedAt);
  assert.equal(shown.display.storyCatalog?.curated, true);
  assert.ok(shown.display.storyCatalogId);
});

test('the refresh button uses the voice session catalog and preserves a newer manual selection', async t => {
  let finish!: (value: StoryCatalogResponse) => void;
  const h = await setup([], { listStories: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => h.control.close());
  h.control.act?.({ type: 'refresh_stories' });
  h.control.selectStory(catalog.items[1].id);
  await flushLive();
  finish(catalog); await flushLive();
  const shown = h.events.findLast(x => x.type === 'display');
  assert.ok(shown?.type === 'display');
  assert.equal(shown.display.view, 'exploration');
  assert.equal(shown.display.headline?.id, catalog.items[1].id);
});

test('refreshing an unchanged catalog emits a new completion while spotlight changes retain it', async t => {
  const h = await setup(); t.after(() => h.control.close());
  h.control.act?.({ type: 'refresh_stories' }); await flushLive();
  const first = h.events.findLast(x => x.type === 'display');
  h.control.act?.({ type: 'refresh_stories' }); await flushLive();
  const second = h.events.findLast(x => x.type === 'display');
  assert.ok(first?.type === 'display' && second?.type === 'display');
  assert.notEqual(first.display.storyCatalogId, second.display.storyCatalogId);
  assert.equal(first.display.storyCatalog?.fetchedAt, second.display.storyCatalog?.fetchedAt);
});

test('a failed session refresh preserves the catalog, clears busy state and can recover', async t => {
  let fail = false;
  const h = await setup([], { listStories: async () => { if (fail) throw new Error('Simulated outage'); return catalog; } });
  t.after(() => h.control.close());
  h.control.act?.({ type: 'refresh_stories' }); await flushLive();
  fail = true;
  h.control.act?.({ type: 'refresh_stories' }); await flushLive();
  const failed = h.events.findLast(x => x.type === 'display');
  assert.ok(failed?.type === 'display');
  assert.equal(failed.display.stories?.length, catalog.items.length);
  assert.match(failed.display.storyCatalogError!, /Couldn’t refresh/);
  assert.equal(failed.display.storyCatalog?.fetchedAt, catalog.fetchedAt);
  const status = h.events.findLast(x => x.type === 'research');
  assert.ok(status?.type === 'research' && !status.busy);
  fail = false;
  h.control.act?.({ type: 'refresh_stories' }); await flushLive();
  const recovered = h.events.findLast(x => x.type === 'display');
  assert.ok(recovered?.type === 'display');
  assert.equal(recovered.display.storyCatalogError, undefined);
});

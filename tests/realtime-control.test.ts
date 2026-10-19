import assert from 'node:assert/strict';
import test from 'node:test';
import type WebSocket from 'ws';
import { createRealtimeControl } from '../lib/realtime-control';
import type { ExplorationBackend, VoiceStatus } from '../lib/voice-tools';
import { FIXTURE_HEADLINES, type StoryCatalogResponse } from '../lib/story-contracts';
import { FakeLiveSocket, flushLive, liveAnswer, liveTool } from './helpers/live-fixture';
import type { EventSnapshot } from '../lib/atlas/contracts';
import type { ScreenReport, ScreenSnapshot } from '../lib/screen-contracts';
import { createFixtureStartResponse } from '../lib/atlas/server/fixtures';
import { walkthroughScript } from '../lib/possibility-walkthrough';
import { randomUUID } from 'node:crypto';
const catalog: StoryCatalogResponse = { ok: true, curated: true, fetchedAt: '2026-09-11T00:00:00Z', stale: false, warning: null,
  items: FIXTURE_HEADLINES.map(headline => ({ ...headline, summary: headline.title, whyItMatters: 'A possible development.', scope: 'both', headlines: [headline], contextSources: [] })) };
async function setup(output: unknown[] = [liveAnswer()], overrides: Partial<ExplorationBackend> = {}, idleTimeoutMs?: number,
  backendResponse?: (request: Record<string, unknown>, index: number) => Response | Promise<Response>) {
  const socket = new FakeLiveSocket(), events: VoiceStatus[] = [], requests: Record<string, unknown>[] = [], selected: string[] = [];
  const control = createRealtimeControl({ callId: 'live_fixture', apiKey: 'synthetic', installationId: 'fixture', idleTimeoutMs, onFatal() {},
    socketFactory: url => { assert.equal(url, 'wss://api.openai.com/v1/live/sessions/live_fixture/attach'); return socket as unknown as WebSocket; },
    fetch: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return backendResponse?.(requests.at(-1)!, requests.length)
      ?? Response.json({ status: 'completed', output: requests.length === 1 ? output : [liveAnswer()] }); },
    exploration: { listStories: async () => catalog, getStoryPreview: async id => catalog.items.find(x => x.id === id) ?? null,
      selectStory: async (_installation, id) => { selected.push(id); return { headline: FIXTURE_HEADLINES.find(h => h.id === id) }; },
      search: async () => ({ answer: 'Verified finding.' }), execute: async () => ({ status: 'ready' }), ...overrides },
  });
  control.subscribe(event => events.push(event)); socket.open(); await control.ready;
  return { control, socket, events, requests, selected };
}
test('Live delegates news reasoning to Luna Fast with current app context', async t => {
  const h = await setup(); t.after(() => h.control.close()); h.socket.user('What does this mean?'); await flushLive();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].model, 'gpt-6-luna');
  assert.equal(h.requests[0].service_tier, 'priority');
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
function pendingCatalog() {
  let update: (value: StoryCatalogResponse) => void = () => {};
  let finish!: (value: StoryCatalogResponse) => void;
  let fail!: (error: Error) => void;
  let signal: AbortSignal | undefined;
  const result = new Promise<StoryCatalogResponse>((resolve, reject) => { finish = resolve; fail = reject; });
  const listStories: ExplorationBackend['listStories'] = (requestSignal, onUpdate) => {
    signal = requestSignal;
    update = value => onUpdate?.(value);
    return result;
  };
  return { listStories, partial: () => update({ ...catalog, complete: false, items: catalog.items.slice(0, 1) }),
    finish: (value = { ...catalog, complete: true }) => finish(value), fail,
    get signal() { return signal; } };
}
const speech = (h: Awaited<ReturnType<typeof setup>>) => h.socket.sent.filter(event => event.type === 'session.commentary.append');
const thinking = (h: Awaited<ReturnType<typeof setup>>) => h.socket.sent.filter(event => event.type === 'session.thinking.append').map(event => event.content).join('');
const latestDisplay = (h: Awaited<ReturnType<typeof setup>>) => {
  const event = h.events.findLast(event => event.type === 'display');
  assert.ok(event?.type === 'display');
  return event.display;
};
function openingReport(h: Awaited<ReturnType<typeof setup>>, overrides: Partial<ScreenSnapshot> = {}): ScreenReport {
  const request = h.events.findLast(event => event.type === 'screen_request' && event.catalog);
  assert.ok(request?.type === 'screen_request' && request.catalog);
  return { requestId: request.requestId, outcome: 'ok', screen: {
    contextKey: request.contextKey, view: 'stories', width: 1440, height: 900, scrollY: 0, atTop: true, atBottom: false, hidden: false,
    storyCatalogId: request.catalog.id, renderedStoryIds: request.catalog.storyIds,
    visibleStoryIds: [request.catalog.storyIds[0]], fullyVisibleStoryIds: [request.catalog.storyIds[0]],
    visibleSections: ['stories'], availableSections: ['stories'], ...overrides,
  } };
}

test('opening publishes the whole catalog and waits for browser acknowledgment before briefing once', async t => {
  let requests = 0;
  const h = await setup([], { listStories: async () => { requests++; return catalog; } }); t.after(() => h.control.close());
  h.control.act?.({ type: 'start_briefing' }); h.control.act?.({ type: 'start_briefing' }); await flushLive();
  assert.equal(requests, 1);
  assert.equal(speech(h).length, 0);
  assert.equal(latestDisplay(h).stories?.length, catalog.items.length);
  assert.equal(latestDisplay(h).spotlightStoryId, catalog.items[0].id);
  assert.equal(h.requests.length, 0, 'screen readiness makes no model request');
  assert.equal(h.control.reportScreen?.(openingReport(h)), true); await flushLive();
  assert.equal(speech(h).length, 1);
  h.socket.frame({ type: 'response.done', response: { status: 'completed' } }); assert.equal(speech(h).length, 1);
  h.control.observeAudio?.({ inputActive: false, outputActive: true });
  h.control.observeAudio?.({ inputActive: false, outputActive: false }); assert.equal(speech(h).length, 2);
  h.control.observeAudio?.({ inputActive: true, outputActive: true });
  h.control.observeAudio?.({ inputActive: false, outputActive: false }); assert.equal(speech(h).length, 2);
});

test('partial opening callbacks never display or speak a lead before the completed catalog', async t => {
  const request = pendingCatalog();
  const h = await setup([], { listStories: request.listStories }); t.after(() => h.control.close());
  h.control.act?.({ type: 'start_briefing' }); request.partial(); await flushLive();
  assert.equal(speech(h).length, 0);
  assert.equal(latestDisplay(h).stories, undefined);
  assert.equal(h.events.some(event => event.type === 'screen_request'), false);
  request.finish(); await flushLive();
  assert.equal(latestDisplay(h).stories?.length, catalog.items.length);
  assert.equal(speech(h).length, 0);
  h.control.reportScreen?.(openingReport(h)); await flushLive();
  assert.equal(speech(h).length, 1);
  const completed = h.events.findLast(event => event.type === 'research');
  assert.ok(completed?.type === 'research' && !completed.catalogPending);
});

test('an unrecognized acknowledgment cannot unlock the opening, while its actual request can', async t => {
  const h = await setup(); t.after(() => h.control.close());
  h.control.act?.({ type: 'start_briefing' }); await flushLive();
  const report = openingReport(h);
  assert.equal(h.control.reportScreen?.({ ...report, requestId: '00000000-0000-4000-8000-000000000000' }), false);
  assert.equal(speech(h).length, 0);
  assert.equal(h.control.reportScreen?.(report), true); await flushLive();
  assert.equal(speech(h).length, 1);
});

for (const [name, override] of [
  ['an older catalog with the same view key', { storyCatalogId: '00000000-0000-4000-8000-000000000000' }],
  ['only the first card rendered', { renderedStoryIds: [catalog.items[0].id] }],
  ['a different card order', { renderedStoryIds: catalog.items.map(item => item.id).reverse() }],
  ['an offscreen first story', { visibleStoryIds: [catalog.items[1].id], fullyVisibleStoryIds: [] }],
  ['a hidden page', { hidden: true }],
] as const) {
  test(`opening rejects acknowledgment of ${name}`, async t => {
    const h = await setup(); t.after(() => h.control.close());
    h.control.act?.({ type: 'start_briefing' }); await flushLive();
    h.control.reportScreen?.(openingReport(h, override as Partial<ScreenSnapshot>)); await flushLive();
    assert.equal(speech(h).length, 0);
    assert.equal(latestDisplay(h).stories?.length, catalog.items.length);
    const completed = h.events.findLast(event => event.type === 'research');
    assert.ok(completed?.type === 'research' && !completed.catalogPending);
  });
}

test('missing screen acknowledgment times out without speaking or hiding the complete catalog', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await setup([], {}, 100); t.after(() => h.control.close());
  h.control.act?.({ type: 'start_briefing' }); await flushLive();
  const report = openingReport(h);
  t.mock.timers.tick(4_999); await flushLive();
  assert.equal(speech(h).length, 0);
  assert.equal(h.events.some(event => event.type === 'ended'), false, 'readiness wait is bounded active work');
  t.mock.timers.tick(1); await flushLive();
  assert.equal(speech(h).length, 0);
  assert.equal(h.control.reportScreen?.(report), false);
  assert.equal(latestDisplay(h).stories?.length, catalog.items.length);
  const completed = h.events.findLast(event => event.type === 'research');
  assert.ok(completed?.type === 'research' && !completed.catalogPending);
  t.mock.timers.tick(100); await flushLive();
  assert.ok(h.events.some(event => event.type === 'ended'), 'idle protection is released after timeout');
});

test('user speech cancels pending visual acknowledgment and never restarts automatic narration', async t => {
  const h = await setup(); t.after(() => h.control.close());
  h.control.act?.({ type: 'start_briefing' }); await flushLive();
  const report = openingReport(h);
  h.control.observeAudio?.({ inputActive: true, outputActive: false }); await flushLive();
  assert.equal(h.control.reportScreen?.(report), false);
  h.control.observeAudio?.({ inputActive: false, outputActive: false });
  h.control.act?.({ type: 'start_briefing' });
  assert.equal(speech(h).length, 0);
});

test('a user interruption during catalog loading still allows the complete cards to arrive silently', async t => {
  const request = pendingCatalog();
  const h = await setup([], { listStories: request.listStories }); t.after(() => h.control.close());
  h.control.act?.({ type: 'start_briefing' }); request.partial();
  h.control.observeAudio?.({ inputActive: true, outputActive: false });
  request.finish(); await flushLive();
  assert.equal(latestDisplay(h).stories?.length, catalog.items.length);
  assert.equal(h.events.some(event => event.type === 'screen_request'), false);
  assert.equal(speech(h).length, 0);
});

for (const action of [{ type: 'show_stories' }, { type: 'select_story', storyId: catalog.items[1].id }] as const) {
  test(`${action.type} cancels opening acknowledgment and suppresses late automatic speech`, async t => {
    const h = await setup(); t.after(() => h.control.close());
    h.control.act?.({ type: 'start_briefing' }); await flushLive();
    const report = openingReport(h);
    h.control.act?.(action); await flushLive();
    const count = speech(h).length;
    assert.equal(h.control.reportScreen?.(report), false); await flushLive();
    assert.equal(speech(h).length, count);
    const cancelled = h.events.findLast(event => event.type === 'research');
    assert.ok(cancelled?.type === 'research' && !cancelled.catalogPending);
  });
}

test('spoken story selection uses the full visible catalog without waiting for its automatic briefing', async t => {
  let catalogRequests = 0;
  const h = await setup([liveTool('choose_story', { storyId: catalog.items[0].id })], {
    listStories: async () => { catalogRequests++; return catalog; },
  }); t.after(() => h.control.close());
  h.control.act?.({ type: 'start_briefing' }); await flushLive();
  const report = openingReport(h);
  h.socket.user('Explore that first story'); await flushLive();
  assert.deepEqual(h.selected, [catalog.items[0].id]);
  assert.equal(catalogRequests, 1);
  assert.equal(latestDisplay(h).view, 'exploration');
  assert.equal(h.control.reportScreen?.(report), false);
});

test('closing an opening aborts catalog loading and ignores a late completion', async () => {
  const request = pendingCatalog();
  const h = await setup([], { listStories: request.listStories });
  h.control.act?.({ type: 'start_briefing' }); request.partial();
  await h.control.close();
  assert.equal(request.signal?.aborted, true);
  const events = h.events.length, count = speech(h).length;
  request.finish(); await flushLive();
  assert.equal(h.events.length, events);
  assert.equal(speech(h).length, count);
});

test('closing while waiting for the screen removes its acknowledgment without narration', async () => {
  const h = await setup();
  h.control.act?.({ type: 'start_briefing' }); await flushLive();
  const report = openingReport(h);
  await h.control.close();
  assert.equal(h.control.reportScreen?.(report), false);
  assert.equal(speech(h).length, 0);
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

const storySnapshot = (index = 0): EventSnapshot => ({
  id: 'd5e98030-536d-48f4-a367-de47d6176536', headline: FIXTURE_HEADLINES[index],
  capturedAt: '2026-10-18T12:00:00Z', verificationStatus: 'reported', summary: 'A fuller reported account.',
  facts: [{ text: 'The first attributed research finding.', sourceIds: ['source_1'] }],
  uncertainties: ['The final outcome remains uncertain.'],
  sources: [{ id: 'source_1', title: 'Reporting source', domain: 'example.com', url: 'https://example.com/report' }],
});
function progressiveStory() {
  let update!: (value: EventSnapshot) => void;
  let finish!: (value: object) => void;
  let fail!: (error: Error) => void;
  const result = new Promise<object>((resolve, reject) => { finish = resolve; fail = reject; });
  const selectStory: ExplorationBackend['selectStory'] = (_installation, _id, _signal, onResearch) => {
    assert.ok(onResearch); update = onResearch; return result;
  };
  return { selectStory, update: (value = storySnapshot()) => update(value), fail,
    finish: (value = { kind: 'exploration', headline: FIXTURE_HEADLINES[0], snapshot: storySnapshot(), choices: [] }) => finish(value) };
}

test('story selection immediately displays the richer catalog context and speaks its significance once', async t => {
  const request = progressiveStory();
  const h = await setup([], { selectStory: request.selectStory }); t.after(() => h.control.close());
  h.control.act?.({ type: 'refresh_stories' }); await flushLive();
  h.control.selectStory(catalog.items[0].id);
  assert.equal(latestDisplay(h).storyPreview?.whyItMatters, catalog.items[0].whyItMatters);
  assert.deepEqual(latestDisplay(h).storyPreview?.headlines, catalog.items[0].headlines);
  assert.equal(latestDisplay(h).storyResearch?.phase, 'gathering');
  await flushLive();
  assert.equal(speech(h).length, 1);
  assert.match(JSON.stringify(speech(h)), /whyItMatters/);
  request.finish(); await flushLive();
  assert.equal(speech(h).length, 1);
});

test('validated research displays before the map without unlocking unsaved paths', async t => {
  const request = progressiveStory();
  const h = await setup([], { selectStory: request.selectStory }); t.after(() => h.control.close());
  h.control.selectStory(catalog.items[0].id); await flushLive();
  h.control.observeAudio?.({ inputActive: false, outputActive: true });
  const count = speech(h).length;
  request.update();
  assert.equal(latestDisplay(h).storyResearch?.phase, 'mapping');
  assert.equal(latestDisplay(h).storyResearch?.snapshot?.facts[0].text, storySnapshot().facts[0].text);
  assert.equal(latestDisplay(h).exploration, null);
  assert.throws(() => h.control.act?.({ type: 'choose_path', nodeId: 'd5e98030-536d-48f4-a367-de47d6176536' }), /no saved paths/);
  assert.equal(speech(h).length, count);
  request.finish(); await flushLive();
});

test('research continuation coalesces snapshots and final map completion adds no duplicate narration', async t => {
  const request = progressiveStory();
  const h = await setup([], { selectStory: request.selectStory }); t.after(() => h.control.close());
  h.control.selectStory(catalog.items[0].id); await flushLive();
  h.control.observeAudio?.({ inputActive: false, outputActive: true });
  const count = speech(h).length;
  request.update();
  const newer = { ...storySnapshot(), facts: [{ text: 'The latest attributed finding.', sourceIds: ['source_1'] }] };
  request.update(newer);
  assert.equal(speech(h).length, count);
  h.control.observeAudio?.({ inputActive: false, outputActive: false });
  assert.equal(speech(h).length, count + 1);
  assert.match(thinking(h), /latest attributed finding/);
  assert.match(thinking(h), /example.com/);
  assert.match(thinking(h), /uncertain/);
  assert.match(JSON.stringify(speech(h).at(-1)), /completeContextReady/);
  request.update(); request.finish(); await flushLive();
  assert.equal(speech(h).length, count + 1);
  assert.ok(latestDisplay(h).exploration);
  assert.equal(latestDisplay(h).storyResearch, undefined);
  request.update();
  assert.equal(latestDisplay(h).storyResearch, undefined, 'late progress cannot replace the completed map');
});

test('research arriving after the introduction is already quiet flushes without needing another audio event', async t => {
  const request = progressiveStory();
  const h = await setup([], { selectStory: request.selectStory }); t.after(() => h.control.close());
  h.control.selectStory(catalog.items[0].id); await flushLive();
  const count = speech(h).length;
  request.update();
  assert.equal(speech(h).length, count + 1);
  assert.equal(h.requests.length, 0, 'Live receives the validated facts without another text narration call');
  request.finish(); await flushLive();
});

test('long research stays complete in Live context and follow-up reasoning while its spoken cue stays short', async t => {
  const request = progressiveStory();
  const h = await setup([], { selectStory: request.selectStory }); t.after(() => h.control.close());
  h.control.selectStory(catalog.items[0].id); await flushLive();
  const fact = `${'The report described the proposal and its regional effects. 🌊 '.repeat(55)}Officials cautioned that these figures are preliminary and exclude people whose eligibility is still under review.`;
  const uncertainty = `${'Coverage remains under review. '.repeat(80)}The reported total does not establish how many people will ultimately lose coverage.`;
  const otherFact = 'The third finding remains available for detailed follow-up.';
  const snapshot = { ...storySnapshot(), facts: [
    { text: fact, sourceIds: ['source_1'] },
    { text: 'The policy remains a proposal.', sourceIds: ['source_1'] },
    { text: otherFact, sourceIds: ['source_1'] },
  ], uncertainties: [uncertainty] };
  request.update(snapshot);
  const reference = JSON.parse(thinking(h));
  assert.equal(reference.facts[0].text, fact, 'Live receives the final qualifier rather than a clipped fact');
  assert.equal(reference.uncertainty, uncertainty);
  assert.deepEqual(reference.sources, snapshot.sources);
  assert.equal(reference.facts.length, 2, 'automatic speech considers a small selection of complete findings');
  for (const event of h.socket.sent.filter(event => event.type === 'session.thinking.append')) {
    assert.equal(Buffer.from(String(event.content)).toString('utf8'), event.content, 'chunks preserve Unicode code points');
    assert.ok(Buffer.byteLength(String(event.content)) <= 480);
  }
  const cue = String(speech(h).at(-1)?.content);
  assert.ok(cue.length < 200);
  assert.match(cue, /researchContinuation/);
  assert.doesNotMatch(cue, /regional effects|preliminary/);
  assert.deepEqual(latestDisplay(h).storyResearch?.snapshot, snapshot);
  h.socket.user('What is the qualification at the end, and what else is known?'); await flushLive();
  const context = JSON.parse((h.requests[0].input as Array<{ content: string }>)[0].content);
  assert.deepEqual(context.selectionContext.snapshot, snapshot, 'The text backend gets every full finding, including those not chosen for automatic speech');
  assert.deepEqual(context.display.storyResearch.snapshot, snapshot);
  request.finish(); await flushLive();
});

test('a spoken selection waits for its active backend response before adding a research continuation', async t => {
  const request = progressiveStory();
  let finishResponse!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { finishResponse = resolve; });
  const h = await setup([liveTool('choose_story', { storyId: catalog.items[0].id })], { selectStory: request.selectStory }, undefined,
    (_request, index) => index === 1 ? Response.json({ status: 'completed', output: [liveTool('choose_story', { storyId: catalog.items[0].id })] }) : response);
  t.after(() => h.control.close());
  h.control.act?.({ type: 'refresh_stories' }); await flushLive();
  h.socket.user('Open the first story'); await flushLive();
  assert.equal(h.requests.length, 2);
  assert.equal(speech(h).length, 0, 'the tool selection leaves the introduction to the active voice response');
  request.update();
  assert.equal(speech(h).length, 0, 'research cannot interrupt the active backend response');
  finishResponse(Response.json({ status: 'completed', output: [liveAnswer('An attributed story introduction.')] })); await flushLive();
  assert.equal(speech(h).filter(event => JSON.stringify(event).includes('researchContinuation')).length, 1);
  request.finish(); await flushLive();
});

for (const interrupt of ['microphone', 'delegation'] as const) {
  test(`${interrupt} suppresses queued research narration while preserving context for the user's question`, async t => {
    const request = progressiveStory();
    const h = await setup([], { selectStory: request.selectStory }); t.after(() => h.control.close());
    h.control.selectStory(catalog.items[0].id); await flushLive();
    h.control.observeAudio?.({ inputActive: false, outputActive: true }); request.update();
    if (interrupt === 'microphone') h.control.observeAudio?.({ inputActive: true, outputActive: true });
    else { h.socket.user('What is known so far?'); await flushLive(); }
    const count = speech(h).length;
    h.control.observeAudio?.({ inputActive: false, outputActive: false });
    request.update(); request.finish(); await flushLive();
    assert.equal(speech(h).length, count);
    assert.ok(latestDisplay(h).exploration);
    if (interrupt === 'delegation') assert.match(JSON.stringify(h.requests[0].input), /first attributed research finding/);
  });
}

test('returning to all stories keeps background research and final map from reopening the detail view', async t => {
  const request = progressiveStory();
  const h = await setup([], { selectStory: request.selectStory }); t.after(() => h.control.close());
  h.control.selectStory(catalog.items[0].id); await flushLive();
  h.control.act?.({ type: 'show_stories' }); const count = speech(h).length;
  request.update();
  assert.equal(latestDisplay(h).view, 'stories');
  request.finish(); await flushLive();
  assert.equal(latestDisplay(h).view, 'stories');
  assert.equal(speech(h).length, count);
});

test('a new story and close both reject late research callbacks and their narration', async () => {
  const request = progressiveStory();
  const h = await setup([], { selectStory: (installation, id, signal, update) => id === catalog.items[0].id
    ? request.selectStory(installation, id, signal, update) : Promise.resolve({ headline: FIXTURE_HEADLINES[1] }) });
  h.control.selectStory(catalog.items[0].id); await flushLive();
  h.control.selectStory(catalog.items[1].id); await flushLive();
  const count = speech(h).length;
  request.update(); request.finish(); await flushLive();
  assert.equal(latestDisplay(h).headline?.id, catalog.items[1].id);
  assert.equal(latestDisplay(h).storyResearch?.snapshot, undefined);
  assert.equal(speech(h).length, count);
  await h.control.close();
  const events = h.events.length;
  request.update(); await flushLive();
  assert.equal(h.events.length, events);
});

test('map failure preserves the streamed reporting and exposes an actionable error', async t => {
  const request = progressiveStory();
  const h = await setup([], { selectStory: request.selectStory }); t.after(() => h.control.close());
  h.control.selectStory(catalog.items[0].id); await flushLive(); request.update();
  request.fail(new Error('Fixture map failure')); await flushLive();
  assert.equal(latestDisplay(h).storyResearch?.phase, 'failed');
  assert.deepEqual(latestDisplay(h).storyResearch?.snapshot, storySnapshot());
  assert.match(latestDisplay(h).storyResearch?.error ?? '', /try again/);
  h.socket.user('What do we know?'); await flushLive();
  assert.match(JSON.stringify(h.requests[0].input), /first attributed research finding/);
  assert.match(JSON.stringify(h.requests[0].input), /researchFailed/);
});

test('invalid or mismatched research never reaches the display or automatic voice', async t => {
  const request = progressiveStory();
  const h = await setup([], { selectStory: request.selectStory }); t.after(() => h.control.close());
  h.control.selectStory(catalog.items[0].id); await flushLive();
  const count = speech(h).length;
  request.update({ ...storySnapshot(), facts: [] });
  request.update(storySnapshot(1));
  assert.equal(latestDisplay(h).storyResearch?.phase, 'gathering');
  assert.equal(speech(h).length, count);
  request.finish(); await flushLive();
});

function savedMap() {
  const graphId = randomUUID();
  const start = createFixtureStartResponse({ graphId, installationId: randomUUID(), headline: FIXTURE_HEADLINES[0] });
  if (start.kind !== 'atlas') throw new Error('Expected a saved map.');
  return { kind: 'exploration' as const, headline: FIXTURE_HEADLINES[0], graphId,
    snapshot: start.snapshot, currentNode: null, lineage: [], choices: start.nodes };
}
function confirmPath(h: Awaited<ReturnType<typeof setup>>, outcome: ScreenReport['outcome'] = 'ok') {
  const request = h.events.findLast(event => event.type === 'screen_request' && event.pathId);
  assert.ok(request?.type === 'screen_request' && request.pathId);
  return h.control.reportScreen?.({ requestId: request.requestId, outcome, screen: {
    contextKey: request.contextKey, view: 'exploration', width: 390, height: 844, scrollY: 200, atTop: false, atBottom: false, hidden: false,
    visibleStoryIds: [], fullyVisibleStoryIds: [], visibleSections: ['ChoiceCards'], availableSections: ['StoryOverview', 'ChoiceCards'],
    visiblePathIds: [request.pathId], expandedPathIds: [request.pathId],
  } });
}

test('walkthrough action waits for its visible card and paces the saved map without backend or research calls', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const map = savedMap(); let selections = 0, expansions = 0;
  const h = await setup([], { selectStory: async () => { selections++; return map; }, execute: async () => { expansions++; return map; } });
  t.after(() => h.control.close()); h.control.selectStory(catalog.items[0].id); await flushLive();
  const opening = speech(h).length;
  h.control.act?.({ type: 'start_walkthrough' }); await flushLive();
  assert.equal(speech(h).length, opening);
  assert.equal(latestDisplay(h).spotlightPathId, map.choices[0].id);
  assert.equal(confirmPath(h), true); await flushLive();
  assert.equal(speech(h).length, opening + 1);
  h.control.act?.({ type: 'start_walkthrough' }); await flushLive();
  assert.equal(speech(h).length, opening + 1, 'a duplicate request cannot queue another guide');
  for (const [index, node] of map.choices.entries()) {
    h.control.observeAudio?.({ inputActive: false, outputActive: true });
    h.socket.frame({ type: 'session.output_transcript.delta', delta: walkthroughScript(node, index), start_ms: index * 1000, end_ms: index * 1000 + 100 });
    h.socket.frame({ type: 'response.done', response: { status: 'completed' } });
    assert.equal(latestDisplay(h).spotlightPathId, node.id, 'provider response events cannot move the card');
    h.control.observeAudio?.({ inputActive: false, outputActive: false });
    t.mock.timers.tick(400); await flushLive();
    if (index < map.choices.length - 1) { confirmPath(h); await flushLive(); }
  }
  assert.equal(speech(h).length, opening + map.choices.length);
  assert.equal(latestDisplay(h).walkthrough, undefined);
  assert.equal(h.requests.length, 0); assert.equal(selections, 1); assert.equal(expansions, 0);
});

test('a spoken walkthrough request starts the same queue silently with no redundant backend continuation', async t => {
  const map = savedMap();
  const h = await setup([liveTool('start_walkthrough', {})], { selectStory: async () => map });
  t.after(() => h.control.close()); h.control.selectStory(catalog.items[0].id); await flushLive(); const opening = speech(h).length;
  h.socket.user('Talk me through these options one by one.'); await flushLive();
  assert.equal(h.requests.length, 1); assert.equal(speech(h).length, opening);
  confirmPath(h); await flushLive();
  assert.equal(speech(h).length, opening + 1);
  assert.equal(latestDisplay(h).walkthrough?.index, 0);
  h.socket.frame({ type: 'session.delegation.created', offset_ms: 101, delegation: { id: 'unsolicited_guide_task', target: 'client' } });
  await flushLive();
  assert.equal(h.requests.length, 1, 'guide narration cannot loop into paid backend work without a new user request');
  assert.equal(latestDisplay(h).walkthrough?.index, 0);
});

test('interrupting a guide permits a flexible analysis card and never resumes the remaining options', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const map = savedMap(); const insight = { title: 'A different possibility', summary: 'This could change the incentives.', points: [], assumptions: ['A hypothetical premise.'], signals: [] };
  const h = await setup([liveTool('show_analysis', insight)], { selectStory: async () => map }); t.after(() => h.control.close());
  h.control.selectStory(catalog.items[0].id); await flushLive(); h.control.act?.({ type: 'start_walkthrough' }); confirmPath(h); await flushLive();
  h.control.observeAudio?.({ inputActive: false, outputActive: true });
  h.control.observeAudio?.({ inputActive: true, outputActive: true });
  assert.equal(latestDisplay(h).walkthrough, undefined);
  h.socket.user('What if the situation develops differently?'); await flushLive();
  assert.equal(latestDisplay(h).insight?.title, insight.title);
  const count = speech(h).length;
  h.socket.frame({ type: 'session.output_transcript.delta', delta: walkthroughScript(map.choices[0], 0), start_ms: 0, end_ms: 100 });
  h.control.observeAudio?.({ inputActive: false, outputActive: false }); t.mock.timers.tick(1000); await flushLive();
  assert.equal(speech(h).length, count); assert.deepEqual(latestDisplay(h).exploration?.choices, map.choices);
});

test('stop, navigation, and close cancel an unconfirmed guide without late narration', async t => {
  const map = savedMap();
  const h = await setup([], { selectStory: async () => map }); t.after(() => h.control.close());
  h.control.selectStory(catalog.items[0].id); await flushLive(); const opening = speech(h).length;
  h.control.act?.({ type: 'start_walkthrough' }); await flushLive();
  h.control.act?.({ type: 'stop_walkthrough' }); assert.equal(confirmPath(h), false); await flushLive();
  assert.equal(speech(h).length, opening);
  h.control.act?.({ type: 'start_walkthrough' }); await flushLive();
  h.control.act?.({ type: 'show_stories' }); assert.equal(confirmPath(h), false); await flushLive();
  assert.equal(latestDisplay(h).view, 'stories'); assert.equal(speech(h).length, opening);
});

test('offers the guide once after the story is quiet without starting it or interrupting playback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const map = savedMap(); const h = await setup([], { selectStory: async () => map }); t.after(() => h.control.close());
  h.control.selectStory(catalog.items[0].id); await flushLive(); const opening = speech(h).length;
  t.mock.timers.tick(1000); assert.equal(speech(h).length, opening, 'wait for actual introduction playback');
  h.control.observeAudio?.({ inputActive: false, outputActive: true }); t.mock.timers.tick(1000);
  assert.equal(speech(h).length, opening);
  h.control.observeAudio?.({ inputActive: false, outputActive: false }); t.mock.timers.tick(600);
  assert.equal(speech(h).length, opening + 1);
  assert.match(String(speech(h).at(-1)?.content), /go through these possibilities one by one/);
  assert.equal(latestDisplay(h).walkthrough, undefined);
  h.control.observeAudio?.({ inputActive: false, outputActive: true });
  h.control.observeAudio?.({ inputActive: false, outputActive: false }); t.mock.timers.tick(600);
  assert.equal(speech(h).length, opening + 1);
});

test('a user question cancels the pending walkthrough offer while keeping conversation analysis available', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const map = savedMap(); const h = await setup([], { selectStory: async () => map }); t.after(() => h.control.close());
  h.control.selectStory(catalog.items[0].id); await flushLive();
  h.control.observeAudio?.({ inputActive: false, outputActive: true });
  h.control.observeAudio?.({ inputActive: false, outputActive: false });
  h.control.observeAudio?.({ inputActive: true, outputActive: false });
  t.mock.timers.tick(600); assert.ok(!speech(h).some(frame => String(frame.content).includes('go through these possibilities')));
});

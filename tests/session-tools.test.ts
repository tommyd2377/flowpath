import type { ScreenReport } from '../lib/screen-contracts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionService } from '../lib/session-server';
import type { VoiceControl, VoiceControlOptions, VoiceStatus } from '../lib/voice-tools';
import { SESSION_SECONDS } from '../lib/session-config';
import { emptyDisplay, type ExplorationAction } from '../lib/visual-contracts';

const origin = 'http://127.0.0.1:3210';
const id = 'e506c426-a37d-4ad6-a62b-2d26e5532a83';
const installation = '38963e02-2f67-4b92-8377-3436958d2dd5';
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

test('fixture mode blocks paid voice even if a local key is configured', async () => {
  let upstreamCalls = 0;
  const service = createSessionService({
    fixtureMode: true, apiKey: () => 'fake-configured-key',
    fetch: async () => { upstreamCalls++; throw new Error('Must never call upstream'); },
  });
  assert.deepEqual(await (await service.GET(request(''))).json(), { ready: false, reason: 'fixture' });
  assert.equal((await service.POST(request('', 'POST', sdp))).status, 503);
  assert.equal(upstreamCalls, 0);
});

function request(path: string, method = 'GET', body?: string, overrides: Record<string, string> = {}) {
  return new Request(`${origin}/api/session${path}`, { method, body, headers: {
    Origin: origin, 'X-Voice-Session': id, 'X-Voice-Installation': installation,
    'Content-Type': path === '' ? 'application/sdp' : 'application/json', ...overrides,
  } });
}

function setup(ready = Promise.resolve()) {
  const listeners = new Set<(event: VoiceStatus) => void>();
  const selected: string[] = [];
  const screens: ScreenReport[] = [];
  const actions: { action: ExplorationAction; headlineId?: string }[] = [];
  const requests: string[] = [];
  let closed = 0;
  let factoryOptions: VoiceControlOptions | undefined;
  const control: VoiceControl = {
    ready,
    reportScreen: report => { screens.push(report); return true; },
    observeScreen: () => true,
    selectStory: (headlineId) => { selected.push(headlineId); return selected.length; },
    act: (action, headlineId) => { actions.push({ action, headlineId }); return 2; },
    subscribe: (listener) => { listeners.add(listener); listener({ type: 'research', busy: false, message: '', revision: 0 }); return () => { listeners.delete(listener); }; },
    close: (message = 'Ended') => { closed++; for (const listener of listeners) listener({ type: 'ended', message }); },
  };
  const service = createSessionService({
    apiKey: () => 'fake-local-test-key',
    controlFactory: (options) => { factoryOptions = options; return control; },
    fetch: async (url) => {
      requests.push(String(url));
      return String(url).endsWith('/hangup') ? new Response(null, { status: 200 })
        : new Response(sdp, { headers: { Location: '/v1/realtime/calls/rtc_fixture' } });
    },
  });
  return { service, selected, actions, requests, listeners, screens, closed: () => closed, factoryOptions: () => factoryOptions };
}

test('visual actions use only the active call and reject malformed or cross-origin requests', async () => {
  const t = setup();
  const body = JSON.stringify({ action: { type: 'choose_path', nodeId: installation }, headlineId: 'headline_a' });
  assert.equal(t.service.hasActiveSession(installation), false);
  assert.equal((await t.service.ACTION(request('/action', 'POST', body))).status, 409);
  await t.service.POST(request('', 'POST', sdp));
  assert.equal(t.service.hasActiveSession(installation), true);
  assert.equal(t.service.hasActiveSession(id), false);
  assert.equal((await t.service.ACTION(request('/action', 'POST', body, { Origin: 'https://foreign.example' }))).status, 403);
  assert.equal((await t.service.ACTION(request('/action', 'POST', body, { 'X-Voice-Session': installation }))).status, 409);
  for (const invalid of ['{', '{}', '{"action":{"type":"choose_path","nodeId":"invented"}}', '{"action":{"type":"show_stories","query":"injected"}}']) {
    assert.equal((await t.service.ACTION(request('/action', 'POST', invalid))).status, 400);
  }
  assert.equal((await t.service.ACTION(request('/action', 'POST', 'x'.repeat(4097)))).status, 413);
  assert.equal(t.actions.length, 0);
  const response = await t.service.ACTION(request('/action', 'POST', body));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, revision: 2 });
  assert.deepEqual(t.actions, [{ action: { type: 'choose_path', nodeId: installation }, headlineId: 'headline_a' }]);
  await t.service.DELETE(request('', 'DELETE'));
  assert.equal(t.service.hasActiveSession(installation), false);
  assert.equal((await t.service.ACTION(request('/action', 'POST', body))).status, 409);
});

test('ending voice during a slow visual action body prevents dispatch', async () => {
  const t = setup();
  await t.service.POST(request('', 'POST', sdp));
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; } });
  const input = new Request(`${origin}/api/session/action`, { method: 'POST', body: stream, duplex: 'half', headers: {
    Origin: origin, 'Content-Type': 'application/json', 'X-Voice-Session': id,
  } } as RequestInit);
  const response = t.service.ACTION(input);
  await t.service.DELETE(request('', 'DELETE'));
  body.enqueue(new TextEncoder().encode('{"action":{"type":"show_stories"}}'));
  body.close();
  assert.equal((await response).status, 409);
  assert.equal(t.actions.length, 0);
});

test('the status stream carries structured visuals without audio or conversation transcripts', async () => {
  const t = setup();
  await t.service.POST(request('', 'POST', sdp));
  const reader = (await t.service.EVENTS(request('/events'))).body!.getReader();
  await reader.read();
  const display = { ...emptyDisplay(3), insight: { title: 'Potential effects', summary: 'If the proposal passes, institutions may adapt.', points: [], assumptions: ['Approval is hypothetical.'], signals: [] } };
  for (const listener of t.listeners) listener({ type: 'display', display, revision: 3 });
  const frame = new TextDecoder().decode((await reader.read()).value);
  assert.deepEqual(JSON.parse(frame.slice(6)), { type: 'display', display, revision: 3 });
  assert.doesNotMatch(frame, /audio|transcript|fake-local-test-key/);
  await reader.cancel();
  await t.service.DELETE(request('', 'DELETE'));
});

test('controlled sessions require installation identity and attach to the created call', async () => {
  const t = setup();
  const missing = request('', 'POST', sdp);
  missing.headers.delete('X-Voice-Installation');
  assert.equal((await t.service.POST(missing)).status, 400);
  assert.equal(t.requests.length, 0);
  assert.equal((await t.service.POST(request('', 'POST', sdp))).status, 200);
  assert.equal(t.factoryOptions()?.callId, 'rtc_fixture');
  assert.equal(t.factoryOptions()?.installationId, installation);
  await t.service.DELETE(request('', 'DELETE'));
  assert.equal(t.closed(), 1);
});

test('sideband setup failure closes the already-created provider call', async () => {
  const ready = Promise.reject(new Error('private internal failure'));
  // The fixture's rejected promise is consumed by the handshake in the same turn.
  const t = setup(ready);
  const response = await t.service.POST(request('', 'POST', sdp));
  assert.equal(response.status, 502);
  assert.equal(t.requests.filter((url) => url.endsWith('/hangup')).length, 1);
  assert.equal((await response.text()).includes('private internal'), false);
});

test('story selection is bound to the active local session and validates a bounded payload', async () => {
  const t = setup();
  assert.equal((await t.service.STORY(request('/story', 'POST', '{"headlineId":"headline_a"}'))).status, 409);
  await t.service.POST(request('', 'POST', sdp));
  for (const body of ['{}', '{"headlineId":"../unsafe"}', '{"headlineId":"headline_a","tool":"injected"}', 'x'.repeat(1025)]) {
    assert.equal((await t.service.STORY(request('/story', 'POST', body))).status, 400);
  }
  assert.equal((await t.service.STORY(request('/story', 'POST', '{"headlineId":"headline_a"}', { 'X-Voice-Session': installation }))).status, 409);
  assert.equal((await t.service.STORY(request('/story', 'POST', '{"headlineId":"headline_a"}', { Origin: 'https://elsewhere.example' }))).status, 403);
  const selected = await t.service.STORY(request('/story', 'POST', '{"headlineId":"headline_a"}'));
  assert.equal(selected.status, 202);
  assert.deepEqual(await selected.json(), { ok: true, revision: 1 });
  assert.deepEqual(t.selected, ['headline_a']);
  await t.service.DELETE(request('', 'DELETE'));
});

test('status stream exposes status only and releases its listener when canceled', async () => {
  const t = setup();
  await t.service.POST(request('', 'POST', sdp));
  assert.equal((await t.service.EVENTS(request('/events', 'GET', undefined, { 'X-Voice-Session': installation }))).status, 409);
  const response = await t.service.EVENTS(request('/events'));
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /"type":"research"/);
  assert.equal(first.includes('fake-local-test-key'), false);
  assert.equal(t.listeners.size, 1);
  await reader.cancel();
  assert.equal(t.listeners.size, 0);
  await t.service.DELETE(request('', 'DELETE'));
});

test('ending a session ends its status stream and disables further selections', async () => {
  const t = setup();
  await t.service.POST(request('', 'POST', sdp));
  const response = await t.service.EVENTS(request('/events'));
  const reader = response.body!.getReader();
  await reader.read();
  await t.service.DELETE(request('', 'DELETE'));
  const end = new TextDecoder().decode((await reader.read()).value);
  assert.match(end, /"type":"ended"/);
  assert.equal((await reader.read()).done, true);
  assert.equal((await t.service.STORY(request('/story', 'POST', '{"headlineId":"headline_a"}'))).status, 409);
});

test('ten-minute server cutoff closes the control channel and upstream call', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const t = setup();
  assert.equal(SESSION_SECONDS, 600);
  await t.service.POST(request('', 'POST', sdp));
  context.mock.timers.tick(599_999);
  assert.equal(t.closed(), 0);
  context.mock.timers.tick(1);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.ok(t.closed() > 0);
  assert.equal(t.requests.filter((url) => url.endsWith('/hangup')).length, 1);
});

test('reloading conversation behavior preserves the active call, start throttle, and cleanup guard', async () => {
  const factories: string[] = [];
  const instructions: string[] = [];
  let hangupFails = false;
  const factory = (version: string): ((options: VoiceControlOptions) => VoiceControl) => () => {
    factories.push(version);
    return { ready: Promise.resolve(), selectStory: () => 1, subscribe: () => () => {}, close: () => {} };
  };
  const service = createSessionService({
    apiKey: () => 'fake-test-key', controlFactory: factory('original'),
    fetch: async (url, init) => {
      if (String(url).endsWith('/hangup')) return new Response(null, { status: hangupFails ? 503 : 200 });
      instructions.push(JSON.parse(String((init?.body as FormData).get('session'))).instructions);
      return new Response(sdp, { headers: { Location: '/v1/realtime/calls/rtc_fixture' } });
    },
  });
  await service.POST(request('', 'POST', sdp));
  service.updateConversation({ instructions: 'Updated conversational policy', controlFactory: factory('updated') });
  assert.equal((await service.POST(request('', 'POST', sdp))).status, 409);
  assert.deepEqual(factories, ['original']);
  await service.DELETE(request('', 'DELETE'));
  for (let index = 0; index < 2; index++) {
    assert.equal((await service.POST(request('', 'POST', sdp))).status, 200);
    await service.DELETE(request('', 'DELETE'));
  }
  assert.deepEqual(factories, ['original', 'updated', 'updated']);
  assert.deepEqual(instructions.slice(1), ['Updated conversational policy', 'Updated conversational policy']);
  service.updateConversation({ instructions: 'Another update', controlFactory: factory('again') });
  assert.equal((await service.POST(request('', 'POST', sdp))).status, 429);

  const blocked = createSessionService({
    apiKey: () => 'fake-test-key',
    fetch: async url => String(url).endsWith('/hangup') ? new Response(null, { status: hangupFails ? 503 : 200 }) : new Response(sdp, { headers: { Location: '/v1/realtime/calls/rtc_fixture' } }),
  });
  await blocked.POST(request('', 'POST', sdp));
  hangupFails = true;
  await blocked.DELETE(request('', 'DELETE'));
  blocked.updateConversation({ instructions: 'Updated', controlFactory: factory('blocked') });
  assert.equal((await blocked.POST(request('', 'POST', sdp))).status, 503);
  assert.deepEqual(await (await blocked.GET(request(''))).json(), { ready: false, reason: 'cleanup_failed' });
});


test('a guided briefing requires the active session and accepts no story or extra action arguments', async () => {
  const t = setup();
  const body = JSON.stringify({ action: { type: 'start_briefing' } });
  assert.equal((await t.service.ACTION(request('/action', 'POST', body))).status, 409);
  await t.service.POST(request('', 'POST', sdp));
  assert.equal((await t.service.ACTION(request('/action', 'POST', body))).status, 202);
  assert.deepEqual(t.actions, [{ action: { type: 'start_briefing' }, headlineId: undefined }]);
  assert.equal((await t.service.ACTION(request('/action', 'POST', '{"action":{"type":"start_briefing","script":"injected"}}'))).status, 400);
  await t.service.DELETE(request('', 'DELETE'));
});

const screenReport: ScreenReport = { requestId: installation, outcome: 'boundary', screen: {
  contextKey: '0:stories::', view: 'stories', width: 390, height: 844, scrollY: 0,
  atTop: true, atBottom: false, hidden: false, visibleStoryIds: [], fullyVisibleStoryIds: [],
  visibleSections: ['stories'], availableSections: ['stories'],
} };

test('screen acknowledgments require the active local session and bounded structured data', async () => {
  const t = setup();
  const body = JSON.stringify(screenReport);
  assert.equal((await t.service.SCREEN(request('/screen', 'POST', body))).status, 409);
  await t.service.POST(request('', 'POST', sdp));
  assert.equal((await t.service.SCREEN(request('/screen', 'POST', body, { Origin: 'https://foreign.example' }))).status, 403);
  assert.equal((await t.service.SCREEN(request('/screen', 'POST', body, { 'X-Voice-Session': installation }))).status, 409);
  for (const invalid of ['{', '{}', JSON.stringify({ ...screenReport, transcript: 'not allowed' }), JSON.stringify({ ...screenReport, screen: { ...screenReport.screen, availableSections: ['injected'] } })]) {
    assert.equal((await t.service.SCREEN(request('/screen', 'POST', invalid))).status, 400);
  }
  assert.equal((await t.service.SCREEN(request('/screen', 'POST', 'x'.repeat(8193)))).status, 413);
  assert.equal(t.screens.length, 0);
  assert.equal((await t.service.SCREEN(request('/screen', 'POST', body))).status, 204);
  assert.deepEqual(t.screens, [screenReport]);
  assert.equal((await t.service.SCREEN(request('/screen', 'POST', JSON.stringify({ type: 'observation', screen: screenReport.screen, sequence: 1 })))).status, 204);
  await t.service.DELETE(request('', 'DELETE'));
  assert.equal((await t.service.SCREEN(request('/screen', 'POST', body))).status, 409);
});

import { screenContextKey, type ScreenReport, type ScreenRequest } from '../lib/screen-contracts';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type WebSocket from 'ws';
import { createRealtimeControl } from '../lib/realtime-control';
import type { ExplorationBackend, VoiceStatus } from '../lib/voice-tools';
import { FIXTURE_HEADLINES, type StoryCatalogResponse } from '../lib/story-contracts';
import type { ExplorationData, ExplorationDisplay } from '../lib/visual-contracts';

const CATALOG: StoryCatalogResponse = {
  ok: true, curated: true, fetchedAt: '2026-09-05T10:00:00.000Z', stale: false, warning: null,
  items: FIXTURE_HEADLINES.map(headline => ({ ...headline, summary: headline.title, whyItMatters: 'A possible consequential development.', scope: 'both', headlines: [headline], contextSources: [] })),
};
const NODE_A = '11111111-1111-4111-8111-111111111111';
const NODE_B = '22222222-2222-4222-8222-222222222222';
function exploration(headline = FIXTURE_HEADLINES[0], focused = false): ExplorationData {
  const node = { id: NODE_A, parentId: 'root', depth: 1 as const, title: 'Adopt the proposal', summary: 'The proposal could be adopted.', whyPlausible: 'Negotiation remains possible.', keyAssumption: 'Support can be secured.', watchFor: ['A vote is scheduled.'], lessLikelyIf: 'Support falls.', horizon: 'Over the coming months', childIds: [], status: 'ready' as const, errorMessage: null, leafReason: null };
  return { kind: 'exploration', headline, currentNode: focused ? node : null, lineage: focused ? [node] : [], choices: focused ? [] : [node] };
}

function latestDisplay(statuses: VoiceStatus[]): ExplorationDisplay | undefined {
  const event = statuses.findLast(event => event.type === 'display');
  return event?.type === 'display' ? event.display : undefined;
}

function toolOutputs(socket: FakeSocket, callId: string) {
  return socket.sent.filter(event => event.type === 'conversation.item.create').map(event => event.item as { type: string; call_id?: string; output: string }).filter(item => item.type === 'function_call_output' && item.call_id === callId).map(item => JSON.parse(item.output));
}

function storyContexts(socket: FakeSocket) {
  return socket.sent.flatMap(event => {
    const item = event.item as { type?: string; content?: Array<{ text?: string }> } | undefined;
    if (event.type !== 'conversation.item.create' || item?.type !== 'message') return [];
    const text = item.content?.[0]?.text;
    return text ? [JSON.parse(text).selected_story_context].filter(Boolean) : [];
  });
}

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  terminated = false;
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  terminate() { this.terminated = true; this.emit('close'); }
  receive(event: object) { this.emit('message', Buffer.from(JSON.stringify(event))); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

async function setup(backend?: Partial<ExplorationBackend>) {
  const socket = new FakeSocket();
  const selects: string[] = [];
  const executions: Array<{ name: string; args: Record<string, unknown> }> = [];
  const searches: Array<{ question: string; headlineId?: string }> = [];
  const statuses: VoiceStatus[] = [];
  let fatal = 0;
  const control = createRealtimeControl({
    callId: 'rtc_fixture', apiKey: 'fake-test-only', installationId: 'fixture-installation',
    onFatal: () => { fatal++; }, socketFactory: () => socket as unknown as WebSocket,
    exploration: {
      listStories: backend?.listStories,
      getStoryPreview: backend?.getStoryPreview,
      selectStory: async (_id, headline, signal) => { selects.push(headline); return backend?.selectStory ? backend.selectStory(_id, headline, signal) : { headline }; },
      execute: async (id, name, args, signal, headlineId) => { executions.push({ name, args }); return backend?.execute ? backend.execute(id, name, args, signal, headlineId) : { choices: ['fixture choice'] }; },
      search: async (id, question, signal, headlineId) => { searches.push({ question, headlineId }); return backend?.search ? backend.search(id, question, signal, headlineId) : { kind: 'web_research', findings: ['fixture evidence'] }; },
    },
  });
  control.subscribe((event) => statuses.push(event));
  socket.emit('open');
  socket.receive({ type: 'session.updated' });
  await control.ready;
  return { control, socket, selects, executions, searches, statuses, fatal: () => fatal };
}

function calls(socket: FakeSocket, responseId: string, items: Array<{ call_id: string; name: string; arguments: string; id?: string }>) {
  socket.receive({ type: 'response.created', response: { id: responseId } });
  socket.receive({ type: 'response.done', response: { id: responseId, status: 'completed', output: items.map((item) => ({ type: 'function_call', ...item })) } });
}

function completeReply(socket: FakeSocket, id = 'reply') {
  socket.receive({ type: 'response.created', response: { id } });
  socket.receive({ type: 'response.done', response: { id, status: 'completed', output: [] } });
}

test('control configures server tools, stays silent on connection, and starts selected-story speech once', async () => {
  const { control, socket, selects, statuses } = await setup();
  const update = socket.sent[0] as { session: { tools: Array<{ name: string }> } };
  assert.deepEqual(update.session.tools.map((tool) => tool.name), ['get_screen', 'scroll_page', 'list_stories', 'spotlight_path', 'spotlight_story', 'choose_story', 'show_stories', 'show_analysis', 'search_web', 'get_exploration', 'retry_story', 'choose_path', 'navigate_path', 'compare_paths']);
  assert.equal(socket.sent.some((event) => event.type === 'response.create'), false);
  assert.equal(control.selectStory('headline_a'), 1);
  assert.equal(control.selectStory('headline_a'), 1);
  await flush();
  assert.deepEqual(selects, ['headline_a']);
  assert.equal(socket.sent.filter((event) => event.type === 'response.create').length, 1);
  assert.ok(statuses.some((event) => event.type === 'research' && event.busy));
  assert.deepEqual(statuses.at(-1), { type: 'research', busy: false, message: '', revision: 1 });
  control.close();
});

test('switching stories aborts old work and discards its late result', async () => {
  const old = deferred<object>();
  let oldSignal: AbortSignal | undefined;
  const { control, socket, selects } = await setup({ selectStory: async (_id, story, signal) => {
    if (story === 'headline_a') { oldSignal = signal; return old.promise; }
    return { headline: story };
  } });
  control.selectStory('headline_a');
  await flush();
  control.selectStory('headline_b');
  await flush();
  assert.equal(oldSignal?.aborted, true);
  assert.deepEqual(selects, ['headline_a', 'headline_b']);
  old.resolve({ headline: 'headline_a', summary: 'obsolete result' });
  await flush();
  assert.equal(JSON.stringify(socket.sent).includes('obsolete result'), false);
  assert.ok(JSON.stringify(socket.sent).includes('headline_b'));
  control.close();
});

test('duplicate tool events are executed once and distinct calls are serialized', async () => {
  const first = deferred<object>();
  const { control, socket, executions } = await setup({ execute: async (_id, name) => name === 'choose_path' ? first.promise : { root: true } });
  control.selectStory('headline_a');
  await flush();
  completeReply(socket);
  const choose = { call_id: 'call_a', name: 'choose_path', arguments: '{"nodeId":"node_a"}' };
  calls(socket, 'tool_response', [choose, { call_id: 'call_b', name: 'get_exploration', arguments: '{}' }]);
  calls(socket, 'duplicate_response', [choose]);
  await flush();
  assert.equal(executions.length, 1);
  first.resolve({ path: 'a' });
  await flush();
  assert.deepEqual(executions.map((item) => item.name), ['choose_path', 'get_exploration']);
  const outputs = socket.sent.filter((event) => event.type === 'conversation.item.create').map((event) => event.item as { type: string; call_id?: string });
  assert.equal(outputs.filter((item) => item.call_id === 'call_a').length, 1);
  assert.equal(outputs.filter((item) => item.call_id === 'call_b').length, 1);
  control.close();
});

test('results ready during user speech are handled by their next turn without a duplicate reply', async () => {
  const result = deferred<object>();
  const { control, socket } = await setup({ selectStory: async () => result.promise });
  control.selectStory('headline_a');
  await flush();
  socket.receive({ type: 'input_audio_buffer.speech_started' });
  result.resolve({ summary: 'ready' });
  await flush();
  assert.equal(socket.sent.filter((event) => event.type === 'response.create').length, 0);
  socket.receive({ type: 'input_audio_buffer.speech_stopped' });
  socket.receive({ type: 'response.created', response: { id: 'user_turn' } });
  socket.receive({ type: 'output_audio_buffer.started' });
  socket.receive({ type: 'response.done', response: { id: 'user_turn', status: 'completed' } });
  assert.equal(socket.sent.filter((event) => event.type === 'response.create').length, 0);
  socket.receive({ type: 'output_audio_buffer.stopped' });
  assert.equal(socket.sent.filter((event) => event.type === 'response.create').length, 0);
  control.close();
});

test('results arriving after a response began wait for its playback to finish', async () => {
  const result = deferred<object>();
  const { control, socket } = await setup({ selectStory: async () => result.promise });
  control.selectStory('headline_a');
  await flush();
  socket.receive({ type: 'response.created', response: { id: 'acknowledgement' } });
  socket.receive({ type: 'output_audio_buffer.started' });
  result.resolve({ summary: 'ready' });
  await flush();
  socket.receive({ type: 'response.done', response: { id: 'acknowledgement', status: 'completed' } });
  assert.equal(socket.sent.filter((event) => event.type === 'response.create').length, 0);
  socket.receive({ type: 'output_audio_buffer.stopped' });
  assert.equal(socket.sent.filter((event) => event.type === 'response.create').length, 1);
  control.close();
});

test('old response tools cannot execute against a new selected story', async () => {
  const { control, socket, executions } = await setup();
  control.selectStory('headline_a');
  await flush();
  socket.receive({ type: 'response.created', response: { id: 'old_response', metadata: { voice_revision: '1' } } });
  socket.receive({ type: 'conversation.item.added', item: { id: 'old_item' } });
  socket.receive({ type: 'output_audio_buffer.started' });
  control.selectStory('headline_b');
  socket.receive({ type: 'response.done', response: { id: 'old_response', status: 'completed', output: [{ type: 'function_call', call_id: 'old_call', name: 'choose_path', arguments: '{"nodeId":"old_node"}' }] } });
  await flush();
  assert.deepEqual(executions, []);
  assert.ok(socket.sent.some((event) => event.type === 'output_audio_buffer.clear'));
  assert.ok(socket.sent.some((event) => event.type === 'conversation.item.delete' && event.item_id === 'old_item'));
  control.close();
});

test('unsupported tool names and malformed arguments never reach the research backend', async () => {
  const { control, socket, executions } = await setup();
  control.selectStory('headline_a');
  await flush();
  completeReply(socket);
  calls(socket, 'invalid_tools', [
    { call_id: 'bad_name', name: 'arbitrary_command', arguments: '{}' },
    { call_id: 'bad_args', name: 'choose_path', arguments: '{broken' },
  ]);
  await flush();
  assert.deepEqual(executions, []);
  assert.ok(JSON.stringify(socket.sent).includes('not supported'));
  control.close();
});

test('closing control aborts research, closes subscribers and never speaks its result', async () => {
  const pending = deferred<object>();
  let signal: AbortSignal | undefined;
  const { control, socket, statuses, fatal } = await setup({ selectStory: async (_id, _headline, currentSignal) => { signal = currentSignal; return pending.promise; } });
  control.selectStory('headline_a');
  await flush();
  control.close();
  pending.resolve({ summary: 'late result' });
  await flush();
  assert.equal(signal?.aborted, true);
  assert.equal(socket.terminated, true);
  assert.equal(statuses.at(-1)?.type, 'ended');
  assert.equal(JSON.stringify(socket.sent).includes('late result'), false);
  assert.equal(fatal(), 0);
});

test('unexpected socket failure reports an ended session exactly once', async () => {
  const { control, socket, statuses, fatal } = await setup();
  socket.emit('error', new Error('private provider diagnostics'));
  socket.emit('close');
  assert.equal(fatal(), 1);
  assert.equal(statuses.filter((event) => event.type === 'ended').length, 1);
  assert.equal(JSON.stringify(statuses).includes('private provider'), false);
  control.close();
});

test('no-cost configuration timeout rejects readiness and closes the socket', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const socket = new FakeSocket();
  let fatal = 0;
  const control = createRealtimeControl({
    callId: 'rtc_fixture', apiKey: 'fake', installationId: 'fixture', readyTimeoutMs: 10,
    onFatal: () => { fatal++; }, socketFactory: () => socket as unknown as WebSocket,
    exploration: { selectStory: async () => ({}), execute: async () => ({}), search: async () => ({}) },
  });
  const rejected = assert.rejects(control.ready, /closed/);
  context.mock.timers.tick(10);
  await rejected;
  assert.equal(fatal, 1);
  assert.equal(socket.terminated, true);
});

test('failed story switch never exposes the previous story and can be explicitly retried', async () => {
  let failB = true;
  const { control, socket, executions, selects } = await setup({ selectStory: async (_id, headline) => {
    if (headline === 'headline_b' && failB) throw new Error('fixture failure');
    return { headline };
  } });
  control.selectStory('headline_a');
  await flush();
  completeReply(socket, 'a_reply');
  control.selectStory('headline_b');
  await flush();
  completeReply(socket, 'b_failed');
  calls(socket, 'old_graph_attempt', [{ call_id: 'get_old', name: 'get_exploration', arguments: '{}' }]);
  await flush();
  assert.deepEqual(executions, []);
  assert.ok(JSON.stringify(socket.sent).includes('No earlier story is active'));
  completeReply(socket, 'explain_failure');
  failB = false;
  calls(socket, 'retry', [{ call_id: 'retry_b', name: 'retry_story', arguments: '{}' }]);
  await flush();
  assert.deepEqual(selects, ['headline_a', 'headline_b', 'headline_b']);
  completeReply(socket, 'b_success');
  calls(socket, 'get_b', [{ call_id: 'get_new', name: 'get_exploration', arguments: '{}' }]);
  await flush();
  assert.equal(executions.length, 1);
  control.close();
});

test('VAD response-create collision does not queue a duplicate spoken summary', async () => {
  const { control, socket } = await setup();
  control.selectStory('headline_a');
  await flush();
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 1);
  socket.receive({ type: 'response.created', response: { id: 'automatic_response' } });
  socket.receive({ type: 'error', error: { code: 'conversation_already_has_active_response' } });
  socket.receive({ type: 'output_audio_buffer.started' });
  socket.receive({ type: 'response.done', response: { id: 'automatic_response', status: 'completed' } });
  socket.receive({ type: 'output_audio_buffer.stopped' });
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 1);
  control.close();
});

test('web questions work before selection and return evidence to the ongoing conversation', async () => {
  const { control, socket, searches, executions, statuses } = await setup();
  calls(socket, 'general_question', [{ call_id: 'general_search', name: 'search_web', arguments: '{"question":"  What changed in the peace talks today?  "}' }]);
  await flush();
  assert.deepEqual(searches, [{ question: 'What changed in the peace talks today?', headlineId: undefined }]);
  assert.deepEqual(executions, []);
  assert.ok(statuses.some(event => event.type === 'research' && event.busy && event.message === 'Searching the web…'));
  const output = socket.sent.find(event => (event.item as { call_id?: string } | undefined)?.call_id === 'general_search');
  assert.deepEqual(JSON.parse((output?.item as { output: string }).output), { kind: 'web_research', findings: ['fixture evidence'] });
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 1);
  assert.equal(socket.sent.some(event => event.type === 'conversation.item.delete'), false);
  completeReply(socket, 'research_answer');
  // A conversational follow-up can complete without being forced through a graph tool.
  completeReply(socket, 'hypothetical_answer');
  assert.equal(searches.length, 1);
  assert.deepEqual(statuses.at(-1), { type: 'research', busy: false, message: '', revision: 0 });
  control.close();
});

test('web research remains available at the saved graph limit and duplicate call IDs execute once', async () => {
  const { control, socket, searches } = await setup({ selectStory: async () => ({ currentNode: { depth: 5 }, limits: { generationCalls: 10 } }) });
  control.selectStory('headline_a');
  await flush();
  completeReply(socket);
  const search = { call_id: 'search_at_limit', name: 'search_web', arguments: '{"question":"What evidence supports a settlement after this outcome?"}' };
  calls(socket, 'research_at_limit', [search]);
  calls(socket, 'duplicate_research', [search]);
  await flush();
  assert.deepEqual(searches, [{ question: 'What evidence supports a settlement after this outcome?', headlineId: 'headline_a' }]);
  assert.equal(socket.sent.filter(event => (event.item as { call_id?: string } | undefined)?.call_id === 'search_at_limit').length, 1);
  control.close();
});

test('failed story selection still allows fresh research bound to that story', async () => {
  const { control, socket, searches, executions } = await setup({ selectStory: async (_id, headline) => {
    if (headline === 'headline_b') throw new Error('fixture verification failed');
    return { headline };
  } });
  control.selectStory('headline_a');
  await flush();
  completeReply(socket, 'a_ready');
  control.selectStory('headline_b');
  await flush();
  completeReply(socket, 'b_failed');
  calls(socket, 'research_b', [{ call_id: 'search_b', name: 'search_web', arguments: '{"question":"Can you verify this report from other sources?"}' }]);
  await flush();
  assert.equal(searches[0]?.headlineId, 'headline_b');
  completeReply(socket, 'b_search_answer');
  calls(socket, 'still_no_graph', [{ call_id: 'get_unverified', name: 'get_exploration', arguments: '{}' }]);
  await flush();
  assert.deepEqual(executions, []);
  control.close();
});

test('invalid search arguments cannot trigger backend research', async () => {
  const { control, socket, searches } = await setup();
  const invalid = ['{}', '{"question":"   "}', '{"question":7}', '{"question":"valid","headlineId":"other_story"}', JSON.stringify({ question: 'x'.repeat(1201) }), '[]', '{broken'];
  calls(socket, 'invalid_searches', invalid.map((args, index) => ({ call_id: `invalid_search_${index}`, name: 'search_web', arguments: args })));
  await flush();
  assert.deepEqual(searches, []);
  control.close();
});

test('switching stories aborts pending web research and discards stale evidence', async () => {
  const pending = deferred<object>();
  let searchSignal: AbortSignal | undefined;
  const { control, socket, selects, statuses } = await setup({ search: async (_id, _question, signal) => { searchSignal = signal; return pending.promise; } });
  control.selectStory('headline_a');
  await flush();
  completeReply(socket);
  calls(socket, 'search_a', [{ call_id: 'obsolete_search', name: 'search_web', arguments: '{"question":"What happened next?"}' }]);
  await flush();
  assert.equal(statuses.at(-1)?.type, 'research');
  control.selectStory('headline_b');
  await flush();
  assert.equal(searchSignal?.aborted, true);
  assert.deepEqual(selects, ['headline_a', 'headline_b']);
  pending.resolve({ findings: ['obsolete web evidence'] });
  await flush();
  assert.equal(JSON.stringify(socket.sent).includes('obsolete web evidence'), false);
  assert.deepEqual(statuses.at(-1), { type: 'research', busy: false, message: '', revision: 2 });
  control.close();
});

test('ending a call cancels web research without speaking a late result', async () => {
  const pending = deferred<object>();
  let searchSignal: AbortSignal | undefined;
  const { control, socket, statuses } = await setup({ search: async (_id, _question, signal) => { searchSignal = signal; return pending.promise; } });
  calls(socket, 'search_before_hangup', [{ call_id: 'search_before_hangup', name: 'search_web', arguments: '{"question":"What is the latest?"}' }]);
  await flush();
  control.close();
  pending.resolve({ findings: ['late web result'] });
  await flush();
  assert.equal(searchSignal?.aborted, true);
  assert.equal(socket.terminated, true);
  assert.equal(statuses.at(-1)?.type, 'ended');
  assert.equal(JSON.stringify(socket.sent).includes('late web result'), false);
});

test('a transport failure allows discussion and an explicit retry without an evidence verdict', async () => {
  let attempts = 0;
  const { control, socket, executions, searches, selects } = await setup({
    getStoryPreview: async () => CATALOG.items[0],
    selectStory: async () => { if (++attempts === 1) throw new Error('Transport interrupted'); return exploration(); },
  });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  completeReply(socket);
  calls(socket, 'read_context', [{ call_id: 'context_without_map', name: 'get_exploration', arguments: '{}' }]);
  await flush();
  assert.equal(toolOutputs(socket, 'context_without_map')[0].researchFailed, true);
  assert.deepEqual(executions, []);
  completeReply(socket);
  calls(socket, 'background', [{ call_id: 'background_search', name: 'search_web', arguments: '{"question":"Why does this proposal matter?"}' }]);
  await flush();
  assert.equal(searches[0]?.headlineId, FIXTURE_HEADLINES[0].id);
  completeReply(socket);
  calls(socket, 'explicit_retry', [{ call_id: 'retry_context', name: 'retry_story', arguments: '{}' }]);
  await flush();
  assert.deepEqual(selects, [FIXTURE_HEADLINES[0].id, FIXTURE_HEADLINES[0].id]);
  completeReply(socket);
  calls(socket, 'get_saved', [{ call_id: 'get_saved', name: 'get_exploration', arguments: '{}' }]);
  await flush();
  assert.equal(executions.length, 1);
  control.close();
});

test('voice briefing tools show curated stories and return usable ordinal-to-ID mappings', async () => {
  let catalogCalls = 0;
  const { control, socket, statuses, selects } = await setup({ listStories: async () => { catalogCalls++; return CATALOG; } });
  calls(socket, 'briefing', [{ call_id: 'list_briefing', name: 'list_stories', arguments: '{}' }]);
  await flush();
  assert.equal(catalogCalls, 1);
  const [output] = toolOutputs(socket, 'list_briefing');
  assert.equal(output.kind, 'story_catalog');
  assert.deepEqual(output.stories.map((item: { number: number; storyId: string }) => ({ number: item.number, storyId: item.storyId })), CATALOG.items.map((item, index) => ({ number: index + 1, storyId: item.id })));
  assert.deepEqual(latestDisplay(statuses)?.stories, CATALOG.items);
  assert.equal(latestDisplay(statuses)?.view, 'stories');
  assert.deepEqual(selects, []);
  completeReply(socket);
  calls(socket, 'return_briefing', [{ call_id: 'show_briefing', name: 'show_stories', arguments: '{}' }]);
  await flush();
  assert.equal(toolOutputs(socket, 'show_briefing').length, 1);
  assert.equal(latestDisplay(statuses)?.view, 'stories');
  control.close();
});

test('voice briefing distinguishes fresh uncurated headlines from an unavailable feed', async () => {
  const catalog = { ...CATALOG, curated: false, warning: 'AI curation is unavailable; RSS headlines are available.' };
  const { control, socket } = await setup({ listStories: async () => catalog });
  calls(socket, 'today', [{ call_id: 'today_headlines', name: 'list_stories', arguments: '{}' }]);
  await flush();
  const [output] = toolOutputs(socket, 'today_headlines');
  assert.equal(output.availability, 'available');
  assert.equal(output.curated, false);
  assert.equal(output.stale, false);
  assert.equal(output.fetchedAt, catalog.fetchedAt);
  assert.ok(Number.isFinite(Date.parse(output.asOf)));
  assert.equal(output.stories[0].publisher, catalog.items[0].publisher);
  assert.equal(output.stories[0].publishedAt, catalog.items[0].publishedAt);
  assert.equal(output.error, undefined);
  control.close();
});

test('voice briefing marks an empty stale fallback unavailable instead of implying live news', async () => {
  const { control, socket } = await setup({ listStories: async () => ({ ...CATALOG, items: [], stale: true, curated: false }) });
  calls(socket, 'empty', [{ call_id: 'empty_headlines', name: 'list_stories', arguments: '{}' }]);
  await flush();
  const [output] = toolOutputs(socket, 'empty_headlines');
  assert.equal(output.availability, 'unavailable');
  assert.equal(output.stale, true);
  assert.deepEqual(output.stories, []);
  control.close();
});

test('choose_story switches without deadlock and completes the retained call exactly once', async () => {
  const { control, socket, selects, statuses, fatal } = await setup({
    listStories: async () => CATALOG,
    selectStory: async (_id, headline) => exploration(FIXTURE_HEADLINES.find(item => item.id === headline)),
  });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  completeReply(socket, 'first_story');
  socket.receive({ type: 'conversation.item.added', item: { id: 'first_story_context' } });
  const choice = { id: 'story_choice_item', call_id: 'choose_second', name: 'choose_story', arguments: JSON.stringify({ storyId: FIXTURE_HEADLINES[1].id }) };
  calls(socket, 'story_choice', [choice, { id: 'obsolete_sibling', call_id: 'obsolete_sibling_call', name: 'show_analysis', arguments: JSON.stringify({ title: 'Obsolete synthesis', summary: 'This belongs to the old story.', points: [], assumptions: [], signals: [] }) }]);
  await flush();
  assert.deepEqual(selects, [FIXTURE_HEADLINES[0].id, FIXTURE_HEADLINES[1].id]);
  assert.equal(toolOutputs(socket, 'choose_second').length, 1);
  assert.equal(toolOutputs(socket, 'choose_second')[0].kind, 'story_preview');
  assert.equal(toolOutputs(socket, 'choose_second')[0].headline.id, FIXTURE_HEADLINES[1].id);
  assert.equal(toolOutputs(socket, 'choose_second')[0].researchPending, true);
  assert.deepEqual(storyContexts(socket).at(-1), exploration(FIXTURE_HEADLINES[1]));
  assert.deepEqual(toolOutputs(socket, 'obsolete_sibling_call'), []);
  assert.equal(socket.sent.some(event => event.type === 'conversation.item.delete' && event.item_id === choice.id), false);
  assert.ok(socket.sent.some(event => event.type === 'conversation.item.delete' && event.item_id === 'first_story_context'));
  assert.ok(socket.sent.some(event => event.type === 'conversation.item.delete' && event.item_id === 'obsolete_sibling'));
  assert.equal(JSON.stringify(socket.sent).includes('"switching":true'), false);
  assert.equal(latestDisplay(statuses)?.headline?.id, FIXTURE_HEADLINES[1].id);
  assert.equal(latestDisplay(statuses)?.revision, 2);
  assert.equal(latestDisplay(statuses)?.insight, null);
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 2);
  assert.equal(fatal(), 0);
  calls(socket, 'duplicated_choice', [choice]);
  await flush();
  assert.equal(toolOutputs(socket, 'choose_second').length, 1);
  assert.equal(selects.length, 2);
  control.close();
});

test('choose_story validates membership and argument shape before selection', async () => {
  const { control, socket, selects } = await setup({ listStories: async () => CATALOG });
  calls(socket, 'invalid_story_choices', [
    { call_id: 'unknown_story', name: 'choose_story', arguments: '{"storyId":"invented-story"}' },
    { call_id: 'extra_story_argument', name: 'choose_story', arguments: JSON.stringify({ storyId: FIXTURE_HEADLINES[0].id, title: 'Invented title' }) },
    { call_id: 'invalid_briefing', name: 'list_stories', arguments: '{"query":"something else"}' },
  ]);
  await flush();
  assert.deepEqual(selects, []);
  assert.match(toolOutputs(socket, 'unknown_story')[0].error, /not in the current briefing/);
  assert.ok(toolOutputs(socket, 'extra_story_argument')[0].error);
  assert.ok(toolOutputs(socket, 'invalid_briefing')[0].error);
  control.close();
});

test('choosing the current story restores the current path and exploration view without new research', async () => {
  let focused = false;
  const { control, socket, selects, statuses, executions } = await setup({
    listStories: async () => CATALOG, selectStory: async () => exploration(),
    execute: async (_id, name) => { if (name === 'choose_path') focused = true; return exploration(FIXTURE_HEADLINES[0], focused); },
  });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  completeReply(socket);
  calls(socket, 'path_choice', [{ call_id: 'path_a', name: 'choose_path', arguments: JSON.stringify({ nodeId: NODE_A }) }]);
  await flush();
  assert.equal(latestDisplay(statuses)?.exploration?.currentNode?.id, NODE_A);
  completeReply(socket);
  control.act!({ type: 'show_stories' }, FIXTURE_HEADLINES[0].id);
  assert.equal(latestDisplay(statuses)?.view, 'stories');
  calls(socket, 'reopen_story', [{ call_id: 'reopen_current', name: 'choose_story', arguments: JSON.stringify({ storyId: FIXTURE_HEADLINES[0].id }) }]);
  await flush();
  assert.deepEqual(selects, [FIXTURE_HEADLINES[0].id]);
  assert.deepEqual(executions.map(item => item.name), ['choose_path', 'get_exploration']);
  assert.equal(toolOutputs(socket, 'reopen_current')[0].currentNode.id, NODE_A);
  assert.equal(latestDisplay(statuses)?.exploration?.currentNode?.id, NODE_A);
  assert.equal(latestDisplay(statuses)?.view, 'exploration');
  assert.equal(latestDisplay(statuses)?.revision, 1);
  control.act!({ type: 'show_stories' });
  assert.equal(control.act!({ type: 'select_story', storyId: FIXTURE_HEADLINES[0].id }), 1);
  assert.equal(latestDisplay(statuses)?.view, 'exploration');
  assert.equal(latestDisplay(statuses)?.exploration?.currentNode?.id, NODE_A);
  control.close();
});

test('choosing the same failed story reports failure rather than an empty switch or automatic retry', async () => {
  const { control, socket, selects } = await setup({ listStories: async () => CATALOG, selectStory: async () => { throw new Error('Simulated failed research'); } });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  completeReply(socket);
  calls(socket, 'choose_failed_again', [{ call_id: 'same_failed', name: 'choose_story', arguments: JSON.stringify({ storyId: FIXTURE_HEADLINES[0].id }) }]);
  await flush();
  assert.deepEqual(selects, [FIXTURE_HEADLINES[0].id]);
  assert.match(toolOutputs(socket, 'same_failed')[0].error, /retry it explicitly/);
  control.close();
});

test('show_analysis validates its bounded schema and cannot mutate the saved graph', async () => {
  const { control, socket, executions, selects, statuses } = await setup();
  const insight = { title: 'If negotiations succeed', summary: 'A negotiated agreement could reduce uncertainty.', points: ['Implementation would matter.'], assumptions: ['The parties reach an agreement.'], signals: ['A public timetable.'] };
  calls(socket, 'show_synthesis', [{ call_id: 'valid_insight', name: 'show_analysis', arguments: JSON.stringify(insight) }]);
  await flush();
  assert.deepEqual(latestDisplay(statuses)?.insight, insight);
  assert.equal(latestDisplay(statuses)?.view, 'exploration');
  assert.deepEqual(toolOutputs(socket, 'valid_insight'), [{ shown: true }]);
  completeReply(socket);
  const invalid = [{ title: 'Missing fields' }, { ...insight, summary: 'x'.repeat(901) }, { ...insight, sourceUrl: 'https://invented.example' }, { ...insight, points: Array(7).fill('Too many points') }];
  calls(socket, 'invalid_synthesis', invalid.map((args, index) => ({ call_id: `bad_insight_${index}`, name: 'show_analysis', arguments: JSON.stringify(args) })));
  await flush();
  assert.deepEqual(latestDisplay(statuses)?.insight, insight);
  assert.deepEqual(executions, []);
  assert.deepEqual(selects, []);
  for (let index = 0; index < invalid.length; index++) assert.ok(toolOutputs(socket, `bad_insight_${index}`)[0].error);
  control.close();
});

test('click actions and spoken actions share focused path, comparisons, and display state', async () => {
  let focused = false;
  const bindings: Array<string | undefined> = [];
  const { control, socket, executions, statuses } = await setup({
    selectStory: async (_id, headline) => exploration(FIXTURE_HEADLINES.find(item => item.id === headline)),
    execute: async (_id, name, _args, _signal, headlineId) => {
      bindings.push(headlineId);
      if (name === 'choose_path') focused = true;
      if (name === 'navigate_path') focused = false;
      const result = exploration(FIXTURE_HEADLINES[0], focused);
      return name === 'compare_paths' ? { ...result, comparison: [{ node: exploration(FIXTURE_HEADLINES[0], true).currentNode!, lineage: [] }] } : result;
    },
  });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  completeReply(socket);
  assert.equal(control.act!({ type: 'choose_path', nodeId: NODE_A }, FIXTURE_HEADLINES[0].id), 1);
  await flush();
  assert.equal(latestDisplay(statuses)?.exploration?.currentNode?.id, NODE_A);
  completeReply(socket);
  calls(socket, 'spoken_current_path', [{ call_id: 'current_after_click', name: 'get_exploration', arguments: '{}' }]);
  await flush();
  assert.equal(toolOutputs(socket, 'current_after_click')[0].currentNode.id, NODE_A);
  completeReply(socket);
  control.act!({ type: 'compare_paths', nodeIds: [NODE_A, NODE_B] }, FIXTURE_HEADLINES[0].id);
  await flush();
  assert.equal(latestDisplay(statuses)?.exploration?.comparison?.length, 1);
  completeReply(socket);
  calls(socket, 'spoken_back', [{ call_id: 'back_to_root', name: 'navigate_path', arguments: '{"target":"root"}' }]);
  await flush();
  assert.equal(latestDisplay(statuses)?.exploration?.currentNode, null);
  assert.deepEqual(executions, [{ name: 'choose_path', args: { nodeId: NODE_A } }, { name: 'get_exploration', args: {} }, { name: 'compare_paths', args: { nodeIds: [NODE_A, NODE_B] } }, { name: 'navigate_path', args: { target: 'root' } }]);
  assert.deepEqual(bindings, Array(4).fill(FIXTURE_HEADLINES[0].id));
  control.selectStory(FIXTURE_HEADLINES[1].id);
  assert.throws(() => control.act!({ type: 'choose_path', nodeId: NODE_A }, FIXTURE_HEADLINES[0].id), /selected story changed/);
  await flush();
  assert.equal(executions.length, 4);
  control.close();
});

test('a late briefing result cannot replace a newly selected story display', async () => {
  const catalog = deferred<StoryCatalogResponse>();
  const { control, socket, statuses, selects } = await setup({ listStories: async () => catalog.promise, selectStory: async () => exploration(FIXTURE_HEADLINES[1]) });
  calls(socket, 'slow_briefing', [{ call_id: 'old_briefing', name: 'list_stories', arguments: '{}' }]);
  await flush();
  control.selectStory(FIXTURE_HEADLINES[1].id);
  await flush();
  assert.deepEqual(selects, [FIXTURE_HEADLINES[1].id]);
  catalog.resolve(CATALOG);
  await flush();
  assert.deepEqual(toolOutputs(socket, 'old_briefing'), []);
  assert.equal(latestDisplay(statuses)?.view, 'exploration');
  assert.equal(latestDisplay(statuses)?.headline?.id, FIXTURE_HEADLINES[1].id);
  assert.equal(latestDisplay(statuses)?.stories, undefined);
  control.close();
});

test('old-story show_analysis output cannot paint or narrate into the newly selected story', async () => {
  const { control, socket, statuses } = await setup({ selectStory: async (_id, headline) => exploration(FIXTURE_HEADLINES.find(item => item.id === headline)) });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  socket.receive({ type: 'response.created', response: { id: 'old_synthesis_response', metadata: { voice_revision: '1' } } });
  control.selectStory(FIXTURE_HEADLINES[1].id);
  socket.receive({ type: 'response.done', response: { id: 'old_synthesis_response', status: 'completed', output: [{ id: 'old_synthesis_item', type: 'function_call', call_id: 'old_synthesis', name: 'show_analysis', arguments: JSON.stringify({ title: 'Obsolete story A', summary: 'Do not display this.', points: [], assumptions: [], signals: [] }) }] } });
  await flush();
  assert.deepEqual(toolOutputs(socket, 'old_synthesis'), []);
  assert.equal(latestDisplay(statuses)?.insight, null);
  assert.equal(latestDisplay(statuses)?.headline?.id, FIXTURE_HEADLINES[1].id);
  assert.equal(JSON.stringify(socket.sent).includes('Obsolete story A'), false);
  assert.ok(socket.sent.some(event => event.type === 'conversation.item.delete' && event.item_id === 'old_synthesis_item'));
  control.close();
});


test('a clicked story supplies its cached card before slow research and can speak immediately', async () => {
  const research = deferred<object>();
  let previews = 0;
  const { control, socket, selects, statuses } = await setup({
    getStoryPreview: async id => { previews++; return CATALOG.items.find(item => item.id === id) ?? null; },
    listStories: async () => { throw new Error('Selecting a card must not refresh or curate the catalog.'); },
    selectStory: async () => research.promise,
  });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  assert.equal(previews, 1);
  assert.deepEqual(selects, [FIXTURE_HEADLINES[0].id]);
  const preview = storyContexts(socket)[0];
  assert.equal(preview.kind, 'story_preview');
  assert.equal(preview.headline.title, CATALOG.items[0].title);
  assert.equal(preview.headline.publisher, CATALOG.items[0].publisher);
  assert.equal(preview.summary, CATALOG.items[0].summary);
  assert.equal(preview.whyItMatters, CATALOG.items[0].whyItMatters);
  assert.equal(preview.researchPending, true);
  assert.match(preview.attribution, /conditionally/);
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 1);
  assert.equal(statuses.at(-1)?.type, 'display');
  assert.equal(latestDisplay(statuses)?.headline?.id, FIXTURE_HEADLINES[0].id);
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  assert.equal(previews, 1);
  assert.equal(selects.length, 1);
  control.close();
  research.resolve(exploration());
});

test('spoken story selection keeps its substantive introduction audio and starts the preview before research finishes', async () => {
  const research = deferred<object>();
  const { control, socket, selects } = await setup({ listStories: async () => CATALOG, selectStory: async () => research.promise });
  socket.receive({ type: 'response.created', response: { id: 'spoken_selection' } });
  socket.receive({ type: 'output_audio_buffer.started', response_id: 'spoken_selection' });
  socket.receive({ type: 'response.done', response: { id: 'spoken_selection', status: 'completed', output: [
    { type: 'message', id: 'selection_ack_audio' },
    { type: 'function_call', id: 'selection_function', call_id: 'spoken_choice', name: 'choose_story', arguments: JSON.stringify({ storyId: FIXTURE_HEADLINES[0].id }) },
  ] } });
  await flush();
  assert.deepEqual(selects, [FIXTURE_HEADLINES[0].id]);
  assert.equal(toolOutputs(socket, 'spoken_choice')[0].kind, 'story_preview');
  assert.equal(socket.sent.some(event => event.type === 'output_audio_buffer.clear' || event.type === 'response.cancel'), false);
  assert.equal(socket.sent.some(event => event.type === 'conversation.item.delete' && event.item_id === 'selection_ack_audio'), false);
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 0);
  socket.receive({ type: 'output_audio_buffer.stopped', response_id: 'spoken_selection' });
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 1);
  socket.receive({ type: 'response.created', response: { id: 'card_intro', metadata: { voice_revision: '1' } } });
  socket.receive({ type: 'output_audio_buffer.started', response_id: 'card_intro' });
  research.resolve(exploration());
  await flush();
  socket.receive({ type: 'response.done', response: { id: 'card_intro', status: 'completed', output: [] } });
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 1);
  assert.equal(socket.sent.some(event => event.type === 'output_audio_buffer.clear'), false);
  socket.receive({ type: 'output_audio_buffer.stopped', response_id: 'card_intro' });
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 2);
  assert.equal(toolOutputs(socket, 'spoken_choice').length, 1);
  control.close();
});

test('a spoken switch preserves the new-story introduction while retiring previous-story context', async () => {
  const { control, socket } = await setup({ listStories: async () => CATALOG });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  completeReply(socket, 'first_story');
  socket.receive({ type: 'conversation.item.added', item: { id: 'previous_story_facts' } });
  socket.receive({ type: 'response.created', response: { id: 'new_story_choice' } });
  socket.receive({ type: 'output_audio_buffer.started', response_id: 'new_story_choice' });
  socket.receive({ type: 'response.done', response: { id: 'new_story_choice', status: 'completed', output: [
    { type: 'message', id: 'new_story_introduction' },
    { type: 'function_call', id: 'new_story_call', call_id: 'choose_new', name: 'choose_story', arguments: JSON.stringify({ storyId: FIXTURE_HEADLINES[1].id }) },
  ] } });
  await flush();
  assert.equal(socket.sent.some(event => event.type === 'output_audio_buffer.clear'), false);
  assert.equal(socket.sent.some(event => event.type === 'conversation.item.delete' && event.item_id === 'new_story_introduction'), false);
  assert.ok(socket.sent.some(event => event.type === 'conversation.item.delete' && event.item_id === 'previous_story_facts'));
  assert.equal(toolOutputs(socket, 'choose_new')[0].headline.id, FIXTURE_HEADLINES[1].id);
  control.close();
});

test('fast context and visual tools remain responsive during initial research', async () => {
  const research = deferred<object>();
  const { control, socket, executions, statuses } = await setup({
    getStoryPreview: async () => CATALOG.items[0], listStories: async () => CATALOG, selectStory: async () => research.promise,
  });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  completeReply(socket, 'opening');
  const insight = { title: 'Why it matters', summary: 'If adopted, this proposal could change transit.', points: [], assumptions: ['The proposal is adopted.'], signals: [] };
  calls(socket, 'context_question', [
    { call_id: 'pending_context', name: 'get_exploration', arguments: '{}' },
    { call_id: 'pending_synthesis', name: 'show_analysis', arguments: JSON.stringify(insight) },
    { call_id: 'pending_briefing', name: 'list_stories', arguments: '{}' },
  ]);
  await flush();
  assert.equal(toolOutputs(socket, 'pending_context')[0].researchPending, true);
  assert.deepEqual(toolOutputs(socket, 'pending_synthesis'), [{ shown: true }]);
  assert.equal(toolOutputs(socket, 'pending_briefing')[0].kind, 'story_catalog');
  assert.deepEqual(latestDisplay(statuses)?.insight, insight);
  assert.deepEqual(executions, []);
  assert.ok(statuses.some(event => event.type === 'research' && event.busy));
  assert.equal(statuses.filter(event => event.type === 'research' && !event.busy).length, 1); // initial subscription only
  control.close();
  research.resolve(exploration());
});

test('a spoken story switch can abort initial research without waiting for it', async () => {
  const old = deferred<object>();
  let oldSignal: AbortSignal | undefined;
  const { control, socket, selects } = await setup({
    listStories: async () => CATALOG,
    selectStory: async (_id, headlineId, signal) => {
      if (headlineId === FIXTURE_HEADLINES[0].id) { oldSignal = signal; return old.promise; }
      return exploration(FIXTURE_HEADLINES[1]);
    },
  });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  calls(socket, 'switch_while_waiting', [{ call_id: 'choose_while_waiting', name: 'choose_story', arguments: JSON.stringify({ storyId: FIXTURE_HEADLINES[1].id }) }]);
  await flush();
  assert.equal(oldSignal?.aborted, true);
  assert.deepEqual(selects, [FIXTURE_HEADLINES[0].id, FIXTURE_HEADLINES[1].id]);
  assert.equal(toolOutputs(socket, 'choose_while_waiting')[0].headline.id, FIXTURE_HEADLINES[1].id);
  old.resolve({ summary: 'Obsolete initial story research.' });
  await flush();
  assert.equal(JSON.stringify(socket.sent).includes('Obsolete initial story research.'), false);
  control.close();
});

test('navigation preserves playing speech and waits before discussing its result', async () => {
  const { control, socket } = await setup({ selectStory: async () => exploration(), execute: async () => exploration(FIXTURE_HEADLINES[0], true) });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  socket.receive({ type: 'response.created', response: { id: 'story_explanation' } });
  socket.receive({ type: 'output_audio_buffer.started', response_id: 'story_explanation' });
  control.act!({ type: 'choose_path', nodeId: NODE_A }, FIXTURE_HEADLINES[0].id);
  await flush();
  assert.equal(socket.sent.some(event => event.type === 'response.cancel' || event.type === 'output_audio_buffer.clear'), false);
  socket.receive({ type: 'response.done', response: { id: 'story_explanation', status: 'completed', output: [] } });
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 1);
  socket.receive({ type: 'output_audio_buffer.stopped', response_id: 'story_explanation' });
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 2);
  control.close();
});

test('a research result arriving before the opening response-created event is not lost', async () => {
  const { control, socket } = await setup({ getStoryPreview: async () => CATALOG.items[0], selectStory: async () => exploration() });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  assert.equal(storyContexts(socket).length, 2);
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 1);
  socket.receive({ type: 'response.created', response: { id: 'opening_after_fast_research' } });
  socket.receive({ type: 'response.done', response: { id: 'opening_after_fast_research', status: 'completed', output: [] } });
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 2);
  control.close();
});

test('a late cached preview is discarded when selection changes', async () => {
  const old = deferred<typeof CATALOG.items[number] | null>();
  const { control, socket, selects, statuses } = await setup({
    getStoryPreview: async headlineId => headlineId === FIXTURE_HEADLINES[0].id ? old.promise : CATALOG.items[1],
  });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  control.selectStory(FIXTURE_HEADLINES[1].id);
  await flush();
  old.resolve(CATALOG.items[0]);
  await flush();
  assert.deepEqual(selects, [FIXTURE_HEADLINES[1].id]);
  assert.equal(latestDisplay(statuses)?.headline?.id, FIXTURE_HEADLINES[1].id);
  assert.equal(storyContexts(socket).some(context => context.headline?.id === FIXTURE_HEADLINES[0].id), false);
  control.close();
});

test('a failed background research result stops marking the preview as pending', async () => {
  const { control, socket } = await setup({ getStoryPreview: async () => CATALOG.items[0], selectStory: async () => { throw new Error('Private provider diagnostics'); } });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  completeReply(socket);
  calls(socket, 'read_failed_preview', [{ call_id: 'failed_preview', name: 'get_exploration', arguments: '{}' }]);
  await flush();
  assert.equal(toolOutputs(socket, 'failed_preview')[0].researchPending, false);
  assert.equal(toolOutputs(socket, 'failed_preview')[0].researchFailed, true);
  assert.equal(JSON.stringify(socket.sent).includes('Private provider diagnostics'), false);
  control.close();
});


test('a failed fast tool cannot mark continuing background research idle', async () => {
  const research = deferred<object>();
  const { control, socket, statuses } = await setup({
    getStoryPreview: async () => CATALOG.items[0], selectStory: async () => research.promise,
    listStories: async () => { throw new Error('Temporary catalog failure'); },
  });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush();
  completeReply(socket);
  calls(socket, 'catalog_while_researching', [{ call_id: 'failed_pending_catalog', name: 'list_stories', arguments: '{}' }]);
  await flush();
  assert.ok(toolOutputs(socket, 'failed_pending_catalog')[0].error);
  const status = statuses.findLast(event => event.type === 'research');
  assert.equal(status?.type === 'research' && status.busy, true);
  research.resolve(exploration());
  await flush();
  const finished = statuses.findLast(event => event.type === 'research');
  assert.equal(finished?.type === 'research' && finished.busy, false);
  control.close();
});


function briefingReply(socket: FakeSocket, id: string, index: number) {
  socket.receive({ type: 'response.created', response: { id, metadata: { voice_revision: '0', voice_briefing: String(index) } } });
}

test('explicit briefing starts once, follows actual playback through the catalog, and never researches a map', async () => {
  let reads = 0;
  const { control, socket, statuses, selects, searches, executions } = await setup({ listStories: async () => { reads++; return CATALOG; } });
  control.act!({ type: 'start_briefing' });
  control.act!({ type: 'start_briefing' });
  await flush();
  assert.equal(reads, 1);
  assert.equal(latestDisplay(statuses)?.spotlightStoryId, null);
  for (let i = 0; i < CATALOG.items.length; i++) {
    const id = `brief-${i}`;
    assert.equal(socket.sent.filter(e => e.type === 'response.create').length, i + 1);
    briefingReply(socket, id, i);
    socket.receive({ type: 'output_audio_buffer.started', response_id: id });
    assert.equal(latestDisplay(statuses)?.spotlightStoryId, CATALOG.items[i].id);
    socket.receive({ type: 'response.done', response: { id, status: 'completed', output: [] } });
    // The text may be generated, but this card remains until its audio finishes.
    assert.equal(socket.sent.filter(e => e.type === 'response.create').length, i + 1);
    socket.receive({ type: 'output_audio_buffer.stopped', response_id: id });
    socket.receive({ type: 'output_audio_buffer.stopped', response_id: id });
  }
  assert.equal(socket.sent.filter(e => e.type === 'response.create').length, CATALOG.items.length);
  assert.deepEqual(selects, []);
  assert.deepEqual(searches, []);
  assert.deepEqual(executions, []);
  control.close();
});

test('speaking during a briefing stops automatic progression while leaving conversational tools available', async () => {
  const { control, socket, statuses } = await setup({ listStories: async () => CATALOG });
  control.act!({ type: 'start_briefing' });
  await flush();
  briefingReply(socket, 'opening-brief', 0);
  socket.receive({ type: 'output_audio_buffer.started', response_id: 'opening-brief' });
  socket.receive({ type: 'input_audio_buffer.speech_started' });
  socket.receive({ type: 'response.done', response: { id: 'opening-brief', status: 'cancelled', output: [] } });
  socket.receive({ type: 'output_audio_buffer.cleared', response_id: 'opening-brief' });
  socket.receive({ type: 'input_audio_buffer.speech_stopped' });
  assert.equal(socket.sent.filter(e => e.type === 'response.create').length, 1);
  assert.equal(latestDisplay(statuses)?.spotlightStoryId, CATALOG.items[0].id);
  calls(socket, 'question', [{ call_id: 'focus-next', name: 'spotlight_story', arguments: JSON.stringify({ storyId: CATALOG.items[1].id }) }]);
  await flush();
  assert.equal(latestDisplay(statuses)?.spotlightStoryId, CATALOG.items[1].id);
  assert.equal(toolOutputs(socket, 'focus-next')[0].storyId, CATALOG.items[1].id);
  control.close();
});

test('speech before or during catalog loading prevents a late automatic briefing', async () => {
  for (const before of [true, false]) {
    const catalog = deferred<StoryCatalogResponse>();
    let reads = 0;
    const { control, socket, statuses } = await setup({ listStories: async () => { reads++; return catalog.promise; } });
    if (before) socket.receive({ type: 'input_audio_buffer.speech_started' });
    control.act!({ type: 'start_briefing' });
    if (!before) socket.receive({ type: 'input_audio_buffer.speech_started' });
    socket.receive({ type: 'input_audio_buffer.speech_stopped' });
    catalog.resolve(CATALOG);
    await flush();
    assert.equal(reads, before ? 0 : 1);
    assert.equal(socket.sent.some(e => e.type === 'response.create'), false);
    assert.equal(statuses.filter(e => e.type === 'research').at(-1)?.busy, false);
    control.close();
  }
});

test('selecting a story or closing the call discards a pending automatic catalog', async () => {
  for (const action of ['select', 'close'] as const) {
    const catalog = deferred<StoryCatalogResponse>();
    const { control, socket, statuses } = await setup({ listStories: () => catalog.promise });
    control.act!({ type: 'start_briefing' });
    if (action === 'select') control.selectStory(CATALOG.items[1].id);
    else control.close();
    await flush();
    const count = socket.sent.length;
    catalog.resolve(CATALOG);
    await flush();
    assert.equal(socket.sent.length, count);
    assert.equal(latestDisplay(statuses)?.stories, undefined);
    control.close();
  }
});

test('briefing retrieval failure speaks once without retries, and unknown spotlight identifiers are rejected', async () => {
  let reads = 0;
  const { control, socket, statuses } = await setup({ listStories: async () => { reads++; throw new Error('fixture failure'); } });
  control.act!({ type: 'start_briefing' });
  await flush();
  completeReply(socket);
  control.act!({ type: 'start_briefing' });
  await flush();
  assert.equal(reads, 1);
  assert.equal(socket.sent.filter(e => e.type === 'response.create').length, 1);
  calls(socket, 'invalid-focus', [{ call_id: 'bad-focus', name: 'spotlight_story', arguments: '{"storyId":"invented-story"}' }]);
  await flush();
  assert.match(toolOutputs(socket, 'bad-focus')[0].error, /current briefing/);
  assert.equal(latestDisplay(statuses)?.spotlightStoryId, undefined);
  control.close();
});


test('this one refers to the audible card when the next introduction is queued but has not played', async () => {
  const { control, socket, statuses } = await setup({ listStories: async () => CATALOG });
  control.act!({ type: 'start_briefing' });
  await flush();
  briefingReply(socket, 'heard-first', 0);
  socket.receive({ type: 'output_audio_buffer.started', response_id: 'heard-first' });
  socket.receive({ type: 'response.done', response: { id: 'heard-first', status: 'completed', output: [] } });
  socket.receive({ type: 'output_audio_buffer.stopped', response_id: 'heard-first' });
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 2);
  socket.receive({ type: 'input_audio_buffer.speech_started' });
  const contexts = socket.sent.flatMap(event => {
    const item = event.item as { content?: Array<{ text: string }> } | undefined;
    return item?.content?.map(part => JSON.parse(part.text)) ?? [];
  });
  assert.equal(contexts.at(-1)?.briefing_focus.storyId, CATALOG.items[0].id);
  assert.equal(contexts.at(-1)?.briefing_focus.number, 1);
  assert.equal(latestDisplay(statuses)?.spotlightStoryId, CATALOG.items[0].id);
  control.close();
});

function screenResult(command: ScreenRequest, storyIds: string[] = []): ScreenReport {
  return { requestId: command.requestId, outcome: 'ok', screen: {
    contextKey: command.contextKey, view: 'stories', width: 390, height: 844, scrollY: 300,
    atTop: false, atBottom: false, hidden: false, visibleStoryIds: storyIds,
    fullyVisibleStoryIds: storyIds, visibleSections: ['stories'], availableSections: ['stories'],
  } };
}

test('voice scroll waits for the browser, deduplicates calls and returns only catalog story identities', async () => {
  const { control, socket, statuses, searches, executions, selects } = await setup({ listStories: async () => CATALOG });
  calls(socket, 'list', [{ call_id: 'list', name: 'list_stories', arguments: '{}' }]);
  await flush(); completeReply(socket);
  const item = { call_id: 'scroll', name: 'scroll_page', arguments: '{"direction":"down"}' };
  calls(socket, 'scroll', [item]); await flush();
  const requests = statuses.filter((event): event is ScreenRequest => event.type === 'screen_request');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].contextKey, screenContextKey(latestDisplay(statuses)!));
  assert.deepEqual(toolOutputs(socket, 'scroll'), []);
  calls(socket, 'duplicate', [item]); await flush();
  assert.equal(statuses.filter(event => event.type === 'screen_request').length, 1);
  assert.equal(control.reportScreen!(screenResult(requests[0], [CATALOG.items[1].id, 'invented-story'])), true);
  await flush();
  const result = toolOutputs(socket, 'scroll')[0];
  assert.equal(result.outcome, 'ok');
  assert.deepEqual(result.visibleStories, [{ storyId: CATALOG.items[1].id, number: 2, title: CATALOG.items[1].title }]);
  assert.deepEqual(result.screen.fullyVisibleStoryIds, [CATALOG.items[1].id]);
  assert.equal(control.reportScreen!(screenResult(requests[0])), false);
  assert.deepEqual([searches, executions, selects], [[], [], []]);
  control.close();
});

test('screen tools reject arbitrary commands and finish pending work on disconnect', async () => {
  const { control, socket, statuses } = await setup();
  calls(socket, 'invalid', [
    { call_id: 'bad', name: 'scroll_page', arguments: '{"direction":"down","selector":"body"}' },
    { call_id: 'bad_section', name: 'scroll_page', arguments: '{"direction":"section"}' },
    { call_id: 'bad_read', name: 'get_screen', arguments: '{"url":"https://other.example"}' },
  ]);
  await flush();
  assert.equal(statuses.some(event => event.type === 'screen_request'), false);
  for (const id of ['bad', 'bad_section', 'bad_read']) assert.ok(toolOutputs(socket, id)[0].error);
  completeReply(socket);
  calls(socket, 'read', [{ call_id: 'read', name: 'get_screen', arguments: '{}' }]); await flush();
  const command = statuses.findLast((event): event is ScreenRequest => event.type === 'screen_request')!;
  control.close(); await flush();
  assert.equal(control.reportScreen!(screenResult(command)), false);
  assert.equal(toolOutputs(socket, 'read').length, 0);
});

test('changing stories invalidates a pending scroll result and cannot scroll the new story', async () => {
  const { control, socket, statuses } = await setup();
  calls(socket, 'scroll', [{ call_id: 'old', name: 'scroll_page', arguments: '{"direction":"bottom"}' }]); await flush();
  const command = statuses.findLast((event): event is ScreenRequest => event.type === 'screen_request')!;
  control.selectStory('headline_new'); await flush();
  assert.equal(control.reportScreen!(screenResult(command)), false);
  assert.equal(toolOutputs(socket, 'old').length, 0);
  control.close();
});


test('focusing a possibility expands its visual context without choosing or generating a branch', async () => {
  const t = await setup({ selectStory: async () => exploration() });
  t.control.selectStory(FIXTURE_HEADLINES[0].id); await flush(); completeReply(t.socket);
  const before = latestDisplay(t.statuses)!.exploration;
  calls(t.socket, 'focus', [{ call_id: 'focus', name: 'spotlight_path', arguments: JSON.stringify({ nodeId: NODE_A }) }]);
  await flush();
  assert.equal(latestDisplay(t.statuses)!.spotlightPathId, NODE_A);
  assert.equal(latestDisplay(t.statuses)!.exploration, before);
  assert.equal(toolOutputs(t.socket, 'focus')[0].node.keyAssumption, 'Support can be secured.');
  assert.deepEqual(t.executions, []);
  completeReply(t.socket);
  calls(t.socket, 'invalid', [{ call_id: 'unknown', name: 'spotlight_path', arguments: JSON.stringify({ nodeId: NODE_B }) }]);
  await flush();
  assert.ok(toolOutputs(t.socket, 'unknown')[0].error);
  assert.equal(latestDisplay(t.statuses)!.spotlightPathId, NODE_A);
  t.control.close();
});

test('scrolling to more stories briefs only the visible set with global story numbers and playback focus', async () => {
  const t = await setup({ listStories: async () => CATALOG });
  calls(t.socket, 'list', [{ call_id: 'list', name: 'list_stories', arguments: '{}' }]); await flush(); completeReply(t.socket);
  calls(t.socket, 'more', [{ call_id: 'more', name: 'scroll_page', arguments: '{"direction":"down"}' }]); await flush();
  const request = t.statuses.findLast((event): event is ScreenRequest => event.type === 'screen_request')!;
  t.control.reportScreen!(screenResult(request, [CATALOG.items[1].id, CATALOG.items[2].id])); await flush();
  assert.equal(toolOutputs(t.socket, 'more')[0].automaticBriefing, true);
  const context = t.socket.sent.filter(event => event.type === 'conversation.item.create').map(event => event.item as { content?: Array<{ text: string }> }).filter(item => item.content).map(item => JSON.parse(item.content![0].text)).at(-1);
  assert.equal(context.briefing_story.number, 2);
  const response = t.socket.sent.findLast(event => event.type === 'response.create')!.response as { instructions: string };
  assert.match(response.instructions, /exactly one short sentence/);
  assert.doesNotMatch(response.instructions, /First briefly say/);
  briefingReply(t.socket, 'second-story', 0);
  t.socket.receive({ type: 'output_audio_buffer.started', response_id: 'second-story' });
  assert.equal(latestDisplay(t.statuses)!.spotlightStoryId, CATALOG.items[1].id);
  t.socket.receive({ type: 'response.done', response: { id: 'second-story', status: 'completed', output: [] } });
  assert.equal(latestDisplay(t.statuses)!.spotlightStoryId, CATALOG.items[1].id);
  t.socket.receive({ type: 'output_audio_buffer.stopped', response_id: 'second-story' });
  briefingReply(t.socket, 'third-story', 1);
  t.socket.receive({ type: 'output_audio_buffer.started', response_id: 'third-story' });
  assert.equal(latestDisplay(t.statuses)!.spotlightStoryId, CATALOG.items[2].id);
  assert.deepEqual([t.selects, t.searches, t.executions], [[], [], []]);
  t.control.close();
});

test('a new user question during scrolling prevents an obsolete automatic briefing', async () => {
  const t = await setup({ listStories: async () => CATALOG });
  calls(t.socket, 'list', [{ call_id: 'list', name: 'list_stories', arguments: '{}' }]); await flush(); completeReply(t.socket);
  calls(t.socket, 'scroll', [{ call_id: 'scroll', name: 'scroll_page', arguments: '{"direction":"down"}' }]); await flush();
  const request = t.statuses.findLast((event): event is ScreenRequest => event.type === 'screen_request')!;
  t.socket.receive({ type: 'input_audio_buffer.speech_started' });
  t.socket.receive({ type: 'input_audio_buffer.speech_stopped' });
  t.control.reportScreen!(screenResult(request, [CATALOG.items[1].id])); await flush();
  assert.equal(toolOutputs(t.socket, 'scroll')[0].automaticBriefing, false);
  t.control.close();
});

test('local screen observations are silent, ordered, scoped to the current view and refreshed on speech', async () => {
  const t = await setup({ listStories: async () => CATALOG });
  calls(t.socket, 'list', [{ call_id: 'list', name: 'list_stories', arguments: '{}' }]); await flush(); completeReply(t.socket);
  const screen = screenResult({ type: 'screen_request', requestId: NODE_A, contextKey: screenContextKey(latestDisplay(t.statuses)!), revision: 0 }, [CATALOG.items[1].id]).screen;
  const sent = t.socket.sent.length;
  assert.equal(t.control.observeScreen!(screen, 1), true);
  assert.equal(t.control.observeScreen!({ ...screen, contextKey: 'different-story' }, 2), false);
  assert.equal(t.control.observeScreen!(screen, 1), false);
  assert.equal(t.socket.sent.length, sent);
  t.socket.receive({ type: 'input_audio_buffer.speech_started' });
  const contextItem = t.socket.sent.findLast(event => event.type === 'conversation.item.create')!.item as { id: string; content: Array<{ text: string }> };
  assert.equal(JSON.parse(contextItem.content[0].text).current_screen.visibleStories[0].storyId, CATALOG.items[1].id);
  assert.equal(t.control.observeScreen!({ ...screen, visibleStoryIds: [CATALOG.items[2].id] }, 3), true);
  t.socket.receive({ type: 'input_audio_buffer.speech_stopped' });
  t.socket.receive({ type: 'input_audio_buffer.speech_started' });
  assert.ok(t.socket.sent.some(event => event.type === 'conversation.item.delete' && event.item_id === contextItem.id));
  t.control.close();
  assert.equal(t.control.observeScreen!(screen, 4), false);
});

test('returning to headlines is silent, reuses the catalog, and can continue an explicitly requested discussion', async () => {
  let reads = 0;
  const { control, socket, statuses } = await setup({ listStories: async () => { reads++; return { ...CATALOG, curated: false }; } });
  calls(socket, 'list', [{ call_id: 'list', name: 'list_stories', arguments: '{}' }]);
  await flush(); completeReply(socket);
  const before = socket.sent.filter(event => event.type === 'response.create').length;
  calls(socket, 'back', [{ call_id: 'back', name: 'show_stories', arguments: '{}' }]);
  await flush();
  assert.equal(latestDisplay(statuses)?.view, 'stories');
  assert.equal(reads, 1);
  assert.equal(toolOutputs(socket, 'back')[0].curated, false);
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, before);
  calls(socket, 'back_and_brief', [{ call_id: 'back_and_brief', name: 'show_stories', arguments: '{"continueDiscussion":true}' }]);
  await flush();
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, before + 1);
  assert.equal(reads, 1);
  control.close();
});

test('path backtracking is silent unless substantive discussion is requested; speech metadata stays out of graph arguments', async () => {
  const { control, socket, executions } = await setup({ selectStory: async () => exploration(), execute: async () => exploration() });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush(); completeReply(socket);
  const before = socket.sent.filter(event => event.type === 'response.create').length;
  calls(socket, 'back', [{ call_id: 'back', name: 'navigate_path', arguments: '{"target":"root"}' }]);
  await flush();
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, before);
  calls(socket, 'back_explain', [{ call_id: 'back_explain', name: 'navigate_path', arguments: '{"target":"root","continueDiscussion":true}' }]);
  await flush();
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, before + 1);
  assert.deepEqual(executions.map(item => item.args), [{ target: 'root' }, { target: 'root' }]);
  control.close();
});

test('scroll to top produces no completion speech; actual navigation errors still get a response', async () => {
  const { control, socket, statuses } = await setup();
  calls(socket, 'top', [{ call_id: 'top', name: 'scroll_page', arguments: '{"direction":"top"}' }]);
  await flush();
  const request = statuses.findLast((event): event is ScreenRequest => event.type === 'screen_request')!;
  control.reportScreen!(screenResult(request));
  await flush();
  assert.equal(toolOutputs(socket, 'top')[0].outcome, 'ok');
  assert.equal(socket.sent.some(event => event.type === 'response.create'), false);
  calls(socket, 'invalid', [{ call_id: 'invalid', name: 'scroll_page', arguments: '{"direction":"diagonal"}' }]);
  await flush();
  assert.ok(toolOutputs(socket, 'invalid')[0].error);
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, 1);
  control.close();
});

test('returning to headlines while research finishes does not trigger a late story speech', async () => {
  const research = deferred<object>();
  const { control, socket, statuses } = await setup({ getStoryPreview: async () => CATALOG.items[0], selectStory: async () => research.promise, listStories: async () => CATALOG });
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush(); completeReply(socket);
  const before = socket.sent.filter(event => event.type === 'response.create').length;
  calls(socket, 'back', [{ call_id: 'back', name: 'show_stories', arguments: '{}' }]);
  await flush();
  research.resolve(exploration());
  await flush();
  assert.equal(latestDisplay(statuses)?.view, 'stories');
  assert.equal(latestDisplay(statuses)?.exploration?.kind, 'exploration');
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, before);
  control.close();
});

test('story and path focus still request substantive speech after the visual action', async () => {
  const { control, socket } = await setup({ listStories: async () => CATALOG, selectStory: async () => exploration() });
  calls(socket, 'list', [{ call_id: 'list', name: 'list_stories', arguments: '{}' }]);
  await flush(); completeReply(socket);
  const before = socket.sent.filter(event => event.type === 'response.create').length;
  calls(socket, 'focus', [{ call_id: 'focus', name: 'spotlight_story', arguments: JSON.stringify({ storyId: CATALOG.items[0].id }) }]);
  await flush();
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, before + 1);
  completeReply(socket);
  control.selectStory(FIXTURE_HEADLINES[0].id);
  await flush(); completeReply(socket);
  const after = socket.sent.filter(event => event.type === 'response.create').length;
  calls(socket, 'path', [{ call_id: 'path', name: 'spotlight_path', arguments: JSON.stringify({ nodeId: NODE_A }) }]);
  await flush();
  assert.equal(socket.sent.filter(event => event.type === 'response.create').length, after + 1);
  control.close();
});

test('scrolling with an explicit follow-up question continues that question instead of starting a walkthrough', async () => {
  const { control, socket, statuses } = await setup({ listStories: async () => CATALOG });
  calls(socket, 'list', [{ call_id: 'list', name: 'list_stories', arguments: '{}' }]);
  await flush(); completeReply(socket);
  const before = socket.sent.filter(event => event.type === 'response.create').length;
  calls(socket, 'scroll_question', [{ call_id: 'scroll_question', name: 'scroll_page', arguments: '{"direction":"down","continueDiscussion":true}' }]);
  await flush();
  const request = statuses.findLast((event): event is ScreenRequest => event.type === 'screen_request')!;
  control.reportScreen!(screenResult(request, [CATALOG.items[1].id]));
  await flush();
  assert.equal(toolOutputs(socket, 'scroll_question')[0].automaticBriefing, false);
  const replies = socket.sent.filter(event => event.type === 'response.create');
  assert.equal(replies.length, before + 1);
  assert.equal((replies.at(-1)?.response as { metadata: { voice_briefing?: string } }).metadata.voice_briefing, undefined);
  control.close();
});

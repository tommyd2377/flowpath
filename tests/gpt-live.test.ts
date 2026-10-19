import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createLiveRuntime, type LiveSocket } from '../lib/gpt-live/runtime';
import { runLiveBackend } from '../lib/gpt-live/backend';
import { liveSessionConfig, liveSessionUrl, liveText } from '../lib/gpt-live/protocol';
import { createAudioActivity, createStartupAudioGuard } from '../lib/gpt-live/browser';
import { createLiveIdleTimer, liveIdleMessage } from '../lib/gpt-live/idle';

class Socket extends EventEmitter {
  readyState = 0; sent: Record<string, unknown>[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.terminate(); }
  terminate() { this.readyState = 3; this.emit('close'); }
  open() { this.readyState = 1; this.emit('open'); }
  frame(value: object) { this.emit('message', Buffer.from(JSON.stringify(value))); }
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function harness(delegate: Parameters<typeof createLiveRuntime>[0]['delegate'], onTaskError?: (message: string) => void) {
  const socket = new Socket(), failures: string[] = [];
  const live = createLiveRuntime({ sessionId: 'live_test', apiKey: 'synthetic', delegate, closeTimeoutMs: 10,
    onFatal: message => failures.push(message), onTaskError, socketFactory: (url) => { assert.equal(url, 'wss://api.openai.com/v1/live/sessions/live_test/attach'); return socket as unknown as LiveSocket; } });
  socket.open(); live.start();
  return { live, socket, failures };
}
function transcript(socket: Socket, delta: string, start_ms = 0) { socket.frame({ type: 'session.input_transcript.delta', delta, start_ms, end_ms: start_ms + 100 }); }
function delegate(socket: Socket, id = 'item_task') { socket.frame({ type: 'session.delegation.created', offset_ms: 500, delegation: { id, target: 'client', type: 'delegation' } }); }

test('Live configuration uses one voice model and client delegation without Realtime fields', () => {
  const config = liveSessionConfig([{ role: 'assistant', text: 'Earlier context' }]);
  assert.equal(config.model, 'gpt-live-1'); assert.equal(config.store, false); assert.deepEqual(config.delegation, { type: 'client' });
  assert.equal(config.input[0].content[0].type, 'output_text');
  assert.equal('turn_detection' in config, false); assert.equal('tools' in config, false);
  assert.throws(() => liveSessionUrl('../escape', 'hangup'));
  assert.equal(Buffer.byteLength(liveText('你好'.repeat(1000))), 480);
});

test('fragments are preserved and only delegation executes work; duplicate IDs execute once', async () => {
  const jobs: unknown[] = [];
  const h = harness(async context => { jobs.push(context); return { text: 'Verified answer.' }; });
  transcript(h.socket, 'What is'); transcript(h.socket, ' this?', 100);
  await flush(); assert.equal(jobs.length, 0);
  delegate(h.socket); delegate(h.socket); await flush();
  assert.equal(jobs.length, 1);
  assert.equal((jobs[0] as { transcripts: { delta: string }[] }).transcripts.map(x => x.delta).join(''), 'What is this?');
  assert.ok(h.socket.sent.some(x => x.type === 'session.commentary.append' && x.delegation_id === 'item_task'));
  assert.ok(!h.socket.sent.some(x => ['response.create', 'session.start', 'session.update'].includes(String(x.type))));
  await h.live.close();
});

test('delegated failures expose a bounded reason to the visitor and the UI', async () => {
  const messages: string[] = [];
  const h = harness(async () => { throw new Error('The conversation backend did not finish.'); }, message => messages.push(message));
  transcript(h.socket, 'Find images.'); delegate(h.socket); await flush();
  assert.deepEqual(messages, ['The conversation backend did not return a complete answer.']);
  assert.ok(h.socket.sent.some(x => String(x.content).includes('did not return a complete answer')));
  assert.ok(!h.socket.sent.some(x => String(x.content).includes('I could not complete that request')));
  await h.live.close();
});

test('manual changes abort backend work and suppress results even when a provider ignores cancellation', async () => {
  let complete!: (value: { text: string }) => void; let signal!: AbortSignal;
  const h = harness(async (_context, current) => { signal = current; return new Promise(resolve => { complete = resolve; }); });
  transcript(h.socket, 'Show the old page.'); delegate(h.socket); await flush();
  h.live.interrupt(); assert.equal(signal.aborted, true);
  complete({ text: 'STALE' }); await flush();
  assert.ok(!h.socket.sent.some(x => String(x.content).includes('STALE')));
  await h.live.close();
});

test('backchannels and overlapping transcripts do not cancel backend work', async () => {
  let complete!: (value: { text: string }) => void; let signal!: AbortSignal;
  const h = harness(async (_context, current) => { signal = current; return new Promise(resolve => { complete = resolve; }); });
  transcript(h.socket, 'Find it'); delegate(h.socket); await flush();
  transcript(h.socket, ' mm-hmm', 700); assert.equal(signal.aborted, false);
  complete({ text: 'Found it' }); await flush(); await h.live.close();
});

test('a newer delegation invalidates a pending answer, including late backend results', async () => {
  let complete!: (value: { text: string }) => void;
  let calls = 0;
  const h = harness(async () => ++calls === 1 ? new Promise(resolve => { complete = resolve; }) : { text: 'New answer' });
  transcript(h.socket, 'Old'); delegate(h.socket); await flush();
  transcript(h.socket, 'Actually new', 600); delegate(h.socket, 'item_new'); await flush(); complete({ text: 'Old answer' }); await flush();
  assert.ok(!h.socket.sent.some(x => x.content === 'Old answer')); assert.ok(h.socket.sent.some(x => x.content === 'New answer'));
  await h.live.close();
});

test('duration updates are cumulative and finalization requires session.closed', async () => {
  const h = harness(async () => ({ text: '' }));
  h.socket.frame({ type: 'session.usage.updated', usage: { seconds: 12 } });
  h.socket.frame({ type: 'session.usage.updated', usage: { seconds: 20 } });
  assert.equal(h.live.usage.seconds, 20);
  const ending = h.live.close(); assert.equal(h.socket.readyState, 1);
  h.socket.frame({ type: 'session.closed', usage: { seconds: 21 }, reason: 'close_requested' });
  assert.deepEqual(await ending, { seconds: 21, finalized: true, reason: 'close_requested' });
  assert.equal(h.socket.readyState, 3);
  const lost = harness(async () => ({ text: '' }));
  assert.equal((await lost.live.close()).finalized, false);
});

test('backend executes one validated tool then a tool-free bounded continuation without retries', async () => {
  const requests: Record<string, unknown>[] = [], executed: string[] = [];
  const result = await runLiveBackend({ apiKey: 'synthetic', instructions: 'Use only validated facts.', context: { question: 'Show it' }, signal: new AbortController().signal,
    tools: [{ type: 'function', name: 'show', description: 'Show a valid view.', parameters: { type: 'object' } }], maxToolRounds: 1,
    execute: async name => { executed.push(name); return { data: { status: 'applied' } }; },
    fetch: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ status: 'completed', output: requests.length === 1
      ? [{ type: 'function_call', name: 'show', call_id: 'call_show', arguments: '{}' }]
      : [{ type: 'message', content: [{ type: 'output_text', text: 'Confirmed.' }] }] }); },
  });
  assert.deepEqual(executed, ['show']); assert.equal(result.text, 'Confirmed.');
  for (const request of requests) {
    assert.equal(request.model, 'gpt-6-luna');
    assert.equal(request.service_tier, 'priority');
    assert.deepEqual(request.reasoning, { effort: 'low' });
  }
  assert.deepEqual(requests[0].include, ['reasoning.encrypted_content']);
  assert.deepEqual(requests[1].tools, []); assert.equal(requests[1].max_output_tokens, 500);
  let attempts = 0;
  await assert.rejects(runLiveBackend({ apiKey: 'synthetic', instructions: '', context: {}, signal: new AbortController().signal, tools: [], execute: async () => ({ data: {} }), fetch: async () => { attempts++; return new Response(null, { status: 429 }); } }), /busy/);
  assert.equal(attempts, 1);
});

test('tool failures can return deterministic spoken text without a continuation', async () => {
  let requests = 0;
  const result = await runLiveBackend({ apiKey: 'synthetic', instructions: '', context: {}, signal: new AbortController().signal,
    tools: [{ type: 'function', name: 'search', description: '', parameters: {} }], maxToolRounds: 1,
    execute: async () => ({ data: { status: 'unavailable' }, directText: 'Image search returned no displayable results.' }),
    fetch: async () => { requests++; return Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'search', call_id: 'call_search', arguments: '{}' }] }); },
  });
  assert.equal(result.text, 'Image search returned no displayable results.'); assert.equal(requests, 1);
});

test('unsupported or multiple backend tools never execute', async () => {
  for (const output of [[{ type: 'function_call', name: 'unknown', call_id: 'a', arguments: '{}' }], [1, 2].map(i => ({ type: 'function_call', name: 'show', call_id: String(i), arguments: '{}' }))]) {
    let executions = 0;
    await assert.rejects(runLiveBackend({ apiKey: 'synthetic', instructions: '', context: {}, signal: new AbortController().signal,
      tools: [{ type: 'function', name: 'show', description: '', parameters: {} }], execute: async () => { executions++; return { data: {} }; }, fetch: async () => Response.json({ status: 'completed', output }) }));
    assert.equal(executions, 0);
  }
});

test('audio activity uses media levels, with separate input and output states', () => {
  const states: unknown[] = []; const sample = createAudioActivity(state => states.push(state));
  sample(0, 0.1, 0); sample(0.1, 0.1, 100); sample(0, 0, 1500);
  assert.deepEqual(states, [{ inputActive: false, outputActive: true }, { inputActive: true, outputActive: true }, { inputActive: false, outputActive: false }]);
});

test('idle timer waits through audio and backend work, then closes once', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let ended = 0;
  const idle = createLiveIdleTimer({ timeoutMs: 1000, onIdle: () => { ended++; } });
  idle.start(); t.mock.timers.tick(999); assert.equal(ended, 0);
  idle.observeAudio({ inputActive: true, outputActive: false }); t.mock.timers.tick(2000); assert.equal(ended, 0);
  idle.observeAudio({ inputActive: false, outputActive: false }); idle.observeBusy(true); t.mock.timers.tick(2000); assert.equal(ended, 0);
  idle.observeBusy(false); t.mock.timers.tick(999); assert.equal(ended, 0); t.mock.timers.tick(1); assert.equal(ended, 1);
  assert.equal(liveIdleMessage(60_000), 'Voice ended after 1 minute of inactivity. Tap the wave to continue.');
  t.mock.timers.tick(2000); assert.equal(ended, 1);
});

test('startup protection preserves capture and ends two seconds after actual playback', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clone = { enabled: true, stop() {} }, source = { enabled: true, clone: () => clone };
  const guard = createStartupAudioGuard({ stream: { getAudioTracks: () => [source as unknown as MediaStreamTrack] }, enabled: true });
  guard.start(); assert.equal(source.enabled, true); assert.equal(clone.enabled, false);
  t.mock.timers.tick(3000); guard.playbackStarted(); t.mock.timers.tick(1500); guard.playbackStarted(); t.mock.timers.tick(500);
  assert.equal(clone.enabled, true); guard.setInputEnabled(false); assert.equal(clone.enabled, false); guard.dispose();
});

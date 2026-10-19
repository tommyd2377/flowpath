import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPossibilityWalkthrough, walkthroughScript, type WalkthroughState } from '../lib/possibility-walkthrough';
import { createFixtureStartResponse } from '../lib/atlas/server/fixtures';
import { FIXTURE_HEADLINES } from '../lib/story-contracts';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function setup(focus?: (id: string, signal: AbortSignal) => Promise<boolean>) {
  const result = createFixtureStartResponse({ graphId: randomUUID(), installationId: randomUUID(), headline: FIXTURE_HEADLINES[0] });
  assert.equal(result.kind, 'atlas');
  if (result.kind !== 'atlas') throw new Error('Expected map.');
  const choices = [...result.nodes, ...result.nodes.slice(0, 2).map((node, i) => ({ ...node, id: randomUUID(), title: `Alternative consequence ${i + 4}` }))];
  let key = 'map-one', busy = false;
  const scripts: string[] = [], focused: string[] = [], states: Array<WalkthroughState | undefined> = [];
  const guide = createPossibilityWalkthrough({ snapshot: () => ({ key, choices }), busy: () => busy,
    focus: (id, signal) => { focused.push(id); return focus?.(id, signal) ?? Promise.resolve(true); },
    speak: script => scripts.push(script), publish: state => states.push(state) });
  return { guide, choices, scripts, focused, states, navigate: () => { key = 'map-two'; }, busy: (value: boolean) => { busy = value; } };
}

test('walks all five saved possibilities in order only after their spoken ending and quiet playback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = setup(); t.after(() => h.guide.stop());
  assert.equal(h.guide.start(), true); await flush();
  for (let i = 0; i < h.choices.length; i++) {
    assert.equal(h.scripts.length, i + 1);
    assert.equal(h.focused[i], h.choices[i].id);
    h.guide.observeAudio({ inputActive: false, outputActive: true });
    h.guide.observeAudio({ inputActive: false, outputActive: false });
    t.mock.timers.tick(1_000); await flush();
    assert.equal(h.scripts.length, i + 1, 'a pause by itself cannot advance');
    const script = walkthroughScript(h.choices[i], i);
    const split = Math.floor(script.length / 2);
    h.guide.observeTranscript({ role: 'assistant', delta: script.slice(0, split), start_ms: i * 1000, end_ms: i * 1000 + 100 });
    t.mock.timers.tick(500); await flush();
    assert.equal(h.scripts.length, i + 1, 'a partial explanation cannot advance');
    h.guide.observeTranscript({ role: 'assistant', delta: script.slice(split), start_ms: i * 1000 + 100, end_ms: i * 1000 + 200 });
    t.mock.timers.tick(399); await flush();
    assert.equal(h.scripts.length, i + 1);
    t.mock.timers.tick(1); await flush();
  }
  assert.equal(h.guide.active, false);
  assert.equal(h.scripts.length, 5);
  assert.equal(h.states.at(-1), undefined);
});

test('transcripts ahead of playback and renewed speech cannot move the highlight early', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = setup(); t.after(() => h.guide.stop()); h.guide.start(); await flush();
  h.guide.observeTranscript({ role: 'assistant', delta: h.scripts[0], start_ms: 0, end_ms: 100 });
  t.mock.timers.tick(1000); assert.equal(h.scripts.length, 1);
  h.guide.observeAudio({ inputActive: false, outputActive: true });
  h.guide.observeAudio({ inputActive: false, outputActive: false }); t.mock.timers.tick(200);
  h.guide.observeAudio({ inputActive: false, outputActive: true }); t.mock.timers.tick(1000);
  assert.equal(h.scripts.length, 1);
  h.guide.observeAudio({ inputActive: false, outputActive: false }); t.mock.timers.tick(400); await flush();
  assert.equal(h.scripts.length, 2);
});

test('speech interruption cancels the queue even when late audio and transcripts arrive', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = setup(); t.after(() => h.guide.stop()); h.guide.start(); await flush();
  h.guide.observeAudio({ inputActive: false, outputActive: true });
  h.guide.observeAudio({ inputActive: true, outputActive: true });
  h.guide.observeTranscript({ role: 'assistant', delta: h.scripts[0], start_ms: 0, end_ms: 100 });
  h.guide.observeAudio({ inputActive: false, outputActive: false }); t.mock.timers.tick(5000); await flush();
  assert.equal(h.guide.active, false); assert.equal(h.scripts.length, 1);
});

test('navigation or cancellation while browser acknowledgment is pending suppresses late narration', async t => {
  let finish!: (ready: boolean) => void;
  const h = setup(() => new Promise(resolve => { finish = resolve; })); t.after(() => h.guide.stop());
  h.guide.start(); await flush(); h.guide.stop(); finish(true); await flush();
  assert.equal(h.scripts.length, 0);
  h.guide.start(); await flush(); h.navigate(); finish(true); await flush();
  assert.equal(h.scripts.length, 0); assert.equal(h.guide.active, false);
});

test('missing spoken completion pauses within the bound, without retry or automatic restart', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = setup(); t.after(() => h.guide.stop()); h.guide.start(); await flush();
  h.guide.observeAudio({ inputActive: false, outputActive: true });
  h.guide.observeAudio({ inputActive: false, outputActive: false });
  t.mock.timers.tick(45_000); await flush();
  assert.equal(h.guide.active, false); assert.equal(h.states.at(-1)?.phase, 'paused'); assert.equal(h.scripts.length, 1);
  h.guide.tick(); assert.equal(h.scripts.length, 1);
});

test('failed screen confirmation never starts speech and backend work postpones the guide', async t => {
  const h = setup(async () => false); t.after(() => h.guide.stop()); h.guide.start(); await flush();
  assert.equal(h.guide.active, false); assert.equal(h.scripts.length, 0);
  const waiting = setup(); t.after(() => waiting.guide.stop()); waiting.busy(true); waiting.guide.start(); await flush();
  assert.equal(waiting.focused.length, 0);
  waiting.busy(false); waiting.guide.tick(); await flush(); assert.equal(waiting.scripts.length, 1);
});

test('the requesting utterance can finish before a new speech onset interrupts the guide', async t => {
  const h = setup(); t.after(() => h.guide.stop());
  h.guide.observeAudio({ inputActive: true, outputActive: true });
  h.guide.start(); await flush();
  h.guide.observeAudio({ inputActive: true, outputActive: false });
  assert.equal(h.guide.active, true); assert.equal(h.scripts.length, 0);
  h.guide.observeAudio({ inputActive: false, outputActive: false }); await flush();
  assert.equal(h.scripts.length, 1);
  h.guide.observeAudio({ inputActive: true, outputActive: false });
  assert.equal(h.guide.active, false);
});

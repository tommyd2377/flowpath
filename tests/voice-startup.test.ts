import assert from 'node:assert/strict';
import test from 'node:test';
import { createStartupAudioGuard, needsStartupAudioGuard } from '../lib/voice-startup';

function setup(enabled = true, protectionMs?: number) {
  let stopped = 0;
  const clone = { enabled: true, stop: () => { stopped++; } } as MediaStreamTrack;
  const capture = { enabled: true, clone: () => clone } as MediaStreamTrack;
  const guard = createStartupAudioGuard({ stream: { getAudioTracks: () => [capture] }, enabled, debug: false, protectionMs });
  return { guard, track: guard.tracks[0], capture, stopped: () => stopped };
}

test('only iOS browsers need the startup workaround, including desktop-mode iPad', () => {
  assert.equal(needsStartupAudioGuard({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 }), true);
  assert.equal(needsStartupAudioGuard({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(needsStartupAudioGuard({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 0 }), false);
  assert.equal(needsStartupAudioGuard({ userAgent: 'Mozilla/5.0 (Linux; Android)', platform: 'Linux', maxTouchPoints: 5 }), false);
});

test('the microphone reopens two seconds after playback starts, not generation completion', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { guard, track, capture, stopped } = setup();
  guard.start();
  assert.equal(track.enabled, false);
  assert.equal(capture.enabled, true, 'capture and echo processing stay active while outgoing audio is silenced');
  guard.handle({ type: 'response.created', response: { id: 'opening' } });
  guard.handle({ type: 'response.done', response: { id: 'opening', status: 'completed', output: [{ content: [{ type: 'audio' }] }] } });
  context.mock.timers.tick(6_000);
  assert.equal(track.enabled, false, 'generation completion does not restore the microphone');
  guard.handle({ type: 'output_audio_buffer.started', response_id: 'opening' });
  context.mock.timers.tick(250);
  guard.handle({ type: 'output_audio_buffer.stopped', response_id: 'older' });
  guard.handle({ type: 'output_audio_buffer.started', response_id: 'opening' });
  guard.handle({ type: 'response.created', response: { id: 'second' } });
  guard.handle({ type: 'output_audio_buffer.started', response_id: 'second' });
  context.mock.timers.tick(1749);
  assert.equal(track.enabled, false);
  context.mock.timers.tick(1);
  assert.equal(track.enabled, true, 'duplicate or later starts cannot extend the two-second window');
  guard.start();
  guard.handle({ type: 'output_audio_buffer.started', response_id: 'third' });
  guard.handle({ type: 'input_audio_buffer.speech_started' });
  assert.equal(track.enabled, true);
  guard.dispose();
  guard.dispose();
  assert.equal(stopped(), 1, 'the extra outgoing track is stopped exactly once');
});

test('desktop and a user who speaks before the opening remain interruptible', () => {
  const desktop = setup(false);
  desktop.guard.start();
  assert.equal(desktop.track.enabled, true);
  desktop.guard.dispose();
  const earlySpeaker = setup();
  earlySpeaker.guard.handle({ type: 'input_audio_buffer.speech_started' });
  earlySpeaker.guard.handle({ type: 'input_audio_buffer.speech_stopped' });
  earlySpeaker.guard.start();
  assert.equal(earlySpeaker.track.enabled, true);
  earlySpeaker.guard.dispose();
});

test('absent audio and tool-only responses restore input without waiting for playback events', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const silent = setup();
  silent.guard.start();
  context.mock.timers.tick(10_000);
  assert.equal(silent.track.enabled, true);
  silent.guard.dispose();
  const toolOnly = setup();
  toolOnly.guard.start();
  toolOnly.guard.handle({ type: 'response.created', response: { id: 'tool' } });
  toolOnly.guard.handle({ type: 'response.done', response: { id: 'tool', status: 'completed', output: [{}] } });
  assert.equal(toolOnly.track.enabled, true);
  toolOnly.guard.dispose();
});

test('cancelled openings recover immediately before playback or within the original two-second window', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const playing of [false, true]) {
    const { guard, track } = setup();
    guard.start();
    guard.handle({ type: 'response.created', response: { id: 'opening' } });
    if (playing) guard.handle({ type: 'output_audio_buffer.started', response_id: 'opening' });
    guard.handle({ type: 'response.done', response: { id: 'opening', status: 'cancelled' } });
    if (playing) {
      context.mock.timers.tick(100);
      assert.equal(track.enabled, false);
      guard.handle({ type: 'output_audio_buffer.cleared', response_id: 'opening' });
      context.mock.timers.tick(1900);
    }
    assert.equal(track.enabled, true);
    guard.dispose();
  }
});

test('manual selection or a failed briefing restores input; disposal cancels pending restoration', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const reason of ['story_selected', 'briefing_request_failed']) {
    const { guard, track } = setup();
    guard.start();
    guard.release(reason);
    assert.equal(track.enabled, true);
    guard.dispose();
  }
  const { guard, track } = setup();
  guard.start();
  guard.handle({ type: 'output_audio_buffer.started', response_id: 'opening' });
  guard.handle({ type: 'output_audio_buffer.stopped', response_id: 'opening' });
  guard.dispose();
  context.mock.timers.tick(70_000);
  assert.equal(track.enabled, false, 'a disposed session never re-enables its old track');
});

test('manual comparisons accept 500 ms or one second, with two seconds as the default', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const cases: Array<[number | undefined, number]> = [[undefined, 2000], [1000, 1000], [2000, 2000], [0, 2000], [500, 500], [60_000, 2000], [NaN, 2000]];
  for (const [input, duration] of cases) {
    const { guard, track } = setup(true, input);
    guard.start();
    guard.handle({ type: 'output_audio_buffer.started', response_id: 'opening' });
    context.mock.timers.tick(duration - 1);
    assert.equal(track.enabled, false);
    context.mock.timers.tick(1);
    assert.equal(track.enabled, true);
    guard.dispose();
  }
});

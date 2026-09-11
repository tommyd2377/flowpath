import assert from 'node:assert/strict';
import test from 'node:test';
import { createStartupAudioGuard, needsStartupAudioGuard } from '../lib/voice-startup';
test('iPhone and desktop-mode iPad use startup protection, desktop and Android do not', () => {
  for (const userAgent of ['iPhone', 'iPad', 'iPod']) assert.equal(needsStartupAudioGuard({ userAgent, platform: '', maxTouchPoints: 1 }), true);
  assert.equal(needsStartupAudioGuard({ userAgent: '', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(needsStartupAudioGuard({ userAgent: 'Android', platform: 'Linux', maxTouchPoints: 1 }), false);
  assert.equal(needsStartupAudioGuard({ userAgent: 'Mac', platform: 'MacIntel', maxTouchPoints: 0 }), false);
});
test('no-playback timeout restores the outgoing track and disposal stops only its clone', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let stopped = 0;
  const clone = { enabled: true, stop() { stopped++; } }, source = { enabled: true, clone: () => clone };
  const guard = createStartupAudioGuard({ stream: { getAudioTracks: () => [source as unknown as MediaStreamTrack] }, enabled: true });
  guard.start(); t.mock.timers.tick(10000); assert.equal(clone.enabled, true); assert.equal(source.enabled, true); guard.dispose(); assert.equal(stopped, 1);
});

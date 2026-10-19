import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createLocalSessionRouter } from '../lib/session-server';

const origin = 'http://127.0.0.1:3210';
const offer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const request = (method: 'POST' | 'DELETE', id: string, installationId: string) => new Request(`${origin}/api/session`, {
  method, headers: { origin, 'content-type': 'application/sdp', 'x-voice-session': id, 'x-voice-installation': installationId },
  ...(method === 'POST' ? { body: offer } : {}),
});
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('local visitors and refreshed sessions are independent and each expires after five minutes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: string[] = [];
  const router = createLocalSessionRouter({
    apiKey: () => 'fake-test-only',
    fetch: async input => {
      const url = String(input); calls.push(url);
      return url.endsWith('/hangup') ? new Response(null, { status: 200 })
        : Response.json({ session: { id: `live_test_${calls.length}` }, transport: { type: 'webrtc', sdp: offer } });
    },
    controlFactory: () => ({ ready: Promise.resolve(), selectStory: () => 1, subscribe: () => () => {}, close: () => {} }),
  });
  t.after(() => router.shutdown());
  const visitor = randomUUID(), other = randomUUID();
  const original = randomUUID(), later = randomUUID(), refreshed = randomUUID();
  assert.equal((await router.POST(request('POST', original, visitor))).status, 200);
  t.mock.timers.tick(60_000);
  const results = await Promise.all([
    router.POST(request('POST', later, other)), router.POST(request('POST', refreshed, visitor)),
  ]);
  assert.deepEqual(results.map(response => response.status), [200, 200]);
  assert.equal((await router.POST(request('POST', original, visitor))).status, 409, 'one session cannot create duplicate provider calls');
  t.mock.timers.tick(240_000); await flush();
  assert.equal(calls.filter(url => url.endsWith('/hangup')).length, 1);
  assert.equal(router.hasActiveSession(visitor), true, 'the refreshed session has its own five-minute clock');
  assert.equal(router.hasActiveSession(other), true, 'another visitor is unaffected by this timeout');
  t.mock.timers.tick(60_000); await flush();
  assert.equal(router.hasActiveSession(visitor), false);
  assert.equal(router.hasActiveSession(other), false);
  assert.equal(calls.filter(url => url.endsWith('/hangup')).length, 3);
  assert.equal((await router.POST(request('POST', randomUUID(), visitor))).status, 200, 'a new session resets the allowance');
});

test('failed cleanup belongs to its session and cannot block another visitor or refresh', async t => {
  const router = createLocalSessionRouter({
    apiKey: () => 'fake-test-only',
    fetch: async input => String(input).endsWith('/hangup') ? new Response(null, { status: 500 })
      : Response.json({ session: { id: 'live_test' }, transport: { type: 'webrtc', sdp: offer } }),
  });
  t.after(() => router.shutdown());
  const visitor = randomUUID(), old = randomUUID();
  assert.equal((await router.POST(request('POST', old, visitor))).status, 200);
  assert.equal((await router.DELETE(request('DELETE', old, visitor))).status, 502);
  assert.equal((await router.POST(request('POST', randomUUID(), visitor))).status, 200);
  assert.equal((await router.POST(request('POST', randomUUID(), randomUUID()))).status, 200);
});

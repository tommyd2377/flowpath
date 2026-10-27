import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { createNewsDemoAccess } from '../lib/demo-access';
import { GenerationCacheRepository } from '../lib/atlas/server/generation-cache';
import { createLocalSessionRouter } from '../lib/session-server';

const origin = 'http://127.0.0.1:3210';
const req = (method = 'GET', code?: unknown, cookie = '', route = 'demo-access') => new Request(`${origin}/api/${route}`, {
  method, headers: { origin, host: '127.0.0.1:3210', cookie, 'content-type': 'application/json',
    'x-voice-session': '00000000-0000-4000-8000-000000000001' },
  ...(code === undefined ? {} : { body: JSON.stringify({ code }) }),
});
const value = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];
function setup(t: TestContext) {
  const folder = mkdtempSync(join(tmpdir(), 'news-demo-code-'));
  const client = createClient({ url: `file:${folder}/test.db` });
  t.after(() => { client.close(); rmSync(folder, { recursive: true, force: true }); });
  const repo = new GenerationCacheRepository(client); let now = Date.now();
  const access = createNewsDemoAccess(() => repo, { now: () => now });
  return { repo, access, advance: (ms: number) => { now += ms; } };
}

test('code grants persist across service instances, stay cookie-scoped and expire without extending voice time', async t => {
  const f = setup(t);
  assert.equal((await f.access.POST(req('POST', 'nyc-1776'))).status, 400);
  const challenge = value(await f.access.GET(req()));
  assert.equal((await f.access.POST(req('POST', 'incorrect', challenge))).status, 403);
  for (const code of ['NYC-1776', ' nyc-1776', 'nyc-1776 ']) assert.equal((await f.access.POST(req('POST', code, challenge))).status, 403);
  const unlocked = await f.access.POST(req('POST', 'nyc-1776', challenge));
  assert.equal(unlocked.status, 200);
  assert.match(unlocked.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
  const grant = value(unlocked);
  assert.equal(await createNewsDemoAccess(() => f.repo).allowed(req('GET', undefined, grant)), true);
  assert.equal(await f.access.allowed(req()), false);
  assert.equal(await f.access.allowed(req('GET', undefined, `${grant}; ${grant}`)), false);
  f.advance(86_400_001);
  assert.equal(await f.access.allowed(req('GET', undefined, grant)), false);
});

test('wrong codes are throttled durably under concurrency and foreign origins cannot issue grants', async t => {
  const f = setup(t), challenge = value(await f.access.GET(req()));
  const results = await Promise.all(Array.from({ length: 8 }, () => f.access.POST(req('POST', 'wrong', challenge))));
  assert.equal(results.filter(r => r.status === 403).length, 6);
  assert.equal(results.filter(r => r.status === 429).length, 2);
  assert.equal((await f.access.POST(req('POST', 'nyc-1776', challenge))).status, 429);
  const foreign = new Request(`${origin}/api/demo-access`, { method: 'POST', headers: { origin: 'https://foreign.example' }, body: '{}' });
  assert.equal((await f.access.POST(foreign)).status, 403);
});

test('direct HTTP starts require a real grant before provider creation, while expired grants can still hang up', async t => {
  const f = setup(t); let calls = 0;
  const service = createLocalSessionRouter({ apiKey: () => 'fake-test-only', authorizeStart: f.access.allowed,
    fetch: async () => { calls++; return Response.json({ session: { id: 'live_fake' }, transport: { type: 'webrtc', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' } }); } });
  t.after(() => service.shutdown());
  assert.equal((await service.GET(req('GET', undefined, '', 'session'))).status, 403);
  assert.equal((await service.POST(req('POST', 'anything', '', 'session'))).status, 403);
  assert.equal(calls, 0);
  const challenge = value(await f.access.GET(req())), grant = value(await f.access.POST(req('POST', 'nyc-1776', challenge)));
  const request = new Request(`${origin}/api/session`, { method: 'POST', headers: { origin, cookie: grant, 'content-type': 'application/sdp',
    'x-voice-session': '00000000-0000-4000-8000-000000000001' }, body: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' });
  assert.equal((await service.POST(request)).status, 200);
  assert.equal(calls, 1);
  f.advance(86_400_001);
  assert.equal((await service.GET(req('GET', undefined, grant, 'session'))).status, 403);
  assert.equal((await service.DELETE(req('DELETE', undefined, '', 'session'))).status, 204);
});

test('hosted WebSocket route refuses an ungranted upgrade before opening a connection', async () => {
  const previous = process.env.VERCEL; process.env.VERCEL = '1';
  try {
    const { GET } = await import('../app/api/session/connect/route');
    const response = await GET(new Request('https://flowpathapp.com/api/session/connect', {
      headers: { origin: 'https://flowpathapp.com', upgrade: 'websocket' },
    }));
    assert.equal(response.status, 403); assert.match((await response.json()).error, /demo code/);
  } finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
});

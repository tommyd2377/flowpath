import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { createClient } from '@libsql/client';
import { localRequest } from '../lib/local-request';
import { GenerationCacheRepository, resolveGenerationDatabaseConfig } from '../lib/atlas/server/generation-cache';
import { voiceDatabaseClient } from '../lib/voice-database';
import { StoryCatalogRepository } from '../lib/story-catalog';
import { claimHostedSession, serveHostedSession } from '../lib/hosted-session';
import { createSessionService } from '../lib/session-server';
import { createSessionTransport } from '../lib/session-transport';

// The existing CI uses Node 20; browsers and Node 24 provide this globally.
globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;

const offer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const answer = () => new Response(offer, { headers: { location: 'https://api.openai.com/v1/realtime/calls/rtc_mock' } });

test('hosted origins stay HTTPS and reject foreign, absent mutation origins and spoofed hosts', () => {
  const env = { NODE_ENV: 'test' as const, VERCEL: '1', VERCEL_URL: 'preview.vercel.app' };
  for (const host of ['flowpathapp.com', 'www.flowpathapp.com', 'preview.vercel.app']) {
    assert.equal(localRequest(new Request(`https://${host}/api/session`, { headers: { origin: `https://${host}` } }), true, env), true);
  }
  assert.equal(localRequest(new Request('https://flowpathapp.com/api/session'), true, env), false);
  assert.equal(localRequest(new Request('https://flowpathapp.com/api/session', { headers: { origin: 'https://attacker.example' } }), true, env), false);
  assert.equal(localRequest(new Request('https://attacker.example/api/session', { headers: { origin: 'https://attacker.example' } }), true, env), false);
  assert.equal(localRequest(new Request('http://flowpathapp.com/api/session', { headers: { origin: 'http://flowpathapp.com' } }), true, env), false);
  assert.equal(localRequest(new Request('http://localhost:3210/api/session', { headers: { host: 'attacker.example', origin: 'http://attacker.example' } }), true, { NODE_ENV: 'test' }), false);
  assert.equal(localRequest(new Request('https://flowpathapp.com/api/session'), false, { NODE_ENV: 'test' }), false);
});

test('hosted database uses configured remote storage; fixtures and file paths cannot leak into Vercel', () => {
  const env = { NODE_ENV: 'test' as const, VERCEL: '1', DATABASE_URL: 'libsql://fake.example', TURSO_AUTH_TOKEN: 'fake-test-token' };
  assert.deepEqual(resolveGenerationDatabaseConfig(env), { url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN, local: false });
  assert.throws(() => resolveGenerationDatabaseConfig({ ...env, VOICE_FIXTURE_MODE: '1' }), /shared remote/);
  assert.throws(() => resolveGenerationDatabaseConfig({ NODE_ENV: 'test', VERCEL: '1' }), /shared remote/);
  assert.throws(() => resolveGenerationDatabaseConfig({ ...env, DATABASE_URL: 'https://user:password@example.com' }), /invalid/);
  assert.throws(() => resolveGenerationDatabaseConfig({ ...env, DATABASE_URL: 'postgres://fake.example' }), /invalid/);
  assert.throws(() => resolveGenerationDatabaseConfig({ ...env, TURSO_AUTH_TOKEN: '' }), /not authenticated/);
});

function database(t: TestContext) {
  const folder = mkdtempSync(join(tmpdir(), 'voice-hosted-test-'));
  const client = createClient({ url: `file:${folder}/test.db` });
  t.after(() => { client.close(); rmSync(folder, { recursive: true, force: true }); });
  return client;
}

test('remote tables, indexes and maintenance are isolated from legacy FlowPath records', async t => {
  const client = database(t);
  await client.executeMultiple("CREATE TABLE generation_templates(marker TEXT); INSERT INTO generation_templates VALUES('keep'); CREATE TABLE voice_story_catalogs(marker TEXT); INSERT INTO voice_story_catalogs VALUES('keep');");
  const isolated = voiceDatabaseClient(client, true);
  const repo = new GenerationCacheRepository(isolated);
  await repo.initialize();
  await repo.acquireLease({ key: 'generation_templates', ownerToken: 'voice_stories', now: 1, ttlMs: 30 });
  const row = (await client.execute('SELECT * FROM the_voice_v1_generation_leases')).rows[0];
  assert.equal(row.cache_key, 'generation_templates');
  assert.equal(row.owner_token, 'voice_stories');
  assert.equal(await new StoryCatalogRepository(isolated).latest('test'), null);
  assert.deepEqual((await client.execute('SELECT * FROM generation_templates')).rows.map(row => row.marker), ['keep']);
  assert.deepEqual((await client.execute('SELECT * FROM voice_story_catalogs')).rows.map(row => row.marker), ['keep']);
  const indexes = (await client.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")).rows;
  assert.ok(indexes.every(row => String(row.name).startsWith('the_voice_v1_')));
});

test('shared admission allows one call across instances and preserves the start cooldown', async t => {
  const repo = new GenerationCacheRepository(voiceDatabaseClient(database(t), true));
  const installationId = randomUUID();
  const first = await claimHostedSession(repo, installationId, 1000);
  assert.ok(first);
  assert.equal(await repo.hasHostedSession(installationId, 1001), true);
  assert.equal(await claimHostedSession(repo, randomUUID(), 1001), null);
  await first();
  assert.equal(await repo.hasHostedSession(installationId, 1002), false);
  assert.equal(await claimHostedSession(repo, installationId, 1002), null);
  const next = await claimHostedSession(repo, installationId, 21_001);
  assert.ok(next); await next();
});

async function harness(t: TestContext, options: { durationMs?: number; lifetimeMs?: number; denied?: boolean; cleanupFails?: boolean; create?: () => Promise<Response> } = {}) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error();
  const origin = `http://127.0.0.1:${address.port}`;
  const calls: string[] = [];
  const selections: string[] = [];
  let releases = 0;
  let claims = 0;
  const completions: Promise<void>[] = [];
  server.on('connection', socket => {
    const service = createSessionService({
      hostedConnection: true, apiKey: () => 'fake-test-only', durationMs: options.durationMs ?? 60_000,
      fetch: async input => {
        const url = String(input); calls.push(url);
        if (url.endsWith('/hangup')) return new Response(null, { status: options.cleanupFails ? 500 : 200 });
        return options.create ? options.create() : answer();
      },
      controlFactory: () => ({
        ready: Promise.resolve(), selectStory: id => { selections.push(id); return 1; },
        act: () => 2,
        subscribe: listener => { listener({ type: 'research', busy: false, message: '', revision: 0 }); return () => {}; },
        close: () => {},
      }),
    });
    completions.push(serveHostedSession(socket, {
      origin, service, lifetimeMs: options.lifetimeMs ?? 60_000,
      claim: async () => { claims++; return options.denied ? null : async () => { releases++; }; },
    }));
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { href: origin } } });
  let disconnects = 0;
  const transport = createSessionTransport({ hosted: true, sessionId: randomUUID(), installationId: randomUUID(), onDisconnect: () => { disconnects++; } });
  t.after(async () => {
    transport.close();
    for (const socket of server.clients) socket.terminate();
    await Promise.all(completions);
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  return { transport, server, calls, selections, origin, done: () => Promise.all(completions), releases: () => releases, claims: () => claims, disconnects: () => disconnects };
}

test('hosted transport carries SDP, event stream, actions and hangup through the same connection', async t => {
  const h = await harness(t);
  assert.equal((await (await h.transport.fetch('/api/session')).json()).ready, true);
  assert.equal(await (await h.transport.fetch('/api/session', { method: 'POST', body: offer })).text(), offer);
  const events = await h.transport.fetch('/api/session/events');
  const reader = events.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"research"/);
  assert.equal((await h.transport.fetch('/api/session/story', { method: 'POST', body: JSON.stringify({ headlineId: 'story-example' }) })).status, 202);
  assert.deepEqual(h.selections, ['story-example']);
  assert.equal((await h.transport.fetch('/api/session/action', { method: 'POST', body: JSON.stringify({ action: { type: 'show_stories' } }) })).status, 202);
  assert.equal((await h.transport.fetch('/api/session', { method: 'POST', body: offer })).status, 409);
  await reader.cancel();
  assert.equal((await h.transport.fetch('/api/session', { method: 'DELETE' })).status, 204);
  h.transport.close(); await h.done();
  assert.equal(h.calls.length, 2); assert.equal(h.claims(), 1); assert.equal(h.releases(), 1); assert.equal(h.disconnects(), 0);
});

test('denied hosted admission never calls the provider', async t => {
  const h = await harness(t, { denied: true });
  assert.equal((await h.transport.fetch('/api/session', { method: 'POST', body: offer })).status, 429);
  assert.deepEqual(h.calls, []);
});

test('connection loss hangs up the provider and notifies the browser', async t => {
  const h = await harness(t);
  await h.transport.fetch('/api/session', { method: 'POST', body: offer });
  for (const socket of h.server.clients) socket.terminate();
  await h.done();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.calls.filter(url => url.endsWith('/hangup')).length, 1);
  assert.equal(h.disconnects(), 1); assert.equal(h.releases(), 1);
});

test('canceling a handshake waits for its provider call ID and closes that call', async t => {
  let finish!: (response: Response) => void;
  let created!: () => void;
  const started = new Promise<void>(resolve => { created = resolve; });
  const response = new Promise<Response>(resolve => { finish = resolve; });
  const h = await harness(t, { create: () => { created(); return response; } });
  const abort = new AbortController();
  const request = h.transport.fetch('/api/session', { method: 'POST', body: offer, signal: abort.signal });
  const rejection = assert.rejects(request, { name: 'AbortError' });
  await started; abort.abort(); await rejection;
  h.transport.close(); finish(answer()); await h.done();
  assert.equal(h.calls.length, 2); assert.equal(h.releases(), 1);
});

test('failed provider cleanup retains the shared admission lease', async t => {
  const h = await harness(t, { cleanupFails: true });
  await h.transport.fetch('/api/session', { method: 'POST', body: offer });
  h.transport.close(); await h.done();
  assert.equal(h.releases(), 0);
});

test('server lifetime closes the provider even when the browser sends nothing', async t => {
  const h = await harness(t, { lifetimeMs: 70 });
  await h.transport.fetch('/api/session', { method: 'POST', body: offer });
  await h.done();
  assert.equal(h.calls.filter(url => url.endsWith('/hangup')).length, 1);
});

test('duplicate RPC IDs cannot repeat actions; changing the bound installation closes the socket', async t => {
  const h = await harness(t);
  const socket = new WebSocket(h.origin.replace('http:', 'ws:'));
  await once(socket, 'open');
  const id = randomUUID();
  const sessionId = randomUUID(); const installationId = randomUUID();
  const frame = { id, operation: 'POST', sessionId, installationId, body: offer };
  const received = once(socket, 'message');
  socket.send(JSON.stringify(frame)); socket.send(JSON.stringify(frame));
  await received;
  assert.equal(h.calls.filter(url => !url.endsWith('/hangup')).length, 1);
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ ...frame, id: randomUUID(), installationId: randomUUID() }));
  assert.equal((await closed)[0], 1008);
});

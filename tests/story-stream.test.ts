import assert from 'node:assert/strict';
import test from 'node:test';
import { readStoryCatalogResponse } from '../lib/story-stream';
import { FIXTURE_HEADLINES, type StoryCatalogResponse } from '../lib/story-contracts';

const items = FIXTURE_HEADLINES.map(headline => ({ ...headline, summary: 'A reported development.', whyItMatters: 'Its effects remain uncertain.', scope: 'both' as const, headlines: [headline], contextSources: [] }));
const catalog: StoryCatalogResponse = { ok: true, items, fetchedAt: '2026-10-18T10:00:00Z', stale: false, curated: true, warning: null, complete: true };

test('a validated lead is delivered before the rest of an open network stream', async () => {
  const encoder = new TextEncoder();
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
  const updates: StoryCatalogResponse[] = [];
  const pending = readStoryCatalogResponse(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }), value => updates.push(value));
  const lead = { ...catalog, complete: false, items: items.slice(0, 1) };
  writer.enqueue(encoder.encode(`${JSON.stringify(lead)}\n`));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(updates, [lead]);
  writer.enqueue(encoder.encode(`${JSON.stringify(catalog)}\n`));
  await pending;
  assert.deepEqual(updates, [lead, catalog]);
});

test('split UTF-8 and JSON chunks preserve story text and final completion without a trailing newline', async () => {
  const value = { ...catalog, items: [{ ...items[0], title: 'Leaders discuss café funding — a proposal' }] };
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const updates: StoryCatalogResponse[] = [];
  await readStoryCatalogResponse(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }), value => updates.push(value));
  assert.deepEqual(updates, [value]);
});

test('legacy JSON responses remain supported', async () => {
  const legacy = { ...catalog, complete: undefined };
  const updates: StoryCatalogResponse[] = [];
  await readStoryCatalogResponse(Response.json(legacy), value => updates.push(value));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].items.length, items.length);
});

test('a truncated stream preserves only the validated lead and reports missing completion', async () => {
  const lead = { ...catalog, complete: false, items: items.slice(0, 1) };
  const updates: StoryCatalogResponse[] = [];
  await assert.rejects(readStoryCatalogResponse(new Response(`${JSON.stringify(lead)}\n`, { headers: { 'Content-Type': 'application/x-ndjson' } }), value => updates.push(value)), /did not finish/);
  assert.deepEqual(updates, [lead]);
});

test('invalid or oversized catalogs never reach the interface', async () => {
  for (const response of [Response.json({ error: 'unavailable' }), new Response('x'.repeat(1_048_577)), new Response('', { status: 503 })]) {
    let count = 0;
    await assert.rejects(readStoryCatalogResponse(response, () => { count++; }));
    assert.equal(count, 0);
  }
});

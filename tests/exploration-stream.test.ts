import assert from 'node:assert/strict';
import test from 'node:test';
import { readExplorationResponse } from '../lib/exploration-stream';
import { FIXTURE_HEADLINES } from '../lib/story-contracts';
import { emptyDisplay, type ExplorationDisplay } from '../lib/visual-contracts';
import type { EventSnapshot } from '../lib/atlas/contracts';

const encoder = new TextEncoder();
const headline = FIXTURE_HEADLINES[0];
const preview = { ...headline, summary: 'Initial attributed reporting.', whyItMatters: 'The consequences remain uncertain.',
  scope: 'both' as const, headlines: [headline], contextSources: [] };
const snapshot: EventSnapshot = {
  id: 'd5e98030-536d-48f4-a367-de47d6176536', headline, capturedAt: '2026-10-18T12:00:00Z', verificationStatus: 'reported',
  summary: 'New reporting discusses café services — 世界 🌍.',
  facts: [{ text: 'A publisher reports a developing proposal.', sourceIds: ['source_1'] }],
  uncertainties: ['The outcome is uncertain.'],
  sources: [{ id: 'source_1', title: 'Original reporting', domain: 'example.com', url: 'https://example.com/report' }],
};
const gathering: ExplorationDisplay = { ...emptyDisplay(1), headline, view: 'exploration', storyPreview: preview, storyResearch: { phase: 'gathering' } };
const mapping: ExplorationDisplay = { ...gathering, storyResearch: { phase: 'mapping', snapshot } };
const finished: ExplorationDisplay = { ...emptyDisplay(1), headline, view: 'exploration', storyPreview: preview,
  exploration: { kind: 'exploration', headline, snapshot, choices: [] } };
type Accepted = { display: ExplorationDisplay; complete: boolean };
const frame = (display: ExplorationDisplay, complete = false) => JSON.stringify({ display, complete });
function openStream() {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; }, cancel() { cancellations++; } });
  return { body, writer, get cancellations() { return cancellations; },
    response: new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } }) };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('preview and validated research publish before the stream or possibility map finishes', async () => {
  const stream = openStream(), accepted: Accepted[] = [];
  let resolved = false;
  const pending = readExplorationResponse(stream.response, (display, complete) => accepted.push({ display, complete })).then(() => { resolved = true; });
  stream.writer.enqueue(encoder.encode(`${frame(gathering)}\n`)); await flush();
  assert.deepEqual(accepted, [{ display: gathering, complete: false }]);
  assert.equal(resolved, false);
  stream.writer.enqueue(encoder.encode(`${frame(mapping)}\n`)); await flush();
  assert.deepEqual(accepted, [{ display: gathering, complete: false }, { display: mapping, complete: false }]);
  assert.equal(resolved, false);
  stream.writer.enqueue(encoder.encode(`${frame(finished, true)}\n`)); await pending;
  assert.deepEqual(accepted.at(-1), { display: finished, complete: true });
  assert.equal(stream.cancellations, 1, 'a terminal frame cancels the still-open body');
  assert.equal(stream.body.locked, false);
});

test('arbitrary byte chunks preserve split UTF-8, multiple stages, blank lines and an unterminated final line', async () => {
  const bytes = encoder.encode(`\n${frame(gathering)}\r\n\n${frame(mapping)}\n${frame(finished, true)}`);
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  const accepted: Accepted[] = [];
  await readExplorationResponse(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }), (display, complete) => accepted.push({ display, complete }));
  assert.deepEqual(accepted, [{ display: gathering, complete: false }, { display: mapping, complete: false }, { display: finished, complete: true }]);
  assert.equal(accepted[1].display.storyResearch?.snapshot?.summary, snapshot.summary);
  assert.equal(body.locked, false);
});

test('a terminal frame stops processing later frames in the same network chunk', async () => {
  const accepted: Accepted[] = [];
  await readExplorationResponse(new Response(`${frame(finished, true)}\n{"error":"This must not overwrite completion."}\n`, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  }), (display, complete) => accepted.push({ display, complete }));
  assert.deepEqual(accepted, [{ display: finished, complete: true }]);
});

test('legacy JSON display responses remain supported as one complete publication', async () => {
  const accepted: Accepted[] = [];
  await readExplorationResponse(Response.json({ display: finished }), (display, complete) => accepted.push({ display, complete }));
  assert.deepEqual(accepted, [{ display: finished, complete: true }]);
});

for (const failure of [
  { name: 'explicit server error', text: '{"error":"The map could not be completed. Try again."}\n', expected: /map could not be completed/ },
  { name: 'invalid display frame', text: '{"display":{"view":"other"},"complete":true}\n', expected: /incomplete display/ },
  { name: 'missing completion flag', text: JSON.stringify({ display: finished }) + '\n', expected: /incomplete display/ },
  { name: 'invalid JSON frame', text: '{"display":broken}\n', expected: /incomplete display/ },
  { name: 'truncated JSON frame', text: '{"display":', expected: /incomplete display/ },
]) {
  test(`${failure.name} preserves earlier accepted research and releases the reader`, async () => {
    const stream = openStream(), accepted: Accepted[] = [];
    const pending = readExplorationResponse(stream.response, (display, complete) => accepted.push({ display, complete }));
    stream.writer.enqueue(encoder.encode(`${frame(mapping)}\n`)); await flush();
    const rejected = assert.rejects(pending, failure.expected);
    stream.writer.enqueue(encoder.encode(failure.text));
    if (failure.name === 'truncated JSON frame') stream.writer.close();
    await rejected;
    assert.deepEqual(accepted, [{ display: mapping, complete: false }]);
    if (failure.name !== 'truncated JSON frame') assert.equal(stream.cancellations, 1);
    assert.equal(stream.body.locked, false);
  });
}

test('a clean EOF without a terminal map preserves validated stages and reports incomplete completion', async () => {
  const accepted: Accepted[] = [];
  await assert.rejects(readExplorationResponse(new Response(`${frame(mapping)}\n`, { headers: { 'Content-Type': 'application/x-ndjson' } }),
    (display, complete) => accepted.push({ display, complete })), /map did not finish/);
  assert.deepEqual(accepted, [{ display: mapping, complete: false }]);
});

test('an oversized unterminated buffer is rejected while retaining previously accepted research', async () => {
  const stream = openStream(), accepted: Accepted[] = [];
  const pending = readExplorationResponse(stream.response, (display, complete) => accepted.push({ display, complete }));
  stream.writer.enqueue(encoder.encode(`${frame(mapping)}\n`)); await flush();
  const rejected = assert.rejects(pending, /display is too large/);
  stream.writer.enqueue(new Uint8Array(2_097_153).fill(32));
  await rejected;
  assert.deepEqual(accepted, [{ display: mapping, complete: false }]);
  assert.equal(stream.cancellations, 1);
  assert.equal(stream.body.locked, false);
});

test('network reader failure leaves accepted context available and releases its lock', async () => {
  const stream = openStream(), accepted: Accepted[] = [];
  const pending = readExplorationResponse(stream.response, (display, complete) => accepted.push({ display, complete }));
  stream.writer.enqueue(encoder.encode(`${frame(mapping)}\n`)); await flush();
  const rejected = assert.rejects(pending, /connection was lost/);
  stream.writer.error(new Error('The connection was lost.')); await rejected;
  assert.deepEqual(accepted, [{ display: mapping, complete: false }]);
  assert.equal(stream.body.locked, false);
});

test('a rejecting consumer still cancels and releases the active response reader', async () => {
  const stream = openStream();
  const pending = readExplorationResponse(stream.response, () => { throw new Error('The selected story changed.'); });
  const rejected = assert.rejects(pending, /selected story changed/);
  stream.writer.enqueue(encoder.encode(`${frame(mapping)}\n`)); await rejected;
  assert.equal(stream.cancellations, 1);
  assert.equal(stream.body.locked, false);
});

test('non-success HTTP, absent bodies and invalid JSON fallback never publish a display', async () => {
  for (const response of [new Response('', { status: 503 }), new Response(null), Response.json({ error: 'unavailable' }), Response.json({ display: { view: 'invalid' } })]) {
    let count = 0;
    await assert.rejects(readExplorationResponse(response, () => { count++; }));
    assert.equal(count, 0);
  }
});

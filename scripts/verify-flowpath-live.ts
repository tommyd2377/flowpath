import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { GenerationCacheRepository } from '../lib/atlas/server/generation-cache';
import { createGenerationService } from '../lib/atlas/server/generation-service';
import { getAtlasModel, getAtlasResponsesAdapter, type AtlasResponsesAdapter, type AtlasResponsesRequest, type AtlasRequestOptions, type AtlasResponseProgress } from '../lib/atlas/server/openai-client';
import type { EventSnapshot } from '../lib/atlas/contracts';

// Explicitly opt-in only. Normal app checks never start this live test.
if (!process.argv.includes('--run')) {
  console.log('Live research verification is disabled. --run makes at most one paid request; no retries.');
  process.exit(0);
}
const directory = process.argv.find(value => value.startsWith('--out='))?.slice(6);
assert.ok(directory && directory.startsWith('/private/tmp/'), 'Provide a private temporary output directory with --out=.');
assert.equal(getAtlasModel(), 'gpt-6-luna', 'Run only after the reviewed Luna migration.');
mkdirSync(directory, { recursive: true });
const base = getAtlasResponsesAdapter();
let calls = 0;
let metadata: object = {};
const begin = (request: AtlasResponsesRequest) => {
  assert.equal(request.model, 'gpt-6-luna');
  assert.equal(String(request.service_tier), 'priority');
  assert.equal(calls, 0, 'No second paid request is permitted.');
  writeFileSync(path.join(directory, 'live-attempt.json'), JSON.stringify({ model: request.model, serviceTier: request.service_tier, attemptedAt: new Date().toISOString() }), { flag: 'wx' });
  calls++;
};
const measure = (response: unknown) => {
  const raw = response as { service_tier?: string; usage?: object; _request_id?: string };
  metadata = { serviceTier: raw.service_tier, usage: raw.usage, requestId: raw._request_id };
};
const adapter: AtlasResponsesAdapter = {
  async parse<T>(request: AtlasResponsesRequest, options: AtlasRequestOptions) {
    begin(request);
    const response = await base.parse<T>(request, options);
    measure(response);
    return response;
  },
  async stream<T>(request: AtlasResponsesRequest, options: AtlasRequestOptions, onProgress: (progress: AtlasResponseProgress) => void) {
    begin(request);
    const response = await base.stream!<T>(request, options, onProgress);
    measure(response);
    return response;
  },
};
const databaseUrl = `file:${path.join(directory, 'live-pipeline.db')}`;
const repository = new GenerationCacheRepository(createClient({ url: databaseUrl }));
let reloaded: GenerationCacheRepository | undefined;
const start = performance.now();
let researchAtMs: number | undefined;
const snapshots: EventSnapshot[] = [];
const input = {
  installationId: randomUUID(), graphId: randomUUID(),
  headline: {
    id: 'benchmark-nasa-dart-orbit-2022',
    title: 'NASA confirms DART mission impact changed asteroid motion',
    publisher: 'NASA', publisherUrl: 'https://www.nasa.gov/',
    googleNewsUrl: 'https://www.nasa.gov/news-release/nasa-confirms-dart-mission-impact-changed-asteroids-motion-in-space/',
    publishedAt: '2022-10-11T12:00:00Z',
  },
};
try {
  const service = createGenerationService({ repository, adapter, mode: () => 'live' });
  const result = await service.start(input, undefined, { onResearch(snapshot) {
    researchAtMs = Math.round(performance.now() - start);
    snapshots.push(snapshot);
  } });
  const elapsedMs = Math.round(performance.now() - start);
  writeFileSync(path.join(directory, 'live-pipeline-output.json'), JSON.stringify({ input, result, snapshots, elapsedMs, researchAtMs, calls, ...metadata }, null, 2));
  assert.equal(result.kind, 'atlas');
  if (result.kind !== 'atlas') throw new Error('A complete map is required.');
  assert.ok(result.snapshot.facts.length >= 2, 'Expect useful source-checked research.');
  assert.ok(result.snapshot.sources.some(source => new URL(source.url).hostname.endsWith('nasa.gov')), 'Expect a NASA source.');
  assert.ok(result.snapshot.facts.every(fact => fact.sourceIds.length > 0), 'Every verified fact must have a source.');
  assert.ok(result.nodes.length >= 3 && result.nodes.length <= 5);
  assert.equal(new Set(result.nodes.map(node => node.title.toLowerCase())).size, result.nodes.length);
  assert.equal(snapshots.length, 1, 'Publish one checked research section before the map.');
  assert.deepEqual(result.snapshot.facts, snapshots[0].facts);
  assert.ok(await repository.getRegisteredGraph(input.graphId), 'The map must be durably registered.');
  repository.close();
  reloaded = new GenerationCacheRepository(createClient({ url: databaseUrl }));
  const replay = await createGenerationService({ repository: reloaded, adapter, mode: () => 'live' }).start(input);
  assert.equal(replay.kind, 'atlas');
  if (replay.kind === 'atlas') assert.deepEqual(replay.snapshot, result.snapshot);
  assert.equal(calls, 1, 'Reopening and replaying must not trigger another request.');
  const summary = { passed: true, model: getAtlasModel(), calls, elapsedMs, researchAtMs,
    facts: result.snapshot.facts.length, sources: result.snapshot.sources.length, branches: result.nodes.length,
    durableReplay: true, ...metadata };
  writeFileSync(path.join(directory, 'live-pipeline-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} catch (error) {
  writeFileSync(path.join(directory, 'live-pipeline-failure.json'), JSON.stringify({ passed: false, calls,
    errorName: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : 'Verification failed', ...metadata }, null, 2));
  console.error('Live verification failed; inspect the bounded test output. No retry was made.');
  process.exitCode = 1;
} finally {
  repository.close();
  reloaded?.close();
}

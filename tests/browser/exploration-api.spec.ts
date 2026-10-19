import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { StoryCatalogResponseSchema } from '../../lib/story-contracts';
import { ExplorationDisplaySchema, type ExplorationAction } from '../../lib/visual-contracts';
import { readExplorationResponse } from '../../lib/exploration-stream';

test('fixture HTTP routes share a saved exploration, enforce graph ownership, and never open voice', async ({ request }) => {
  // Fail before any research endpoint if someone points this test at a live server.
  const readiness = await request.get('/api/session');
  expect(await readiness.json()).toEqual({ ready: false, reason: 'fixture' });
  const catalog = StoryCatalogResponseSchema.parse(await (await request.get('/api/stories')).json());
  expect(catalog.warning).toContain('Fixture');
  const installation = randomUUID();
  const headers = { Origin: 'http://127.0.0.1:3210', 'X-Voice-Installation': installation };
  const select = { type: 'select_story', storyId: catalog.items[0].id } as const;
  const act = async (action: ExplorationAction, headlineId = catalog.items[0].id) => {
    const response = await request.post('/api/exploration', { headers, data: { action, headlineId } });
    expect(response.ok()).toBe(true);
    return ExplorationDisplaySchema.parse((await response.json()).display);
  };
  const start = await act(select);
  const initialCalls = start.exploration!.limits!.callsUsed;
  expect(initialCalls).toBeLessThanOrEqual(1);
  const duplicate = await act(select);
  expect(duplicate.exploration?.graphId).toBe(start.exploration?.graphId);
  expect(duplicate.exploration?.limits?.callsUsed).toBe(initialCalls);
  const nodeId = start.exploration!.choices![0].id;
  const selected = await act({ type: 'choose_path', nodeId });
  expect(selected.exploration?.currentNode?.id).toBe(nodeId);
  const expandedCalls = selected.exploration!.limits!.callsUsed;
  expect(expandedCalls).toBeLessThanOrEqual(initialCalls + 1);
  const comparison = await act({ type: 'compare_paths', nodeIds: selected.exploration!.choices!.slice(0, 2).map(node => node.id) });
  expect(comparison.exploration?.comparison).toHaveLength(2);
  const restored = ExplorationDisplaySchema.parse((await (await request.get('/api/exploration', { headers })).json()).display);
  expect(restored.exploration?.currentNode?.id).toBe(nodeId);
  expect(restored.exploration?.limits?.callsUsed).toBe(expandedCalls);
  expect((await act({ type: 'show_stories' })).view).toBe('stories');
  expect((await act({ type: 'navigate_path', target: 'root' })).exploration?.currentNode).toBeNull();
  const forged = await request.post('/api/exploration', {
    headers, data: { action: { type: 'choose_path', nodeId: randomUUID() }, headlineId: catalog.items[0].id },
  });
  expect(forged.status()).toBeGreaterThanOrEqual(400);
  const other = await request.post('/api/exploration', {
    headers: { ...headers, 'X-Voice-Installation': randomUUID() }, data: { action: { type: 'choose_path', nodeId } },
  });
  expect(other.status()).toBeGreaterThanOrEqual(400);
  expect((await request.post('/api/exploration', {
    headers: { ...headers, Origin: 'https://foreign.example' }, data: { action: select },
  })).status()).toBe(403);
  expect((await request.post('/api/exploration', { headers, data: { action: { type: 'unknown_tool' } } })).status()).toBe(400);
  expect(await (await request.get('/api/session')).json()).toEqual({ ready: false, reason: 'fixture' });
});

test('fixture selection streams preview and checked research before the saved map, retaining JSON compatibility', async ({ request }) => {
  expect(await (await request.get('/api/session')).json()).toEqual({ ready: false, reason: 'fixture' });
  const catalog = StoryCatalogResponseSchema.parse(await (await request.get('/api/stories')).json());
  const story = catalog.items[2];
  const headers = { Origin: 'http://127.0.0.1:3210', 'X-Voice-Installation': randomUUID(), Accept: 'application/x-ndjson' };
  const selected = await request.post('/api/exploration', { headers, data: { action: { type: 'select_story', storyId: story.id } } });
  expect(selected.ok()).toBe(true);
  expect(selected.headers()['content-type']).toContain('application/x-ndjson');
  const stages: Array<{ display: ReturnType<typeof ExplorationDisplaySchema.parse>; complete: boolean }> = [];
  await readExplorationResponse(new Response(await selected.text(), { headers: selected.headers() }), (display, complete) => stages.push({ display, complete }));
  expect(stages[0].display.storyPreview?.summary).toBe(story.summary);
  expect(stages[0].display.storyResearch?.phase).toBe('gathering');
  for (const stage of stages.slice(0, -1)) {
    expect(stage.complete).toBe(false);
    expect(stage.display.exploration).toBeNull();
  }
  // Cached maps can skip the research stage and still deliver a saved final graph.
  const final = stages.at(-1)!;
  expect(final.complete).toBe(true);
  expect(final.display.storyResearch).toBeUndefined();
  expect(final.display.exploration?.choices).toHaveLength(3);
  const restored = ExplorationDisplaySchema.parse((await (await request.get('/api/exploration', { headers })).json()).display);
  expect(restored.exploration?.graphId).toBe(final.display.exploration?.graphId);
  expect(restored.exploration?.snapshot?.id).toBe(final.display.exploration?.snapshot?.id);
  const invalid = await request.post('/api/exploration', { headers: { ...headers, Origin: 'https://foreign.example' }, data: { action: { type: 'select_story', storyId: story.id } } });
  expect(invalid.status()).toBe(403);
});

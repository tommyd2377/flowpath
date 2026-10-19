import { expect, test, type Page } from '@playwright/test';
import { createFixtureStartResponse } from '../../lib/atlas/server/fixtures';
import { emptyDisplay, type ExplorationDisplay } from '../../lib/visual-contracts';
import type { CuratedStory } from '../../lib/story-contracts';

const headline = {
  id: 'progress-transit-story', title: 'City weighs a new transit plan', publisher: 'Metro Journal',
  publisherUrl: 'https://metro.example/', googleNewsUrl: 'https://news.google.com/rss/articles/transit',
  publishedAt: '2026-10-18T09:00:00Z',
};
const story: CuratedStory = {
  ...headline, summary: 'A new transit proposal would connect more neighborhoods.',
  whyItMatters: 'The decision could change travel times and the city budget.',
  scope: 'us', headlines: [headline, { ...headline, id: 'progress-transit-report',
    title: 'Transit proposal includes new cross-town links', publisher: 'City News',
    googleNewsUrl: 'https://news.google.com/rss/articles/transit-followup', publishedAt: '2026-10-18T09:30:00Z' }],
  contextSources: [{ title: 'Earlier transit study', url: 'https://context.example/transit-study' }],
};
const catalog = {
  ok: true, items: [story], fetchedAt: '2026-10-18T10:00:00Z', stale: false,
  warning: null, curated: true, complete: true,
};
const graphId = '00000000-0000-4000-8000-000000000001';
const result = createFixtureStartResponse({
  installationId: '00000000-0000-4000-8000-000000000099',
  graphId, headline,
});
if (result.kind !== 'atlas') throw new Error('Expected a saved fixture map.');
const snapshot = { ...result.snapshot,
  summary: 'The researched proposal would add two routes while its funding remains undecided.',
  facts: [{ text: 'The council scheduled a public hearing for the proposal.', sourceIds: ['research-source'] }],
  uncertainties: ['The funding vote has not been scheduled.'],
  sources: [{ id: 'research-source', title: 'Council announces a public hearing', url: 'https://council.example/hearing', domain: 'council.example' }],
};
const mapping: ExplorationDisplay = {
  ...emptyDisplay(1), headline, storyPreview: story, stories: [story], view: 'exploration',
  storyResearch: { phase: 'mapping', snapshot },
};
const completed: ExplorationDisplay = {
  ...emptyDisplay(1), headline, storyPreview: story, stories: [story], view: 'exploration',
  exploration: { kind: 'exploration', headline, graphId, snapshot,
    currentNode: null, lineage: [], choices: result.nodes },
};

type StreamProbe = {
  requests: number;
  accept: string;
  push: (chunk: string) => void;
  close: () => void;
};

async function send(page: Page, frame: object, split = false) {
  const chunk = `${JSON.stringify(frame)}\n`;
  await page.evaluate(({ chunk, split }) => {
    const stream = (window as unknown as { storyProgressTest: StreamProbe }).storyProgressTest;
    if (split) {
      const midpoint = Math.floor(chunk.length / 2);
      stream.push(chunk.slice(0, midpoint));
      stream.push(chunk.slice(midpoint));
    } else stream.push(chunk);
  }, { chunk, split });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/stories', route => route.fulfill({ json: catalog }));
  await page.route('**/api/exploration', route => route.fulfill({ json: { display: emptyDisplay() } }));
  await page.route('https://api.openai.com/**', route => route.abort('blockedbyclient'));
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const probe: StreamProbe = { requests: 0, accept: '', push: () => {}, close: () => {} };
    Object.assign(window, { storyProgressTest: probe });
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (url.pathname !== '/api/exploration' || method !== 'POST') return originalFetch(input, init);
      probe.requests++;
      probe.accept = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('accept') ?? '';
      let open = true;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          probe.push = chunk => { if (open) controller.enqueue(encoder.encode(chunk)); };
          probe.close = () => { if (open) { open = false; controller.close(); } };
          const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
          const abort = () => { if (open) { open = false; controller.error(new DOMException('Aborted', 'AbortError')); } };
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        },
        cancel() { open = false; },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  });
});

async function openStory(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(headline.title) }).click();
  await expect(page.getByRole('region', { name: 'Story exploration' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { storyProgressTest: StreamProbe }).storyProgressTest.requests)).toBe(1);
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`richer reporting and streamed research precede the saved map with ${reducedMotion} motion`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    if (reducedMotion === 'reduce') await page.setViewportSize({ width: 390, height: 844 });
    await openStory(page);
    const region = page.getByRole('region', { name: 'Story exploration' });
    await expect(region.getByText(story.summary, { exact: true })).toBeVisible();
    await expect(region.getByRole('heading', { name: 'Why it matters' })).toBeVisible();
    await expect(region.getByText(story.whyItMatters, { exact: true })).toBeVisible();
    await expect(region.locator('.evidence-panel')).not.toHaveAttribute('open', '');
    await region.locator('.evidence-panel summary').click();
    await expect(region.locator('.evidence-list')).toContainText('Metro Journal');
    await expect(region.locator('.evidence-list')).toContainText('City News');
    await expect(region.locator('a[href="https://context.example/transit-study"]')).toBeVisible();
    await expect(region.locator('.exploration-loading')).toContainText('Gathering context');
    await expect(region.locator('.possibility-card')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { storyProgressTest: StreamProbe }).storyProgressTest.accept)).toContain('application/x-ndjson');

    const overview = await region.locator('.story-overview').elementHandle();
    const evidence = await region.locator('.evidence-panel').elementHandle();
    await send(page, { display: mapping, complete: false }, true);
    await expect(region.getByText(snapshot.summary, { exact: true })).toBeVisible();
    await expect(region.getByText(snapshot.facts[0].text, { exact: true })).toBeVisible();
    await expect(region.getByText(snapshot.uncertainties[0], { exact: true })).toBeVisible();
    await expect(region.locator('.exploration-loading')).toHaveText('Mapping possibilities…');
    await expect(region.locator('.possibility-card')).toHaveCount(0);
    await expect(region).not.toHaveAttribute('aria-busy', 'true');
    await region.locator('.evidence-panel summary').click();
    await expect(region.locator('.evidence-panel')).not.toHaveAttribute('open', '');

    await send(page, { display: completed, complete: true });
    await expect(region.locator('.possibility-card')).toHaveCount(result.nodes.length);
    await expect(region.locator('.possibility-card').first()).toBeEnabled();
    await expect(region.locator('.exploration-loading')).toHaveCount(0);
    await expect(region.locator('.evidence-panel')).not.toHaveAttribute('open', '');
    expect(await overview!.evaluate(node => node === document.querySelector('.story-overview'))).toBe(true);
    expect(await evidence!.evaluate(node => node === document.querySelector('.evidence-panel'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`completed-map-${reducedMotion}.png`), fullPage: true });
  });
}

test('returning to all stories keeps late research and map updates from reopening the story', async ({ page }) => {
  await openStory(page);
  await page.getByRole('button', { name: 'All stories', exact: true }).click();
  await expect(page.locator('.voice-page')).toHaveAttribute('data-view', 'stories');
  await send(page, { display: mapping, complete: false });
  await expect(page.locator('.voice-page')).toHaveAttribute('data-view', 'stories');
  await send(page, { display: completed, complete: true });
  await expect(page.locator('.voice-page')).toHaveAttribute('data-working', 'false');
  await expect(page.locator('.voice-page')).toHaveAttribute('data-view', 'stories');
  await expect(page.getByRole('region', { name: 'Story exploration' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(headline.title) })).toBeVisible();
});

test('map failure preserves streamed facts and sources, ends loading, and leaves a return control', async ({ page }) => {
  await openStory(page);
  await send(page, { display: mapping, complete: false });
  await page.locator('.evidence-panel summary').click();
  await expect(page.getByText(snapshot.facts[0].text, { exact: true })).toBeVisible();
  await send(page, { error: 'The possibility map could not be completed.' });
  await page.evaluate(() => (window as unknown as { storyProgressTest: StreamProbe }).storyProgressTest.close());
  const region = page.getByRole('region', { name: 'Story exploration' });
  await expect(region.getByRole('heading', { name: 'The possibility map is unavailable' })).toBeVisible();
  await expect(region.getByText(snapshot.summary, { exact: true })).toBeVisible();
  await expect(region.getByText(snapshot.facts[0].text, { exact: true })).toBeVisible();
  await expect(region.locator('a[href="https://council.example/hearing"]').first()).toBeVisible();
  await expect(region.locator('.exploration-loading')).toHaveCount(0);
  await expect(region.locator('.possibility-card')).toHaveCount(0);
  await expect(page.locator('.voice-page')).toHaveAttribute('data-working', 'false');
  await region.getByRole('button', { name: 'All stories', exact: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(headline.title) })).toBeVisible();
});

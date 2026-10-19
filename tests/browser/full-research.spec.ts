import { expect, test, type Page } from '@playwright/test';
import { createFixtureStartResponse } from '../../lib/atlas/server/fixtures';
import { emptyDisplay, type ExplorationDisplay } from '../../lib/visual-contracts';
import type { CuratedStory } from '../../lib/story-contracts';

const headline = {
  id: 'full-research-transit', title: 'Council considers expanded transit service', publisher: 'Metro Journal',
  publisherUrl: 'https://metro.example/', googleNewsUrl: 'https://news.google.com/rss/articles/full-research',
  publishedAt: '2026-10-18T09:00:00Z',
};
const story: CuratedStory = {
  ...headline, summary: 'The council is considering a proposal to expand transit service.',
  whyItMatters: 'The decision could change residents’ access to work and school.',
  scope: 'us', headlines: [headline], contextSources: [],
};
const source = { id: 'transit-report', title: 'The full transit study', url: 'https://council.example/transit-study', domain: 'council.example' };
const qualifier = 'However, the study does not establish whether the proposal would reduce travel times for every neighborhood.';
const longFact = 'The council published an analysis of the proposed routes, service schedules, and funding assumptions. '
  + 'The report includes separate estimates for weekday commuters, evening trips, school travel, and connections to existing services. '.repeat(10)
  + `The supporting record identifier is ${'R'.repeat(320)}. ` + qualifier;
const summaryCaveat = 'The full context also cautions that this analysis cannot establish results for every neighborhood.';
const longSummary = 'The study compares the proposed routes and the range of assumptions used to estimate their effects. '.repeat(14) + summaryCaveat;
const detailCaveat = 'The remaining uncertainty includes whether additional support would reach residents outside the proposed service area.';
const longDetail = 'The published estimates depend on ridership, operating costs, funding decisions, and connections to existing services. '.repeat(8) + detailCaveat;
const graphId = '00000000-0000-4000-8000-000000000001';
const result = createFixtureStartResponse({
  installationId: '00000000-0000-4000-8000-000000000099',
  graphId, headline,
});
if (result.kind !== 'atlas') throw new Error('Expected a saved fixture map.');
const snapshot = { ...result.snapshot,
  summary: 'The study sets out possible routes while identifying important limits to its estimates.',
  facts: [{ text: longFact, sourceIds: [source.id] }],
  uncertainties: ['The council has not approved funding.'], sources: [source],
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

type ResearchStream = { requests: number; push: (chunk: string) => void };

async function send(page: Page, display: ExplorationDisplay, complete = false) {
  await page.evaluate(frame => {
    (window as unknown as { fullResearchTest: ResearchStream }).fullResearchTest.push(`${JSON.stringify(frame)}\n`);
  }, { display, complete });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/stories', route => route.fulfill({ json: {
    ok: true, items: [story], fetchedAt: '2026-10-18T10:00:00Z', stale: false,
    warning: null, curated: true, complete: true,
  } }));
  await page.route('**/api/exploration', route => route.fulfill({ json: { display: emptyDisplay() } }));
  await page.route('https://api.openai.com/**', route => route.abort('blockedbyclient'));
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const probe: ResearchStream = { requests: 0, push: () => {} };
    Object.assign(window, { fullResearchTest: probe });
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (url.pathname !== '/api/exploration' || method !== 'POST') return originalFetch(input, init);
      probe.requests++;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) { probe.push = chunk => controller.enqueue(encoder.encode(chunk)); },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  });
});

async function openStory(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(headline.title) }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { fullResearchTest: ResearchStream }).fullResearchTest.requests)).toBe(1);
}

test('full research remains expandable with citations and stays expanded when the map arrives', async ({ page }) => {
  await openStory(page);
  await send(page, mapping);
  await expect(page.locator('.evidence-panel')).not.toHaveAttribute('open', '');
  await expect(page.locator('.evidence-panel .evidence-content')).toBeHidden();
  await page.locator('.evidence-panel summary').click();
  const fact = page.locator('.evidence-panel .evidence-list > li').first();
  const paragraph = fact.locator('.fact-text');
  const toggle = fact.getByRole('button');
  await expect(paragraph).toContainText('The council published an analysis');
  await expect(paragraph).not.toContainText(qualifier);
  expect((await paragraph.innerText()).length).toBeLessThanOrEqual(500);
  await expect(toggle).toHaveAccessibleName('Show full fact');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(fact.getByRole('link', { name: source.domain })).toHaveAttribute('href', source.url);
  await toggle.click();
  await expect(paragraph).toHaveText(longFact);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAccessibleName('Show less');
  const contentId = await toggle.getAttribute('aria-controls');
  await expect(paragraph).toHaveAttribute('id', contentId!);

  const node = await paragraph.elementHandle();
  await send(page, completed, true);
  await expect(page.locator('.possibility-card')).toHaveCount(result.nodes.length);
  await expect(paragraph).toHaveText(longFact);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toBeFocused();
  expect(await node!.evaluate(element => element === document.querySelector('.evidence-panel .fact-text'))).toBe(true);
  await expect(fact.getByRole('link', { name: source.domain })).toBeVisible();

  await toggle.click();
  await expect(paragraph).not.toContainText(qualifier);
  await expect(toggle).toHaveAccessibleName('Show full fact');
});

test('a changed fact starts with its own concise preview', async ({ page }) => {
  await openStory(page);
  await send(page, mapping);
  await page.locator('.evidence-panel summary').click();
  const fact = page.locator('.evidence-panel .evidence-list > li').first();
  await fact.getByRole('button', { name: 'Show full fact' }).click();
  await expect(fact.locator('.fact-text')).toHaveText(longFact);
  const revised = `The council revised the analysis. ${longFact}`;
  await send(page, { ...mapping, storyResearch: { phase: 'mapping', snapshot: {
    ...snapshot, facts: [{ text: revised, sourceIds: [source.id] }],
  } } });
  await expect(fact.locator('.fact-text')).toContainText('The council revised the analysis.');
  await expect(fact.getByRole('button', { name: 'Show full fact' })).toHaveAttribute('aria-expanded', 'false');
  await expect(fact.locator('.fact-text')).not.toContainText(qualifier);
});

test('long context and uncertainties retain their full detail through the saved map', async ({ page }) => {
  await openStory(page);
  const detailedSnapshot = { ...snapshot, summary: longSummary, uncertainties: [longDetail] };
  await send(page, { ...mapping, storyResearch: { phase: 'mapping', snapshot: detailedSnapshot } });
  await page.locator('.evidence-panel summary').click();
  const summary = page.locator('.story-summary');
  const uncertainty = page.locator('.evidence-panel .uncertainty-note .detail-list > li').first();
  await expect(summary.locator('.fact-text')).not.toContainText(summaryCaveat);
  expect((await summary.locator('.fact-text').innerText()).length).toBeLessThanOrEqual(900);
  await summary.getByRole('button', { name: 'Show full context' }).click();
  await expect(summary.locator('.fact-text')).toHaveText(longSummary);
  await expect(uncertainty.locator('.fact-text')).not.toContainText(detailCaveat);
  expect((await uncertainty.locator('.fact-text').innerText()).length).toBeLessThanOrEqual(500);
  await uncertainty.getByRole('button', { name: 'Show full detail' }).click();
  await expect(uncertainty.locator('.fact-text')).toHaveText(longDetail);

  await send(page, { ...completed, exploration: { ...completed.exploration!, snapshot: detailedSnapshot } }, true);
  await expect(page.locator('.possibility-card')).toHaveCount(result.nodes.length);
  await expect(summary.locator('.fact-text')).toHaveText(longSummary);
  await expect(summary.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  await expect(uncertainty.locator('.fact-text')).toHaveText(longDetail);
  await expect(uncertainty.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  expect(await page.locator('p p').count()).toBe(0);
});

test('full snapshot and follow-up facts fit a narrow screen with reduced motion', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page);
  await send(page, { ...completed, research: {
    kind: 'web_research', status: 'supported', question: 'What does the full study establish?',
    researchedAt: '2026-10-18T10:05:00Z', findings: snapshot.facts,
    implications: [longDetail], uncertainties: [longDetail], sources: [source],
  } }, true);
  await page.locator('.evidence-panel summary').click();
  const evidence = page.locator('.evidence-panel .evidence-list > li').first();
  const followup = page.locator('.research-update .evidence-list > li').first();
  for (const fact of [evidence, followup]) {
    await expect(fact.getByRole('button', { name: 'Show full fact' })).toBeVisible();
    await fact.getByRole('button', { name: 'Show full fact' }).click();
    await expect(fact.locator('.fact-text')).toHaveText(longFact);
    await expect(fact.getByRole('link', { name: source.domain })).toBeVisible();
  }
  for (const detail of [page.locator('.research-update .research-implications li'), page.locator('.research-update .uncertainty-note li')]) {
    await detail.getByRole('button', { name: 'Show full detail' }).click();
    await expect(detail.locator('.fact-text')).toHaveText(longDetail);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('expanded-full-research-mobile.png'), fullPage: true });
});

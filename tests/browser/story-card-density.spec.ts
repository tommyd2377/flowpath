import { expect, test, type Page } from '@playwright/test';
import { emptyDisplay } from '../../lib/visual-contracts';
import type { CuratedStory } from '../../lib/story-contracts';

const headline = {
  id: 'density-transit', title: 'Transit plan advances', publisher: 'Metro Journal',
  publisherUrl: 'https://metro.example/', googleNewsUrl: 'https://news.google.com/rss/articles/density-transit',
  publishedAt: '2026-10-19T09:00:00Z',
};
const brief: CuratedStory = {
  ...headline, summary: 'The council published a revised transit plan.',
  whyItMatters: 'Service changes could affect commuters.', scope: 'us',
  headlines: [headline, { ...headline, id: 'density-second-report', publisher: 'Regional News' }], contextSources: [],
};
const repeated: CuratedStory = {
  ...brief, id: 'density-repeated', title: 'Service review begins',
  summary: 'The service review starts next month.', whyItMatters: 'The service review starts next month!',
};
const long: CuratedStory = {
  ...brief, id: 'density-long', title: 'Council reviews a longer proposal for regional transit service',
  summary: 'The council published proposed schedules, routes, and funding assumptions for a regional transit plan. '
    + 'The report compares weekday trips, evening service, school travel, and links to existing routes. '
    + 'It also identifies areas where ridership estimates remain uncertain. '
    + 'No construction funding has been approved.',
  whyItMatters: 'Residents depend on the routes to reach work, school, and medical appointments. '
    + 'The proposal could change those connections, but estimated benefits depend on the final routes and funding. '
    + 'The report does not establish that every neighborhood would benefit.',
};
const items = [brief, repeated, long];
const catalog = { ok: true, items, fetchedAt: '2026-10-19T10:00:00Z', stale: false, warning: null, curated: true, complete: true };

type DensityProbe = { send: (event: object) => void; connected: boolean };

async function focusStory(page: Page, id: string) {
  await page.evaluate(({ id, display }) => {
    (window as unknown as { densityTest: DensityProbe }).densityTest.send({
      type: 'display', revision: 0, display: { ...display, spotlightStoryId: id },
    });
  }, { id, display: { ...emptyDisplay(), stories: items } });
  const card = page.locator(`[data-story-id="${id}"]`);
  await expect(card).toHaveAttribute('data-spotlight', 'true');
  await expect(card.locator('.card-copy')).toHaveCSS('opacity', '1');
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  return card;
}

async function openMockBriefing(page: Page) {
  await page.route('https://api.openai.com/**', route => route.abort('blockedbyclient'));
  await page.route('**/api/stories', route => route.fulfill({ json: catalog }));
  await page.route('**/api/exploration', route => route.fulfill({ json: { display: emptyDisplay() } }));
  await page.route('**/api/session/screen', route => route.fulfill({ status: 204 }));
  await page.route('**/api/session/action', route => route.fulfill({ status: 202, json: { ok: true } }));
  await page.route('**/api/session', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { ready: true } });
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
    return route.fulfill({ contentType: 'application/sdp', body: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' });
  });
  await page.addInitScript(() => {
    const probe: DensityProbe = { connected: false, send: () => {} };
    Object.assign(window, { densityTest: probe });
    const fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== '/api/session/events') return fetch(input, init);
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        probe.connected = true;
        probe.send = event => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
    const track = { enabled: true, stop() {}, clone: () => ({ enabled: true, stop() {} }) };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    class AudioNode { connect(node: unknown) { return node; } }
    class FakeAudioContext {
      state = 'running'; destination = {};
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createMediaStreamSource() { return new AudioNode(); }
      createGain() { return Object.assign(new AudioNode(), { gain: { value: 1 } }); }
      createAnalyser() { return Object.assign(new AudioNode(), {
        fftSize: 2048, getByteTimeDomainData: (bytes: Uint8Array) => bytes.fill(128),
        getFloatTimeDomainData: (values: Float32Array) => values.fill(0),
      }); }
    }
    class FakeAudio { setAttribute() {} play() { return Promise.resolve(); } pause() {} }
    class FakePeer {
      iceGatheringState = 'complete'; connectionState = 'new';
      onconnectionstatechange: (() => void) | null = null;
      ontrack: ((event: unknown) => void) | null = null;
      addTrack() {} setLocalDescription() { return Promise.resolve(); }
      createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0\r\n' }); }
      setRemoteDescription() {
        this.connectionState = 'connected'; this.onconnectionstatechange?.();
        this.ontrack?.({ streams: [stream], track }); return Promise.resolve();
      }
      close() { this.connectionState = 'closed'; }
    }
    Object.assign(window, { AudioContext: FakeAudioContext, Audio: FakeAudio, RTCPeerConnection: FakePeer });
  });
  await page.route('**/api/demo-access', route => route.fulfill({ json: { enabled: true, allowed: true } }));
  await page.goto('/');
  await expect(page.locator('.headline-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { densityTest: DensityProbe }).densityTest.connected)).toBe(true);
  await page.evaluate(() => (window as unknown as { densityTest: DensityProbe }).densityTest.send({ type: 'research', busy: false, message: '', revision: 0 }));
  await expect(page.locator('main')).toHaveAttribute('data-started', 'true');
}

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 768, height: 1024 }]) {
  test(`spoken story cards use their available context without empty space at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.setTimeout(45_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: viewport.width === 390 ? 'no-preference' : 'reduce' });
    await openMockBriefing(page);
    const wave = await page.locator('canvas').elementHandle();
    const first = await focusStory(page, brief.id);
    await expect(first.locator('.headline-summary')).toHaveText(brief.summary);
    await expect(first.locator('.headline-context')).toHaveText(brief.whyItMatters);
    await expect(first.getByText('The story', { exact: true })).toBeVisible();
    await expect(first.getByText('Why it matters', { exact: true })).toBeVisible();
    await expect(first.locator('small')).toContainText('2 reports');
    const bounds = (await first.boundingBox())!;
    expect(bounds.height).toBeLessThan(420);
    expect((await page.locator(`[data-story-id="${repeated.id}"]`).boundingBox())!.y).toBeLessThan(viewport.height);
    const metadata = (await first.locator('small').boundingBox())!;
    expect(metadata.y + metadata.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    await page.screenshot({ path: testInfo.outputPath('brief-story-density.png') });

    const duplicate = await focusStory(page, repeated.id);
    await expect(duplicate.locator('.headline-mobile-summary')).toHaveCount(0);
    await expect(duplicate.locator('.headline-context')).toHaveText(repeated.whyItMatters);
    expect((await duplicate.boundingBox())!.height).toBeLessThan(320);

    const detailed = await focusStory(page, long.id);
    await expect(detailed.locator('.headline-summary')).toHaveText(long.summary);
    await expect(detailed.locator('.headline-context')).toHaveText(long.whyItMatters);
    expect(await detailed.evaluate(element => element.scrollHeight <= element.clientHeight + 2)).toBe(true);
    await detailed.locator('small').scrollIntoViewIfNeeded();
    await expect(detailed.locator('small')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await wave!.evaluate(canvas => canvas === document.querySelector('canvas'))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('detailed-story-density.png') });
    await page.getByRole('button', { name: 'End conversation' }).click();
  });
}

test('desktop story focus retains the compact context and keyboard target', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMockBriefing(page);
  const card = await focusStory(page, brief.id);
  await expect(card.locator('.headline-mobile-summary')).not.toBeVisible();
  await expect(card.locator('.headline-context')).toHaveText(brief.whyItMatters);
  await expect(card.locator('.headline-context-label').last()).not.toBeVisible();
  await card.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(card).toBeFocused();
  expect(await card.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
  await page.getByRole('button', { name: 'End conversation' }).click();
});

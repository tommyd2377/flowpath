import { screenContextKey, type ScreenReport, type ScrollArgs } from '../../lib/screen-contracts';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createFixtureStartResponse } from '../../lib/atlas/server/fixtures';
import { emptyDisplay, type ExplorationDisplay } from '../../lib/visual-contracts';

const headlines = [
  { id: 'story-transit', title: 'City weighs a new transit plan', publisher: 'Metro Journal', publisherUrl: 'https://metro.example/', googleNewsUrl: 'https://news.google.com/rss/articles/transit', publishedAt: '2026-09-05T09:00:00Z' },
  { id: 'story-water', title: 'Regional water talks enter a new round', publisher: 'Regional News', publisherUrl: 'https://regional.example/', googleNewsUrl: 'https://news.google.com/rss/articles/water', publishedAt: '2026-09-05T08:00:00Z' },
  { id: 'story-energy', title: 'Energy storage project reaches a milestone', publisher: 'Energy Daily', publisherUrl: 'https://energy.example/', googleNewsUrl: 'https://news.google.com/rss/articles/energy', publishedAt: '2026-09-05T07:00:00Z' },
];
const stories = headlines.map((headline, index) => ({ ...headline,
  summary: 'Several reports describe an important development.', whyItMatters: 'The outcome could shape public policy and institutions.',
  scope: index === 0 ? 'us' as const : 'global' as const, headlines: [headline], contextSources: [],
}));
const catalog = { ok: true, items: stories, fetchedAt: '2026-09-05T10:00:00Z', stale: false, warning: null, curated: true };

function explorationDisplay(index = 0, revision = 1): ExplorationDisplay {
  const graphId = `00000000-0000-4000-8000-00000000000${index}`;
  const result = createFixtureStartResponse({ installationId: '00000000-0000-4000-8000-000000000099', graphId, headline: headlines[index] });
  if (result.kind !== 'atlas') throw new Error('Expected fixture story.');
  return { ...emptyDisplay(revision), headline: headlines[index], view: 'exploration', exploration: {
    kind: 'exploration', headline: headlines[index], graphId, snapshot: result.snapshot, currentNode: null, lineage: [], choices: result.nodes,
  } };
}

async function clickStory(page: Page, index: number) {
  const allStories = page.getByRole('button', { name: 'All stories', exact: true });
  if (await allStories.isVisible()) await allStories.click();
  await page.getByRole('button', { name: new RegExp(headlines[index].title) }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/session/screen', route => route.fulfill({ status: 204 }));
  await page.route('**/api/stories', (route) => route.fulfill({ json: catalog }));
  await page.route('**/api/exploration', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { selectedHeadline: null, display: emptyDisplay() } });
    const action = route.request().postDataJSON().action;
    const index = headlines.findIndex(headline => headline.id === action.storyId);
    return route.fulfill({ json: { display: explorationDisplay(Math.max(0, index)) } });
  });
  await page.route('**/api/session/action', async (route) => {
    if (route.request().postDataJSON().action.type === 'start_briefing') {
      await emitServer(page, { type: 'display', display: { ...emptyDisplay(), stories }, revision: 0 });
      await emitServer(page, { type: 'research', busy: false, message: '', revision: 0 });
    }
    await route.fulfill({ status: 202, json: { ok: true } });
  });
  await page.route('https://api.openai.com/**', (route) => route.abort('blockedbyclient'));
});

async function fakeAudio(page: Page, microphone: 'allowed' | 'denied' | 'pending' = 'allowed') {
  await page.addInitScript(({ microphone }) => {
    const tracker = {
      microphoneCalls: 0,
      microphoneEnabled: true,
      captureEnabled: true,
      stoppedOutgoingTracks: 0,
      stoppedTracks: 0,
      closedPeers: 0,
      closedContexts: 0,
      playedAudio: 0,
      createdAudio: 0,
      pausedAudio: 0,
      audioMuted: false,
      createdPeers: 0,
      sentEvents: [] as string[],
      eventConnections: 0,
      eventAborts: 0,
      releaseMicrophone: () => {},
      emit: (event: object) => { void event; },
      emitServer: (event: object) => { void event; },
      closeServer: () => {},
    };
    Object.assign(window, { voiceTest: tracker });
    // A real ReadableStream exercises the fetch/SSE parser without provider calls.
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== '/api/session/events') return nativeFetch(input, init);
      tracker.eventConnections++;
      const encoder = new TextEncoder();
      let open = true;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          tracker.emitServer = (event: object) => {
            if (open) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          };
          tracker.closeServer = () => {
            if (open) { open = false; controller.close(); }
          };
          const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
          const abort = () => {
            tracker.eventAborts++;
            if (open) { open = false; controller.error(new DOMException('Aborted', 'AbortError')); }
          };
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        },
        cancel() { open = false; },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    };
    const track = { stop: () => { tracker.stoppedTracks++; }, onended: null,
      get enabled() { return tracker.captureEnabled; },
      set enabled(value: boolean) { tracker.captureEnabled = value; tracker.microphoneEnabled = value; },
      clone: () => ({
        get enabled() { return tracker.microphoneEnabled; },
        set enabled(value: boolean) { tracker.microphoneEnabled = value; },
        stop: () => { tracker.stoppedOutgoingTracks++; },
      }),
    };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          tracker.microphoneCalls++;
          if (microphone === 'denied') throw new DOMException('Denied', 'NotAllowedError');
          if (microphone === 'pending') await new Promise<void>((resolve) => { tracker.releaseMicrophone = resolve; });
          return stream;
        },
      },
      configurable: true,
    });
    class AudioNode {
      connect(node: unknown) { return node; }
    }
    let inputActive = false, outputActive = false, playingId = '';
    tracker.emit = (value: object) => {
      if (!value || typeof value !== 'object') return;
      const event = value as { type: string; response_id?: string };
      if (event.type === 'media.input.active') inputActive = true;
      if (event.type === 'media.input.quiet') inputActive = false;
      if (event.type === 'media.output.active') { outputActive = true; playingId = event.response_id ?? ''; }
      if (['media.output.quiet', 'media.output.clear'].includes(event.type) && (!event.response_id || event.response_id === playingId)) outputActive = false;
    };
    let analyserIndex = 0;
    class FakeAudioContext {
      state = 'running';
      destination = {};
      resume() { return Promise.resolve(); }
      close() { this.state = 'closed'; tracker.closedContexts++; return Promise.resolve(); }
      createMediaStreamSource() { return new AudioNode(); }
      createGain() { return Object.assign(new AudioNode(), { gain: { value: 1 } }); }
      createAnalyser() {
        const output = analyserIndex++ % 2 === 1;
        return Object.assign(new AudioNode(), {
          fftSize: 2048,
          getByteTimeDomainData: (array: Uint8Array) => array.fill((output ? outputActive : inputActive) ? 144 : 128),
          getFloatTimeDomainData: (array: Float32Array) => {
            for (let i = 0; i < array.length; i++) array[i] = Math.sin(i / 16) * 0.075;
          },
        });
      }
    }
    class FakeAudio {
      constructor() { tracker.createdAudio++; }
      autoplay = false;
      srcObject: unknown = null;
      get muted() { return tracker.audioMuted; }
      set muted(value: boolean) { tracker.audioMuted = value; }
      setAttribute() {}
      play() { tracker.playedAudio++; return Promise.resolve(); }
      pause() { tracker.pausedAudio++; }
    }
    class FakePeer {
      constructor() { tracker.createdPeers++; }
      iceGatheringState = 'complete';
      connectionState = 'new';
      onconnectionstatechange: (() => void) | null = null;
      ontrack: ((event: unknown) => void) | null = null;
      channel = {
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: string }) => void) | null,
        onclose: null as (() => void) | null,
        close: () => { this.channel.onclose?.(); },
        send: (value: string) => { tracker.sentEvents.push(value); },
      };
      addTrack(outgoing: { enabled: boolean }) {
        Object.defineProperty(tracker, 'outgoingEnabled', { get: () => outgoing.enabled, configurable: true });
      }
      createDataChannel() { throw new Error('Live provider commands must stay server-side'); }
      createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }); }
      setLocalDescription() { return Promise.resolve(); }
      setRemoteDescription() {
        this.connectionState = 'connected';
        this.onconnectionstatechange?.();
        this.ontrack?.({ streams: [stream], track });
        this.channel.onopen?.();
        return Promise.resolve();
      }
      close() { this.connectionState = 'closed'; tracker.closedPeers++; this.onconnectionstatechange?.(); }
    }
    Object.assign(window, { AudioContext: FakeAudioContext, Audio: FakeAudio, RTCPeerConnection: FakePeer });
  }, { microphone });
}

async function mockSessions(page: Page, ready = true) {
  const calls: string[] = [];
  await page.route('**/api/session', async (route) => {
    const method = route.request().method();
    calls.push(method);
    if (method === 'GET') await route.fulfill({ json: { ready } });
    else if (method === 'DELETE') await route.fulfill({ status: 204 });
    else await route.fulfill({ contentType: 'application/sdp', body: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' });
  });
  // These browser tests must never contact a provider, even if app code changes.
  await page.route('https://api.openai.com/**', (route) => route.abort('blockedbyclient'));
  return calls;
}

test('an immediate voice restart waits for confirmed cleanup before requesting another connection', async ({ page }) => {
  await fakeAudio(page);
  const calls = await mockSessions(page);
  let finishCleanup!: () => void;
  const cleanup = new Promise<void>(resolve => { finishCleanup = resolve; });
  let closing = false;
  await page.route('**/api/session', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    calls.push('DELETE'); closing = true;
    await cleanup; await route.fulfill({ status: 204 });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await page.getByRole('button', { name: 'End conversation' }).click();
  await expect.poll(() => closing).toBe(true);
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.getByRole('button', { name: 'Cancel connection' })).toBeVisible();
  expect(calls).toEqual(['GET', 'POST', 'DELETE']);
  expect((await metrics(page)).microphoneCalls).toBe(1);
  finishCleanup();
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  expect(calls).toEqual(['GET', 'POST', 'DELETE', 'GET', 'POST']);
  await page.getByRole('button', { name: 'End conversation' }).click();
});

async function emit(page: Page, event: object) {
  await page.evaluate((event) => {
    (window as unknown as { voiceTest: { emit: (value: object) => void } }).voiceTest.emit(event);
  }, event);
}

async function emitServer(page: Page, event: object) {
  await expect.poll(() => page.evaluate(() => (window as unknown as {
    voiceTest: { eventConnections: number };
  }).voiceTest.eventConnections)).toBeGreaterThan(0);
  await page.evaluate((event) => (window as unknown as {
    voiceTest: { emitServer: (value: object) => void };
  }).voiceTest.emitServer(event), event);
}

async function mockStories(page: Page) {
  const selections: { headlineId: string; session: string | undefined; installation: string | undefined }[] = [];
  const revisions = new Map<string, number>();
  await page.route('**/api/session/story', async (route) => {
    const request = route.request();
    selections.push({
      headlineId: request.postDataJSON().headlineId,
      session: request.headers()['x-voice-session'],
      installation: request.headers()['x-voice-installation'],
    });
    const session = request.headers()['x-voice-session'];
    const revision = (revisions.get(session) ?? 0) + 1;
    revisions.set(session, revision);
    await route.fulfill({ status: 202, json: { ok: true, revision } });
  });
  return selections;
}

async function metrics(page: Page) {
  return page.evaluate(() => {
    const test = (window as unknown as { voiceTest: Record<string, number> }).voiceTest;
    return { microphoneCalls: test.microphoneCalls, stoppedTracks: test.stoppedTracks, closedPeers: test.closedPeers, closedContexts: test.closedContexts };
  });
}

test('iPhone opening sends silence before the briefing request and restores interruption after two seconds of playback', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  }));
  await page.clock.install();
  await fakeAudio(page);
  await mockSessions(page);
  const microphoneEnabled = () => page.evaluate(() => (window as unknown as {
    voiceTest: { outgoingEnabled: boolean };
  }).voiceTest.outgoingEnabled);
  let enabledAtRequest: boolean | undefined;
  await page.route('**/api/session/action', async route => {
    enabledAtRequest = await microphoneEnabled();
    await route.fulfill({ status: 202, json: { ok: true } });
    await emitServer(page, { type: 'research', busy: false, message: '', revision: 0 });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect.poll(() => enabledAtRequest).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { captureEnabled: boolean } }).voiceTest.captureEnabled)).toBe(true);
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 100);
  await emit(page, { type: 'backend.created', response: { id: 'opening' } });
  await emit(page, { type: 'backend.completed', response: { id: 'opening', status: 'completed', output: [{ content: [{ type: 'audio' }] }] } });
  expect(await microphoneEnabled()).toBe(false);
  await emit(page, { type: 'media.output.active', response_id: 'opening' });
  await page.clock.fastForward(50);
  await page.clock.fastForward(1999);
  expect(await microphoneEnabled()).toBe(false);
  await page.clock.fastForward(1);
  expect(await microphoneEnabled()).toBe(true);
  // The opening is still playing, but the user can already interrupt it.
  await emit(page, { type: 'media.input.active' });
  await emit(page, { type: 'media.output.clear', response_id: 'opening' });
  await page.clock.fastForward(1250);
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await emit(page, { type: 'media.input.quiet' });
  await emit(page, { type: 'backend.created', response: { id: 'next-story' } });
  await emit(page, { type: 'media.output.active', response_id: 'next-story' });
  await emit(page, { type: 'media.input.active' });
  await emit(page, { type: 'media.output.clear', response_id: 'next-story' });
  await page.clock.fastForward(1250);
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  expect(await microphoneEnabled()).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await metrics(page)).stoppedTracks).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { stoppedOutgoingTracks: number } }).voiceTest.stoppedOutgoingTracks)).toBe(1);
});

test('idle is quiet; missing setup never asks for the microphone or creates a call', async ({ page }) => {
  await fakeAudio(page);
  const calls = await mockSessions(page, false);
  await page.goto('/');
  await expect(page).toHaveTitle('The Voice');
  await expect(page.locator('.wordmark-news')).toHaveText('News');
  await expect(page.getByRole('button', { name: 'Start conversation' })).toHaveCount(1);
  await expect(page.locator('.headline-card')).toHaveCount(3);
  await expect(page.getByText('Presented by Thomas DeVito')).toBeVisible();
  expect(calls).toEqual([]);
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.getByRole('status')).toContainText('test key locally');
  expect(calls).toEqual(['GET']);
  expect((await metrics(page)).microphoneCalls).toBe(0);
  expect((await metrics(page)).closedContexts).toBe(1);
});

test('conversation follows actual playback, handles interruptions, and cleans up on Escape', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fakeAudio(page);
  const calls = await mockSessions(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { microphoneEnabled: boolean } }).voiceTest.microphoneEnabled)).toBe(true);
  await emit(page, { type: 'media.input.active' });
  await emit(page, { type: 'media.input.quiet' });
  await emitServer(page, { type: 'research', busy: true, message: 'Thinking…', revision: 0 });
  await expect(page.getByRole('status')).toHaveText('Thinking…');
  await emit(page, { type: 'backend.created', response: { id: 'r1' } });
  await emit(page, { type: 'media.output.active', response_id: 'r1' });
  await expect(page.locator('main')).toHaveClass(/phase-speaking/);
  await emit(page, { type: 'backend.completed', response: { id: 'r1', status: 'completed' } });
  await expect(page.locator('main')).toHaveClass(/phase-speaking/);
  await emit(page, { type: 'media.input.active' });
  await emit(page, { type: 'media.output.clear', response_id: 'r1' });
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await emit(page, { type: 'media.input.quiet' });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 0 });
  await emit(page, { type: 'backend.created', response: { id: 'r2' } });
  await emit(page, { type: 'media.output.active', response_id: 'r2' });
  await emit(page, { type: 'media.output.quiet', response_id: 'r1' });
  await expect(page.locator('main')).toHaveClass(/phase-speaking/);
  await emit(page, { type: 'media.output.quiet', response_id: 'r2' });
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Start conversation' })).toBeVisible();
  await expect.poll(() => calls.filter((method) => method === 'DELETE').length).toBe(1);
  await expect.poll(() => metrics(page)).toEqual({ microphoneCalls: 1, stoppedTracks: 1, closedPeers: 1, closedContexts: 1 });
  expect(errors).toEqual([]);
});

test('microphone denial leaves a useful recovery message and no API call', async ({ page }) => {
  await fakeAudio(page, 'denied');
  const calls = await mockSessions(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.getByRole('status')).toContainText('Microphone access is off');
  expect(calls).toEqual(['GET']);
  expect((await metrics(page)).closedContexts).toBe(1);
});

test('canceling during microphone setup stops a late stream without opening a call', async ({ page }) => {
  await fakeAudio(page, 'pending');
  const calls = await mockSessions(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect.poll(async () => (await metrics(page)).microphoneCalls).toBe(1);
  await page.getByRole('button', { name: 'Cancel connection' }).click();
  await page.evaluate(() => (window as unknown as { voiceTest: { releaseMicrophone: () => void } }).voiceTest.releaseMicrophone());
  await expect.poll(async () => (await metrics(page)).stoppedTracks).toBe(1);
  expect(calls).toEqual(['GET']);
  await expect(page.getByRole('button', { name: 'Start conversation' })).toBeVisible();
});

test('silence closes the conversation and releases the microphone', async ({ page }) => {
  await page.clock.install();
  await fakeAudio(page);
  const calls = await mockSessions(page);
  await page.goto('/');
  // The briefing's loading state suspends the idle clock until startup completes.
  const briefingReady = page.waitForResponse(response => response.url().endsWith('/api/session/action') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await briefingReady;
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await page.clock.runFor(1300);
  await page.clock.fastForward(45_100);
  await expect(page.locator('main')).toHaveClass(/phase-idle/);
  await expect(page.locator('.exploration-loading')).toHaveCount(0);
  await expect.poll(() => calls.filter((method) => method === 'DELETE').length).toBe(1);
  expect((await metrics(page)).stoppedTracks).toBe(1);
});

test('assistant playback suspends the silence cutoff until the audio actually finishes', async ({ page }) => {
  await page.clock.install();
  await fakeAudio(page);
  await mockSessions(page);
  await page.goto('/');
  // The briefing's loading state suspends the idle clock until startup completes.
  const briefingReady = page.waitForResponse(response => response.url().endsWith('/api/session/action') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await briefingReady;
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await emit(page, { type: 'media.output.active', response_id: 'long-answer' });
  await emit(page, { type: 'backend.completed', response: { id: 'long-answer', status: 'completed' } });
  await page.clock.runFor(100);
  await page.clock.fastForward(60_000);
  await expect(page.locator('main')).toHaveClass(/phase-speaking/);
  expect((await metrics(page)).stoppedTracks).toBe(0);
  await emit(page, { type: 'media.output.quiet', response_id: 'long-answer' });
  await page.clock.runFor(1_300);
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await page.clock.fastForward(45_100);
  await expect(page.locator('main')).toHaveClass(/phase-idle/);
  expect((await metrics(page)).stoppedTracks).toBe(1);
});

test('five-minute absolute session cutoff still applies while the user is speaking', async ({ page }) => {
  await page.clock.install();
  await fakeAudio(page);
  await mockSessions(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await emit(page, { type: 'media.input.active' });
  await page.clock.fastForward(180_100);
  expect((await metrics(page)).stoppedTracks).toBe(0);
  await page.clock.fastForward(120_000);
  await expect(page.locator('main')).toHaveClass(/phase-idle/);
  expect((await metrics(page)).stoppedTracks).toBe(1);
});

test('refresh gives the visitor a fresh five-minute session without inheriting elapsed time', async ({ page }) => {
  await page.clock.install();
  await fakeAudio(page);
  const calls = await mockSessions(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await emit(page, { type: 'media.input.active' });
  await page.clock.fastForward(180_100);
  await page.reload();
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await emit(page, { type: 'media.input.active' });
  await page.clock.fastForward(180_100);
  expect((await metrics(page)).stoppedTracks).toBe(0);
  await page.clock.fastForward(120_000);
  await expect(page.locator('main')).toHaveClass(/phase-idle/);
  expect((await metrics(page)).stoppedTracks).toBe(1);
  expect(calls.filter(method => method === 'POST')).toHaveLength(2);
});

test('mobile layout, footer links, and reduced motion stay usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fakeAudio(page);
  const calls = await mockSessions(page);
  await page.goto('/');
  const logo = page.locator('.wordmark-logo');
  const news = page.locator('.wordmark-news');
  await expect(logo).toHaveCSS('width', '145px');
  await expect(news).toHaveText('News');
  await expect(news).toHaveCSS('font-size', '10.875px');
  await expect(news).toHaveCSS('font-family', 'Manrope, system-ui, sans-serif');
  const logoBounds = (await logo.boundingBox())!;
  const newsBounds = (await news.boundingBox())!;
  expect(Math.abs(newsBounds.x + newsBounds.width / 2 - (logoBounds.x + logoBounds.width / 2))).toBeLessThan(1);
  expect(Math.abs(newsBounds.y - (logoBounds.y + 145 * .54 + 5))).toBeLessThan(1);
  await expect(page.getByRole('button', { name: 'Start conversation' })).toBeVisible();
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.getByRole('link')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const heart = page.locator('.heart');
  await expect(heart).toHaveCSS('color', 'rgb(226, 85, 85)');
  await expect(page.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/tommyd2377');
  await page.screenshot({ path: 'test-results/the-voice-mobile.png', fullPage: true });
  expect(calls).toEqual([]);
});

test('desktop preview contains a rendered waveform', async ({ page }) => {
  await fakeAudio(page);
  await mockSessions(page);
  await page.goto('/');
  await expect(page.locator('.wordmark-logo')).toHaveCSS('width', '160px');
  await expect(page.locator('.wordmark-news')).toHaveCSS('font-size', '12px');
  await expect.poll(() => page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(500);
  await page.screenshot({ path: 'test-results/the-voice-desktop.png', fullPage: true });
});

test('late response events never start an inactivity cutoff during speech', async ({ page }) => {
  await page.clock.install();
  await fakeAudio(page);
  await mockSessions(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await emit(page, { type: 'media.input.active' });
  await emit(page, { type: 'backend.created', response: { id: 'previous' } });
  await page.clock.fastForward(46_000);
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  expect((await metrics(page)).stoppedTracks).toBe(0);
  await page.keyboard.press('Escape');
});

test('invalid events are ignored and failed cleanup has an accurate message', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fakeAudio(page);
  await mockSessions(page);
  await page.route('**/api/session', async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 502, json: { error: 'Could not close' } });
    else await route.fallback();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await emit(page, null as unknown as object);
  await emit(page, {});
  await page.evaluate(() => document.addEventListener('keydown', event => {
    if (event.key === 'Escape') event.stopPropagation();
  }, { capture: true }));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status')).toContainText('disconnection could not be confirmed');
  expect((await metrics(page)).stoppedTracks).toBe(1);
  expect(errors).toEqual([]);
});

test('blocked cleanup is not misreported as a missing API key', async ({ page }) => {
  await fakeAudio(page);
  await mockSessions(page);
  await page.route('**/api/session', (route) => route.fulfill({ json: { ready: false, reason: 'cleanup_failed' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.getByRole('status')).toContainText('previous connection could not be closed');
  expect((await metrics(page)).microphoneCalls).toBe(0);
});


test('a rejected connection preserves its original error without a misleading cleanup attempt', async ({ page }) => {
  await fakeAudio(page);
  const calls: string[] = [];
  await page.route('**/api/session', async (route) => {
    const method = route.request().method();
    calls.push(method);
    if (method === 'GET') await route.fulfill({ json: { ready: true } });
    else await route.fulfill({ status: 403, json: { error: 'Only same-origin local requests are allowed.' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.getByRole('status')).toHaveText('Only same-origin local requests are allowed.');
  expect(calls).toEqual(['GET', 'POST']);
  expect((await metrics(page)).stoppedTracks).toBe(1);
});

test('keyboard story selection opens visual analysis without requesting a microphone', async ({ page }) => {
  await fakeAudio(page);
  const calls = await mockSessions(page);
  const selections = await mockStories(page);
  await page.goto('/');
  const selected = page.getByRole('button', { name: new RegExp(headlines[0].title) });
  await selected.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Story exploration' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Possible next steps' })).toBeVisible();
  await expect(page.getByRole('heading', { name: headlines[0].title, exact: true })).toBeVisible();
  expect(selections).toHaveLength(0);
  expect(calls).toEqual([]);
  expect((await metrics(page)).microphoneCalls).toBe(0);
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: 'Start conversation' })).toBeVisible();
  await page.getByRole('button', { name: 'All stories', exact: true }).click();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.getByRole('button', { name: 'End conversation' })).toBeVisible();
  await clickStory(page, 0);
  await expect.poll(() => selections.length).toBe(1);
  expect(selections[0].headlineId).toBe(headlines[0].id);
  expect(selections[0].session).toBeTruthy();
  expect(selections[0].installation).toBeTruthy();
  await expect(page.getByRole('region', { name: 'Story exploration' })).toBeVisible();
  expect(selections).toHaveLength(1);
  expect(calls.filter((method) => method === 'POST')).toHaveLength(1);
  await page.keyboard.press('Escape');
});

test('rapid story choices while microphone setup is pending only research the latest choice', async ({ page }) => {
  await fakeAudio(page, 'pending');
  const calls = await mockSessions(page);
  const selections = await mockStories(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await clickStory(page, 0);
  await expect.poll(async () => (await metrics(page)).microphoneCalls).toBe(1);
  await clickStory(page, 1);
  await clickStory(page, 2);
  expect(selections).toEqual([]);
  await page.evaluate(() => (window as unknown as { voiceTest: { releaseMicrophone: () => void } }).voiceTest.releaseMicrophone());
  await expect.poll(() => selections.map((selection) => selection.headlineId)).toEqual([headlines[2].id]);
  await emitServer(page, { type: 'display', revision: 1, display: { ...explorationDisplay(2), view: 'stories' } });
  await expect(page.getByRole('button', { name: new RegExp(headlines[2].title) })).toHaveAttribute('aria-pressed', 'true');
  expect(calls.filter((method) => method === 'POST')).toHaveLength(1);
  await page.keyboard.press('Escape');
});

test('restoration opens the grid on fresh visits and after returning home, preserving the saved story', async ({ page }, testInfo) => {
  await fakeAudio(page);
  const calls = await mockSessions(page);
  const installations: string[] = [];
  await page.route('**/api/exploration', async (route) => {
    installations.push(route.request().headers()['x-voice-installation']);
    await route.fulfill({ json: { selectedHeadline: headlines[1], display: explorationDisplay(1) } });
  });
  const selected = page.getByRole('button', { name: new RegExp(headlines[1].title) });
  const expectGrid = async () => {
    await expect(page.locator('.voice-page')).toHaveAttribute('data-view', 'stories');
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', { name: 'Story exploration' })).toHaveCount(0);
  };
  await page.goto('/');
  await expectGrid();
  expect((await metrics(page)).microphoneCalls).toBe(0);
  await selected.click();
  await expect(page.getByRole('heading', { name: 'Possible next steps' })).toBeVisible();
  // Refreshing an article starts at the grid, while its saved research remains available.
  await page.reload();
  await expectGrid();
  await selected.click();
  await expect(page.getByRole('heading', { name: 'Possible next steps' })).toBeVisible();
  await page.getByRole('button', { name: 'All stories', exact: true }).click();
  await expectGrid();
  await page.reload();
  await expectGrid();
  await expect(page.locator('.headline-card')).toHaveCount(headlines.length);
  await expect.poll(() => page.evaluate(() => document.getAnimations().every(animation => animation.playState !== 'running'))).toBe(true);
  await settledLayout(page);
  await page.screenshot({ path: testInfo.outputPath('refreshed-grid.png'), fullPage: true });
  await expect(page.getByRole('button', { name: 'Start conversation' })).toBeVisible();
  expect((await metrics(page)).microphoneCalls).toBe(0);
  expect(calls).toEqual([]);
  expect(installations.length).toBeGreaterThanOrEqual(2);
  expect(installations[0]).toBeTruthy();
  expect(new Set(installations).size).toBe(1);
  const selections = await mockStories(page);
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.getByRole('button', { name: 'End conversation' })).toBeVisible();
  expect(selections).toHaveLength(0);
  await expect(page.locator('.voice-page')).toHaveAttribute('data-view', 'stories');
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/session') && response.request().method() === 'DELETE'),
    page.keyboard.press('Escape'),
  ]);
  await page.unrouteAll({ behavior: 'wait' });
});

test('pending research survives silence beyond 45 seconds and inactivity resumes after research completes', async ({ page }) => {
  await page.clock.install();
  await fakeAudio(page);
  const calls = await mockSessions(page);
  await mockStories(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await clickStory(page, 0);
  await emitServer(page, { type: 'story', headlineId: headlines[0].id, revision: 1 });
  await emitServer(page, { type: 'research', busy: true, message: 'Checking the story’s sources…', revision: 1 });
  await expect(page.locator('#voice-status')).toHaveText('Checking the story’s sources…');
  await page.clock.fastForward(60_000);
  await expect(page.getByRole('button', { name: 'End conversation' })).toBeVisible();
  expect((await metrics(page)).stoppedTracks).toBe(0);
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await page.clock.fastForward(45_100);
  await expect(page.locator('main')).toHaveClass(/phase-idle/);
  expect((await metrics(page)).stoppedTracks).toBe(1);
  await expect.poll(() => calls.filter((method) => method === 'DELETE').length).toBe(1);
});

test('switching an active story keeps one voice session and rejects outdated research events', async ({ page }) => {
  await fakeAudio(page);
  const calls = await mockSessions(page);
  const selections = await mockStories(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await clickStory(page, 0);
  await expect.poll(() => selections.length).toBe(1);
  await emitServer(page, { type: 'story', headlineId: headlines[0].id, revision: 1 });
  await emitServer(page, { type: 'research', busy: true, message: 'Checking the transit story…', revision: 1 });
  await clickStory(page, 1);
  await expect.poll(() => selections.length).toBe(2);
  await emitServer(page, { type: 'story', headlineId: headlines[1].id, revision: 2 });
  await emitServer(page, { type: 'research', busy: true, message: 'Checking the water story…', revision: 2 });
  await expect(page.locator('#voice-status')).toHaveText('Checking the water story…');
  await emitServer(page, { type: 'research', busy: false, message: 'Old transit research finished.', revision: 1 });
  await emitServer(page, { type: 'story', headlineId: headlines[0].id, revision: 1 });
  await emitServer(page, { type: 'display', display: explorationDisplay(0, 1), revision: 1 });
  await expect(page.locator('#voice-status')).toHaveText('Checking the water story…');
  await expect(page.getByRole('heading', { name: headlines[1].title, exact: true })).toBeVisible();
  expect(calls.filter((method) => method === 'POST')).toHaveLength(1);
  expect((await metrics(page)).microphoneCalls).toBe(1);
  await page.keyboard.press('Escape');
  await emitServer(page, { type: 'research', busy: true, message: 'Late result after leaving.', revision: 3 });
  await expect(page.locator('#voice-status')).not.toContainText('Late result');
  await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '0');
});

test('initial stream snapshot cannot dismiss research before story selection is acknowledged', async ({ page }) => {
  await page.clock.install();
  await fakeAudio(page);
  await mockSessions(page);
  let requested = false;
  let release = () => {};
  const selectionResponse = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/session/story', async (route) => {
    requested = true;
    await selectionResponse;
    await route.fulfill({ status: 202, json: { ok: true, revision: 1 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await clickStory(page, 0);
  await expect.poll(() => requested).toBe(true);
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 0 });
  await expect(page.locator('#voice-status')).toHaveText('Looking into this story…');
  await page.clock.fastForward(60_000);
  expect((await metrics(page)).stoppedTracks).toBe(0);
  await emitServer(page, { type: 'research', busy: true, message: 'Verifying the selected story…', revision: 1 });
  await expect(page.locator('#voice-status')).toHaveText('Looking into this story…');
  await emitServer(page, { type: 'story', headlineId: headlines[0].id, revision: 1 });
  await expect(page.locator('#voice-status')).toHaveText('Verifying the selected story…');
  release();
  await page.keyboard.press('Escape');
});

test('a previous story cannot replace status while the next selection acknowledgement is delayed', async ({ page }) => {
  await fakeAudio(page);
  await mockSessions(page);
  await mockStories(page);
  let requested = false;
  let release = () => {};
  const selectionResponse = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/session/story', async (route) => {
    if (route.request().postDataJSON().headlineId !== headlines[1].id) return route.fallback();
    requested = true;
    await selectionResponse;
    await route.fulfill({ status: 202, json: { ok: true, revision: 2 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await clickStory(page, 0);
  await emitServer(page, { type: 'story', headlineId: headlines[0].id, revision: 1 });
  await emitServer(page, { type: 'research', busy: true, message: 'Checking transit…', revision: 1 });
  await expect(page.locator('#voice-status')).toHaveText('Checking transit…');
  await clickStory(page, 1);
  await expect.poll(() => requested).toBe(true);
  await emitServer(page, { type: 'research', busy: false, message: 'Transit analysis complete.', revision: 1 });
  await expect(page.locator('#voice-status')).toHaveText('Looking into this story…');
  await emitServer(page, { type: 'research', busy: true, message: 'Checking water…', revision: 2 });
  await expect(page.locator('#voice-status')).toHaveText('Looking into this story…');
  release();
  await expect(page.locator('#voice-status')).toHaveText('Checking water…');
  await page.keyboard.press('Escape');
});

test('provider events cannot control the browser; an application terminal event closes voice', async ({ page }) => {
  await fakeAudio(page);
  await mockSessions(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await emit(page, { type: 'error', error: { code: 'response_cancel_not_active', event_id: 'voice_cleanup_cancel' } });
  await emit(page, { type: 'error', error: { code: 'conversation_already_has_active_response' } });
  await expect(page.getByRole('button', { name: 'End conversation' })).toBeVisible();
  expect((await metrics(page)).stoppedTracks).toBe(0);
  await emitServer(page, { type: 'ended', error: true, message: 'The voice service reported a problem.' });
  await expect(page.locator('#voice-status')).toContainText('voice service reported a problem');
  expect((await metrics(page)).stoppedTracks).toBe(1);
});

test('fixture warning is visible and fixture readiness never opens the microphone', async ({ page }) => {
  await fakeAudio(page);
  const calls = await mockSessions(page, false);
  await page.route('**/api/stories', (route) => route.fulfill({ json: { ...catalog,
    warning: 'Fixture mode: these headlines and analyses are simulated.',
  } }));
  await page.route('**/api/session', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: { ready: false, reason: 'fixture' } }) : route.fallback());
  await page.goto('/');
  await expect(page.locator('#voice-status')).toContainText('headlines and analyses are simulated');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.locator('#voice-status')).toContainText('Fixture preview: voice is disabled');
  expect((await metrics(page)).microphoneCalls).toBe(0);
  expect(calls).toEqual([]);
});

test('lost research stream releases the microphone and permits a clean reconnection', async ({ page }) => {
  await fakeAudio(page);
  const calls = await mockSessions(page);
  await mockStories(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await clickStory(page, 0);
  await emitServer(page, { type: 'research', busy: true, message: 'Checking sources…', revision: 1 });
  await page.evaluate(() => (window as unknown as { voiceTest: { closeServer: () => void } }).voiceTest.closeServer());
  await expect(page.getByRole('button', { name: 'Start conversation' })).toBeVisible();
  await expect(page.locator('#voice-status')).toContainText(/connection|reconnect|interrupted/i);
  await expect(page.locator('.exploration-loading')).toHaveCount(0);
  await expect.poll(() => calls.filter((method) => method === 'DELETE').length).toBe(1);
  expect(await metrics(page)).toEqual({ microphoneCalls: 1, stoppedTracks: 1, closedPeers: 1, closedContexts: 1 });
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.getByRole('button', { name: 'End conversation' })).toBeVisible();
  expect((await metrics(page)).microphoneCalls).toBe(2);
  await page.keyboard.press('Escape');
});

test('microphone denial keeps the selected visual exploration available', async ({ page }) => {
  await fakeAudio(page, 'denied');
  const calls = await mockSessions(page);
  const selections = await mockStories(page);
  await page.goto('/');
  const card = page.getByRole('button', { name: new RegExp(headlines[0].title) });
  await card.click();
  await expect(page.getByRole('heading', { name: 'Possible next steps' })).toBeVisible();
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.getByRole('status')).toContainText('Microphone access is off');
  expect(selections).toEqual([]);
  expect(calls).toEqual(['GET']);
  await expect(page.getByRole('heading', { name: headlines[0].title, exact: true })).toBeVisible();
});

test('stories and dynamic exploration stay responsive without showing conversation transcripts', async ({ page, baseURL }) => {
  const remoteScripts: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'script' && new URL(request.url()).origin !== new URL(baseURL!).origin) remoteScripts.push(request.url());
  });
  await fakeAudio(page);
  await mockSessions(page);
  await mockStories(page);
  await page.goto('/');
  await expect(page.locator('.headline-card')).toHaveCount(3);
  for (const [width, expectedColumns] of [[390, 1], [800, 2], [1440, 3]]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.locator('.headline-grid').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length)).toBe(expectedColumns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const grid = await page.locator('.headline-grid').boundingBox();
  const footer = await page.locator('footer').boundingBox();
  expect(grid).not.toBeNull();
  expect(footer).not.toBeNull();
  expect(footer!.y).toBeGreaterThanOrEqual(grid!.y + grid!.height);
  await clickStory(page, 0);
  await expect(page.getByRole('heading', { name: 'Possible next steps' })).toBeVisible();
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await emitServer(page, { type: 'story', headlineId: headlines[0].id, revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await emit(page, { type: 'session.output_transcript.delta', delta: 'PRIVATE_ANALYSIS_SENTINEL' });
  await emit(page, { type: 'conversation.item.input_audio_transcription.completed', transcript: 'PRIVATE_USER_TRANSCRIPT_SENTINEL' });
  await expect(page.getByText('PRIVATE_ANALYSIS_SENTINEL')).toHaveCount(0);
  await expect(page.getByText('PRIVATE_USER_TRANSCRIPT_SENTINEL')).toHaveCount(0);
  await expect(page.getByRole('tree')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.locator('.evidence-panel')).not.toHaveAttribute('open', '');
  await page.locator('.evidence-panel summary').click();
  await expect(page.getByRole('link', { name: /source-a.example/ }).first()).toHaveAttribute('href', /https:\/\/source-a.example/);
  await expect(page.locator('[data-openui-devtools-auto-mount]')).not.toBeVisible();
  await expect(page.locator('[data-openui-devtools-root]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open OpenUI Inspect', exact: true })).toHaveCount(0);
  expect(remoteScripts).toEqual([]);
  await page.screenshot({ path: 'test-results/the-voice-exploration-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/the-voice-exploration-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 650));
  await expect.poll(() => page.locator('.voice-stage').evaluate(stage => Math.round(stage.getBoundingClientRect().top))).toBe(0);
  await page.keyboard.press('Escape');
});

test('voice can select a story and update its analysis without a headline click', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await fakeAudio(page);
  await mockSessions(page);
  const selections = await mockStories(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await emitServer(page, { type: 'story', headlineId: headlines[1].id, revision: 1 });
  const display = explorationDisplay(1);
  await emitServer(page, { type: 'display', display, revision: 1 });
  await expect(page.getByRole('heading', { name: headlines[1].title, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Possible next steps' })).toBeVisible();
  display.insight = { title: 'The wider implications', summary: 'If negotiations succeed, regional cooperation could deepen.', points: ['Timing will matter.'], assumptions: ['The agreement is implemented.'], signals: ['A signed schedule.'] };
  await emitServer(page, { type: 'display', display, revision: 1 });
  await expect(page.getByRole('heading', { name: 'The wider implications' })).toBeVisible();
  await expect(page.getByText('The agreement is implemented.', { exact: true })).toBeVisible();
  expect(selections).toEqual([]);
  await page.getByRole('button', { name: 'All stories', exact: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(headlines[1].title) })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('clicking paths and comparisons in a voice session uses the same server-owned exploration', async ({ page }) => {
  await fakeAudio(page);
  await mockSessions(page);
  const actions: Array<{ action: { type: string; nodeId?: string; nodeIds?: string[] }; headlineId: string }> = [];
  await page.route('**/api/session/action', async route => {
    if (route.request().postDataJSON().action.type === 'start_briefing') {
      await emitServer(page, { type: 'research', busy: false, message: '', revision: 0 });
    } else actions.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { ok: true } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await emitServer(page, { type: 'story', headlineId: headlines[0].id, revision: 1 });
  const display = explorationDisplay();
  await emitServer(page, { type: 'display', display, revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await page.getByRole('button', { name: 'Compare paths', exact: true }).click();
  await expect.poll(() => actions.length).toBe(1);
  expect(actions[0]).toEqual({ action: { type: 'compare_paths', nodeIds: display.exploration!.choices!.map(node => node.id) }, headlineId: headlines[0].id });
  display.exploration!.comparison = display.exploration!.choices!.map(node => ({ node, lineage: [node] }));
  await emitServer(page, { type: 'display', display, revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await expect(page.getByRole('heading', { name: 'How the possibilities differ' })).toBeVisible();
  await page.screenshot({ path: 'test-results/the-voice-comparison.png', fullPage: true });
  const chosen = display.exploration!.choices![0];
  await page.locator('.comparison-card').first().getByRole('button', { name: 'Explore this path' }).click();
  await expect.poll(() => actions.length).toBe(2);
  expect(actions[1]).toEqual({ action: { type: 'choose_path', nodeId: chosen.id }, headlineId: headlines[0].id });
  display.exploration = { ...display.exploration!, comparison: undefined, currentNode: chosen, lineage: [chosen], choices: [] };
  await emitServer(page, { type: 'display', display, revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await expect(page.getByRole('region', { name: 'Current possibility' })).toBeVisible();
  await expect(page.getByText('Depth 1 / 5', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back one step', exact: true }).click();
  await expect.poll(() => actions.length).toBe(3);
  expect(actions[2]).toEqual({ action: { type: 'navigate_path', target: 'parent' }, headlineId: headlines[0].id });
  await emitServer(page, { type: 'display', display: explorationDisplay(), revision: 1 });
  await expect(page.getByText('Depth 0 / 5', { exact: true })).toHaveCount(0);
  expect((await metrics(page)).microphoneCalls).toBe(1);
  await page.keyboard.press('Escape');
});

test('click-only exploration reaches all five levels and survives reload without voice', async ({ page }) => {
  await fakeAudio(page);
  const calls = await mockSessions(page);
  let display = explorationDisplay();
  let selected = false;
  let analysisCalls = 0;
  await page.route('**/api/exploration', async route => {
    if (route.request().method() === 'POST') {
      const { action } = route.request().postDataJSON();
      if (action.type === 'select_story' && !selected) { selected = true; analysisCalls++; }
      if (action.type === 'choose_path') {
        const node = display.exploration!.choices!.find(choice => choice.id === action.nodeId);
        expect(node).toBeTruthy();
        const choices = node!.depth === 5 ? [] : explorationDisplay().exploration!.choices!.map(choice => ({ ...choice, id: randomUUID(), parentId: node!.id, depth: (node!.depth + 1) as 1 | 2 | 3 | 4 | 5 }));
        display = { ...display, exploration: { ...display.exploration!, currentNode: { ...node!, childIds: choices.map(choice => choice.id), leafReason: node!.depth === 5 ? 'The final saved level.' : null }, lineage: [...display.exploration!.lineage!, node!], choices } };
        analysisCalls++;
      }
    }
    await route.fulfill({ json: { selectedHeadline: selected ? headlines[0] : null, display: selected ? display : emptyDisplay() } });
  });
  await page.goto('/');
  await clickStory(page, 0);
  await expect(page.getByRole('heading', { name: 'Possible next steps' })).toBeVisible();
  for (let depth = 1; depth <= 5; depth++) {
    await page.locator('.possibility-card').first().click();
    await expect(page.getByText(`Depth ${depth} / 5`, { exact: true })).toBeVisible();
  }
  await expect(page.locator('.possibility-card')).toHaveCount(0);
  await expect(page.getByText('The final saved level.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: new RegExp(headlines[0].title) })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Story exploration' })).toHaveCount(0);
  await clickStory(page, 0);
  await expect(page.getByText('Depth 5 / 5', { exact: true })).toBeVisible();
  expect(analysisCalls).toBe(6);
  expect(calls).toEqual([]);
  expect((await metrics(page)).microphoneCalls).toBe(0);
});

test('the real local route accepts its public origin without creating a provider session', async ({ request, baseURL }) => {
  // Invalid SDP stops before the provider request, even with a funded key configured.
  const response = await request.post('/api/session', {
    headers: { Origin: new URL(baseURL!).origin, 'Content-Type': 'application/sdp' },
    data: 'invalid-offer',
  });
  expect([400, 503]).toContain(response.status());
  const wrongOrigin = await request.post('/api/session', {
    headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/sdp' },
    data: 'invalid-offer',
  });
  expect(wrongOrigin.status()).toBe(403);
  // A random nonmatching local id never hangs up someone else's active call.
  const end = await request.delete('/api/session', {
    headers: { Origin: new URL(baseURL!).origin, 'X-Voice-Session': randomUUID() },
  });
  expect(end.status()).toBe(204);
});

async function audioLifetime(page: Page) {
  return page.evaluate(() => {
    const tracker = (window as unknown as { voiceTest: {
      createdAudio: number; pausedAudio: number; createdPeers: number; eventConnections: number; sentEvents: string[];
    } }).voiceTest;
    return { createdAudio: tracker.createdAudio, pausedAudio: tracker.pausedAudio, createdPeers: tracker.createdPeers,
      eventConnections: tracker.eventConnections, sentEvents: tracker.sentEvents };
  });
}

async function settledLayout(page: Page) {
  let previous = '';
  let stable = 0;
  await expect.poll(async () => {
    const layout = await page.locator('.voice-stage, .story-overview, .possibility-card, .comparison-card, .scenario-detail').evaluateAll(elements =>
      JSON.stringify(elements.map(element => {
        const box = element.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height].map(value => Math.round(value * 10) / 10);
      })));
    stable = layout === previous ? stable + 1 : 0;
    previous = layout;
    return stable;
  }, { intervals: [120], timeout: 8000 }).toBeGreaterThanOrEqual(2);
}

async function captureMotion(page: Page, name: string, fullPage = false) {
  await mkdir('/private/tmp/the-voice-motion-qa', { recursive: true });
  await page.screenshot({ path: `/private/tmp/the-voice-motion-qa/${name}.png`, fullPage, animations: 'allow' });
}

async function assertVisibleDashboard(page: Page) {
  const stage = await page.locator('.voice-stage').boundingBox();
  const currentPath = page.locator('.scenario-detail');
  const dashboard = await (await currentPath.count() ? currentPath : page.locator('.exploration-section')).boundingBox();
  // The full-height canvas intentionally extends beyond its compact button.
  const waveform = await page.locator('.wave-control').boundingBox();
  expect(stage).not.toBeNull();
  expect(dashboard).not.toBeNull();
  expect(waveform).not.toBeNull();
  expect(dashboard!.y).toBeGreaterThanOrEqual(stage!.y + stage!.height - 2);
  expect(dashboard!.y).toBeLessThan(page.viewportSize()!.height * 0.6);
  expect(waveform!.width).toBeGreaterThan(200);
  expect(waveform!.height).toBeGreaterThan(40);
  expect(waveform!.y + waveform!.height).toBeLessThanOrEqual(stage!.y + stage!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('motion continuity: spoken selection and slow research never replace or pause the voice transport', async ({ page }) => {
  await page.clock.install();
  // Playwright advances JS time/RAF but not document.timeline. Motion copies its
  // JS timestamp into WAAPI startTime, scheduling native exits 60 seconds ahead.
  // Exercise its JS fallback on the same fake clock for this timer test only;
  // the desktop and rapid-navigation tests below retain native animations.
  await page.addInitScript(() => { Reflect.deleteProperty(Element.prototype, 'animate'); });
  await fakeAudio(page);
  const calls = await mockSessions(page);
  const selections = await mockStories(page);
  await page.goto('/');
  const canvas = await page.locator('canvas').elementHandle();
  const wave = page.getByRole('button', { name: 'Start conversation' });
  await wave.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await emit(page, { type: 'backend.created', response: { id: 'story-introduction' } });
  await emit(page, { type: 'media.output.active', response_id: 'story-introduction' });
  await emitServer(page, { type: 'story', headlineId: headlines[0].id, revision: 1 });
  await emitServer(page, { type: 'display', revision: 1, display: {
    ...emptyDisplay(1), headline: headlines[0], view: 'exploration', stories,
  } });
  await emitServer(page, { type: 'research', busy: true, message: 'Gathering fuller context…', revision: 1 });
  await expect(page.getByRole('heading', { name: headlines[0].title, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Story exploration' }).getByText(stories[0].summary, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'End conversation' })).toBeFocused();
  await expect(page.locator('main')).toHaveClass(/phase-speaking/);
  expect(await canvas!.evaluate(node => node === document.querySelector('canvas'))).toBe(true);

  // Speech can finish while research is still pending without starting the silence cutoff.
  await emit(page, { type: 'backend.completed', response: { id: 'story-introduction', status: 'completed' } });
  await emit(page, { type: 'media.output.quiet', response_id: 'story-introduction' });
  await page.clock.fastForward(60_000);
  await expect(page.getByRole('button', { name: 'End conversation' })).toBeVisible();
  await emitServer(page, { type: 'display', display: explorationDisplay(), revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await expect(page.getByRole('heading', { name: 'Possible next steps' })).toBeVisible();
  await emit(page, { type: 'media.output.active', response_id: 'researched-answer' });
  await page.getByRole('button', { name: 'All stories', exact: true }).click();
  await expect(page.locator('.headline-grid')).toBeVisible();
  await clickStory(page, 0);
  await expect(page.getByRole('region', { name: 'Story exploration' })).toBeVisible();
  await expect(page.locator('main')).toHaveClass(/phase-speaking/);
  expect(await canvas!.evaluate(node => node === document.querySelector('canvas'))).toBe(true);
  expect(await metrics(page)).toEqual({ microphoneCalls: 1, stoppedTracks: 0, closedPeers: 0, closedContexts: 0 });
  expect(await audioLifetime(page)).toEqual({ createdAudio: 1, pausedAudio: 0, createdPeers: 1, eventConnections: 1, sentEvents: [] });
  expect(calls.filter(method => method === 'POST')).toHaveLength(1);
  expect(selections).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await audioLifetime(page)).pausedAudio).toBe(1);
});

test('motion desktop: story expansion, comparison and backtracking preserve layout and disclosure state', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await fakeAudio(page);
  await mockSessions(page);
  await page.goto('/');
  await expect(page.locator('.headline-card')).toHaveCount(3);
  await settledLayout(page);
  const gridStageHeight = (await page.locator('.voice-stage').boundingBox())!.height;
  await captureMotion(page, 'desktop-1440-grid');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await emit(page, { type: 'media.output.active', response_id: 'explore-aloud' });
  await emitServer(page, { type: 'story', headlineId: headlines[0].id, revision: 1 });
  const display = explorationDisplay();
  // Sample actual intermediate geometry while the React layout changes.
  const sample = page.evaluate(async () => {
    const canvas = document.querySelector('canvas')!;
    const context = canvas.getContext('2d')!;
    const heights: number[] = [];
    const resized: Array<{ height: number; visiblePixels: boolean }> = [];
    // Read after resize observers: resetting the backing buffer must not leave a
    // blank frame between the canvas resize callback and the next animation frame.
    const observer = new ResizeObserver(() => queueMicrotask(() => {
      const width = Math.min(96, canvas.width);
      const height = Math.min(192, canvas.height);
      const pixels = context.getImageData(Math.floor((canvas.width - width) / 2), Math.floor((canvas.height - height) / 2), width, height).data;
      resized.push({ height: document.querySelector('.voice-stage')!.getBoundingClientRect().height,
        visiblePixels: pixels.some((value, index) => index % 4 === 3 && value > 0) });
    }));
    observer.observe(canvas);
    const until = performance.now() + 900;
    while (performance.now() < until) {
      heights.push(document.querySelector('.voice-stage')!.getBoundingClientRect().height);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    observer.disconnect();
    return { heights, resized };
  });
  await emitServer(page, { type: 'display', display, revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await captureMotion(page, 'desktop-1440-opening-mid');
  const { heights, resized } = await sample;
  await settledLayout(page);
  const detailStageHeight = (await page.locator('.voice-stage').boundingBox())!.height;
  expect(detailStageHeight).toBeLessThan(gridStageHeight - 20);
  expect(heights.some(height => height < gridStageHeight - 2 && height > detailStageHeight + 2)).toBe(true);
  const intermediateResizes = resized.filter(sample => sample.height < gridStageHeight - 2 && sample.height > detailStageHeight + 2);
  expect(resized.every(sample => sample.visiblePixels)).toBe(true);
  expect(intermediateResizes.every(sample => sample.visiblePixels)).toBe(true);
  await assertVisibleDashboard(page);
  await captureMotion(page, 'desktop-1440-detail', true);

  const evidence = page.locator('.evidence-panel');
  const disclosure = evidence.locator('summary');
  await expect(evidence).not.toHaveAttribute('open', '');
  await disclosure.click();
  await expect(evidence).toHaveAttribute('open', '');
  await disclosure.click();
  await disclosure.focus();
  await expect(evidence).not.toHaveAttribute('open', '');
  const evidenceNode = await evidence.elementHandle();
  display.insight = { title: 'The wider implications', summary: 'Public policy choices could shape institutions and daily life.',
    points: ['The pace of implementation matters.'], assumptions: ['The proposal remains under discussion.'], signals: ['An announced schedule.'] };
  await emitServer(page, { type: 'display', display, revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await expect(page.getByRole('heading', { name: 'The wider implications' })).toBeVisible();
  expect(await evidenceNode!.evaluate(node => node === document.querySelector('.evidence-panel'))).toBe(true);
  await expect(evidence).not.toHaveAttribute('open', '');
  await expect(disclosure).toBeFocused();

  await page.getByRole('button', { name: 'Compare paths', exact: true }).click();
  display.exploration!.comparison = display.exploration!.choices!.slice(0, 2).map(node => ({ node, lineage: [node] }));
  await emitServer(page, { type: 'display', display, revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await expect(page.getByRole('heading', { name: 'How the possibilities differ' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await settledLayout(page);
  const comparisonBoxes = await page.locator('.comparison-card').evaluateAll(cards => cards.map(card => {
    const box = card.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width };
  }));
  expect(comparisonBoxes).toHaveLength(2);
  expect(Math.abs(comparisonBoxes[0].y - comparisonBoxes[1].y)).toBeLessThan(2);
  expect(comparisonBoxes[1].x).toBeGreaterThanOrEqual(comparisonBoxes[0].x + comparisonBoxes[0].width);
  await captureMotion(page, 'desktop-1440-comparison', true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await settledLayout(page);
  await assertVisibleDashboard(page);
  const focusedComparison = await page.locator('.comparison-card').first().boundingBox();
  expect(focusedComparison!.y + 120).toBeLessThan(720);
  await captureMotion(page, 'desktop-1280-comparison');

  const chosen = display.exploration!.choices![0];
  await page.locator('.comparison-card').first().getByRole('button', { name: 'Explore this path' }).click();
  display.insight = null;
  display.exploration = { ...display.exploration!, comparison: undefined, currentNode: chosen, lineage: [chosen], choices: [] };
  await emitServer(page, { type: 'display', display, revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await expect(page.getByRole('region', { name: 'Current possibility' })).toBeVisible();
  await settledLayout(page);
  await assertVisibleDashboard(page);
  const focusedPossibility = await page.locator('.scenario-detail').boundingBox();
  expect(focusedPossibility!.y + 120).toBeLessThan(720);
  await captureMotion(page, 'desktop-1280-path');
  await page.setViewportSize({ width: 1440, height: 900 });
  await settledLayout(page);
  await captureMotion(page, 'desktop-1440-path', true);

  const next = { ...chosen, id: randomUUID(), parentId: chosen.id, depth: 2 as const, title: 'Implementation enters a second phase' };
  display.exploration = { ...display.exploration!, currentNode: next, lineage: [chosen, next], choices: [] };
  await emitServer(page, { type: 'display', display, revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await expect(page.getByText('Depth 2 / 5', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back one step', exact: true }).click();
  display.exploration = { ...display.exploration!, currentNode: chosen, lineage: [chosen], choices: [] };
  await emitServer(page, { type: 'display', display, revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await expect(page.getByText('Depth 1 / 5', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Original story', exact: true }).click();
  await emitServer(page, { type: 'display', display: explorationDisplay(), revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await expect(page.getByText('Depth 0 / 5', { exact: true })).toHaveCount(0);
  const allStories = page.getByRole('button', { name: 'All stories', exact: true });
  await allStories.focus();
  await page.keyboard.press('Enter');
  const selectedCard = page.getByRole('button', { name: new RegExp(headlines[0].title) });
  await expect(selectedCard).toHaveAttribute('aria-pressed', 'true');
  await expect(selectedCard).toBeFocused();
  await settledLayout(page);
  expect((await page.locator('.voice-stage').boundingBox())!.height).toBeCloseTo(detailStageHeight, 0);
  await captureMotion(page, 'desktop-1440-returned-grid');
  expect((await audioLifetime(page)).pausedAudio).toBe(0);
  expect(errors).toEqual([]);
  await page.keyboard.press('Escape');
});

test('motion responsive: twenty stories, long titles and reduced motion fit desktop and mobile', async ({ page }) => {
  test.setTimeout(60_000);
  await fakeAudio(page);
  const calls = await mockSessions(page);
  const expandedStories = [...stories, ...Array.from({ length: 17 }, (_, index) => ({
    ...stories[index % stories.length], id: `story-additional-${index}`,
    title: `Global institutions consider a coordinated response as policymakers evaluate a changing economic outlook and its consequences — briefing ${index + 4}`,
  }))];
  await page.route('**/api/stories', route => route.fulfill({ json: { ...catalog, items: expandedStories } }));
  await page.goto('/');
  await expect(page.locator('.headline-card')).toHaveCount(20);
  for (const [width, height] of [[1280, 720], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await settledLayout(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await captureMotion(page, `desktop-${width}-twenty-stories`);
    await clickStory(page, 0);
    await expect(page.getByRole('heading', { name: 'Possible next steps' })).toBeVisible();
    await settledLayout(page);
    await assertVisibleDashboard(page);
    await captureMotion(page, `desktop-${width}-detail`);
    await page.getByRole('button', { name: 'All stories', exact: true }).click();
    await expect(page.locator('.headline-card')).toHaveCount(20);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settledLayout(page);
  await captureMotion(page, 'mobile-390-reduced-grid');
  const originalCanvas = await page.locator('canvas').elementHandle();
  await clickStory(page, 0);
  await expect(page.getByRole('heading', { name: 'Possible next steps' })).toBeVisible();
  await settledLayout(page);
  await assertVisibleDashboard(page);
  await expect(page.locator('.possibility-grid')).toHaveCSS('grid-template-columns', /^[\d.]+px$/);
  await captureMotion(page, 'mobile-390-reduced-detail', true);
  expect(await originalCanvas!.evaluate(node => node === document.querySelector('canvas'))).toBe(true);
  const transforms = await page.locator('[data-motion-section]').evaluateAll(sections => sections.map(section => getComputedStyle(section).transform));
  expect(transforms.every(value => value === 'none' || value === 'matrix(1, 0, 0, 1, 0, 0)')).toBe(true);
  await expect(page.getByRole('button', { name: 'Start conversation' })).toBeVisible();
  expect(calls).toEqual([]);
  expect((await metrics(page)).microphoneCalls).toBe(0);
});


test('motion rapid navigation: native transitions stay clickable through interrupted view changes', async ({ page }) => {
  await fakeAudio(page);
  const calls = await mockSessions(page);
  const selections = await mockStories(page);
  await page.goto('/');
  expect(await page.evaluate(() => typeof Element.prototype.animate)).toBe('function');
  const canvas = await page.locator('canvas').elementHandle();
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await emit(page, { type: 'media.output.active', response_id: 'continuous-discussion' });
  // Reverse the view as soon as its controls become available, while its shared
  // layout transition may still be running. No fake clock or forced clicks.
  for (let pass = 0; pass < 4; pass++) {
    const index = pass % headlines.length;
    const revision = pass + 1;
    await emitServer(page, { type: 'story', headlineId: headlines[index].id, revision });
    await emitServer(page, { type: 'display', display: explorationDisplay(index, revision), revision });
    await expect(page.getByRole('heading', { name: headlines[index].title, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'All stories', exact: true }).click();
    const selected = page.getByRole('button', { name: new RegExp(headlines[index].title) });
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await selected.click();
    await expect(page.getByRole('region', { name: 'Story exploration' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'All stories', exact: true }).click();
  await expect(page.locator('.dashboard-view[aria-hidden="true"]')).toHaveCount(0);
  await settledLayout(page);
  const selected = page.getByRole('button', { name: new RegExp(headlines[0].title) });
  const hitIsSelected = await selected.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  });
  expect(hitIsSelected).toBe(true);
  expect(await canvas!.evaluate(node => node === document.querySelector('canvas'))).toBe(true);
  expect((await audioLifetime(page)).pausedAudio).toBe(0);
  expect((await metrics(page)).microphoneCalls).toBe(1);
  expect(calls.filter(method => method === 'POST')).toHaveLength(1);
  expect(selections).toEqual([]);
  await captureMotion(page, 'desktop-native-rapid-return');
  await page.keyboard.press('Escape');
});


test('desktop voice opening glides upward without resizing the canvas and spotlights spoken headlines', async ({ page }, testInfo) => {
  const titles = [
    'Negotiators meet for renewed peace talks as a diplomatic deadline approaches',
    'Shipping disruption raises questions about global energy supplies',
    'Regional election result opens a new round of coalition negotiations',
    'Humanitarian agencies seek wider access as regional tensions grow',
    'European and U.S. envoys discuss a new framework for security cooperation',
    'Public health officials coordinate a response to a growing outbreak',
    'Flood recovery brings infrastructure and climate preparedness into focus',
    'Court considers a case that could shape the next federal election',
    'Financial support package puts the outlook for global growth in focus',
  ];
  const nine = titles.map((title, i) => ({ ...stories[i % 3], id: `briefing-story-${i}`, title,
    whyItMatters: 'The outcome could influence public policy, trade and daily life. The next steps depend on negotiations and the evidence still emerging.' }));
  await page.route('**/api/stories', route => route.fulfill({ json: { ...catalog, items: nine } }));
  const actions: string[] = [];
  await page.route('**/api/session/action', async route => {
    actions.push(route.request().postDataJSON().action.type);
    await emitServer(page, { type: 'display', display: { ...emptyDisplay(), stories: nine }, revision: 0 });
    await emitServer(page, { type: 'research', busy: false, message: '', revision: 0 });
    await route.fulfill({ status: 202, json: { ok: true } });
  });
  await fakeAudio(page);
  await mockSessions(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('.headline-card')).toHaveCount(9);
  await expect(page.locator('.voice-stage')).toHaveCSS('height', '1000px');
  const opening = (await page.locator('.wave-control').boundingBox())!;
  expect((await page.locator('canvas').boundingBox())!.height).toBeCloseTo(opening.height, 0);
  expect(opening.y).toBeGreaterThan(150);
  expect(opening.y + opening.height / 2).toBeLessThan(500);
  await page.evaluate(() => Object.assign(window, { originalCanvas: document.querySelector('canvas') }));
  await page.screenshot({ path: testInfo.outputPath('desktop-opening.png') });
  expect((await metrics(page)).microphoneCalls).toBe(0);
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect.poll(() => actions).toEqual(['start_briefing']);
  await expect(page.locator('.wordmark')).toHaveCSS('opacity', '0');
  await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '0');
  await expect(page.locator('.ai-note')).toHaveCount(0);
  await expect.poll(async () => (await page.locator('.wave-control').boundingBox())!.y).toBeLessThan(8);
  const docked = (await page.locator('.wave-control').boundingBox())!;
  expect(docked.width).toBeCloseTo(opening.width, 0);
  expect(docked.height).toBeCloseTo(opening.height * 0.6, 0);
  expect((await page.locator('canvas').boundingBox())!.height).toBeCloseTo(opening.height, 0);
  expect(await page.evaluate(() => document.querySelector('canvas') === (window as unknown as { originalCanvas: Element }).originalCanvas)).toBe(true);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1710, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await emitServer(page, { type: 'display', display: { ...emptyDisplay(), stories: nine, spotlightStoryId: null }, revision: 0 });
    await expect.poll(async () => (await page.locator('.headline-card').last().boundingBox())!.y).toBeLessThan(viewport.height);
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    const unfocused = (await page.locator('.headline-card').nth(7).boundingBox())!;
    await emit(page, { type: 'media.output.active', response_id: 'spoken-eighth' });
    await emitServer(page, { type: 'display', display: { ...emptyDisplay(), stories: nine, spotlightStoryId: nine[7].id }, revision: 0 });
    await expect(page.locator('[data-spotlight="true"]')).toHaveCount(1);
    await expect(page.locator('[data-spotlight="true"]')).toHaveAttribute('data-story-id', nine[7].id);
    await expect.poll(async () => (await page.locator('.headline-card').nth(7).boundingBox())!.width).toBeGreaterThan(unfocused.width);
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    const boxes = await page.locator('.headline-card').evaluateAll(cards => cards.map(card => {
      const box = card.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height, clipped: card.scrollHeight > card.clientHeight + 2 };
    }));
    expect(boxes.every(box => !box.clipped)).toBe(true);
    expect(boxes[8].bottom).toBeLessThanOrEqual(viewport.height - 4);
    expect(boxes[0].top).toBeGreaterThanOrEqual((await page.locator('.voice-stage').boundingBox())!.height);
    expect(await page.locator('.headline-card').nth(7).getAttribute('aria-pressed')).toBe('false');
    expect((await metrics(page)).microphoneCalls).toBe(1);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: testInfo.outputPath(`desktop-briefing-${viewport.width}.png`) });
  }
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await metrics(page)).stoppedTracks).toBe(1);
  await page.reload();
  await expect(page.locator('.voice-page')).toHaveAttribute('data-started', 'false');
  expect((await metrics(page)).microphoneCalls).toBe(0);
});

test('desktop briefing follows offscreen stories without moving keyboard focus, and respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const twenty = Array.from({ length: 20 }, (_, i) => ({ ...stories[i % 3], id: `briefing-story-${i}` }));
  await page.route('**/api/stories', route => route.fulfill({ json: { ...catalog, items: twenty } }));
  await fakeAudio(page);
  await mockSessions(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'End conversation' })).toBeFocused();
  await emitServer(page, { type: 'display', display: { ...emptyDisplay(), stories: twenty, spotlightStoryId: twenty[18].id }, revision: 0 });
  const focused = page.locator('[data-spotlight="true"]');
  await expect.poll(async () => { const box = (await focused.boundingBox())!; return box.y + box.height; }).toBeLessThan(980);
  const box = (await focused.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual((await page.locator('.voice-stage').boundingBox())!.height);
  await expect(page.getByRole('button', { name: 'End conversation' })).toBeFocused();
  expect(await focused.evaluate(e => getComputedStyle(e).transform)).toMatch(/none|matrix\(1, 0, 0, 1, 0, 0\)/);
  await page.keyboard.press('Escape');
});


test.describe('touchscreen', () => {
  test.use({ hasTouch: true });

for (const viewport of [
  { width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 },
  { width: 768, height: 1024 }, { width: 844, height: 390 },
]) {
  test(`mobile voice opening ${viewport.width}x${viewport.height} preserves waveform size and follows spoken cards`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await fakeAudio(page);
    const calls = await mockSessions(page);
    const selections = await mockStories(page);
    const nine = Array.from({ length: 9 }, (_, index) => ({ ...stories[index % 3], id: `mobile-briefing-${index}`,
      whyItMatters: 'The outcome could influence public policy, trade and daily life. The next steps depend on negotiations and the evidence still emerging.' }));
    await page.route('**/api/stories', route => route.fulfill({ json: { ...catalog, items: nine } }));
    const actions: string[] = [];
    await page.route('**/api/session/action', async route => {
      actions.push(route.request().postDataJSON().action.type);
      await emitServer(page, { type: 'display', display: { ...emptyDisplay(), stories: nine }, revision: 0 });
      await emitServer(page, { type: 'research', busy: false, message: '', revision: 0 });
      await route.fulfill({ status: 202, json: { ok: true } });
    });
    await page.goto('/');
    await expect(page.locator('.headline-card')).toHaveCount(9);
    await expect(page.locator('.voice-stage')).toHaveCSS('height', `${viewport.height}px`);
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    const opening = (await page.locator('.wave-control').boundingBox())!;
    expect((await page.locator('canvas').boundingBox())!.height).toBeCloseTo(opening.height, 0);
    const canvas = await page.locator('canvas').elementHandle();
    expect(opening.y).toBeGreaterThan(viewport.height * 0.18);
    expect(opening.y + opening.height / 2).toBeLessThan(viewport.height * 0.5);
    expect(calls).toEqual([]);
    expect((await metrics(page)).microphoneCalls).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('mobile-opening.png') });
    await page.getByRole('button', { name: 'Start conversation' }).tap();
    await expect.poll(() => actions).toEqual(['start_briefing']);
    await expect(page.locator('.wordmark')).toHaveCSS('opacity', '0');
    await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '0');
    await expect(page.locator('.ai-note')).toHaveCount(0);
    await expect.poll(async () => (await page.locator('.wave-control').boundingBox())!.y).toBeLessThan(8);
    const docked = (await page.locator('.wave-control').boundingBox())!;
    expect(docked.height).toBeCloseTo(opening.height * 0.6, 0);
    expect((await page.locator('canvas').boundingBox())!.height).toBeCloseTo(opening.height, 0);
    expect(docked.width).toBeCloseTo(opening.width, 0);
    expect(await canvas!.evaluate(node => node === document.querySelector('canvas'))).toBe(true);
    for (const index of [0, 7, 1]) {
      const card = page.locator(`[data-story-id="${nine[index].id}"]`);
      const collapsedHeight = (await card.boundingBox())!.height;
      await emit(page, { type: 'media.output.active', response_id: `spoken-${index}` });
      await emitServer(page, { type: 'display', display: { ...emptyDisplay(), stories: nine, spotlightStoryId: nine[index].id }, revision: 0 });
      await expect(card).toHaveAttribute('data-spotlight', 'true');
      await expect(card).toHaveAttribute('aria-pressed', 'false');
      await expect(card.locator('.headline-context')).toBeVisible();
      await expect.poll(async () => (await card.boundingBox())!.height).toBeGreaterThan(collapsedHeight);
      await expect.poll(async () => {
        const box = (await card.boundingBox())!;
        const stage = (await page.locator('.voice-stage').boundingBox())!;
        const dockBottom = stage.y + stage.height;
        // Rich context can exceed a short landscape viewport. Keep its start
        // below the dock and allow normal page scrolling instead of clipping it.
        return box.y >= dockBottom && (box.height > viewport.height - dockBottom - 8
          ? box.y <= dockBottom + 40 : box.y + box.height <= viewport.height - 8);
      }).toBe(true);
      await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
      const box = (await card.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(await card.evaluate(element => element.scrollHeight <= element.clientHeight + 2)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await audioLifetime(page)).toMatchObject({ createdAudio: 1, pausedAudio: 0, createdPeers: 1 });
      await page.screenshot({ path: testInfo.outputPath(`mobile-story-${index + 1}.png`) });
      await emit(page, { type: 'media.output.quiet', response_id: `spoken-${index}` });
    }
    // The dock remains a usable touch target after scrolling through the briefing.
    await page.getByRole('button', { name: 'End conversation' }).tap();
    await expect.poll(async () => (await metrics(page)).stoppedTracks).toBe(1);
    expect(selections).toEqual([]);
    expect(calls.filter(method => method === 'POST')).toHaveLength(1);
    await page.reload();
    await expect(page.locator('.voice-page')).toHaveAttribute('data-started', 'false');
    await expect(page.locator('.voice-stage')).toHaveCSS('height', `${viewport.height}px`);
    expect((await metrics(page)).microphoneCalls).toBe(0);
  });
}

test('mobile microphone denial keeps the recovery notice readable above tappable stories', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await fakeAudio(page, 'denied');
  const calls = await mockSessions(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).tap();
  await expect(page.getByRole('status')).toContainText('Microphone access is off');
  await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '1');
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  const notice = (await page.getByRole('status').boundingBox())!;
  const dock = (await page.locator('.voice-stage').boundingBox())!;
  expect(notice.y + notice.height).toBeLessThanOrEqual(dock.height);
  expect(calls).toEqual(['GET']);
  await page.screenshot({ path: testInfo.outputPath('mobile-microphone-denied.png') });
  await page.locator('.headline-card').first().tap();
  await expect(page.getByRole('heading', { name: 'Possible next steps' })).toBeVisible();
  expect((await metrics(page)).microphoneCalls).toBe(1);
});

test('mobile reduced motion follows a headline instantly and keeps voice through rotation and story selection', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fakeAudio(page);
  await mockSessions(page);
  await mockStories(page);
  await page.goto('/');
  const canvas = await page.locator('canvas').elementHandle();
  await page.getByRole('button', { name: 'Start conversation' }).tap();
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await emitServer(page, { type: 'display', display: { ...emptyDisplay(), stories, spotlightStoryId: stories[2].id }, revision: 0 });
  const spotlight = page.locator('[data-spotlight="true"]');
  await expect(spotlight).toHaveCount(1);
  await expect.poll(async () => { const box = (await spotlight.boundingBox())!; return box.y + box.height; }).toBeLessThan(824);
  expect(await spotlight.evaluate(element => getComputedStyle(element).transform)).toMatch(/none|matrix\(1, 0, 0, 1, 0, 0\)/);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.wordmark')).toHaveCSS('opacity', '0');
  await spotlight.tap();
  await emitServer(page, { type: 'display', display: explorationDisplay(2), revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await expect(page.getByRole('heading', { name: 'Possible next steps' })).toBeVisible();
  await page.getByRole('button', { name: 'All stories', exact: true }).tap();
  await expect(page.locator('.voice-page')).toHaveAttribute('data-view', 'stories');
  expect(await canvas!.evaluate(node => node === document.querySelector('canvas'))).toBe(true);
  expect(await audioLifetime(page)).toMatchObject({ createdAudio: 1, pausedAudio: 0, createdPeers: 1 });
  await page.screenshot({ path: testInfo.outputPath('mobile-rotated.png') });
  await page.getByRole('button', { name: 'End conversation' }).tap();
});

});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test(`voice scrolling ${viewport.width} uses the visible page and keeps audio connected`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await fakeAudio(page);
    const calls = await mockSessions(page);
    const twenty = Array.from({ length: 20 }, (_, index) => ({ ...stories[index % 3], id: `scroll-story-${index}`, title: `Story ${index + 1}: ${stories[index % 3].title}` }));
    let display: ExplorationDisplay = { ...emptyDisplay(), stories: twenty };
    const reports: ScreenReport[] = [];
    let researchCalls = 0;
    await page.route('**/api/session/screen', async route => {
      const body = route.request().postDataJSON();
      if (body.type !== 'observation') reports.push(body);
      await route.fulfill({ status: 204 });
    });
    await page.route('**/api/session/story', async route => { researchCalls++; await route.fulfill({ status: 202, json: { revision: 1 } }); });
    await page.route('**/api/stories', route => route.fulfill({ json: { ...catalog, items: twenty } }));
    await page.route('**/api/session/action', async route => {
      await emitServer(page, { type: 'display', display, revision: display.revision });
      await emitServer(page, { type: 'research', busy: false, message: '', revision: display.revision });
      await route.fulfill({ status: 202, json: { ok: true } });
    });
    await page.goto('/');
    expect(reports).toEqual([]);
    await page.getByRole('button', { name: 'Start conversation' }).click();
    await expect(page.getByRole('button', { name: 'End conversation' })).toBeVisible();
    await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '0');
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    const command = async (scroll?: ScrollArgs, context = screenContextKey(display)) => {
      const requestId = randomUUID();
      await emitServer(page, { type: 'screen_request', requestId, revision: display.revision, contextKey: context, ...(scroll ? { scroll } : {}) });
      await expect.poll(() => reports.some(report => report.requestId === requestId)).toBe(true);
      return reports.find(report => report.requestId === requestId)!;
    };
    const first = await command();
    expect(first.screen.atTop).toBe(true);
    expect(first.screen.visibleStoryIds.length).toBeGreaterThan(0);
    expect(first.screen.visibleStoryIds.length).toBeLessThan(20);
    expect(first.screen.width).toBe(viewport.width);
    for (const id of first.screen.fullyVisibleStoryIds) {
      const box = (await page.locator(`[data-story-id="${id}"]`).boundingBox())!;
      expect(box.y).toBeGreaterThan((await page.locator('.voice-stage').boundingBox())!.height);
      expect(box.y + box.height).toBeLessThan(viewport.height);
    }
    const down = await command({ direction: 'down' });
    expect(down.screen.scrollY).toBeGreaterThan(first.screen.scrollY);
    expect(down.screen.visibleStoryIds).not.toEqual(first.screen.visibleStoryIds);
    await page.screenshot({ path: testInfo.outputPath('voice-scrolled-stories.png') });
    // Retransmission must not scroll twice or post a second acknowledgment.
    const count = reports.length;
    await emitServer(page, { type: 'screen_request', requestId: down.requestId, revision: 0, contextKey: screenContextKey(display), scroll: { direction: 'down' } });
    await page.waitForTimeout(150);
    expect(reports.length).toBe(count);
    expect(Math.round(await page.evaluate(() => window.scrollY))).toBe(down.screen.scrollY);
    const up = await command({ direction: 'up' });
    expect(up.screen.scrollY).toBeLessThan(down.screen.scrollY);
    expect((await command({ direction: 'top' })).screen.atTop).toBe(true);
    expect((await command({ direction: 'up' })).outcome).toBe('boundary');
    const next = await command({ direction: 'next_section' });
    expect(next.screen.scrollY).toBeGreaterThan(0);
    expect((await command({ direction: 'previous_section' })).screen.scrollY).toBeLessThan(next.screen.scrollY);
    const bottom = await command({ direction: 'bottom' });
    expect(bottom.screen.atBottom, JSON.stringify(bottom)).toBe(true);
    expect((await command({ direction: 'down' })).outcome).toBe('boundary');
    expect(researchCalls).toBe(0);
    expect(calls.filter(method => method === 'POST')).toHaveLength(1);
    // Voice-driven view changes use the existing display stream and actual sections.
    display = { ...explorationDisplay(), stories: twenty };
    await emitServer(page, { type: 'story', headlineId: display.headline!.id, revision: 1 });
    await emitServer(page, { type: 'display', display, revision: 1 });
    await expect(page.getByRole('heading', { name: headlines[0].title })).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    const detail = await command();
    expect(detail.screen.view).toBe('exploration');
    expect(detail.screen.visibleStoryIds).toEqual([]);
    expect(detail.screen.availableSections).toContain('ChoiceCards');
    const choices = await command({ direction: 'section', section: 'ChoiceCards' });
    expect(choices.screen.visibleSections).toContain('ChoiceCards');
    await page.screenshot({ path: testInfo.outputPath('voice-scrolled-analysis.png') });
    const location = choices.screen.scrollY;
    expect((await command({ direction: 'bottom' }, '0:stories::')).outcome).toBe('view_changed');
    expect(Math.round(await page.evaluate(() => window.scrollY))).toBe(location);
    expect((await command({ direction: 'section', section: 'PathComparison' })).outcome).toBe('section_unavailable');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect((await command({ direction: 'top' })).screen.atTop).toBe(true);
    expect((await metrics(page)).microphoneCalls).toBe(1);
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    const resized = await command();
    expect(resized.screen.width).toBe(viewport.height);
    expect(resized.screen.height).toBe(viewport.width);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Stop during a requested glide: no late acknowledgment or renewed microphone.
    const stoppingRequest = randomUUID();
    await emitServer(page, { type: 'screen_request', requestId: stoppingRequest, revision: 1, contextKey: screenContextKey(display), scroll: { direction: 'bottom' } });
    await page.getByRole('button', { name: 'End conversation' }).click();
    await expect.poll(() => calls.filter(method => method === 'DELETE').length).toBe(1);
    await page.waitForTimeout(200);
    expect(reports.some(report => report.requestId === stoppingRequest)).toBe(false);
    const endedCount = reports.length;
    await emitServer(page, { type: 'screen_request', requestId: randomUUID(), revision: 1, contextKey: screenContextKey(display), scroll: { direction: 'bottom' } });
    await page.waitForTimeout(150);
    expect(reports.length).toBe(endedCount);
    expect(await metrics(page)).toEqual({ microphoneCalls: 1, stoppedTracks: 1, closedPeers: 1, closedContexts: 1 });
  });
}


for (const viewport of [{ width: 464, height: 931 }, { width: 1440, height: 1000 }]) {
  test(`focused briefing and paths ${viewport.width} preserve the wave and report visible focus`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await fakeAudio(page);
    const calls = await mockSessions(page);
    const selections = await mockStories(page);
    const items = Array.from({ length: 12 }, (_, index) => ({ ...stories[index % 3], id: `focus-story-${index}` }));
    const observations: ScreenReport['screen'][] = [];
    const actions: string[] = [];
    await page.route('**/api/stories', route => route.fulfill({ json: { ...catalog, items } }));
    await page.route('**/api/session/screen', async route => {
      const body = route.request().postDataJSON();
      if (body.type === 'observation') observations.push(body.screen);
      await route.fulfill({ status: 204 });
    });
    await page.route('**/api/session/action', async route => {
      const action = route.request().postDataJSON().action;
      actions.push(action.type);
      if (action.type === 'start_briefing') {
        await emitServer(page, { type: 'display', display: { ...emptyDisplay(), stories: items }, revision: 0 });
        await emitServer(page, { type: 'research', busy: false, message: '', revision: 0 });
      }
      await route.fulfill({ status: 202, json: { ok: true } });
    });
    await page.goto('/');
    await expect(page.locator('.headline-card')).toHaveCount(12);
    await expect(page.locator('.stories-heading')).toHaveCount(0);
    const originalCanvas = await page.locator('canvas').elementHandle();
    await page.getByRole('button', { name: 'Start conversation' }).click();
    await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '0');
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    await expect(page.locator('main')).toHaveCSS('--opening-progress', '0');
    const wave = (await page.locator('.wave-control').boundingBox())!;
    for (const index of [0, 7, 8]) {
      await emit(page, { type: 'media.output.active', response_id: `focus-${index}` });
      await emitServer(page, { type: 'display', display: { ...emptyDisplay(), stories: items, spotlightStoryId: items[index].id }, revision: 0 });
      const card = page.locator(`[data-story-id="${items[index].id}"]`);
      await expect(card).toHaveAttribute('data-spotlight', 'true');
      await expect(card.locator('.headline-context')).toBeVisible();
      await expect.poll(() => observations.at(-1)?.focusedStoryId).toBe(items[index].id);
      await expect.poll(() => observations.at(-1)?.fullyVisibleStoryIds.includes(items[index].id)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath('focused-stories.png') });
    let display = explorationDisplay();
    await emitServer(page, { type: 'story', headlineId: display.headline!.id, revision: 1 });
    await emitServer(page, { type: 'display', display, revision: 1 });
    await expect(page.locator('.possibility-card')).toHaveCount(3);
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    // The extra paragraph belongs to focus, not branch generation.
    await expect(page.locator('.possibility-card').last().locator('.possibility-context')).not.toBeVisible();
    for (const index of [2, 0]) {
      const node = display.exploration!.choices![index];
      display = { ...display, spotlightPathId: node.id };
      await emitServer(page, { type: 'display', display, revision: 1 });
      const card = page.locator(`.possibility-card[data-path-id="${node.id}"]`);
      await expect(card).toHaveAttribute('aria-current', 'true');
      await expect(card.locator('.possibility-context')).toBeVisible();
      await expect(card.locator('.possibility-context')).toContainText(node.whyPlausible);
      await expect.poll(() => observations.at(-1)?.focusedPathId).toBe(node.id);
      await expect.poll(() => observations.at(-1)?.fullyVisiblePathIds?.includes(node.id)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`focused-path-${index}.png`) });
    }
    expect(actions).toEqual(['start_briefing']);
    expect(selections).toEqual([]);
    const chosen = display.exploration!.choices![0];
    await page.locator(`.possibility-card[data-path-id="${chosen.id}"]`).click();
    await expect.poll(() => actions.at(-1)).toBe('choose_path');
    display = { ...display, exploration: { ...display.exploration!, currentNode: chosen, lineage: [chosen], choices: [] } };
    await emitServer(page, { type: 'display', display, revision: 1 });
    await expect(page.locator('.scenario-detail')).toHaveAttribute('data-spotlight', 'true');
    await expect(page.locator('.scenario-detail')).toContainText(chosen.keyAssumption);
    expect(calls.filter(method => method === 'POST')).toHaveLength(1);
    expect(await originalCanvas!.evaluate(node => node === document.querySelector('canvas'))).toBe(true);
    // Ended-call copy no longer enlarges the dock; the button remains identical.
    await page.getByRole('button', { name: 'End conversation' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-working', 'false');
    await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '0');
    const ended = (await page.locator('.wave-control').boundingBox())!;
    expect(ended.width).toBeCloseTo(wave.width, 0);
    expect(ended.height).toBeCloseTo(wave.height, 0);
    expect(ended.y).toBeCloseTo(wave.y, 0);
    expect((await page.locator('.voice-stage').boundingBox())!.height).toBeLessThan(ended.height + 20);
    const count = observations.length;
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(350);
    expect(observations).toHaveLength(count);
    await page.screenshot({ path: testInfo.outputPath('compact-ended-dock.png') });
  });
}

for (const width of [390, 1440]) {
  test(`loading status and pending path ${width} animate without replacing the waveform`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    let releaseStory!: () => void;
    let releasePath!: () => void;
    const storyGate = new Promise<void>(resolve => { releaseStory = resolve; });
    const pathGate = new Promise<void>(resolve => { releasePath = resolve; });
    const root = explorationDisplay();
    const selected = root.exploration!.choices![1];
    await page.route('**/api/exploration', async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { display: emptyDisplay() } });
      const action = route.request().postDataJSON().action;
      if (action.type === 'select_story') {
        await storyGate;
        return route.fulfill({ json: { display: root } });
      }
      await pathGate;
      return route.fulfill({ json: { display: { ...root, exploration: { ...root.exploration!, currentNode: selected, lineage: [selected], choices: [] } } } });
    });
    await page.goto('/');
    await expect(page.locator('.headline-card')).toHaveCount(3);
    const canvas = await page.locator('canvas').elementHandle();
    await clickStory(page, 0);
    await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '1');
    await expect(page.locator('#voice-status')).toContainText('Looking into this story');
    await expect(page.locator('.exploration-loading')).toBeVisible();
    await page.waitForTimeout(1300);
    const busyDock = (await page.locator('.voice-stage').boundingBox())!;
    releaseStory();
    await expect(page.locator('.possibility-card')).toHaveCount(3);
    await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '0');
    await expect(page.locator('.path-trail')).toHaveCount(0);
    await expect.poll(async () => (await page.locator('.voice-stage').boundingBox())!.height).toBeLessThan(busyDock.height - 15);
    await page.locator('.possibility-card').nth(1).click();
    await expect(page.locator('.scenario-detail h3')).toHaveText(selected.title);
    await expect(page.locator('#voice-status')).toHaveText('Exploring this possibility…');
    await expect(page.locator('.exploration-loading')).toBeVisible();
    await expect(page.locator('.possibility-card')).toHaveCount(0);
    await expect.poll(async () => (await page.locator('.scenario-detail').boundingBox())!.y - (await page.locator('.voice-stage').boundingBox())!.height).toBeGreaterThanOrEqual(15);
    await settledLayout(page);
    await page.screenshot({ path: testInfo.outputPath('pending-path.png') });
    releasePath();
    await expect(page.locator('.exploration-loading')).toHaveCount(0);
    await expect(page.locator('.path-trail')).toBeVisible();
    await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '0');
    expect(await canvas!.evaluate(node => node === document.querySelector('canvas'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('completed-path.png') });
  });
}

test('web search status expands the dock temporarily during a voice conversation', async ({ page }) => {
  await fakeAudio(page);
  await mockSessions(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '0');
  await page.waitForTimeout(1300);
  const initial = (await page.locator('.voice-stage').boundingBox())!.height;
  await emitServer(page, { type: 'research', busy: true, message: 'Searching the web…', revision: 0 });
  await expect(page.locator('#voice-status')).toHaveText('Searching the web…');
  await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '1');
  await expect.poll(async () => (await page.locator('.voice-stage').boundingBox())!.height).toBeGreaterThan(initial + 15);
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 0 });
  await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '0');
  await expect.poll(async () => (await page.locator('.voice-stage').boundingBox())!.height).toBeLessThan(initial + 1);
  await page.getByRole('button', { name: 'End conversation' }).click();
});

test('story updates finish loading, fade below the wave, and keep a timestamp beside refresh', async ({ page }, testInfo) => {
  await page.clock.install();
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const updated = { ...catalog, fetchedAt: '2026-09-21T13:30:00Z', items: stories.map(item => ({ ...item, title: `Updated: ${item.title}` })) };
  await page.route('**/api/stories', async route => {
    calls++;
    if (calls === 1) await ready;
    await route.fulfill({ json: calls === 1 ? catalog : updated });
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Loading stories…');
  release();
  await expect(page.locator('.headline-card:not(.headline-skeleton)')).toHaveCount(3);
  await expect(page.getByRole('status')).toContainText('Stories updated');
  await expect(page.locator('.stories-update time')).toHaveAttribute('datetime', catalog.fetchedAt);
  await page.clock.runFor(5600);
  await expect(page.locator('.conversation-copy')).toHaveAttribute('aria-hidden', 'true');
  const canvas = await page.locator('.wave-control canvas').elementHandle();
  await page.getByRole('button', { name: 'Refresh stories', exact: true }).click();
  await expect(page.locator('.stories-update time')).toHaveAttribute('datetime', updated.fetchedAt);
  expect(calls).toBe(2);
  expect(await canvas?.evaluate(element => element.isConnected)).toBe(true);
  await page.getByRole('button', { name: /Updated: City weighs/ }).focus();
  await page.clock.runFor(600);
  await expect(page.locator('.headline-card[data-expanded="true"] .headline-context')).toHaveText(stories[0].whyItMatters);
  await page.screenshot({ path: testInfo.outputPath('stories-refresh-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.runFor(6000);
  await page.getByRole('button', { name: 'Refresh stories', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('stories-refresh-mobile.png') });
});

test('a stalled story request times out and refresh recovers without reloading the page', async ({ page }) => {
  await page.clock.install();
  let requested = false;
  await page.route('**/api/stories', () => { requested = true; });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Loading stories…');
  await expect.poll(() => requested).toBe(true);
  await page.clock.fastForward(100_100);
  await expect(page.getByRole('button', { name: 'Refresh stories' })).toBeEnabled();
  await expect(page.locator('.stories-notice')).toContainText('Stories couldn’t be loaded');
  await expect(page.locator('.voice-page')).toHaveAttribute('data-working', 'false');
  await page.route('**/api/stories', route => route.fulfill({ json: catalog }));
  await page.getByRole('button', { name: 'Refresh stories' }).click();
  await expect(page.locator('.headline-card')).toHaveCount(3);
  await expect(page.locator('.stories-notice')).toHaveCount(0);
});

test('a failed refresh keeps the displayed stories and their original update time', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.headline-card')).toHaveCount(3);
  await page.route('**/api/stories', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.getByRole('button', { name: 'Refresh stories' }).click();
  await expect(page.locator('.stories-notice')).toContainText('Your saved stories are still here');
  await expect(page.locator('.headline-card')).toHaveCount(3);
  await expect(page.locator('.stories-update time')).toHaveAttribute('datetime', catalog.fetchedAt);
  await expect(page.getByRole('button', { name: 'Refresh stories' })).toBeEnabled();
});

test('fallback notices fade beneath the waveform and are not presented as story analysis', async ({ page }) => {
  await page.clock.install();
  const warning = 'Showing uncurated Google News headlines. AI grouping and ranking are temporarily unavailable.';
  await page.route('**/api/stories', route => route.fulfill({ json: { ...catalog, curated: false, warning,
    items: stories.map(story => ({ ...story, summary: story.title, whyItMatters: 'This headline has not been grouped or assessed for significance.' })) } }));
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText(warning);
  await page.clock.runFor(5600);
  await expect(page.locator('.conversation-copy')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.stories-notice')).toHaveText(warning);
  await expect(page.getByText('This headline has not been grouped or assessed for significance.')).toHaveCount(0);
});

test('a voice catalog completes a stalled page load and active refresh waits for its own result', async ({ page }) => {
  await fakeAudio(page); await mockSessions(page);
  await page.route('**/api/stories', () => {});
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  const metadata = { fetchedAt: catalog.fetchedAt, curated: true, stale: false, warning: null };
  const display = { ...emptyDisplay(), stories, storyCatalog: metadata, storyCatalogId: '00000000-0000-4000-8000-000000000001' };
  await emitServer(page, { type: 'display', display, revision: 0 });
  await expect(page.locator('.stories-update time')).toHaveAttribute('datetime', catalog.fetchedAt);
  await expect(page.getByRole('button', { name: 'Refresh stories' })).toBeEnabled();
  let refreshes = 0;
  await page.route('**/api/session/action', async route => {
    if (route.request().postDataJSON().action.type === 'refresh_stories') refreshes++;
    await route.fulfill({ status: 202, json: { ok: true } });
  });
  await page.getByRole('button', { name: 'Refresh stories' }).click();
  await expect.poll(() => refreshes).toBe(1);
  await emitServer(page, { type: 'display', display: { ...display, spotlightStoryId: stories[1].id }, revision: 0 });
  await expect(page.getByRole('button', { name: 'Refresh stories' })).toBeDisabled();
  await emitServer(page, { type: 'display', display: { ...display, storyCatalogId: '00000000-0000-4000-8000-000000000002', storyCatalog: { ...metadata, fetchedAt: '2026-09-21T14:00:00Z' } }, revision: 0 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 0 });
  await expect(page.getByRole('button', { name: 'Refresh stories' })).toBeEnabled();
  await expect(page.locator('.stories-update time')).toHaveAttribute('datetime', '2026-09-21T14:00:00Z');
  await mkdir('/private/tmp/flowpath-news-qa', { recursive: true });
  await page.waitForTimeout(650);
  await page.screenshot({ path: '/private/tmp/flowpath-news-qa/refreshed-news-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(650);
  await page.screenshot({ path: '/private/tmp/flowpath-news-qa/refreshed-news-mobile.png' });
  await page.getByRole('button', { name: 'Refresh stories' }).click();
  await expect.poll(() => refreshes).toBe(2);
  await emitServer(page, { type: 'display', display: { ...display, storyCatalogId: '00000000-0000-4000-8000-000000000003', storyCatalogError: 'Couldn’t refresh stories.' }, revision: 0 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 0 });
  await expect(page.getByRole('button', { name: 'Refresh stories' })).toBeEnabled();
  await expect(page.locator('.stories-notice')).toContainText('Your saved stories are still here');
  await expect(page.locator('.stories-update time')).toHaveAttribute('datetime', '2026-09-21T14:00:00Z');
  await page.getByRole('button', { name: 'Refresh stories' }).click();
  await expect.poll(() => refreshes).toBe(3);
  await page.keyboard.press('Escape');
  await expect(page.locator('.voice-page')).toHaveAttribute('data-working', 'false');
  await expect(page.getByRole('button', { name: 'Refresh stories' })).toBeEnabled();
});

async function streamedCatalog(page: Page) {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    const tracker = { ready: false, push: (value: object) => { void value; }, close: () => {} };
    Object.assign(window, { storyStream: tracker });
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== '/api/stories') return nativeFetch(input, init);
      let open = true;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          tracker.ready = true;
          tracker.push = value => { if (open) controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); };
          tracker.close = () => { if (open) { open = false; controller.close(); } };
          init?.signal?.addEventListener('abort', () => { if (open) { open = false; controller.error(new DOMException('Aborted', 'AbortError')); } });
        },
        cancel() { open = false; },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  });
}

async function pushCatalog(page: Page, value: object) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { storyStream: { ready: boolean } }).storyStream.ready)).toBe(true);
  await page.evaluate(value => (window as unknown as { storyStream: { push(value: object): void } }).storyStream.push(value), value);
}

test('stories stay loading until the complete catalog arrives together', async ({ page }, testInfo) => {
  await streamedCatalog(page);
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Loading stories…');
  await pushCatalog(page, { ...catalog, complete: false, items: stories.slice(0, 1) });
  await expect(page.locator('[data-story-id]')).toHaveCount(0);
  await expect(page.locator('.headline-skeleton')).toHaveCount(6);
  await expect(page.locator('.voice-page')).toHaveAttribute('data-working', 'true');
  await expect(page.getByRole('button', { name: 'Refresh stories' })).toBeDisabled();
  await pushCatalog(page, { ...catalog, complete: true });
  await expect(page.locator('[data-story-id]')).toHaveCount(3);
  await expect(page.locator('[data-story-id]').first()).toHaveAttribute('data-story-id', stories[0].id);
  await expect(page.locator('.headline-skeleton')).toHaveCount(0);
  await expect(page.locator('.stories-update')).not.toContainText('More stories arriving');
  await expect(page.getByRole('button', { name: 'Refresh stories' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('complete-catalog.png') });
});

test('an interrupted incomplete catalog exposes no lead-only list and permits refresh', async ({ page }) => {
  await streamedCatalog(page);
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Loading stories…');
  await pushCatalog(page, { ...catalog, complete: false, items: stories.slice(0, 1) });
  await expect(page.locator('[data-story-id]')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { storyStream: { close(): void } }).storyStream.close());
  await expect(page.locator('.stories-notice')).toContainText('Stories couldn’t be loaded');
  await expect(page.locator('[data-story-id]')).toHaveCount(0);
  await expect(page.locator('.headline-skeleton')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh stories' })).toBeEnabled();
});

test('voice publishes the full catalog together before playback focus', async ({ page }) => {
  await fakeAudio(page);
  await mockSessions(page);
  const reports: ScreenReport[] = [];
  await page.route('**/api/session/screen', async route => {
    const body = route.request().postDataJSON();
    if (body.type !== 'observation') reports.push(body);
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/stories', () => {});
  await page.route('**/api/session/action', route => route.fulfill({ status: 202, json: { ok: true } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  const metadata = { fetchedAt: catalog.fetchedAt, stale: catalog.stale, curated: catalog.curated, warning: catalog.warning };
  const display = { ...emptyDisplay(), stories: stories.slice(0, 1), storyCatalog: { ...metadata, complete: false },
    storyCatalogId: '00000000-0000-4000-8000-000000000088', spotlightStoryId: null };
  await emitServer(page, { type: 'display', display, revision: 0 });
  await emitServer(page, { type: 'research', busy: true, catalogPending: true, message: 'Getting the news briefing…', revision: 0 });
  await expect(page.locator('[data-story-id]')).toHaveCount(0);
  const requestId = randomUUID();
  await emitServer(page, { type: 'screen_request', requestId, revision: 0, contextKey: screenContextKey(display),
    catalog: { id: display.storyCatalogId, storyIds: stories.map(story => story.id) } });
  await page.waitForTimeout(120);
  expect(reports).toHaveLength(0);
  await emitServer(page, { type: 'display', display: { ...display, stories, storyCatalog: { ...metadata, complete: true }, spotlightStoryId: stories[0].id }, revision: 0 });
  await expect(page.locator('[data-story-id]')).toHaveCount(3);
  await expect.poll(() => reports.some(report => report.requestId === requestId)).toBe(true);
  const ready = reports.find(report => report.requestId === requestId)!;
  expect(ready.outcome).toBe('ok');
  expect(ready.screen.storyCatalogId).toBe(display.storyCatalogId);
  expect(ready.screen.renderedStoryIds).toEqual(stories.map(story => story.id));
  expect(ready.screen.visibleStoryIds).toContain(stories[0].id);
  await emitServer(page, { type: 'research', busy: false, catalogPending: false, message: '', revision: 0 });
  await emit(page, { type: 'media.output.active', response_id: 'first-story' });
  await expect(page.locator(`[data-story-id="${stories[0].id}"]`)).toHaveAttribute('data-spotlight', 'true');
  await expect(page.getByRole('button', { name: 'Refresh stories' })).toBeEnabled();
  await page.getByRole('button', { name: 'End conversation' }).click();
});

test('catalog pending protects quiet voice startup and cancellation restores the normal idle cutoff', async ({ page }) => {
  await page.clock.install();
  await fakeAudio(page);
  await mockSessions(page);
  await page.route('**/api/session/action', route => route.fulfill({ status: 202, json: { ok: true } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await emitServer(page, { type: 'research', busy: false, catalogPending: true, message: '', revision: 0 });
  await expect(page.locator('main')).toHaveClass(/phase-listening/);
  await page.clock.fastForward(46_000);
  await expect(page.getByRole('button', { name: 'End conversation' })).toBeVisible();
  await emitServer(page, { type: 'research', busy: false, catalogPending: false, message: '', revision: 0 });
  await page.clock.fastForward(45_100);
  await expect(page.locator('main')).toHaveClass(/phase-idle/);
  expect((await metrics(page)).stoppedTracks).toBe(1);
});

for (const width of [390, 1440]) {
  test(`voice-only possibility walkthrough ${width} shows a hint and confirms the highlighted card`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fakeAudio(page); const sessions = await mockSessions(page);
    const actions: string[] = [], reports: ScreenReport[] = [];
    await page.route('**/api/session/action', async route => {
      actions.push(route.request().postDataJSON().action.type);
      await route.fulfill({ status: 202, json: { ok: true } });
    });
    await page.route('**/api/session/screen', async route => {
      const body = route.request().postDataJSON();
      if (body.requestId) reports.push(body);
      await route.fulfill({ status: 204 });
    });
    await page.goto('/');
    await clickStory(page, 0);
    await expect(page.getByRole('button', { name: /walkthrough|walk me through/i })).toHaveCount(0);
    const hint = page.getByText('Tap the wave, then say “talk me through these options.”', { exact: true });
    await expect(hint).toBeVisible();
    const firstCard = page.locator('[data-path-id]').first();
    expect((await hint.boundingBox())!.y).toBeLessThan((await firstCard.boundingBox())!.y);
    await page.getByRole('button', { name: 'Start conversation' }).click();
    await emitServer(page, { type: 'story', headlineId: headlines[0].id, revision: 1 });
    const display = explorationDisplay();
    await emitServer(page, { type: 'display', display, revision: 1 });
    await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
    await expect(page.getByText('Try saying “talk me through these options.” You can interrupt at any time.', { exact: true })).toBeVisible();
    await expect(page.getByText(/Ask about an option to discuss it/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('voice-hint.png'), fullPage: true });
    // A spoken request starts the server queue; the client renders its streamed state.
    const nodeId = display.exploration!.choices![0].id;
    const requestId = randomUUID();
    display.spotlightPathId = nodeId;
    display.walkthrough = { nodeId, index: 0, total: 3, phase: 'waiting' };
    await emitServer(page, { type: 'display', display, revision: 1 });
    await emitServer(page, { type: 'screen_request', requestId, pathId: nodeId, contextKey: screenContextKey(display), revision: 1 });
    await expect.poll(() => reports.some(report => report.requestId === requestId)).toBe(true);
    const confirmation = reports.find(report => report.requestId === requestId)!;
    expect(confirmation.outcome).toBe('ok');
    expect(confirmation.screen.visiblePathIds).toContain(nodeId);
    expect(confirmation.screen.expandedPathIds).toContain(nodeId);
    const card = page.locator(`[data-path-id="${nodeId}"]`);
    await expect(card).toHaveAttribute('data-spotlight', 'true');
    await expect(card).toHaveAttribute('data-expanded', 'true');
    await expect(page.getByText(/Option 1 of 3/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('walkthrough-voice-hint.png') });
    await emit(page, { type: 'media.output.active' });
    await expect(page.locator('main')).toHaveClass(/phase-speaking/);
    await expect(page.getByRole('button', { name: /walkthrough|walk me through/i })).toHaveCount(0);
    await emit(page, { type: 'media.input.active' });
    await expect.poll(() => page.evaluate(() => (window as unknown as { voiceTest: { audioMuted: boolean } }).voiceTest.audioMuted)).toBe(true);
    display.walkthrough = undefined;
    await emitServer(page, { type: 'display', display, revision: 1 });
    await emit(page, { type: 'media.input.quiet' });
    await emit(page, { type: 'media.output.quiet' });
    await expect.poll(() => page.evaluate(() => (window as unknown as { voiceTest: { audioMuted: boolean } }).voiceTest.audioMuted)).toBe(false);
    await expect(page.getByText('Try saying “talk me through these options.” You can interrupt at any time.', { exact: true })).toBeVisible();
    expect(actions.filter(action => action === 'choose_path')).toHaveLength(0);
    expect(sessions).toEqual(['GET', 'POST']);
    await page.getByRole('button', { name: 'End conversation' }).click();
  });
}

test('speaking during a possibility walkthrough mutes stale guide audio while keeping voice and analysis available', async ({ page }) => {
  await fakeAudio(page); const sessions = await mockSessions(page);
  await page.goto('/'); await page.getByRole('button', { name: 'Start conversation' }).click();
  await emitServer(page, { type: 'story', headlineId: headlines[0].id, revision: 1 });
  const display = explorationDisplay(); const nodeId = display.exploration!.choices![0].id;
  display.spotlightPathId = nodeId; display.walkthrough = { nodeId, index: 0, total: 3, phase: 'speaking' };
  await emitServer(page, { type: 'display', display, revision: 1 });
  await emitServer(page, { type: 'research', busy: false, message: '', revision: 1 });
  await emit(page, { type: 'media.output.active' });
  await expect(page.locator('main')).toHaveClass(/phase-speaking/);
  await emit(page, { type: 'media.input.active' });
  await expect.poll(() => page.evaluate(() => (window as unknown as { voiceTest: { audioMuted: boolean } }).voiceTest.audioMuted)).toBe(true);
  display.walkthrough = undefined;
  display.insight = { title: 'A different question', summary: 'We can explore another possibility.', points: [], assumptions: [], signals: [] };
  await emitServer(page, { type: 'display', display, revision: 1 });
  await expect(page.getByRole('heading', { name: 'A different question' })).toBeVisible();
  await emit(page, { type: 'media.input.quiet' }); await emit(page, { type: 'media.output.quiet' });
  await expect.poll(() => page.evaluate(() => (window as unknown as { voiceTest: { audioMuted: boolean } }).voiceTest.audioMuted)).toBe(false);
  expect(sessions).toEqual(['GET', 'POST']);
  expect((await metrics(page)).stoppedTracks).toBe(0);
  await page.getByRole('button', { name: 'End conversation' }).click();
});

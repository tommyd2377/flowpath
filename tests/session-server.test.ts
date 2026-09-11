import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionService } from '../lib/session-server';
import { MODEL } from '../lib/session-config';

const LOCAL_ORIGIN = 'http://127.0.0.1:3210';
const SESSION_ID = 'e506c426-a37d-4ad6-a62b-2d26e5532a83';
const OTHER_SESSION_ID = '38963e02-2f67-4b92-8377-3436958d2dd5';
const OFFER = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const ANSWER = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=recvonly\r\n';
const FAKE_KEY = 'fake-unit-test-key-never-sent-to-network';

type ProviderCall = { url: string; init?: RequestInit };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function providerAnswer(body: BodyInit = ANSWER, callId = 'live_test_call') {
  if (body instanceof ReadableStream) {
    const source = body;
    return new Response(new ReadableStream({ async start(output) {
      output.enqueue(new TextEncoder().encode(JSON.stringify({ session: { id: callId } }).slice(0, -1) + ',"transport":{"type":"webrtc","sdp":"'));
      const reader = source.getReader();
      while (true) { const part = await reader.read(); if (part.done) break; output.enqueue(new TextEncoder().encode(JSON.stringify(new TextDecoder().decode(part.value)).slice(1, -1))); }
      output.enqueue(new TextEncoder().encode('"}}')); output.close();
    } }));
  }
  return Response.json({ session: { id: callId }, transport: { type: 'webrtc', sdp: body } });
}

function setup(options: {
  apiKey?: () => string | undefined;
  durationMs?: number;
  respond?: (call: ProviderCall) => Response | Promise<Response>;
} = {}) {
  const calls: ProviderCall[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const call = { url: String(input), init };
    calls.push(call);
    if (options.respond) return options.respond(call);
    return call.url.endsWith('/hangup') ? new Response(null, { status: 200 }) : providerAnswer();
  };
  const service = createSessionService({
    apiKey: options.apiKey ?? (() => FAKE_KEY),
    fetch: fakeFetch,
    durationMs: options.durationMs ?? 60_000,
  });
  return {
    service,
    calls,
    creates: () => calls.filter((call) => !call.url.endsWith('/hangup')),
    hangups: () => calls.filter((call) => call.url.endsWith('/hangup')),
  };
}

function request(method: 'GET' | 'POST' | 'DELETE', options: {
  origin?: string | null;
  url?: string;
  id?: string | null;
  body?: BodyInit;
  contentType?: string;
  signal?: AbortSignal;
} = {}) {
  const headers = new Headers();
  if (options.origin !== null) headers.set('origin', options.origin ?? LOCAL_ORIGIN);
  if (options.id !== null) headers.set('x-voice-session', options.id ?? SESSION_ID);
  if (method === 'POST') headers.set('content-type', options.contentType ?? 'application/sdp');
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    signal: options.signal,
  };
  if (method === 'POST') {
    init.body = options.body ?? OFFER;
    if (init.body instanceof ReadableStream) init.duplex = 'half';
  }
  return new Request(options.url ?? `${LOCAL_ORIGIN}/api/session`, init);
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('missing setup reports unready and rejects creation without contacting the provider', async () => {
  const { service, calls } = setup({ apiKey: () => undefined });
  const status = await service.GET(request('GET'));
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { ready: false, reason: 'missing_key' });
  assert.equal((await service.POST(request('POST'))).status, 503);
  assert.equal(calls.length, 0);
});

test('non-local and cross-origin requests are denied before any provider call', async () => {
  const { service, calls } = setup();
  for (const method of ['GET', 'POST', 'DELETE'] as const) {
    assert.equal((await service[method](request(method, { origin: 'https://elsewhere.example' }))).status, 403);
    assert.equal((await service[method](request(method, {
      url: 'https://voice.example/api/session', origin: 'https://voice.example',
    }))).status, 403);
  }
  for (const method of ['POST', 'DELETE'] as const) {
    assert.equal((await service[method](request(method, { origin: null }))).status, 403);
  }
  assert.equal((await service.GET(request('GET', { origin: null }))).status, 200);
  assert.equal(calls.length, 0);
});

test('invalid SDP, media types, and identifiers do not create a provider session', async () => {
  const { service, calls } = setup();
  for (const options of [
    { body: 'not-sdp' },
    { body: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' },
    { contentType: 'application/json' },
    { id: '../rtc_someone_else' },
  ]) {
    assert.equal((await service.POST(request('POST', options))).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('an oversized streamed offer is canceled without a provider call', async () => {
  const { service, calls } = setup();
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(OFFER));
      controller.enqueue(new Uint8Array(32_769));
    },
    cancel() { canceled = true; },
  });
  assert.equal((await service.POST(request('POST', { body: stream }))).status, 400);
  assert.equal(canceled, true);
  assert.equal(calls.length, 0);
});

test('a successful call uses the configured model and returns only the opaque local session id', async () => {
  const { service, creates } = setup();
  const response = await service.POST(request('POST'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-voice-session'), SESSION_ID);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('location'), null);
  assert.equal(await response.text(), ANSWER);
  const creation = creates()[0];
  assert.equal(creation.url, 'https://api.openai.com/v1/live/sessions');
  assert.equal(creation.init?.method, 'POST');
  assert.equal(new Headers(creation.init?.headers).get('authorization'), `Bearer ${FAKE_KEY}`);
  const { session: config, transport } = JSON.parse(String(creation.init?.body));
  assert.equal(transport.sdp, OFFER); assert.equal(config.model, MODEL);
  assert.deepEqual(config.delegation, { type: 'client' }); assert.equal(config.audio.output.voice, 'marin');
  assert.equal('turn_detection' in config, false);
  await service.DELETE(request('DELETE'));
});

test('only one provider call can be opening or active at a time', async () => {
  const upstream = deferred<Response>();
  const entered = deferred<void>();
  const { service, creates } = setup({ respond: (call) => {
    if (call.url.endsWith('/hangup')) return new Response(null, { status: 200 });
    entered.resolve();
    return upstream.promise;
  } });
  const first = service.POST(request('POST'));
  await entered.promise;
  assert.equal((await service.POST(request('POST', { id: OTHER_SESSION_ID }))).status, 409);
  upstream.resolve(providerAnswer());
  assert.equal((await first).status, 200);
  assert.equal((await service.POST(request('POST', { id: OTHER_SESSION_ID }))).status, 409);
  assert.equal(creates().length, 1);
  await service.DELETE(request('DELETE'));
});

test('ending conversations does not bypass the three-start minute limit', async () => {
  const { service, creates, hangups } = setup();
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal((await service.POST(request('POST'))).status, 200);
    assert.equal((await service.DELETE(request('DELETE'))).status, 204);
  }
  assert.equal((await service.POST(request('POST'))).status, 429);
  assert.equal(creates().length, 3);
  assert.equal(hangups().length, 3);
});

test('upstream error bodies and exceptions are redacted from client responses', async () => {
  const privateDetail = 'fake-provider-debug-detail-with-fake-key';
  for (const status of [401, 403, 429, 500]) {
    const { service } = setup({ respond: () => new Response(privateDetail, { status }) });
    const result = await service.POST(request('POST'));
    assert.equal(result.status, status === 429 ? 429 : 502);
    const text = await result.text();
    assert.equal(text.includes(privateDetail), false);
    assert.equal(text.includes(FAKE_KEY), false);
  }
  const { service } = setup({ respond: () => { throw new Error(privateDetail); } });
  const result = await service.POST(request('POST'));
  assert.equal(result.status, 502);
  assert.equal((await result.text()).includes(privateDetail), false);
});

test('DELETE requires the matching opaque id and never uses an arbitrary id as the provider call id', async () => {
  const { service, hangups } = setup();
  assert.equal((await service.POST(request('POST'))).status, 200);
  assert.equal((await service.DELETE(request('DELETE', { id: null }))).status, 400);
  assert.equal((await service.DELETE(request('DELETE', { id: OTHER_SESSION_ID }))).status, 204);
  assert.equal(hangups().length, 0);
  assert.equal((await service.DELETE(request('DELETE'))).status, 204);
  assert.equal(hangups().length, 1);
  assert.equal(hangups()[0].url, 'https://api.openai.com/v1/live/sessions/live_test_call/hangup');
  assert.equal((await service.DELETE(request('DELETE'))).status, 204);
  assert.equal(hangups().length, 1);
});

test('DELETE during a pending provider handshake hangs up as soon as its call id arrives', async () => {
  const upstream = deferred<Response>();
  const entered = deferred<void>();
  const { service, hangups } = setup({ respond: (call) => {
    if (call.url.endsWith('/hangup')) return new Response(null, { status: 200 });
    entered.resolve();
    return upstream.promise;
  } });
  const opening = service.POST(request('POST'));
  await entered.promise;
  assert.equal((await service.DELETE(request('DELETE'))).status, 204);
  assert.equal((await service.POST(request('POST', { id: OTHER_SESSION_ID }))).status, 409);
  upstream.resolve(providerAnswer());
  assert.equal((await opening).status, 409);
  assert.equal(hangups().length, 1);
});

test('aborting a pending handshake also closes the eventual provider call', async () => {
  const upstream = deferred<Response>();
  const entered = deferred<void>();
  const controller = new AbortController();
  const { service, hangups } = setup({ respond: (call) => {
    if (call.url.endsWith('/hangup')) return new Response(null, { status: 200 });
    entered.resolve();
    return upstream.promise;
  } });
  const opening = service.POST(request('POST', { signal: controller.signal }));
  await entered.promise;
  controller.abort();
  upstream.resolve(providerAnswer());
  assert.equal((await opening).status, 409);
  assert.equal(hangups().length, 1);
});

test('the duration timer closes a provider call even without a browser DELETE', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { service, hangups } = setup({ durationMs: 100 });
  assert.equal((await service.POST(request('POST'))).status, 200);
  context.mock.timers.tick(99);
  assert.equal(hangups().length, 0);
  context.mock.timers.tick(1);
  await flushPromises();
  assert.equal(hangups().length, 1);
  assert.equal((await service.POST(request('POST', { id: OTHER_SESSION_ID }))).status, 200);
  await service.DELETE(request('DELETE', { id: OTHER_SESSION_ID }));
});

test('failed hangup disables readiness and blocks future creation', async () => {
  for (const failure of ['http', 'network'] as const) {
    const { service, creates } = setup({ respond: (call) => {
      if (!call.url.endsWith('/hangup')) return providerAnswer();
      if (failure === 'network') throw new Error('fake hangup failure');
      return new Response('fake upstream detail', { status: 500 });
    } });
    assert.equal((await service.POST(request('POST'))).status, 200);
    assert.equal((await service.DELETE(request('DELETE'))).status, 502);
    assert.deepEqual(await (await service.GET(request('GET'))).json(), { ready: false, reason: 'cleanup_failed' });
    assert.equal((await service.POST(request('POST', { id: OTHER_SESSION_ID }))).status, 503);
    assert.equal(creates().length, 1);
  }
});

test('an already-closed provider call is a successful hangup', async () => {
  const { service } = setup({ respond: (call) => call.url.endsWith('/hangup')
    ? new Response(null, { status: 404 }) : providerAnswer() });
  assert.equal((await service.POST(request('POST'))).status, 200);
  assert.equal((await service.DELETE(request('DELETE'))).status, 204);
  assert.deepEqual(await (await service.GET(request('GET'))).json(), { ready: true, reason: null });
});

test('an untrackable provider call blocks retries and an invalid answer is hung up', async () => {
  for (const location of [null, 'https://untrusted.example/v1/realtime/calls/rtc_test']) {
    const { service, calls } = setup({ respond: () => new Response(ANSWER, {
      headers: location ? { location } : {},
    }) });
    assert.equal((await service.POST(request('POST'))).status, 502);
    assert.equal((await service.POST(request('POST'))).status, 503);
    assert.equal(calls.length, 1);
  }
  const { service, hangups } = setup({ respond: (call) => call.url.endsWith('/hangup')
    ? new Response(null, { status: 200 }) : providerAnswer('not valid SDP') });
  assert.equal((await service.POST(request('POST'))).status, 502);
  assert.equal(hangups().length, 1);
});

for (const cancellation of ['DELETE', 'abort'] as const) {
  test(`${cancellation} while reading the provider answer cannot return a successful session`, async () => {
    const reading = deferred<void>();
    const abortController = new AbortController();
    let answerController!: ReadableStreamDefaultController<Uint8Array>;
    const answer = new ReadableStream<Uint8Array>({
      start(controller) { answerController = controller; },
      pull() { reading.resolve(); },
    }, { highWaterMark: 0 });
    const { service, hangups } = setup({ respond: (call) => call.url.endsWith('/hangup')
      ? new Response(null, { status: 200 }) : providerAnswer(answer) });
    const opening = service.POST(request('POST', { signal: abortController.signal }));
    await reading.promise;
    if (cancellation === 'DELETE') {
      assert.equal((await service.DELETE(request('DELETE'))).status, 204);
    } else {
      abortController.abort();
    }
    answerController.enqueue(new TextEncoder().encode(ANSWER));
    answerController.close();
    assert.equal((await opening).status, 409);
    assert.equal(hangups().length, 1);
  });
}

test('a slow offer cannot bypass a hangup failure that occurs while its body is being read', async () => {
  const reading = deferred<void>();
  let offerController!: ReadableStreamDefaultController<Uint8Array>;
  const offer = new ReadableStream<Uint8Array>({
    start(controller) { offerController = controller; },
    pull() { reading.resolve(); },
  }, { highWaterMark: 0 });
  const { service, creates } = setup({ respond: (call) => call.url.endsWith('/hangup')
    ? new Response('fake hangup failure', { status: 500 }) : providerAnswer() });
  const slowOpening = service.POST(request('POST', { body: offer, id: OTHER_SESSION_ID }));
  await reading.promise;
  assert.equal((await service.POST(request('POST'))).status, 200);
  assert.equal((await service.DELETE(request('DELETE'))).status, 502);
  offerController.enqueue(new TextEncoder().encode(OFFER));
  offerController.close();
  assert.equal((await slowOpening).status, 503);
  assert.equal(creates().length, 1);
});


test('Next.js localhost normalization preserves the browser-facing loopback origin', async () => {
  const { service, creates } = setup();
  const offer = request('POST', { url: 'http://localhost:3210/api/session' });
  offer.headers.set('host', '127.0.0.1:3210');
  const response = await service.POST(offer);
  assert.equal(response.status, 200);
  assert.equal(creates().length, 1);
  const end = request('DELETE', { url: 'http://localhost:3210/api/session' });
  end.headers.set('host', '127.0.0.1:3210');
  assert.equal((await service.DELETE(end)).status, 204);
});

test('browser-facing host validation still rejects foreign hosts and mismatched origins', async () => {
  const { service, calls } = setup();
  for (const { host, origin } of [
    { host: 'evil.example:3210', origin: 'http://evil.example:3210' },
    { host: '127.0.0.1:3210', origin: 'http://localhost:3210' },
    { host: '127.0.0.1:3210', origin: 'http://127.0.0.1:3211' },
    { host: '127.0.0.1:3210', origin: 'https://127.0.0.1:3210' },
    { host: '127.0.0.1:3210/ignored', origin: 'http://127.0.0.1:3210' },
    { host: 'user@localhost:3210', origin: 'http://localhost:3210' },
  ]) {
    const incoming = request('POST', { url: 'http://localhost:3210/api/session', origin });
    incoming.headers.set('host', host);
    assert.equal((await service.POST(incoming)).status, 403);
  }
  assert.equal(calls.length, 0);
});

import { liveSessionConfig, liveSessionId, liveSessionUrl } from './gpt-live/protocol';
import { randomUUID } from 'node:crypto';
import { IDLE_SECONDS, SESSION_SECONDS } from './session-config';
import { localRequest, validId } from './local-request';
import { VOICE_INSTRUCTIONS, type VoiceControl, type VoiceControlOptions } from './voice-tools';
import { ExplorationActionSchema } from './visual-contracts';
import { z } from 'zod';
import { ScreenSubmissionSchema } from './screen-contracts';

type Session = {
  id: string;
  callId?: string;
  ended: boolean;
  ending?: Promise<boolean>;
  timer?: ReturnType<typeof setTimeout>;
  control?: VoiceControl;
  installationId?: string;
};

type Options = {
  apiKey: () => string | undefined;
  fetch?: typeof fetch;
  durationMs?: number;
  controlFactory?: (options: VoiceControlOptions) => VoiceControl;
  fixtureMode?: boolean;
  hostedConnection?: boolean;
};

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function readOffer(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/sdp')) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 32_768) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const offer = Buffer.concat(chunks).toString('utf8');
  return offer.startsWith('v=0') && /(?:\r?\n)m=audio /.test(offer) && !/(?:^|\r?\n)m=(?!audio )/.test(offer) && !/(?:^|\r?\n)a=(?:sctp|dcmap|dcsa)/i.test(offer) ? offer : null;
}

// One owning connection, one session. Local routing isolates each connection too.
export function createSessionService(options: Options) {
  const requestOpenAI = options.fetch ?? globalThis.fetch;
  const durationMs = options.durationMs ?? SESSION_SECONDS * 1000;
  let conversation = { instructions: VOICE_INSTRUCTIONS, controlFactory: options.controlFactory };
  let active: Session | undefined;
  let blocked = false;

  async function performHangup(session: Session) {
    if (session.timer) clearTimeout(session.timer);
    const finalUsage = await session.control?.close();
    if (finalUsage?.finalized) { if (active === session) active = undefined; return true; }
    if (!session.callId) return true;
    try {
      const response = await requestOpenAI(
        liveSessionUrl(session.callId, 'hangup'),
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${options.apiKey()}` },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!response.ok && response.status !== 404) {
        blocked = true;
        return false;
      }
      return true;
    } catch {
      blocked = true;
      return false;
    } finally {
      if (active === session) active = undefined;
    }
  }

  function hangup(session: Session) {
    session.ending ??= performHangup(session);
    return session.ending;
  }

  return {
    // Called by the owning WebSocket after pending request bodies have settled.
    async shutdown() {
      if (active) {
        active.ended = true;
        if (active.callId) await hangup(active);
      }
      return !blocked;
    },
    hasActiveSession(installationId: string) { return Boolean(active && active.installationId === installationId); },
    // Dev reloads refresh future conversations while this call and its cleanup
    // state keep their original lifetime.
    updateConversation(next: { instructions: string; controlFactory: Options['controlFactory'] }) {
      conversation = next;
    },

    async ACTION(request: Request) {
      if (!localRequest(request, true)) return json({ error: 'Only same-origin local requests are allowed.' }, 403);
      const session = active;
      if (!session || session.ended || session.id !== request.headers.get('x-voice-session') || !session.control?.act) return json({ error: 'The voice conversation is not active.' }, 409);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Send the exploration request as JSON.' }, 400);
      try {
        const body = await request.text();
        if (body.length > 4096) return json({ error: 'The exploration request is too large.' }, 413);
        const parsed = z.object({ action: ExplorationActionSchema, headlineId: z.string().min(8).max(64).optional() }).strict().safeParse(JSON.parse(body));
        if (!parsed.success) return json({ error: 'The exploration request is invalid.' }, 400);
        if (active !== session || session.ended || request.signal.aborted) return json({ error: 'The voice conversation has ended.' }, 409);
        return json({ ok: true, revision: session.control.act(parsed.data.action, parsed.data.headlineId) }, 202);
      } catch (error) { return json({ error: 'That action is no longer available for the selected story.' }, error instanceof SyntaxError ? 400 : 409); }
    },
    async GET(request: Request) {
      if (!localRequest(request)) return json({ error: 'This prototype is available on localhost only.' }, 403);
      if (options.fixtureMode) return json({ ready: false, reason: 'fixture' });
      const configured = Boolean(options.apiKey());
      return json({ ready: configured && !blocked, reason: blocked ? 'cleanup_failed' : configured ? null : 'missing_key' });
    },

    async POST(request: Request) {
      const { controlFactory } = conversation;
      if (!localRequest(request, true)) return json({ error: 'Only same-origin local requests are allowed.' }, 403);
      if (process.env.VERCEL === '1' && !options.hostedConnection) return json({ error: 'Use the hosted voice connection.' }, 409);
      if (options.fixtureMode) return json({ error: 'Voice is disabled in the fixture preview.' }, 503);
      const apiKey = options.apiKey();
      if (!apiKey) return json({ error: 'The voice connection has not been set up yet.' }, 503);
      if (blocked) return json({ error: 'The previous connection could not be closed. Check the local server before trying again.' }, 503);
      if (active) return json({ error: 'A conversation is already open. End it before starting another.' }, 409);

      const id = request.headers.get('x-voice-session') ?? randomUUID();
      if (!validId(id)) return json({ error: 'Invalid session identifier.' }, 400);
      const installationId = request.headers.get('x-voice-installation');
      if (controlFactory && !validId(installationId)) return json({ error: 'Missing or invalid local installation.' }, 400);
      let offer: string | null;
      try { offer = await readOffer(request); }
      catch { return json({ error: 'The audio connection request was interrupted.' }, 400); }
      if (!offer) return json({ error: 'Invalid audio connection request.' }, 400);
      // Recheck after awaiting the body: two tabs can submit at the same time.
      if (blocked) return json({ error: 'The previous connection could not be closed. Check the local server before trying again.' }, 503);
      if (request.signal.aborted) return json({ error: 'The conversation was canceled.' }, 409);
      if (active) return json({ error: 'A conversation is already open.' }, 409);
      const session: Session = { id, ended: false, installationId: installationId ?? undefined };
      active = session;
      const onAbort = () => { session.ended = true; };
      request.signal.addEventListener('abort', onAbort, { once: true });

      try {
        const response = await requestOpenAI('https://api.openai.com/v1/live/sessions', {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: liveSessionConfig(), transport: { type: 'webrtc', sdp: offer } }),
          redirect: 'error', signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          active = undefined;
          const message = response.status === 401 || response.status === 403
            ? 'The voice connection could not be authorized. Check the key and model access.'
            : response.status === 429
              ? 'The voice service has reached its usage limit. Please try again later.'
              : 'The voice service is unavailable right now. Please try again.';
          return json({ error: message }, response.status === 429 ? 429 : 502);
        }
        const payload = await response.json();
        try { session.callId = liveSessionId(payload?.session?.id); }
        catch { blocked = true; active = undefined; return json({ error: 'The voice service returned an incomplete connection.' }, 502); }
        if (session.ended || request.signal.aborted) {
          await hangup(session);
          return json({ error: 'The conversation was canceled.' }, 409);
        }
        const answer = payload?.transport?.sdp;
        if (session.ended || request.signal.aborted) {
          await hangup(session);
          return json({ error: 'The conversation was canceled.' }, 409);
        }
        if (typeof answer !== 'string' || answer.length > 65536 || !answer.startsWith('v=0') || /(?:^|\r?\n)m=(?!audio )/.test(answer)) {
          await hangup(session);
          return json({ error: 'The voice service returned an invalid connection.' }, 502);
        }
        if (controlFactory && session.installationId) {
          session.control = controlFactory({
            apiKey,
            callId: session.callId,
            installationId: session.installationId,
            onFatal: () => { session.ended = true; void hangup(session); },
            idleTimeoutMs: IDLE_SECONDS * 1000,
          });
          await session.control.ready;
          if (session.ended || request.signal.aborted) {
            await hangup(session);
            return json({ error: 'The conversation was canceled.' }, 409);
          }
        }
        // Node stays alive for this local prototype; this timer also bounds a lost browser.
        session.timer = setTimeout(() => {
          session.ended = true;
          session.control?.close('A little breather. Tap the wave to resume this story.');
          void hangup(session);
        }, durationMs);
        session.timer.unref?.();
        return new Response(answer, {
          headers: {
            'Content-Type': 'application/sdp',
            'Cache-Control': 'no-store',
            'X-Voice-Session': id,
          },
        });
      } catch {
        if (session.callId) await hangup(session);
        else if (active === session) { active = undefined; blocked = true; }
        return json({ error: 'The voice connection timed out. Please try again.' }, 502);
      } finally {
        request.signal.removeEventListener('abort', onAbort);
      }
    },

    async DELETE(request: Request) {
      if (!localRequest(request, true)) return json({ error: 'Only same-origin local requests are allowed.' }, 403);
      const id = request.headers.get('x-voice-session');
      if (!id) return json({ error: 'Missing session identifier.' }, 400);
      if (!active || active.id !== id) return new Response(null, { status: 204 });
      active.ended = true;
      // A canceled handshake is allowed to finish so its call ID can be hung up.
      if (!active.callId) return new Response(null, { status: 204 });
      const ended = await hangup(active);
      return ended ? new Response(null, { status: 204 }) : json({ error: 'The connection could not be closed at the voice service.' }, 502);
    },

    async STORY(request: Request) {
      if (!localRequest(request, true)) return json({ error: 'Only same-origin local requests are allowed.' }, 403);
      const session = active;
      if (!session || session.ended || session.id !== request.headers.get('x-voice-session') || !session.control) {
        return json({ error: 'Start a voice conversation before selecting a story.' }, 409);
      }
      if (!request.headers.get('content-type')?.startsWith('application/json') || !request.body) return json({ error: 'Invalid story selection.' }, 400);
      const reader = request.body.getReader();
      let text = '';
      let length = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 1024) { await reader.cancel(); return json({ error: 'Invalid story selection.' }, 400); }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        const input: unknown = JSON.parse(text);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !('headlineId' in input) || typeof input.headlineId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(input.headlineId)) {
          return json({ error: 'Invalid story selection.' }, 400);
        }
        if (request.signal.aborted || active !== session || session.ended) return json({ error: 'The conversation has ended.' }, 409);
        const revision = session.control.selectStory(input.headlineId);
        return json({ ok: true, revision }, 202);
      } catch {
        return json({ error: 'The story selection could not be completed.' }, 400);
      } finally {
        reader.releaseLock();
      }
    },

    async SCREEN(request: Request) {
      if (!localRequest(request, true)) return json({ error: 'Only same-origin local requests are allowed.' }, 403);
      const session = active;
      if (!session || session.ended || session.id !== request.headers.get('x-voice-session') || !session.control?.reportScreen) return json({ error: 'The voice conversation is not active.' }, 409);
      if (!request.headers.get('content-type')?.startsWith('application/json') || !request.body) return json({ error: 'Send the screen result as JSON.' }, 400);
      const reader = request.body.getReader();
      try {
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 8192) { await reader.cancel(); return json({ error: 'The screen result is too large.' }, 413); }
          chunks.push(value);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (active !== session || session.ended || request.signal.aborted) return json({ error: 'The conversation has ended.' }, 409);
        const audio = z.object({ type: z.literal('audio'), inputActive: z.boolean(), outputActive: z.boolean() }).strict().safeParse(body);
        if (audio.success) { session.control.observeAudio?.(audio.data); return new Response(null, { status: 204 }); }
        const parsed = ScreenSubmissionSchema.safeParse(body);
        if (!parsed.success) return json({ error: 'Invalid screen result.' }, 400);
        if (active !== session || session.ended || request.signal.aborted) return json({ error: 'The conversation has ended.' }, 409);
        if ('type' in parsed.data) {
          const accepted = session.control.observeScreen?.(parsed.data.screen, parsed.data.sequence);
          return accepted ? new Response(null, { status: 204 }) : json({ error: 'The screen belongs to an older view.' }, 409);
        }
        return session.control.reportScreen(parsed.data) ? new Response(null, { status: 204 }) : json({ error: 'That screen request has expired.' }, 409);
      } catch { return json({ error: 'Invalid screen result.' }, 400); }
      finally { reader.releaseLock(); }
    },

    async EVENTS(request: Request) {
      if (!localRequest(request)) return json({ error: 'Only same-origin local requests are allowed.' }, 403);
      const session = active;
      if (!session || session.ended || session.id !== request.headers.get('x-voice-session') || !session.control) return json({ error: 'The conversation has ended.' }, 409);
      const control = session.control;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let end = () => {};
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(output) {
          let finished = false;
          end = () => {
            if (finished) return;
            finished = true;
            unsubscribe();
            if (heartbeat) clearInterval(heartbeat);
            request.signal.removeEventListener('abort', end);
            try { output.close(); } catch { /* The browser may already have canceled. */ }
          };
          unsubscribe = control.subscribe((event) => {
            if (finished) return;
            output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            if (event.type === 'ended') end();
          });
          if (finished) { unsubscribe(); return; }
          heartbeat = setInterval(() => output.enqueue(encoder.encode(': keepalive\n\n')), 15_000);
          heartbeat.unref?.();
          request.signal.addEventListener('abort', end, { once: true });
          if (request.signal.aborted) end();
        },
        cancel() { end(); },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
    },
  };
}

/** Local HTTP requests use the same per-connection isolation as hosted sockets. */
export function createLocalSessionRouter(options: Options) {
  const readiness = createSessionService(options);
  const sessions = new Map<string, { service: ReturnType<typeof createSessionService>; timer: ReturnType<typeof setTimeout> }>();
  let conversation = { instructions: VOICE_INSTRUCTIONS, controlFactory: options.controlFactory };
  type Operation = 'GET' | 'POST' | 'DELETE' | 'STORY' | 'ACTION' | 'SCREEN' | 'EVENTS';
  async function route(operation: Operation, request: Request) {
    if (!localRequest(request, operation !== 'GET' && operation !== 'EVENTS')) return json({ error: 'Only same-origin local requests are allowed.' }, 403);
    const id = request.headers.get('x-voice-session');
    if (operation === 'GET' && !id) return readiness.GET(request);
    if (!validId(id)) return json({ error: 'Missing or invalid session identifier.' }, 400);
    let entry = sessions.get(id);
    if (!entry && operation === 'POST') {
      const service = createSessionService(options);
      service.updateConversation(conversation);
      const timer = setTimeout(() => {
        sessions.delete(id);
        void service.shutdown();
      }, (SESSION_SECONDS + 30) * 1000);
      timer.unref?.();
      entry = { service, timer }; sessions.set(id, entry);
    }
    if (!entry) return operation === 'GET' ? readiness.GET(request)
      : operation === 'DELETE' ? new Response(null, { status: 204 })
        : json({ error: 'The voice conversation is not active.' }, 409);
    return entry.service[operation](request);
  }
  return {
    GET: (request: Request) => route('GET', request),
    POST: (request: Request) => route('POST', request),
    DELETE: (request: Request) => route('DELETE', request),
    STORY: (request: Request) => route('STORY', request),
    ACTION: (request: Request) => route('ACTION', request),
    SCREEN: (request: Request) => route('SCREEN', request),
    EVENTS: (request: Request) => route('EVENTS', request),
    hasActiveSession: (installationId: string) => [...sessions.values()].some(entry => entry.service.hasActiveSession(installationId)),
    updateConversation(next: typeof conversation) {
      conversation = next;
      readiness.updateConversation(next);
      for (const entry of sessions.values()) entry.service.updateConversation(next);
    },
    async shutdown() {
      const closing = [...sessions.values()]; sessions.clear();
      for (const entry of closing) clearTimeout(entry.timer);
      const results = await Promise.allSettled(closing.map(entry => entry.service.shutdown()));
      return results.every(result => result.status === 'fulfilled' && result.value);
    },
  };
}

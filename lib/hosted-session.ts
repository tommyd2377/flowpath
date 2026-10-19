import { randomUUID } from 'node:crypto';
import type { WebSocket, RawData } from 'ws';
import { z } from 'zod';
import type { createSessionService } from './session-server';
import type { GenerationCacheRepository } from './atlas/server/generation-cache';

export const HOSTED_CONNECTION_MS = 285_000;
const Frame = z.object({
  id: z.string().uuid(),
  operation: z.enum(['GET', 'POST', 'DELETE', 'STORY', 'ACTION', 'SCREEN', 'EVENTS']),
  sessionId: z.string().uuid(),
  installationId: z.string().uuid(),
  body: z.string().max(32_768).optional(),
}).strict();
const Cancel = z.object({ cancel: z.string().uuid() }).strict();
type Service = ReturnType<typeof createSessionService>;
type LeaseRepository = Pick<GenerationCacheRepository, 'acquireLease' | 'releaseLease' | 'leaseExpiresAt'>;

export class HostedAdmissionError extends Error {
  constructor(readonly code: 'session_active' | 'start_cooldown' | 'cleanup_pending', readonly retryAfterSeconds: number) {
    super(code === 'start_cooldown'
      ? `Please wait ${retryAfterSeconds} seconds between voice starts, then tap the wave again.`
      : code === 'cleanup_pending'
        ? `Your previous voice connection is still closing. Try again in up to ${retryAfterSeconds} seconds.`
        : `A voice conversation is already active on this site. Only one can run at a time. End it in the other tab or device, or try again in up to ${retryAfterSeconds} seconds.`);
  }
}

async function admissionError(repository: LeaseRepository, key: string, now: number, code: HostedAdmissionError['code']) {
  const expires = await repository.leaseExpiresAt(key);
  return new HostedAdmissionError(code, Math.max(1, Math.ceil(((expires ?? now + 1000) - now) / 1000)));
}

// Preserve the personal prototype's single-call capacity across cold starts.
// A failed cleanup retains its lease until expiry. A separate 20-second lease
// bounds repeated starts across connections, including failed handshakes.
export async function claimHostedSession(repository: LeaseRepository, installationId: string, now = Date.now()) {
  const ownerToken = randomUUID();
  const key = 'hosted-voice:active:v1';
  const active = await repository.acquireLease({ key, ownerToken, now, ttlMs: HOSTED_CONNECTION_MS + 30_000 });
  if (!active) throw await admissionError(repository, key, now, 'session_active');
  const installationKey = `hosted-installation:${installationId}`;
  try {
    const allowed = await repository.acquireLease({ key: 'hosted-voice:start:v1', ownerToken, now, ttlMs: 20_000 });
    if (!allowed) throw await admissionError(repository, 'hosted-voice:start:v1', now, 'start_cooldown');
    if (!await repository.acquireLease({ key: installationKey, ownerToken, now, ttlMs: HOSTED_CONNECTION_MS + 30_000 })) {
      throw await admissionError(repository, installationKey, now, 'cleanup_pending');
    }
    return async () => { await repository.releaseLease(installationKey, ownerToken); await repository.releaseLease(key, ownerToken); };
  } catch (error) {
    await repository.releaseLease(key, ownerToken);
    throw error;
  }
}

export function serveHostedSession(socket: WebSocket, options: {
  origin: string;
  service: Service;
  claim: (installationId: string) => Promise<(() => Promise<void>) | null>;
  lifetimeMs?: number;
}) {
  const { service, origin } = options;
  const pending = new Map<string, AbortController>();
  const jobs = new Set<Promise<void>>();
  const seen = new Set<string>();
  let identity: { sessionId: string; installationId: string } | undefined;
  let postStarted = false;
  let eventsStarted = false;
  let closing = false;
  let release: (() => Promise<void>) | undefined;
  let startJob: Promise<void> | undefined;
  let finished!: () => void;
  const done = new Promise<void>(resolve => { finished = resolve; });
  const send = (value: object) => {
    if (!closing && socket.readyState === 1) {
      if (socket.bufferedAmount > 2_000_000) { socket.close(1008, 'Slow connection'); void close(); return; }
      socket.send(JSON.stringify(value));
    }
  };
  const timer = setTimeout(() => { socket.close(1000, 'Session limit'); void close(); }, options.lifetimeMs ?? HOSTED_CONNECTION_MS);
  const setupTimer = setTimeout(() => { if (!postStarted) { socket.close(1000, 'Connection expired'); void close(); } }, 35_000);
  let pong = true;
  const heartbeat = setInterval(() => {
    if (!pong) { socket.terminate(); void close(); return; }
    pong = false;
    socket.ping();
  }, 20_000);
  socket.on('pong', () => { pong = true; });

  async function close() {
    if (closing) return done;
    closing = true;
    clearTimeout(timer); clearTimeout(setupTimer); clearInterval(heartbeat);
    for (const controller of pending.values()) controller.abort();
    await Promise.allSettled([...jobs]);
    try {
      const cleaned = await service.shutdown();
      if (cleaned) await release?.();
    } catch { /* Retain the durable lease if cleanup could not be confirmed. */ }
    finally { finished(); }
    return done;
  }

  async function handle(frame: z.infer<typeof Frame>, controller: AbortController) {
    const { id, operation } = frame;
    try {
      if (operation === 'POST') {
        if (postStarted) { send({ id, status: 409, body: '{"error":"This connection already started a conversation."}' }); return; }
        postStarted = true;
        clearTimeout(setupTimer);
        release = (await options.claim(frame.installationId)) ?? undefined;
        if (!release) throw new HostedAdmissionError('session_active', 20);
      }
      // A canceled handshake can still be waiting for its provider ID. Its job
      // must finish cleanup before DELETE confirms that a restart is safe.
      if (operation === 'DELETE') await startJob;
      if (closing || controller.signal.aborted) return;
      if (operation === 'EVENTS') {
        if (eventsStarted) { send({ id, status: 409, body: '{"error":"The event stream is already open."}' }); return; }
        eventsStarted = true;
      }
      const method = ['GET', 'EVENTS'].includes(operation) ? 'GET' : operation === 'DELETE' ? 'DELETE' : 'POST';
      const headers = {
        origin, host: new URL(origin).host,
        'x-voice-session': frame.sessionId, 'x-voice-installation': frame.installationId,
        'content-type': operation === 'POST' ? 'application/sdp' : 'application/json',
      };
      const response = await service[operation](new Request(`${origin}/api/session`, {
        method, headers, signal: controller.signal,
        ...(method === 'POST' ? { body: frame.body ?? '' } : {}),
      }));
      // Release admission before acknowledging a confirmed hangup, rather than
      // making the next connection race this WebSocket's close event.
      if (operation === 'DELETE' && response.ok) {
        if (!await service.shutdown()) {
          send({ id, status: 502, body: '{"error":"The previous voice connection could not be closed. Wait for the session limit before reconnecting."}' });
          return;
        }
        await release?.(); release = undefined;
      }
      if (operation !== 'EVENTS' || !response.ok || !response.body) {
        send({ id, status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
        return;
      }
      send({ id, status: response.status, headers: Object.fromEntries(response.headers), stream: true });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (!closing && !controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          send({ id, chunk: decoder.decode(chunk.value, { stream: true }) });
        }
        send({ id, end: true });
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (error) {
      if (error instanceof HostedAdmissionError) {
        console.info('[flowpath:voice_admission_rejected]', JSON.stringify({ code: error.code, retryAfterSeconds: error.retryAfterSeconds }));
        send({ id, status: error.code === 'start_cooldown' ? 429 : 409,
          headers: { 'retry-after': String(error.retryAfterSeconds) },
          body: JSON.stringify({ error: error.message, code: error.code, retryAfterSeconds: error.retryAfterSeconds }) });
        return;
      }
      send({ id, status: 503, body: '{"error":"The hosted connection is temporarily unavailable."}' });
    }
  }

  socket.on('message', (raw: RawData, binary: boolean) => {
    if (closing) return;
    let data: unknown;
    try { if (binary || raw.toString().length > 65_536) throw new Error(); data = JSON.parse(raw.toString()); }
    catch { socket.close(1008, 'Invalid request'); void close(); return; }
    const cancel = Cancel.safeParse(data);
    if (cancel.success) { pending.get(cancel.data.cancel)?.abort(); return; }
    const parsed = Frame.safeParse(data);
    if (!parsed.success) { socket.close(1008, 'Invalid request'); void close(); return; }
    const frame = parsed.data;
    if (seen.has(frame.id)) return; // An RPC is never executed twice.
    if (seen.size >= 4096 || pending.size >= 16 || (identity && (identity.sessionId !== frame.sessionId || identity.installationId !== frame.installationId))) {
      socket.close(1008, 'Connection limit'); void close(); return;
    }
    identity ??= frame;
    seen.add(frame.id);
    const controller = new AbortController();
    pending.set(frame.id, controller);
    const job = handle(frame, controller).finally(() => { pending.delete(frame.id); jobs.delete(job); });
    if (frame.operation === 'POST' && !startJob) startJob = job;
    jobs.add(job);
  });
  socket.on('close', () => { void close(); });
  socket.on('error', () => { socket.terminate(); void close(); });
  return done;
}

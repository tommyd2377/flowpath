import { newsDemoAccess } from '@/lib/demo-access-runtime';
import { experimental_upgradeWebSocket, getDeadline } from '@vercel/functions';
import { createSessionService } from '@/lib/session-server';
import { createRealtimeControl } from '@/lib/realtime-control';
import { explorationService } from '@/lib/exploration-server';
import { getGenerationCacheRepository } from '@/lib/atlas/server/generation-cache';
import { claimHostedSession, HOSTED_CONNECTION_MS, serveHostedSession } from '@/lib/hosted-session';
import { HOSTED_SESSION_SECONDS } from '@/lib/session-config';
import { localRequest } from '@/lib/local-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (process.env.VERCEL !== '1' || !localRequest(request, true)) return new Response(null, { status: 403 });
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 426 });
  if (!await newsDemoAccess.allowed(request)) return Response.json({ error: 'Enter the demo code first.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  const deadline = getDeadline()?.getTime();
  const lifetimeMs = Math.min(HOSTED_CONNECTION_MS, deadline ? deadline - Date.now() - 15_000 : HOSTED_CONNECTION_MS);
  if (lifetimeMs < 60_000) return new Response(null, { status: 503 });
  return experimental_upgradeWebSocket(socket => serveHostedSession(socket, {
    origin: request.headers.get('origin')!, lifetimeMs,
    claim: (installationId, sessionId) => claimHostedSession(getGenerationCacheRepository(), installationId, sessionId),
    service: createSessionService({
      hostedConnection: true,
      authorizeStart: () => newsDemoAccess.allowed(request),
      durationMs: HOSTED_SESSION_SECONDS * 1000,
      fixtureMode: process.env.VOICE_FIXTURE_MODE === '1',
      apiKey: () => process.env.VOICE_FIXTURE_MODE === '1' ? undefined : process.env.OPENAI_API_KEY,
      controlFactory: options => createRealtimeControl({ ...options, exploration: explorationService }),
    }),
  }), { maxPayload: 65_536 });
}

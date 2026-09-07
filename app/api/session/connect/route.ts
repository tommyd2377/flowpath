import { experimental_upgradeWebSocket, getDeadline } from '@vercel/functions';
import { createSessionService } from '@/lib/session-server';
import { createRealtimeControl } from '@/lib/realtime-control';
import { explorationService } from '@/lib/exploration-server';
import { getGenerationCacheRepository } from '@/lib/atlas/server/generation-cache';
import { claimHostedSession, HOSTED_CONNECTION_MS, serveHostedSession } from '@/lib/hosted-session';
import { localRequest } from '@/lib/local-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function GET(request: Request) {
  if (process.env.VERCEL !== '1' || !localRequest(request, true)) return new Response(null, { status: 403 });
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 426 });
  const deadline = getDeadline()?.getTime();
  const lifetimeMs = Math.min(HOSTED_CONNECTION_MS, deadline ? deadline - Date.now() - 15_000 : HOSTED_CONNECTION_MS);
  if (lifetimeMs < 60_000) return new Response(null, { status: 503 });
  return experimental_upgradeWebSocket(socket => serveHostedSession(socket, {
    origin: request.headers.get('origin')!, lifetimeMs,
    claim: installationId => claimHostedSession(getGenerationCacheRepository(), installationId),
    service: createSessionService({
      hostedConnection: true,
      fixtureMode: process.env.VOICE_FIXTURE_MODE === '1',
      apiKey: () => process.env.VOICE_FIXTURE_MODE === '1' ? undefined : process.env.OPENAI_API_KEY,
      controlFactory: options => createRealtimeControl({ ...options, exploration: explorationService }),
    }),
  }), { maxPayload: 65_536 });
}

import { getGenerationCacheRepository, resolveGenerationDatabaseConfig } from '@/lib/atlas/server/generation-cache';
import { localRequest } from '@/lib/local-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!localRequest(request)) return new Response(null, { status: 403 });
  try {
    const config = resolveGenerationDatabaseConfig();
    await getGenerationCacheRepository().initialize();
    return Response.json({
      status: 'ok', app: 'The Voice', database: config.local ? 'local' : 'remote',
      voiceConfigured: Boolean(process.env.OPENAI_API_KEY),
      transport: process.env.VERCEL === '1' ? 'websocket' : 'http',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'unavailable', app: 'The Voice', database: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

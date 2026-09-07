import { voiceSessions } from '@/lib/session-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => voiceSessions.ACTION(request);

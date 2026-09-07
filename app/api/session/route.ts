import { voiceSessions } from '@/lib/session-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = voiceSessions.GET;
export const POST = voiceSessions.POST;
export const DELETE = voiceSessions.DELETE;

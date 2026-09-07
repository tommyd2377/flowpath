import { explorationService } from "@/lib/exploration-server";
import { errorResponse } from "@/lib/atlas/server/http";
import { localRequest, validId } from "@/lib/local-request";
import { hasActiveVoiceSession } from "@/lib/session-runtime";
import { ExplorationActionSchema } from "@/lib/visual-contracts";
import { runExplorationAction } from "@/lib/exploration-actions";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  if (!localRequest(request)) return Response.json({ error: "Use this app from localhost." }, { status: 403 });
  const installationId = request.headers.get("x-voice-installation");
  if (!installationId || !validId(installationId)) return Response.json({ error: "A valid local installation is required." }, { status: 400 });
  try {
    return Response.json({ ...await explorationService.restore(installationId), display: await explorationService.getDisplay(installationId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!localRequest(request, true)) return Response.json({ error: "Only same-origin local requests are allowed." }, { status: 403 });
  const installationId = request.headers.get('x-voice-installation');
  if (!installationId || !validId(installationId)) return Response.json({ error: 'A valid local installation is required.' }, { status: 400 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'Send the exploration request as JSON.' }, { status: 400 });
  try {
    if (await hasActiveVoiceSession(installationId)) return Response.json({ error: 'Use the controls in your active voice conversation.' }, { status: 409 });
    const text = await request.text();
    if (text.length > 4096) return Response.json({ error: 'The exploration request is too large.' }, { status: 413 });
    const parsed = z.object({ action: ExplorationActionSchema, headlineId: z.string().min(8).max(64).optional() }).strict().safeParse(JSON.parse(text));
    if (!parsed.success) return Response.json({ error: 'The exploration request is invalid.' }, { status: 400 });
    if (parsed.data.action.type === 'start_briefing') return Response.json({ error: 'Start a voice conversation to hear the briefing.' }, { status: 409 });
    if (request.signal.aborted || await hasActiveVoiceSession(installationId)) return Response.json({ error: 'Use the controls in your active voice conversation.' }, { status: 409 });
    return Response.json({ display: await runExplorationAction(installationId, parsed.data.action, request.signal, parsed.data.headlineId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: 'The exploration request is invalid.' }, { status: 400 });
    return errorResponse(error);
  }
}

import { explorationService } from "@/lib/exploration-server";
import { errorResponse, normalizeAtlasError } from "@/lib/atlas/server/http";
import { localRequest, validId } from "@/lib/local-request";
import { hasActiveVoiceSession } from "@/lib/session-runtime";
import { ExplorationActionSchema, type ExplorationDisplay } from "@/lib/visual-contracts";
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
    if (parsed.data.action.type === 'start_walkthrough' || parsed.data.action.type === 'stop_walkthrough') return Response.json({ error: 'Start a voice conversation to hear a walkthrough.' }, { status: 409 });
    if (request.signal.aborted || await hasActiveVoiceSession(installationId)) return Response.json({ error: 'Use the controls in your active voice conversation.' }, { status: 409 });
    if (parsed.data.action.type === 'select_story' && request.headers.get('accept')?.includes('application/x-ndjson')) {
      const cancelled = new AbortController();
      const signal = AbortSignal.any([request.signal, cancelled.signal]);
      const encoder = new TextEncoder();
      let open = true;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const publish = (display: ExplorationDisplay, complete = false) => {
            if (open && !signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify({ display, complete })}\n`));
          };
          void runExplorationAction(installationId, parsed.data.action, signal, parsed.data.headlineId, publish)
            .then(display => publish(display, true))
            .catch(error => {
              if (open && !signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify({ error: normalizeAtlasError(error).message })}\n`));
            }).finally(() => { if (open) { open = false; controller.close(); } });
        },
        cancel() { open = false; cancelled.abort(); },
      });
      return new Response(body, { headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' } });
    }
    return Response.json({ display: await runExplorationAction(installationId, parsed.data.action, request.signal, parsed.data.headlineId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: 'The exploration request is invalid.' }, { status: 400 });
    return errorResponse(error);
  }
}

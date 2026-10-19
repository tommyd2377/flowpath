import { localRequest } from "@/lib/local-request";
import { getVoiceStories } from "@/lib/story-catalog";
import type { StoryCatalogResponse } from "@/lib/story-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const headers = { "Cache-Control": "private, no-store, max-age=0", "CDN-Cache-Control": "no-store", Pragma: "no-cache" };

export async function GET(request: Request) {
  if (!localRequest(request)) return Response.json({ error: "Use this app from localhost." }, { status: 403, headers });
  if (request.headers.get("accept")?.includes("application/x-ndjson")) {
    const cancelled = new AbortController();
    const signal = AbortSignal.any([request.signal, cancelled.signal]);
    const encoder = new TextEncoder();
    let open = true;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let previous = "";
        const publish = (catalog: StoryCatalogResponse) => {
          const next = JSON.stringify(catalog);
          if (!open || next === previous) return;
          previous = next;
          controller.enqueue(encoder.encode(`${next}\n`));
        };
        void getVoiceStories(signal, publish).then(publish).catch(() => {
          if (open && !signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify({ error: "The story catalog is temporarily unavailable." })}\n`));
        }).finally(() => { if (open) { open = false; controller.close(); } });
      },
      cancel() { open = false; cancelled.abort(); },
    });
    return new Response(body, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" } });
  }
  try {
    return Response.json(await getVoiceStories(request.signal), { headers });
  } catch {
    return Response.json({ error: "The story catalog is temporarily unavailable." }, { status: 503, headers });
  }
}

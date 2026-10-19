import { z } from 'zod';
import { ExplorationDisplaySchema, type ExplorationDisplay } from './visual-contracts';

const FrameSchema = z.union([
  z.object({ display: ExplorationDisplaySchema, complete: z.boolean() }).strict(),
  z.object({ error: z.string().min(1).max(300) }).strict(),
]);
const MAX_DISPLAY_BYTES = 2_097_152;

/** Publish checked display stages, retaining the last useful stage if the map fails. */
export async function readExplorationResponse(response: Response, accept: (display: ExplorationDisplay, complete: boolean) => void) {
  if (!response.ok || !response.body) throw new Error('The story could not be opened. Try again.');
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const display = ExplorationDisplaySchema.safeParse((await response.json()).display);
    if (!display.success) throw new Error('The story returned an incomplete display. Try again.');
    accept(display.data, true);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', bytes = 0;
  const publish = (text: string) => {
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error('The story returned an incomplete display. Try again.'); }
    const frame = FrameSchema.safeParse(value);
    if (!frame.success) throw new Error('The story returned an incomplete display. Try again.');
    if ('error' in frame.data) throw new Error(frame.data.error);
    accept(frame.data.display, frame.data.complete);
    return frame.data.complete;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > MAX_DISPLAY_BYTES) throw new Error('The story display is too large. Try again.');
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line && publish(line)) return;
      }
      if (done) break;
    }
    if (buffer.trim() && publish(buffer)) return;
    throw new Error('The possibility map did not finish. Your available context is still here.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

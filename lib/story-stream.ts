import { StoryCatalogResponseSchema, type StoryCatalogResponse } from './story-contracts';

const MAX_CATALOG_BYTES = 1_048_576;

/** Accept complete, validated catalog stages, including across arbitrary network chunks. */
export async function readStoryCatalogResponse(response: Response, accept: (catalog: StoryCatalogResponse) => void) {
  if (!response.ok || !response.body) throw new Error('Stories unavailable');
  const streaming = response.headers.get('content-type')?.includes('application/x-ndjson');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', bytes = 0;
  const publish = (text: string) => {
    const catalog = StoryCatalogResponseSchema.parse(JSON.parse(text));
    accept(catalog);
    return catalog.complete !== false;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > MAX_CATALOG_BYTES) throw new Error('The story catalog is too large');
      buffer += decoder.decode(value, { stream: !done });
      if (streaming) {
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line && publish(line)) return;
        }
      }
      if (done) break;
    }
    if (buffer.trim() && publish(buffer)) return;
    throw new Error('The story catalog did not finish');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

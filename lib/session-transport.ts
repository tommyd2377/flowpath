export type SessionTransport = {
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => void;
};

const operations: Record<string, string> = {
  '/api/session/story': 'STORY', '/api/session/action': 'ACTION',
  '/api/session/screen': 'SCREEN', '/api/session/events': 'EVENTS',
};

export function createSessionTransport(options: {
  sessionId: string;
  installationId: string;
  onDisconnect: () => void;
  hosted?: boolean;
}): SessionTransport {
  if (!(options.hosted ?? process.env.NEXT_PUBLIC_VOICE_HOSTED === '1')) {
    return { fetch: (path, init) => fetch(path, init), close: () => {} };
  }
  const url = new URL('/api/session/connect', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  type Pending = {
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
    stream?: ReadableStreamDefaultController<Uint8Array>;
    cleanup: () => void;
    timer: ReturnType<typeof setTimeout>;
  };
  const pending = new Map<string, Pending>();
  let closed = false;
  let ready!: () => void;
  let failed!: (error: Error) => void;
  const opened = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
  // Closing before the first request is valid (for example an immediate tap off).
  void opened.catch(() => {});

  const reject = (id: string, error: Error) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer); request.cleanup();
    if (request.stream) request.stream.error(error);
    else request.reject(error);
  };
  function disconnect(intentional: boolean) {
    if (closed) return;
    closed = true;
    const error = new Error('The hosted voice connection ended. Tap the wave to reconnect.');
    failed(error);
    for (const id of pending.keys()) reject(id, error);
    if (!intentional) options.onDisconnect();
  }
  socket.addEventListener('open', () => ready());
  socket.addEventListener('close', () => disconnect(false));
  socket.addEventListener('error', () => { disconnect(false); socket.close(); });
  socket.addEventListener('message', event => {
    try {
      if (typeof event.data !== 'string' || event.data.length > 2_000_000) throw new Error();
      const frame = JSON.parse(event.data);
      const request = pending.get(frame.id);
      if (!request) return;
      if (typeof frame.chunk === 'string' && request.stream) {
        request.stream.enqueue(new TextEncoder().encode(frame.chunk));
      } else if (frame.end && request.stream) {
        request.stream.close(); request.cleanup(); clearTimeout(request.timer); pending.delete(frame.id);
      } else if (Number.isInteger(frame.status) && frame.status >= 200 && frame.status <= 599) {
        if (request.stream) { reject(frame.id, new Error('The voice event stream ended unexpectedly.')); return; }
        clearTimeout(request.timer);
        if (frame.stream) {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) { request.stream = controller; },
            cancel() {
              pending.delete(frame.id); request.cleanup();
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ cancel: frame.id }));
            },
          });
          request.resolve(new Response(stream, { status: frame.status, headers: frame.headers }));
        } else {
          pending.delete(frame.id); request.cleanup();
          request.resolve(new Response([204, 205, 304].includes(frame.status) ? null : frame.body ?? '', { status: frame.status, headers: frame.headers }));
        }
      } else throw new Error();
    } catch { disconnect(false); socket.close(1008, 'Invalid response'); }
  });

  return {
    close() { disconnect(true); socket.close(1000, 'Conversation ended'); },
    fetch(path, init = {}) {
      if (closed) return Promise.reject(new Error('The voice connection has ended.'));
      const operation = path === '/api/session' ? init.method ?? 'GET' : operations[path];
      if (!operation || (init.body !== undefined && typeof init.body !== 'string')) return Promise.reject(new Error('Invalid voice request.'));
      return new Promise<Response>((resolve, rejectRequest) => {
        const id = crypto.randomUUID();
        const abort = () => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ cancel: id }));
          reject(id, new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
          reject(id, new Error('The hosted connection took too long. Please reconnect.'));
          disconnect(false); socket.close();
        }, 25_000);
        pending.set(id, { resolve, reject: rejectRequest, timer, cleanup: () => init.signal?.removeEventListener('abort', abort) });
        init.signal?.addEventListener('abort', abort, { once: true });
        if (init.signal?.aborted) { abort(); return; }
        void opened.then(() => {
          if (pending.has(id) && !closed) socket.send(JSON.stringify({
            id, operation, sessionId: options.sessionId, installationId: options.installationId,
            ...(init.body === undefined ? {} : { body: init.body }),
          }));
        }).catch(error => reject(id, error));
      });
    },
  };
}

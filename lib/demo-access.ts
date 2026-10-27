import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { localRequest } from './local-request';

type Leases = {
  acquireLease(input: { key: string; ownerToken: string; now: number; ttlMs: number }): Promise<boolean>;
  hasLease(key: string, now: number): Promise<boolean>;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
// Same temporary code as Studio; only its verifier is stored in server source.
const CODE_DIGEST = '63fd0648bc9994c3f86cbe9aa0179525d5f2fd2d6c576234404cf1e27811cbed';
const GRANT_MS = 86_400_000;
const names = (request: Request) => new URL(request.url).protocol === 'https:'
  ? ['__Host-flowpath_news_access', '__Host-flowpath_news_attempt'] : ['flowpath_news_access', 'flowpath_news_attempt'];
function token(request: Request, name: string) {
  const values = (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
  const value = values.length === 1 ? values[0].slice(name.length + 1) : '';
  return /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
const json = (body: object, status = 200, cookie?: string) => Response.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
});
const cookie = (request: Request, name: string, value: string, seconds: number) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;

/** Separate News grant leases. They grant voice access, never accounts or extra usage. */
export function createNewsDemoAccess(leases: () => Leases, options: { now?: () => number; codeDigest?: string } = {}) {
  const now = options.now ?? Date.now;
  async function claimSlots(scope: string, limit: number, window: number) {
    const time = now(), bucket = Math.floor(time / window);
    for (let slot = 0; slot < limit; slot++) {
      if (await leases().acquireLease({ key: `news-demo-attempt:${scope}:${bucket}:${slot}`, ownerToken: 'attempt', now: time, ttlMs: window })) return true;
    }
    return false;
  }
  async function allowed(request: Request) {
    if (!localRequest(request)) return false;
    const grant = token(request, names(request)[0]);
    return !!grant && leases().hasLease(`news-demo-grant:${hash(grant)}`, now());
  }
  return {
    allowed,
    async GET(request: Request) {
      if (!localRequest(request)) return json({ error: 'Only requests from this app are allowed.' }, 403);
      try {
        const accepted = await allowed(request), challenge = token(request, names(request)[1]) ?? randomBytes(32).toString('hex');
        return json({ enabled: true, allowed: accepted }, 200, cookie(request, names(request)[1], challenge, 1800));
      } catch { return json({ error: 'Demo access is temporarily unavailable.' }, 503); }
    },
    async POST(request: Request) {
      if (!localRequest(request, true)) return json({ error: 'Only same-origin requests are allowed.' }, 403);
      const challenge = token(request, names(request)[1]);
      if (!challenge) return json({ error: 'Refresh the page before entering the code.' }, 400);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Enter a valid demo code.' }, 400);
      let text = '';
      try {
        if (!request.body) return json({ error: 'Enter a valid demo code.' }, 400);
        const reader = request.body.getReader();
        try {
          const chunks: Uint8Array[] = []; let bytes = 0;
          while (true) { const part = await reader.read(); if (part.done) break;
            bytes += part.value.byteLength; if (bytes > 256) { await reader.cancel(); return json({ error: 'Enter a valid demo code.' }, 400); } chunks.push(part.value); }
          text = Buffer.concat(chunks).toString('utf8');
        } finally { reader.releaseLock(); }
        const body = JSON.parse(text);
        if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.code !== 'string' || body.code.length > 80) return json({ error: 'Enter a valid demo code.' }, 400);
        // Exact, case-sensitive shared code; spaces are significant.
        const actual = Buffer.from(hash(body.code), 'hex');
        const expected = Buffer.from(options.codeDigest ?? CODE_DIGEST, 'hex');
        if (!await claimSlots('global', 60, 60_000) || !await claimSlots(hash(challenge), 6, 600_000)) return json({ error: 'Too many code attempts. Please wait before trying again.' }, 429);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json({ error: 'That demo code is incorrect.' }, 403);
        const grant = randomBytes(32).toString('hex');
        if (!await leases().acquireLease({ key: `news-demo-grant:${hash(grant)}`, ownerToken: 'grant', now: now(), ttlMs: GRANT_MS })) return json({ error: 'Demo access could not be saved.' }, 503);
        return json({ allowed: true }, 200, cookie(request, names(request)[0], grant, GRANT_MS / 1000));
      } catch (error) { return error instanceof SyntaxError ? json({ error: 'Enter a valid demo code.' }, 400) : json({ error: 'Demo access could not be checked. Refresh and try again.' }, 503); }
    },
  };
}

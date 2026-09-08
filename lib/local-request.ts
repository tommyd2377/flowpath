export function validId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}

export function localRequest(request: Request, mutation = false, environment: NodeJS.ProcessEnv = process.env) {
  const url = new URL(request.url);
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  // Next may normalize the URL to localhost; retain the incoming browser-facing Host.
  const host = request.headers.get('host') ?? url.host;
  let publicUrl: URL;
  try { publicUrl = new URL(`${url.protocol}//${host}`); }
  catch { return false; }
  if (publicUrl.host !== host) return false;
  if (environment.VERCEL === '1') {
    const allowed = ['flowpathapp.com', 'www.flowpathapp.com', environment.VERCEL_URL, environment.VERCEL_BRANCH_URL].filter(Boolean);
    if (url.protocol !== 'https:' || !allowed.includes(publicUrl.host)) return false;
  } else if (!loopback.includes(url.hostname) || !loopback.includes(publicUrl.hostname)) {
    // Opt-in HTTPS on one private Wi-Fi address for physical-device testing.
    // This exception is unavailable in production and preserves origin checks.
    const [first, second] = publicUrl.hostname.split('.').map(Number);
    const privateAddress = /^\d+\.\d+\.\d+\.\d+$/.test(publicUrl.hostname) &&
      (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168));
    if (environment.NODE_ENV !== 'development' || !privateAddress || url.protocol !== 'https:' ||
      publicUrl.origin !== environment.VOICE_DEV_ORIGIN ||
      (!loopback.includes(url.hostname) && url.hostname !== publicUrl.hostname)) return false;
  }
  const origin = request.headers.get('origin');
  return mutation ? origin === publicUrl.origin : !origin || origin === publicUrl.origin;
}

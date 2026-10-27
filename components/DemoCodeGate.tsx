'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';

export default function DemoCodeGate({ allowed, onAccess, onUnlocked }: { allowed: boolean | null; onAccess(allowed: boolean): void; onUnlocked(): void }) {
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submitting = useRef(false);
  useEffect(() => {
    let current = true;
    void fetch('/api/demo-access', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (current) onAccess(body.allowed === true);
    }).catch(() => { if (current) setError('Demo access could not be checked. Refresh to try again.'); });
    return () => { current = false; };
  }, [onAccess]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/demo-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const body = await response.json();
      if (!response.ok || body.allowed !== true) throw new Error(body.error ?? 'The demo could not be unlocked.');
      setCode(''); onAccess(true); onUnlocked();
    } catch (error) { setError(error instanceof Error ? error.message : 'The demo could not be unlocked.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return allowed ? <span className="news-demo-label" role="status">Demo unlocked</span> : <div className="news-demo-gate"><form id="news-demo-code-form" onSubmit={submit}>
    <label className="news-demo-label" htmlFor="news-demo-code">Demo code</label>
    <div className="news-demo-entry"><KeyRound aria-hidden="true" /><input id="news-demo-code" placeholder="Enter demo code" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={80} required disabled={busy} value={code} onChange={event => setCode(event.target.value)} aria-invalid={!!error} aria-describedby={error ? 'news-demo-error' : undefined} />{busy && <span role="status">Checking…</span>}</div>
    {error && <p id="news-demo-error" role="alert">{error}</p>}
  </form></div>;
}

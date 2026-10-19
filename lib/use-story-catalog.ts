'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatStoriesUpdatedAt, type StoryCatalogResponse } from './story-contracts';
import { readStoryCatalogResponse } from './story-stream';
import type { ExplorationDisplay } from './visual-contracts';

export const STORY_LOAD_TIMEOUT_MS = 100_000;

export function useStoryCatalog(display: ExplorationDisplay | null, voiceActive: boolean) {
  const [catalog, setCatalog] = useState<StoryCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const current = useRef<StoryCatalogResponse | null>(null);
  const request = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const pendingVoice = useRef(false);
  const noticeEnabled = useRef(true);
  const voiceUpdate = useRef<string | undefined>(undefined);
  const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismiss = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const finish = useCallback(() => {
    request.current?.abort();
    request.current = null;
    pending.current = false;
    pendingVoice.current = false;
    clearTimeout(deadline.current);
    setLoading(false);
  }, []);

  const announce = useCallback((text: string) => {
    clearTimeout(dismiss.current);
    setNotice(text);
    dismiss.current = setTimeout(() => setNotice(''), 5_000);
  }, []);

  const dismissNotice = useCallback(() => {
    if (pendingVoice.current) finish();
    noticeEnabled.current = false;
    clearTimeout(dismiss.current);
    setNotice('');
  }, [finish]);

  const fail = useCallback(() => {
    finish();
    const message = current.current?.items.length
      ? 'Couldn’t refresh stories. Your saved stories are still here. Try Refresh again.'
      : 'Stories couldn’t be loaded. Try Refresh again.';
    setError(message);
    announce(message);
  }, [announce, finish]);

  const accept = useCallback((next: StoryCatalogResponse) => {
    // A story list becomes usable as one complete set, including legacy streams.
    if (next.complete === false) return;
    const previous = current.current;
    if (previous && Date.parse(next.fetchedAt) < Date.parse(previous.fetchedAt)) {
      return;
    }
    if (!pending.current && JSON.stringify(previous) === JSON.stringify(next)) return;
    if (!next.items.length) { fail(); return; }
    const shouldAnnounce = noticeEnabled.current || (!pending.current && previous !== null);
    finish();
    current.current = next;
    setCatalog(next);
    setError('');
    if (shouldAnnounce) announce(next.warning || `${next.stale ? 'Saved stories from' : 'Stories updated'} ${formatStoriesUpdatedAt(next.fetchedAt)}`);
  }, [announce, fail, finish]);

  const refresh = useCallback(async (viaVoice?: () => Promise<void>) => {
    if (pending.current) return;
    const controller = new AbortController();
    request.current = controller;
    pending.current = true;
    pendingVoice.current = Boolean(viaVoice);
    noticeEnabled.current = true;
    setLoading(true);
    setError('');
    setNotice('');
    clearTimeout(dismiss.current);
    deadline.current = setTimeout(fail, STORY_LOAD_TIMEOUT_MS);
    try {
      if (viaVoice) { await viaVoice(); return; }
      const response = await fetch('/api/stories', { headers: { Accept: 'application/x-ndjson' }, cache: 'no-store', signal: controller.signal });
      await readStoryCatalogResponse(response, next => {
        // A voice result may have superseded the original page request.
        if (!controller.signal.aborted && request.current === controller) accept(next);
      });
      if (request.current === controller) finish();
    } catch {
      if (!controller.signal.aborted && request.current === controller) fail();
    }
  }, [accept, fail, finish]);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => { if (!disposed) void refresh(); });
    return () => {
      disposed = true;
      request.current?.abort();
      request.current = null;
      pending.current = false;
      pendingVoice.current = false;
      clearTimeout(deadline.current);
      clearTimeout(dismiss.current);
    };
  }, [refresh]);

  useEffect(() => {
    if (voiceActive || !pendingVoice.current) return;
    let disposed = false;
    queueMicrotask(() => { if (!disposed) finish(); });
    return () => { disposed = true; };
  }, [voiceActive, finish]);

  const stories = display?.stories;
  const metadata = display?.storyCatalog;
  const catalogId = display?.storyCatalogId;
  const catalogError = display?.storyCatalogError;
  useEffect(() => {
    if ((!stories || !metadata) && !catalogError) return;
    const update = JSON.stringify({ catalogId, stories, metadata, catalogError });
    if (voiceUpdate.current === update) return;
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      voiceUpdate.current = update;
      if (catalogError) fail();
      else if (stories && metadata) accept({ ok: true, items: stories, ...metadata });
    });
    return () => { disposed = true; };
  }, [stories, metadata, catalogId, catalogError, accept, fail]);

  return { catalog, loading, notice, error, refresh, dismissNotice };
}

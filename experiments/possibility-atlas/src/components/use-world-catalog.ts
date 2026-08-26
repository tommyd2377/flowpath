"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorResponseSchema } from "../lib/contracts";
import {
  WorldEventsResponseSchema,
  WorldRefreshRequestSchema,
  WorldRefreshResponseSchema,
  type WorldEventsResponse,
} from "../lib/world-contracts";
import { loadStorageEnvelope } from "../lib/storage";
import { worldRefreshCompletionMessage } from "../lib/world-presentation";

async function readPayload(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function errorMessage(payload: unknown, fallback: string) {
  const parsed = ErrorResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data.error.message : fallback;
}

function asCatalog(payload: unknown): WorldEventsResponse {
  const parsed = WorldRefreshResponseSchema.parse(payload);
  return WorldEventsResponseSchema.parse({
    ok: true,
    catalogVersion: parsed.catalogVersion,
    feedFingerprint: parsed.feedFingerprint,
    scannedAt: parsed.scannedAt,
    events: parsed.events,
    featuredCandidates: parsed.featuredCandidates,
    pressurePoints: parsed.pressurePoints,
    crossCurrents: parsed.crossCurrents,
    recentlyChanged: parsed.recentlyChanged,
  });
}

export function useWorldCatalog() {
  const mountedRef = useRef(true);
  const refreshingRef = useRef(false);
  const [catalog, setCatalog] = useState<WorldEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"info" | "warning">("info");
  const [error, setError] = useState<string | null>(null);
  const [refreshLongRunning, setRefreshLongRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/world/events", { cache: "no-store" });
      const payload = await readPayload(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "The saved world view is unavailable."));
      }
      const parsed = WorldEventsResponseSchema.parse(payload);
      if (mountedRef.current) setCatalog(parsed);
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught instanceof Error ? caught.message : "The saved world view is unavailable.");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshLongRunning(false);
    setError(null);
    setMessage(null);
    setMessageTone("info");
    try {
      const installationId = loadStorageEnvelope(window.localStorage).envelope.installationId;
      const request = WorldRefreshRequestSchema.parse({ installationId });
      const response = await fetch("/api/world/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "The world view could not be refreshed."));
      }
      const parsed = WorldRefreshResponseSchema.parse(payload);
      if (!mountedRef.current) return;
      setCatalog(asCatalog(parsed));
      setMessageTone(parsed.feed.stale ? "warning" : "info");
      setMessage(worldRefreshCompletionMessage(parsed));
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught instanceof Error ? caught.message : "The world view could not be refreshed.");
      }
    } finally {
      refreshingRef.current = false;
      if (mountedRef.current) {
        setRefreshing(false);
        setRefreshLongRunning(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!refreshing) return;
    const longRunningTimer = window.setTimeout(() => {
      if (mountedRef.current && refreshingRef.current) setRefreshLongRunning(true);
    }, 8_000);
    return () => {
      window.clearTimeout(longRunningTimer);
    };
  }, [refreshing]);

  useEffect(() => {
    mountedRef.current = true;
    queueMicrotask(() => {
      if (mountedRef.current) void load();
    });
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  return {
    catalog,
    loading,
    refreshing,
    refreshLongRunning,
    message,
    messageTone,
    error,
    load,
    refresh,
  };
}

export type WorldCatalogController = ReturnType<typeof useWorldCatalog>;

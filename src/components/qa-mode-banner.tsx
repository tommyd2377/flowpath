"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { FlaskConical, Trash2, X } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import {
  readClientQaMode,
  syncClientQaModeFromUrl,
  writeClientQaMode,
} from "@/lib/qa-mode";

export function QaModeBanner() {
  const enabled = useSyncExternalStore(
    subscribeQaMode,
    readClientQaMode,
    () => false,
  );
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    syncClientQaModeFromUrl();
  }, []);

  if (!enabled) return null;

  async function clearQaData() {
    setClearing(true);
    setMessage(null);
    try {
      await apiFetch("/api/qa-data", { method: "DELETE" });
      setMessage("QA test data cleared.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not clear QA test data.",
      );
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="border-b border-amber-900/70 bg-amber-950/70 text-amber-50">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          <span className="font-medium">QA mode</span>
          <span className="text-amber-100/80">
            Test data is hidden from normal queues.
          </span>
          {message ? <span className="text-amber-100">{message}</span> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={clearQaData}
            disabled={clearing}
            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-amber-700 px-2 text-xs font-medium hover:bg-amber-900/40 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {clearing ? "Clearing..." : "Clear QA test data"}
          </button>
          <button
            type="button"
            onClick={() => {
              writeClientQaMode(false);
            }}
            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-amber-700 px-2 text-xs font-medium hover:bg-amber-900/40"
          >
            <X className="h-3.5 w-3.5" />
            Exit QA
          </button>
        </div>
      </div>
    </div>
  );
}

function subscribeQaMode(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("flowpath-qa-mode-change", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("flowpath-qa-mode-change", callback);
    window.removeEventListener("storage", callback);
  };
}

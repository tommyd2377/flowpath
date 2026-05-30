"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Archive, CheckCircle2, Plus, Trash2 } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import type { Situation } from "@/lib/types";
import { Button, Card, EmptyState, Notice, PageHeader, SelectInput } from "./ui";
import { modeLabel } from "./next-move-plan-card";

export function SituationsView() {
  const [situations, setSituations] = useState<Situation[]>([]);
  const [status, setStatus] = useState("active");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const suffix = status === "all" ? "" : `?status=${status}`;
      setSituations(await apiFetch<Situation[]>(`/api/situations${suffix}`));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load situations.",
      );
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function updateStatus(situation: Situation, nextStatus: Situation["status"]) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/situations/${situation.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...situation, status: nextStatus }),
      });
      setMessage(`Situation marked ${nextStatus}.`);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not update situation.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteSituation(situation: Situation) {
    if (confirmingDeleteId !== situation.id) {
      setConfirmingDeleteId(situation.id);
      setMessage(null);
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<void>(`/api/situations/${situation.id}`, {
        method: "DELETE",
      });
      setConfirmingDeleteId(null);
      setMessage("Situation deleted.");
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete situation.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Situations" title="Current Reality">
        <p>
          Situations are the context FlowPath uses to separate highest-leverage moves from
          noise.
        </p>
      </PageHeader>

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SelectInput
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="sm:max-w-48"
        >
          <option value="active">active</option>
          <option value="resolved">resolved</option>
          <option value="archived">archived</option>
          <option value="all">all</option>
        </SelectInput>
        <Link href="/next-move">
          <Button type="button">
            <Plus className="h-4 w-4" />
            Find My Next Move
          </Button>
        </Link>
      </div>

      {loading ? (
        <Card>
          <div className="text-sm text-slate-400">Loading situations...</div>
        </Card>
      ) : situations.length === 0 ? (
        <EmptyState>No situations in this view.</EmptyState>
      ) : (
        <div className="grid gap-3">
          {situations.map((situation) => (
            <Card key={situation.id}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <Link href={`/situations/${situation.id}`} className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
                      {situation.category}
                    </span>
                    <span className="rounded-md bg-[rgba(0,120,212,0.18)] px-2 py-1 text-xs font-medium text-blue-100">
                      {situation.urgency}
                    </span>
                    <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
                      {situation.status}
                    </span>
                    {situation.latest_plan_mode ? (
                      <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
                        {modeLabel(situation.latest_plan_mode)}
                      </span>
                    ) : null}
                  </div>
                  <h2 className="mt-3 text-xl font-semibold text-white">
                    {situation.title}
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Latest move: {situation.latest_plan_move || "No plan generated yet."}
                  </p>
                </Link>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {situation.status === "active" ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={saving}
                        onClick={() => updateStatus(situation, "resolved")}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Resolve
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={saving}
                        onClick={() => updateStatus(situation, "archived")}
                      >
                        <Archive className="h-4 w-4" />
                        Archive
                      </Button>
                    </>
                  ) : null}
                  {confirmingDeleteId === situation.id ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={saving}
                        onClick={() => setConfirmingDeleteId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        disabled={saving}
                        onClick={() => deleteSituation(situation)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete now
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="danger"
                      disabled={saving}
                      onClick={() => deleteSituation(situation)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

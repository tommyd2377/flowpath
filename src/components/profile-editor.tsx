"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Check, MessageSquare, Trash2, X } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import type {
  ContextConstraints,
  InferredContextCategory,
  InferredContextItem,
  Profile,
} from "@/lib/types";
import {
  Button,
  Card,
  CharacterCount,
  EmptyState,
  Notice,
  PageHeader,
  TextArea,
} from "./ui";

type MemoryBankItem = {
  id: string;
  label: string;
  value: string;
  badges: string[];
  sourceItem?: InferredContextItem;
};

const categoryLabels: Record<InferredContextCategory, string> = {
  money: "Money",
  location: "Location",
  time: "Time",
  energy: "Energy",
  education_credentials: "Education/credentials",
  access_connections: "Access/connections",
  support_network: "Support network",
  family_caregiving: "Family/caregiving",
  transportation: "Transportation",
  deadline: "Deadline",
  safety_risk: "Safety risk",
  age_life_stage: "Age/life stage",
  connection_dating: "Connection/dating",
  work_career: "Work/career",
  health_recovery: "Health/recovery",
  creative_personal_project: "Creative/project",
  working_style: "Working style",
  other: "Other",
};

const profileFields: Array<{ key: keyof Profile; label: string }> = [
  { key: "personal_profile", label: "Profile context" },
  { key: "current_season", label: "Current season" },
  { key: "core_priorities", label: "Priorities" },
  { key: "constraints", label: "Constraints" },
  { key: "operating_principles", label: "Planning preferences" },
  { key: "remember", label: "Durable preferences" },
  { key: "challenge_on", label: "Patterns to challenge" },
];

const defaultProfilePrefixes = [
  "paste durable context",
  "describe the season",
  "list the few outcomes",
  "name time, energy",
  "add principles like",
  "add details flowpath",
  "add patterns you want",
];

function isMeaningfulText(value: unknown) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase();
  return !defaultProfilePrefixes.some((prefix) => normalized.startsWith(prefix));
}

function compactValue(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const parts = Object.entries(value)
    .filter(([key, child]) => {
      if (key === "persistence") return false;
      if (child === undefined || child === "") return false;
      if (Array.isArray(child)) return child.length > 0;
      return true;
    })
    .map(([key, child]) => {
      if (Array.isArray(child)) return `${key}: ${child.join(", ")}`;
      if (typeof child === "object" && child !== null) {
        return `${key}: ${compactValue(child)}`;
      }
      return `${key}: ${String(child)}`;
    })
    .filter(Boolean);
  return parts.join("; ");
}

function constraintCards(context: ContextConstraints): MemoryBankItem[] {
  return Object.entries(context)
    .map(([key, value]) => ({
      id: `constraint-${key}`,
      label: key.replaceAll("_", " "),
      value: compactValue(value),
      badges: ["Stated", "Constraint"],
    }))
    .filter((item) => item.value);
}

function itemBadges(item: InferredContextItem) {
  const certainty =
    item.persistence === "saved_memory"
      ? item.source === "manual"
        ? "Stated"
        : "Inferred"
      : item.persistence === "proposed_memory"
        ? "Assumption"
        : "From board";
  return [
    certainty,
    categoryLabels[item.category],
    item.situation_title ? "From board" : "",
    item.updated_at !== item.created_at ? "Updated" : "",
  ].filter(Boolean);
}

function profileCards(profile: Profile): MemoryBankItem[] {
  return profileFields
    .filter((field) => isMeaningfulText(profile[field.key]))
    .map((field) => ({
      id: `profile-${String(field.key)}`,
      label: field.label,
      value: String(profile[field.key]),
      badges: ["Stated", "Profile"],
    }));
}

export function ProfileEditor() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [items, setItems] = useState<InferredContextItem[]>([]);
  const [correction, setCorrection] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [profileData, itemData] = await Promise.all([
        apiFetch<Profile>("/api/profile"),
        apiFetch<InferredContextItem[]>("/api/memory/context-items"),
      ]);
      setProfile(profileData);
      setItems(itemData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load memory.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  const memoryBank = useMemo<MemoryBankItem[]>(() => {
    const inferred = items.map((item) => ({
      id: `item-${item.id}`,
      label: item.label,
      value: item.value,
      badges: itemBadges(item),
      sourceItem: item,
    }));
    return [
      ...inferred,
      ...(profile ? constraintCards(profile.context_constraints ?? {}) : []),
      ...(profile ? profileCards(profile) : []),
    ];
  }, [items, profile]);

  async function updateItem(id: number, input: Partial<InferredContextItem>, success: string) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<InferredContextItem>(`/api/memory/context-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      setMessage(success);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update memory.");
    } finally {
      setSaving(false);
    }
  }

  async function forgetItem(id: number, success = "Memory forgotten.") {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<void>(`/api/memory/context-items/${id}`, { method: "DELETE" });
      setMessage(success);
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Could not forget memory.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitCorrection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = correction.trim();
    if (!trimmed) {
      setError("Tell FlowPath what is wrong, outdated, missing, or no longer true.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/api/memory/correction", {
        method: "POST",
        body: JSON.stringify({ content: trimmed }),
      });
      setCorrection("");
      setMessage("Memory updated.");
      await load();
    } catch (correctionError) {
      setError(
        correctionError instanceof Error
          ? correctionError.message
          : "Could not update memory.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Memory" title="What FlowPath Knows">
        <p>One coherent memory bank: the context FlowPath is using about you.</p>
      </PageHeader>

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      <Card className="mb-5">
        <form className="grid gap-3" onSubmit={submitCorrection}>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-[var(--azure-light)]" />
            <h2 className="text-xl font-semibold">
              Tell FlowPath what is wrong, outdated, missing, or no longer true.
            </h2>
          </div>
          <TextArea
            value={correction}
            maxLength={1600}
            onChange={(event) => setCorrection(event.target.value)}
            placeholder="Example: I moved, weekends are the only realistic time, and I don’t want FlowPath to treat this as career-related."
            className="min-h-24"
          />
          <CharacterCount value={correction} max={1600} />
          <div>
            <Button type="submit" disabled={saving || !correction.trim()}>
              <Check className="h-4 w-4" />
              {saving ? "Updating..." : "Update memory"}
            </Button>
          </div>
        </form>
      </Card>

      {loading ? (
        <Card>
          <div className="text-sm text-slate-400">Loading memory...</div>
        </Card>
      ) : memoryBank.length === 0 ? (
        <Card>
          <EmptyState>
            No memory yet. Start a board and FlowPath will keep useful context here.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-3">
          {memoryBank.map((item) => (
            <MemoryCard
              key={item.id}
              item={item}
              saving={saving}
              onKeep={
                item.sourceItem && item.sourceItem.persistence !== "saved_memory"
                  ? () =>
                      updateItem(
                        item.sourceItem!.id,
                        { persistence: "saved_memory" },
                        "Memory kept.",
                      )
                  : undefined
              }
              onWrong={
                item.sourceItem
                  ? () => forgetItem(item.sourceItem!.id, "Marked wrong and removed.")
                  : undefined
              }
              onForget={
                item.sourceItem ? () => forgetItem(item.sourceItem!.id) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MemoryCard({
  item,
  saving,
  onKeep,
  onWrong,
  onForget,
}: {
  item: MemoryBankItem;
  saving: boolean;
  onKeep?: () => void;
  onWrong?: () => void;
  onForget?: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            {item.badges.map((badge) => (
              <Badge key={badge}>{badge}</Badge>
            ))}
          </div>
          <h2 className="mt-3 text-lg font-semibold text-white">{item.label}</h2>
          <p className="mt-1 text-sm text-slate-300">{item.value}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {onKeep ? (
            <Button type="button" variant="secondary" onClick={onKeep} disabled={saving}>
              <Check className="h-4 w-4" />
              Keep
            </Button>
          ) : null}
          {onWrong ? (
            <Button type="button" variant="secondary" onClick={onWrong} disabled={saving}>
              <X className="h-4 w-4" />
              This is wrong
            </Button>
          ) : null}
          {onForget ? (
            <Button type="button" variant="danger" onClick={onForget} disabled={saving}>
              <Trash2 className="h-4 w-4" />
              Forget
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
      {children}
    </span>
  );
}

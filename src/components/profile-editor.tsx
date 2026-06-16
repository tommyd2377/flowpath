"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Check, Pencil, Save, Trash2, X } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import { MEMORY_LABEL_MAX, MEMORY_VALUE_MAX } from "@/lib/schemas";
import type {
  ContextConstraints,
  InferredContextCategory,
  InferredContextItem,
  Profile,
} from "@/lib/types";
import { INFERRED_CONTEXT_CATEGORIES } from "@/lib/types";
import { ContextConstraintsEditor } from "./context-constraints-editor";
import {
  Button,
  Card,
  CharacterCount,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  SelectInput,
  TextArea,
  TextInput,
} from "./ui";

type ProfileForm = Omit<Profile, "id" | "created_at" | "updated_at">;
type ProfileTextField = Exclude<keyof ProfileForm, "context_constraints">;

const emptyProfile: ProfileForm = {
  personal_profile: "",
  current_season: "",
  core_priorities: "",
  constraints: "",
  operating_principles: "",
  remember: "",
  challenge_on: "",
  context_constraints: {},
};

const fields: Array<{
  key: ProfileTextField;
  label: string;
  placeholder: string;
  hint: string;
  rows?: number;
}> = [
  {
    key: "personal_profile",
    label: "Personal profile",
    placeholder:
      "Optional stable context: broad work focus, city/region-level location, recurring goals, or useful background.",
    hint: "Leave this blank until there is durable context FlowPath should reuse.",
    rows: 5,
  },
  {
    key: "current_season",
    label: "Current season",
    placeholder:
      "Example: rebuilding routines, searching for work, launching a project, simplifying commitments.",
    hint: "Use this only for broad season-level context, not private journal notes.",
    rows: 4,
  },
  {
    key: "core_priorities",
    label: "Core priorities",
    placeholder:
      "The few outcomes that should matter most over the next month or two.",
    hint: "Short, current priorities help FlowPath rank tradeoffs.",
    rows: 4,
  },
  {
    key: "constraints",
    label: "Broad constraints",
    placeholder:
      "Time, energy, caregiving, access, transportation, deadlines, or other limits to respect.",
    hint: "Keep this broad. Sensitive details are better handled through intake or session-only notes.",
    rows: 4,
  },
  {
    key: "operating_principles",
    label: "Planning preferences",
    placeholder:
      "Example: prefer concrete next actions, avoid over-planning, choose low-friction first steps.",
    hint: "Describe how FlowPath should shape recommendations.",
    rows: 4,
  },
  {
    key: "remember",
    label: "Durable preferences",
    placeholder:
      "Reusable preferences or context that should carry across situations.",
    hint: "If it is not broadly useful later, leave it out.",
    rows: 5,
  },
  {
    key: "challenge_on",
    label: "Patterns to challenge",
    placeholder:
      "Example: over-scoping, avoiding outreach, staying in research instead of taking action.",
    hint: "Use this for recurring patterns FlowPath should gently push against.",
    rows: 4,
  },
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

function formFromProfile(data: Profile): ProfileForm {
  return {
    personal_profile: data.personal_profile,
    current_season: data.current_season,
    core_priorities: data.core_priorities,
    constraints: data.constraints,
    operating_principles: data.operating_principles,
    remember: data.remember,
    challenge_on: data.challenge_on,
    context_constraints: data.context_constraints ?? {},
  };
}

function isMeaningfulText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase();
  return !defaultProfilePrefixes.some((prefix) => normalized.startsWith(prefix));
}

function constraintLabel(key: keyof ContextConstraints) {
  return key.replaceAll("_", " ");
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

function removeConstraint(
  context: ContextConstraints,
  keyToRemove: keyof ContextConstraints,
) {
  return Object.fromEntries(
    Object.entries(context).filter(([key]) => key !== keyToRemove),
  ) as ContextConstraints;
}

export function ProfileEditor() {
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile);
  const [items, setItems] = useState<InferredContextItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<InferredContextItem | null>(null);
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
      setProfile(formFromProfile(profileData));
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

  const profileNotes = useMemo(
    () =>
      fields
        .filter((field) => isMeaningfulText(profile[field.key]))
        .map((field) => ({
          id: field.key,
          label: field.label,
          value: profile[field.key],
        })),
    [profile],
  );

  const constraintCards = useMemo(
    () =>
      Object.entries(profile.context_constraints ?? {})
        .map(([key, value]) => ({
          key: key as keyof ContextConstraints,
          label: constraintLabel(key as keyof ContextConstraints),
          value: compactValue(value),
        }))
        .filter((item) => item.value),
    [profile.context_constraints],
  );

  const proposedItems = items.filter((item) => item.persistence === "proposed_memory");
  const savedItems = items.filter((item) => item.persistence === "saved_memory");
  const sessionOnlyItems = items.filter((item) => item.persistence === "session_only");

  async function saveProfile(nextProfile = profile) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await apiFetch<Profile>("/api/profile", {
        method: "PUT",
        body: JSON.stringify(nextProfile),
      });
      setProfile(formFromProfile(saved));
      setMessage("Memory saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  async function updateItem(id: number, input: Partial<InferredContextItem>) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<InferredContextItem>(`/api/memory/context-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      setEditingId(null);
      setEditingItem(null);
      setMessage("Memory card updated.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update memory.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(id: number) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<void>(`/api/memory/context-items/${id}`, { method: "DELETE" });
      setMessage("Memory card deleted.");
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Could not delete memory.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteConstraint(key: keyof ContextConstraints) {
    const nextProfile = {
      ...profile,
      context_constraints: removeConstraint(profile.context_constraints, key),
    };
    setProfile(nextProfile);
    await saveProfile(nextProfile);
  }

  return (
    <div>
      <PageHeader eyebrow="Founder Memory" title="Founder Memory">
        <p>
          Review the founder context FlowPath uses to make future next moves more
          realistic. Proposed items are not saved until you approve them;
          session-only notes stay tied to the current situation unless you move
          them into review.
        </p>
      </PageHeader>

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      {loading ? (
        <Card>
          <div className="text-sm text-slate-400">Loading memory...</div>
        </Card>
      ) : (
        <div className="grid gap-5">
          <MemorySection
            title="Proposed Founder Memory"
            description="Review broad startup context FlowPath inferred before saving it for future situations."
          >
            {proposedItems.length === 0 ? (
              <EmptyState>No memories waiting for review.</EmptyState>
            ) : (
              proposedItems.map((item) => (
                <MemoryItemCard
                  key={item.id}
                  item={item}
                  editing={editingId === item.id}
                  editingItem={editingItem}
                  setEditingItem={setEditingItem}
                  startEditing={() => {
                    setEditingId(item.id);
                    setEditingItem(item);
                  }}
                  cancelEditing={() => {
                    setEditingId(null);
                    setEditingItem(null);
                  }}
                  onSave={() => editingItem && updateItem(item.id, editingItem)}
                  onKeep={() => updateItem(item.id, { persistence: "saved_memory" })}
                  onDelete={() => deleteItem(item.id)}
                  keepLabel="Save"
                  deleteLabel="Reject"
                  saving={saving}
                />
              ))
            )}
          </MemorySection>

          <MemorySection
            title="Saved Founder Memory"
            description="Durable context FlowPath can reuse later: saved cards, broad constraints, and manual profile notes."
          >
            {savedItems.length === 0 && profileNotes.length === 0 && constraintCards.length === 0 ? (
              <EmptyState>
                No saved memory yet. Start with a founder situation and FlowPath
                will propose broad context here.
              </EmptyState>
            ) : (
              <>
                {savedItems.map((item) => (
                  <MemoryItemCard
                    key={item.id}
                    item={item}
                    editing={editingId === item.id}
                    editingItem={editingItem}
                    setEditingItem={setEditingItem}
                    startEditing={() => {
                      setEditingId(item.id);
                      setEditingItem(item);
                    }}
                    cancelEditing={() => {
                      setEditingId(null);
                      setEditingItem(null);
                    }}
                    onSave={() => editingItem && updateItem(item.id, editingItem)}
                    onKeep={() => updateItem(item.id, { persistence: "saved_memory" })}
                    onDelete={() => deleteItem(item.id)}
                    keepLabel="Save"
                    deleteLabel="Reject"
                    saving={saving}
                  />
                ))}
                {constraintCards.map((item) => (
                  <StaticMemoryCard
                    key={item.key}
                    label={item.label}
                    value={item.value}
                    meta="Saved broad constraint"
                    onDelete={() => deleteConstraint(item.key)}
                    saving={saving}
                  />
                ))}
                {profileNotes.map((item) => (
                  <StaticMemoryCard
                    key={item.id}
                    label={item.label}
                    value={item.value}
                    meta="Saved profile note"
                  />
                ))}
              </>
            )}
          </MemorySection>

          {sessionOnlyItems.length > 0 ? (
            <MemorySection
              title="Situation Notes"
              description="Context tied to a specific founder situation. Save only a broad version if it should carry forward."
            >
              {sessionOnlyItems.map((item) => (
                <MemoryItemCard
                  key={item.id}
                  item={item}
                  editing={editingId === item.id}
                  editingItem={editingItem}
                  setEditingItem={setEditingItem}
                  startEditing={() => {
                    setEditingId(item.id);
                    setEditingItem(item);
                  }}
                  cancelEditing={() => {
                    setEditingId(null);
                    setEditingItem(null);
                  }}
                  onSave={() => editingItem && updateItem(item.id, editingItem)}
                  onKeep={() => updateItem(item.id, { persistence: "proposed_memory" })}
                  onDelete={() => deleteItem(item.id)}
                  keepLabel="Review"
                  deleteLabel="Reject"
                  saving={saving}
                />
              ))}
            </MemorySection>
          ) : null}

          <Card>
            <details>
              <summary className="cursor-pointer text-xl font-semibold text-white">
                Manual profile notes
              </summary>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                Optional. These fields start blank for new users; the prompts below are
                placeholders, not saved memory. Most users can ignore this and let
                FlowPath infer reviewable cards from intake.
              </p>
              <form
                className="mt-5 grid gap-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveProfile();
                }}
              >
                {fields.map((field) => (
                  <Field key={field.key} label={field.label} hint={field.hint}>
                    <TextArea
                      rows={field.rows}
                      placeholder={field.placeholder}
                      value={profile[field.key]}
                      onChange={(event) =>
                        setProfile((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  </Field>
                ))}
                <details className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-[var(--azure-light)]">
                    Edit broad constraints
                  </summary>
                  <div className="mt-4">
                    <ContextConstraintsEditor
                      value={profile.context_constraints}
                      onChange={(context_constraints) =>
                        setProfile((current) => ({ ...current, context_constraints }))
                      }
                      profileMode
                    />
                  </div>
                </details>
                <div>
                  <Button type="submit" disabled={saving}>
                    <Save className="h-4 w-4" />
                    {saving ? "Saving..." : "Save Memory"}
                  </Button>
                </div>
              </form>
            </details>
          </Card>
        </div>
      )}
    </div>
  );
}

function MemorySection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <h2 className="text-xl font-semibold">{title}</h2>
      {description ? (
        <p className="mt-2 mb-4 max-w-3xl text-sm text-slate-400">{description}</p>
      ) : (
        <div className="mb-4" />
      )}
      <div className="grid gap-3">{children}</div>
    </Card>
  );
}

function MemoryItemCard({
  item,
  editing,
  editingItem,
  setEditingItem,
  startEditing,
  cancelEditing,
  onSave,
  onKeep,
  onDelete,
  keepLabel,
  deleteLabel = "Delete",
  saving,
}: {
  item: InferredContextItem;
  editing: boolean;
  editingItem: InferredContextItem | null;
  setEditingItem: (item: InferredContextItem) => void;
  startEditing: () => void;
  cancelEditing: () => void;
  onSave: () => void;
  onKeep: () => void;
  onDelete: () => void;
  keepLabel: string;
  deleteLabel?: string;
  saving: boolean;
}) {
  const draft = editingItem ?? item;

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/70 p-4">
      {editing ? (
        <div className="grid gap-3">
          <Field label="Label">
            <TextInput
              value={draft.label}
              maxLength={MEMORY_LABEL_MAX}
              onChange={(event) =>
                setEditingItem({ ...draft, label: event.target.value })
              }
            />
            <CharacterCount value={draft.label} max={MEMORY_LABEL_MAX} />
          </Field>
          <Field label="Value">
            <TextArea
              value={draft.value}
              maxLength={MEMORY_VALUE_MAX}
              onChange={(event) =>
                setEditingItem({ ...draft, value: event.target.value })
              }
            />
            <CharacterCount value={draft.value} max={MEMORY_VALUE_MAX} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category">
              <SelectInput
                value={draft.category}
                onChange={(event) =>
                  setEditingItem({
                    ...draft,
                    category: event.target.value as InferredContextCategory,
                  })
                }
              >
                {INFERRED_CONTEXT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {categoryLabels[category]}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Section">
              <SelectInput
                value={draft.persistence}
                onChange={(event) =>
                  setEditingItem({
                    ...draft,
                    persistence: event.target.value as InferredContextItem["persistence"],
                  })
                }
              >
                <option value="session_only">Situation Notes</option>
                <option value="proposed_memory">Proposed Founder Memory</option>
                <option value="saved_memory">Saved Founder Memory</option>
              </SelectInput>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onSave} disabled={saving}>
              <Save className="h-4 w-4" />
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={cancelEditing}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <Badge>{categoryLabels[item.category]}</Badge>
              {item.situation_title ? <Badge>{item.situation_title}</Badge> : null}
            </div>
            <h3 className="mt-3 text-lg font-semibold text-white">{item.label}</h3>
            <p className="mt-1 text-sm text-slate-300">{item.value}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {item.persistence !== "saved_memory" ? (
              <Button type="button" variant="secondary" onClick={onKeep} disabled={saving}>
                <Check className="h-4 w-4" />
                {keepLabel}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={startEditing}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            <Button type="button" variant="danger" onClick={onDelete} disabled={saving}>
              <Trash2 className="h-4 w-4" />
              {deleteLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StaticMemoryCard({
  label,
  value,
  meta,
  onDelete,
  saving,
}: {
  label: string;
  value: string;
  meta: string;
  onDelete?: () => void;
  saving?: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Badge>{meta}</Badge>
          <h3 className="mt-3 text-lg font-semibold capitalize text-white">{label}</h3>
          <p className="mt-1 text-sm text-slate-300">{value}</p>
        </div>
        {onDelete ? (
          <Button type="button" variant="danger" onClick={onDelete} disabled={saving}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
      {children}
    </span>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import type { LifeArea, PriorityLevel } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  SelectInput,
  TextArea,
  TextInput,
} from "./ui";

type LifeAreaForm = {
  name: string;
  description: string;
  priority_level: PriorityLevel;
  desired_outcome: string;
  current_bottleneck: string;
};

const emptyLifeArea: LifeAreaForm = {
  name: "",
  description: "",
  priority_level: "medium",
  desired_outcome: "",
  current_bottleneck: "",
};

function formFromArea(area: LifeArea): LifeAreaForm {
  return {
    name: area.name,
    description: area.description,
    priority_level: area.priority_level,
    desired_outcome: area.desired_outcome,
    current_bottleneck: area.current_bottleneck,
  };
}

export function LifeAreasManager() {
  const [areas, setAreas] = useState<LifeArea[]>([]);
  const [form, setForm] = useState<LifeAreaForm>(emptyLifeArea);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingForm, setEditingForm] = useState<LifeAreaForm>(emptyLifeArea);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setAreas(await apiFetch<LifeArea[]>("/api/life-areas"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load areas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  async function createArea(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<LifeArea>("/api/life-areas", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm(emptyLifeArea);
      setMessage("Life area added.");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not add area.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id: number) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<LifeArea>(`/api/life-areas/${id}`, {
        method: "PUT",
        body: JSON.stringify(editingForm),
      });
      setEditingId(null);
      setMessage("Life area saved.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save area.");
    } finally {
      setSaving(false);
    }
  }

  async function removeArea(id: number) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<void>(`/api/life-areas/${id}`, { method: "DELETE" });
      setMessage("Life area deleted.");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete area.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Life Areas" title="Areas of Attention">
        <p>
          Keep the dashboard honest about the domains that compete for today&apos;s
          energy.
        </p>
      </PageHeader>

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <h2 className="mb-4 text-xl font-semibold">Add Life Area</h2>
          <LifeAreaFormFields
            form={form}
            setForm={setForm}
            onSubmit={createArea}
            submitLabel={saving ? "Saving..." : "Add Area"}
            disabled={saving}
          />
        </Card>

        <div className="grid gap-3">
          {loading ? (
            <Card>
              <div className="text-sm text-slate-400">Loading areas...</div>
            </Card>
          ) : areas.length === 0 ? (
            <EmptyState>No life areas yet. Run the seed command or add one here.</EmptyState>
          ) : (
            areas.map((area) => {
              const editing = editingId === area.id;
              return (
                <Card key={area.id}>
                  {editing ? (
                    <div className="grid gap-4">
                      <LifeAreaFields form={editingForm} setForm={setEditingForm} />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={() => saveEdit(area.id)}
                          disabled={saving}
                        >
                          <Save className="h-4 w-4" />
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="h-4 w-4" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-semibold">{area.name}</h2>
                            <span className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300">
                              {area.priority_level}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-slate-300">
                            {area.description || "No description yet."}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setEditingId(area.id);
                              setEditingForm(formFromArea(area));
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => removeArea(area.id)}
                            disabled={saving}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <div className="font-medium">Desired outcome</div>
                          <p className="text-slate-300">
                            {area.desired_outcome || "Not set."}
                          </p>
                        </div>
                        <div>
                          <div className="font-medium">Current bottleneck</div>
                          <p className="text-slate-300">
                            {area.current_bottleneck || "Not set."}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function LifeAreaFormFields({
  form,
  setForm,
  onSubmit,
  submitLabel,
  disabled,
}: {
  form: LifeAreaForm;
  setForm: React.Dispatch<React.SetStateAction<LifeAreaForm>>;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  disabled: boolean;
}) {
  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <LifeAreaFields form={form} setForm={setForm} />
      <div>
        <Button type="submit" disabled={disabled}>
          <Plus className="h-4 w-4" />
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function LifeAreaFields({
  form,
  setForm,
}: {
  form: LifeAreaForm;
  setForm: React.Dispatch<React.SetStateAction<LifeAreaForm>>;
}) {
  return (
    <>
      <Field label="Name">
        <TextInput
          value={form.name}
          onChange={(event) =>
            setForm((current) => ({ ...current, name: event.target.value }))
          }
          required
        />
      </Field>
      <Field label="Priority level">
        <SelectInput
          value={form.priority_level}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              priority_level: event.target.value as PriorityLevel,
            }))
          }
        >
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </SelectInput>
      </Field>
      <Field label="Description">
        <TextArea
          value={form.description}
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
        />
      </Field>
      <Field label="Desired outcome">
        <TextArea
          value={form.desired_outcome}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              desired_outcome: event.target.value,
            }))
          }
        />
      </Field>
      <Field label="Current bottleneck">
        <TextArea
          value={form.current_bottleneck}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              current_bottleneck: event.target.value,
            }))
          }
        />
      </Field>
    </>
  );
}

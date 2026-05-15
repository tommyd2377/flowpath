"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import type { LifeArea, Project, ProjectStatus } from "@/lib/types";
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

type ProjectForm = {
  name: string;
  life_area_id: number | null;
  status: ProjectStatus;
  description: string;
  next_milestone: string;
  current_bottleneck: string;
  why_it_matters: string;
};

const emptyProject: ProjectForm = {
  name: "",
  life_area_id: null,
  status: "active",
  description: "",
  next_milestone: "",
  current_bottleneck: "",
  why_it_matters: "",
};

function formFromProject(project: Project): ProjectForm {
  return {
    name: project.name,
    life_area_id: project.life_area_id,
    status: project.status,
    description: project.description,
    next_milestone: project.next_milestone,
    current_bottleneck: project.current_bottleneck,
    why_it_matters: project.why_it_matters,
  };
}

export function ProjectsManager() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<LifeArea[]>([]);
  const [form, setForm] = useState<ProjectForm>(emptyProject);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingForm, setEditingForm] = useState<ProjectForm>(emptyProject);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const activeCount = useMemo(
    () => projects.filter((project) => project.status === "active").length,
    [projects],
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [projectData, areaData] = await Promise.all([
        apiFetch<Project[]>("/api/projects"),
        apiFetch<LifeArea[]>("/api/life-areas"),
      ]);
      setProjects(projectData);
      setAreas(areaData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load projects.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm(emptyProject);
      setMessage("Project added.");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not add project.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id: number) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<Project>(`/api/projects/${id}`, {
        method: "PUT",
        body: JSON.stringify(editingForm),
      });
      setEditingId(null);
      setMessage("Project saved.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save project.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProject(id: number) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<void>(`/api/projects/${id}`, { method: "DELETE" });
      setMessage("Project deleted.");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Projects" title="Active Bets">
        <p>
          Track the projects FlowPath should consider when choosing today&apos;s highest
          leverage actions. Active projects are weighted most heavily.
        </p>
      </PageHeader>

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-2xl font-semibold">{projects.length}</div>
          <div className="text-sm text-slate-400">total projects</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold">{activeCount}</div>
          <div className="text-sm text-slate-400">active projects</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold">{areas.length}</div>
          <div className="text-sm text-slate-400">life areas</div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <h2 className="mb-4 text-xl font-semibold">Add Project</h2>
          <form className="grid gap-4" onSubmit={createProject}>
            <ProjectFields form={form} setForm={setForm} areas={areas} />
            <div>
              <Button type="submit" disabled={saving}>
                <Plus className="h-4 w-4" />
                {saving ? "Saving..." : "Add Project"}
              </Button>
            </div>
          </form>
        </Card>

        <div className="grid gap-3">
          {loading ? (
            <Card>
              <div className="text-sm text-slate-400">Loading projects...</div>
            </Card>
          ) : projects.length === 0 ? (
            <EmptyState>No projects yet. Run the seed command or add one here.</EmptyState>
          ) : (
            projects.map((project) => {
              const editing = editingId === project.id;
              return (
                <Card key={project.id}>
                  {editing ? (
                    <div className="grid gap-4">
                      <ProjectFields
                        form={editingForm}
                        setForm={setEditingForm}
                        areas={areas}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={() => saveEdit(project.id)}
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
                            <h2 className="text-lg font-semibold">{project.name}</h2>
                            <span className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300">
                              {project.status}
                            </span>
                            {project.life_area_name ? (
                              <span className="rounded-md bg-[rgba(0,120,212,0.18)] px-2 py-1 text-xs font-medium text-blue-100">
                                {project.life_area_name}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-slate-300">
                            {project.description || "No description yet."}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setEditingId(project.id);
                              setEditingForm(formFromProject(project));
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => deleteProject(project.id)}
                            disabled={saving}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-3 text-sm sm:grid-cols-3">
                        <InfoBlock title="Next milestone" value={project.next_milestone} />
                        <InfoBlock title="Bottleneck" value={project.current_bottleneck} />
                        <InfoBlock title="Why it matters" value={project.why_it_matters} />
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

function ProjectFields({
  form,
  setForm,
  areas,
}: {
  form: ProjectForm;
  setForm: React.Dispatch<React.SetStateAction<ProjectForm>>;
  areas: LifeArea[];
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Life area">
          <SelectInput
            value={form.life_area_id ?? ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                life_area_id: event.target.value ? Number(event.target.value) : null,
              }))
            }
          >
            <option value="">None</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Status">
          <SelectInput
            value={form.status}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                status: event.target.value as ProjectStatus,
              }))
            }
          >
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="someday">someday</option>
            <option value="done">done</option>
          </SelectInput>
        </Field>
      </div>
      <Field label="Description">
        <TextArea
          value={form.description}
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
        />
      </Field>
      <Field label="Next milestone">
        <TextArea
          value={form.next_milestone}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              next_milestone: event.target.value,
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
      <Field label="Why it matters">
        <TextArea
          value={form.why_it_matters}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              why_it_matters: event.target.value,
            }))
          }
        />
      </Field>
    </>
  );
}

function InfoBlock({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <div className="font-medium">{title}</div>
      <p className="text-slate-300">{value || "Not set."}</p>
    </div>
  );
}

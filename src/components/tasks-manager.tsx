"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, Save, Trash2, X } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import { TASK_FRICTION_TYPES } from "@/lib/types";
import type {
  LifeArea,
  Project,
  Task,
  TaskFrictionType,
  TaskStatus,
} from "@/lib/types";
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

type TaskForm = {
  title: string;
  life_area_id: number | null;
  project_id: number | null;
  status: TaskStatus;
  importance: number;
  effort: number;
  friction_type: TaskFrictionType;
  friction_note: string;
  due_date: string | null;
  notes: string;
};

const emptyTask: TaskForm = {
  title: "",
  life_area_id: null,
  project_id: null,
  status: "open",
  importance: 3,
  effort: 3,
  friction_type: "none",
  friction_note: "",
  due_date: null,
  notes: "",
};

const frictionLabels: Record<TaskFrictionType, string> = {
  none: "none",
  unclear: "unclear",
  too_large: "too large",
  scary: "scary",
  blocked: "blocked",
  low_energy: "low energy",
  needs_person: "needs person",
  not_important: "not important",
  admin_drag: "admin drag",
};

function formFromTask(task: Task): TaskForm {
  return {
    title: task.title,
    life_area_id: task.life_area_id,
    project_id: task.project_id,
    status: task.status,
    importance: task.importance,
    effort: task.effort,
    friction_type: task.friction_type ?? "none",
    friction_note: task.friction_note ?? "",
    due_date: task.due_date,
    notes: task.notes,
  };
}

export function TasksManager() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [areas, setAreas] = useState<LifeArea[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState<TaskForm>(emptyTask);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingForm, setEditingForm] = useState<TaskForm>(emptyTask);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const openTasks = useMemo(
    () => tasks.filter((task) => task.status === "open"),
    [tasks],
  );
  const isInitialLoading = loading && tasks.length === 0;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [taskData, areaData, projectData] = await Promise.all([
        apiFetch<Task[]>("/api/tasks"),
        apiFetch<LifeArea[]>("/api/life-areas"),
        apiFetch<Project[]>("/api/projects"),
      ]);
      setTasks(taskData);
      setAreas(areaData);
      setProjects(projectData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm(emptyTask);
      setMessage("Task added.");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not add task.");
    } finally {
      setSaving(false);
    }
  }

  async function saveTask(id: number, nextForm: TaskForm) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<Task>(`/api/tasks/${id}`, {
        method: "PUT",
        body: JSON.stringify(nextForm),
      });
      setEditingId(null);
      setMessage("Task saved.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save task.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTask(id: number) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<void>(`/api/tasks/${id}`, { method: "DELETE" });
      setMessage("Task deleted.");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Tasks" title="Open Loops">
        <p>
          Keep tasks simple and honest. FlowPath uses open tasks as inputs, not as a
          demand that every task deserves attention today.
        </p>
      </PageHeader>

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-2xl font-semibold">
            {isInitialLoading ? "..." : openTasks.length}
          </div>
          <div className="text-sm text-slate-400">open tasks</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold">
            {isInitialLoading
              ? "..."
              : openTasks.filter((task) => task.importance >= 4).length}
          </div>
          <div className="text-sm text-slate-400">high importance</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold">
            {isInitialLoading
              ? "..."
              : openTasks.filter((task) => task.effort <= 2).length}
          </div>
          <div className="text-sm text-slate-400">low effort</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold">
            {isInitialLoading
              ? "..."
              : openTasks.filter((task) => (task.friction_type ?? "none") !== "none").length}
          </div>
          <div className="text-sm text-slate-400">friction signals</div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <h2 className="mb-4 text-xl font-semibold">Add Task</h2>
          <form className="grid gap-4" onSubmit={createTask}>
            <TaskFields
              form={form}
              setForm={setForm}
              areas={areas}
              projects={projects}
            />
            <div>
              <Button type="submit" disabled={saving}>
                <Plus className="h-4 w-4" />
                {saving ? "Saving..." : "Add Task"}
              </Button>
            </div>
          </form>
        </Card>

        <div className="grid gap-3">
          {loading ? (
            <Card>
              <div className="text-sm text-slate-400">Loading tasks...</div>
            </Card>
          ) : tasks.length === 0 ? (
            <EmptyState>No tasks yet. Add one when something needs a holding pen.</EmptyState>
          ) : (
            tasks.map((task) => {
              const editing = editingId === task.id;
              const frictionType = task.friction_type ?? "none";
              return (
                <Card
                  key={task.id}
                  className={task.status === "done" ? "opacity-70" : ""}
                >
                  {editing ? (
                    <div className="grid gap-4">
                      <TaskFields
                        form={editingForm}
                        setForm={setEditingForm}
                        areas={areas}
                        projects={projects}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={() => saveTask(task.id, editingForm)}
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
                            <h2 className="text-lg font-semibold">{task.title}</h2>
                            <span className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300">
                              {task.status}
                            </span>
                            {task.life_area_name ? (
                              <span className="rounded-md bg-[rgba(0,120,212,0.18)] px-2 py-1 text-xs font-medium text-blue-100">
                                {task.life_area_name}
                              </span>
                            ) : null}
                            {task.project_name ? (
                              <span className="rounded-md bg-blue-950/60 px-2 py-1 text-xs font-medium text-blue-100">
                                {task.project_name}
                              </span>
                            ) : null}
                            {task.situation_title ? (
                              <span className="rounded-md bg-[rgba(0,120,212,0.18)] px-2 py-1 text-xs font-medium text-blue-100">
                                {task.situation_title}
                              </span>
                            ) : null}
                            {frictionType !== "none" ? (
                              <span className="rounded-md bg-amber-950/70 px-2 py-1 text-xs font-medium text-amber-100">
                                {frictionLabels[frictionType]}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-slate-300">
                            {task.notes || "No notes."}
                          </p>
                          {task.friction_note ? (
                            <p className="mt-2 text-sm text-amber-100/90">
                              Friction: {task.friction_note}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {task.status !== "done" ? (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() =>
                                saveTask(task.id, {
                                  ...formFromTask(task),
                                  status: "done",
                                })
                              }
                              disabled={saving}
                            >
                              <Check className="h-4 w-4" />
                              Done
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setEditingId(task.id);
                              setEditingForm(formFromTask(task));
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => deleteTask(task.id)}
                            disabled={saving}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-3 text-sm sm:grid-cols-4">
                        <Info title="Importance" value={`${task.importance}/5`} />
                        <Info title="Effort" value={`${task.effort}/5`} />
                        <Info
                          title="Friction"
                          value={frictionLabels[frictionType]}
                        />
                        <Info title="Due date" value={task.due_date || "None"} />
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

function TaskFields({
  form,
  setForm,
  areas,
  projects,
}: {
  form: TaskForm;
  setForm: React.Dispatch<React.SetStateAction<TaskForm>>;
  areas: LifeArea[];
  projects: Project[];
}) {
  return (
    <>
      <Field label="Title">
        <TextInput
          value={form.title}
          onChange={(event) =>
            setForm((current) => ({ ...current, title: event.target.value }))
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
        <Field label="Project">
          <SelectInput
            value={form.project_id ?? ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                project_id: event.target.value ? Number(event.target.value) : null,
              }))
            }
          >
            <option value="">None</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Status">
          <SelectInput
            value={form.status}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                status: event.target.value as TaskStatus,
              }))
            }
          >
            <option value="open">open</option>
            <option value="done">done</option>
            <option value="ignored">ignored</option>
          </SelectInput>
        </Field>
        <Field label="Importance">
          <SelectInput
            value={form.importance}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                importance: Number(event.target.value),
              }))
            }
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Effort">
          <SelectInput
            value={form.effort}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                effort: Number(event.target.value),
              }))
            }
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <Field label="Due date">
        <TextInput
          type="date"
          value={form.due_date ?? ""}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              due_date: event.target.value || null,
            }))
          }
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Friction">
          <SelectInput
            value={form.friction_type}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                friction_type: event.target.value as TaskFrictionType,
              }))
            }
          >
            {TASK_FRICTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {frictionLabels[type]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Friction note">
          <TextInput
            value={form.friction_note}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                friction_note: event.target.value,
              }))
            }
            placeholder="Why this might stall..."
          />
        </Field>
      </div>
      <Field label="Notes">
        <TextArea
          value={form.notes}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
        />
      </Field>
    </>
  );
}

function Info({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <div className="font-medium">{title}</div>
      <p className="text-slate-300">{value}</p>
    </div>
  );
}

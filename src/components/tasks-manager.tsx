"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { Check, Clock3, Pencil, Plus, Save, Trash2, X } from "lucide-react";

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
  const deferredOrDone = useMemo(
    () => tasks.filter((task) => task.status !== "open"),
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

  async function createTask(event: FormEvent<HTMLFormElement>) {
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
      <PageHeader eyebrow="Tasks" title="Ranked next actions">
        <p>
          Tasks from every situation are ranked by what matters most now, not by
          where they came from.
        </p>
      </PageHeader>

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-2xl font-semibold">
            {isInitialLoading ? "..." : openTasks.length}
          </div>
          <div className="text-sm text-slate-400">open actions</div>
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
              : openTasks.filter((task) => task.source_next_move_plan_id).length}
          </div>
          <div className="text-sm text-slate-400">from plans</div>
        </Card>
      </div>

      <div className="grid gap-5">
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-[var(--azure-light)]" />
            <h2 className="text-xl font-semibold">Action queue</h2>
          </div>
          {loading ? (
            <div className="text-sm text-slate-400">Loading tasks...</div>
          ) : openTasks.length === 0 ? (
            <EmptyState>
              No tasks yet. Start with a situation and FlowPath will turn the plan
              into ranked next actions.
            </EmptyState>
          ) : (
            <div className="grid gap-3">
              {openTasks.map((task, index) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  rank={index + 1}
                  editing={editingId === task.id}
                  editingForm={editingForm}
                  setEditingForm={setEditingForm}
                  areas={areas}
                  projects={projects}
                  saving={saving}
                  onSave={() => saveTask(task.id, editingForm)}
                  onDone={() =>
                    saveTask(task.id, {
                      ...formFromTask(task),
                      status: "done",
                    })
                  }
                  onDefer={() =>
                    saveTask(task.id, {
                      ...formFromTask(task),
                      status: "ignored",
                    })
                  }
                  onEdit={() => {
                    setEditingId(task.id);
                    setEditingForm(formFromTask(task));
                  }}
                  onCancel={() => setEditingId(null)}
                  onDelete={() => deleteTask(task.id)}
                />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <details>
            <summary className="cursor-pointer text-xl font-semibold text-white">
              Add a task manually
            </summary>
            <form className="mt-5 grid gap-4" onSubmit={createTask}>
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
          </details>
        </Card>

        {deferredOrDone.length > 0 ? (
          <Card>
            <details>
              <summary className="cursor-pointer text-xl font-semibold text-white">
                Deferred and completed tasks
              </summary>
              <div className="mt-4 grid gap-3">
                {deferredOrDone.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    editing={editingId === task.id}
                    editingForm={editingForm}
                    setEditingForm={setEditingForm}
                    areas={areas}
                    projects={projects}
                    saving={saving}
                    onSave={() => saveTask(task.id, editingForm)}
                    onDone={() =>
                      saveTask(task.id, {
                        ...formFromTask(task),
                        status: "done",
                      })
                    }
                    onDefer={() =>
                      saveTask(task.id, {
                        ...formFromTask(task),
                        status: "ignored",
                      })
                    }
                    onEdit={() => {
                      setEditingId(task.id);
                      setEditingForm(formFromTask(task));
                    }}
                    onCancel={() => setEditingId(null)}
                    onDelete={() => deleteTask(task.id)}
                  />
                ))}
              </div>
            </details>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  rank,
  editing,
  editingForm,
  setEditingForm,
  areas,
  projects,
  saving,
  onSave,
  onDone,
  onDefer,
  onEdit,
  onCancel,
  onDelete,
}: {
  task: Task;
  rank?: number;
  editing: boolean;
  editingForm: TaskForm;
  setEditingForm: Dispatch<SetStateAction<TaskForm>>;
  areas: LifeArea[];
  projects: Project[];
  saving: boolean;
  onSave: () => void;
  onDone: () => void;
  onDefer: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const frictionType = task.friction_type ?? "none";

  return (
    <div className={`rounded-md border border-slate-800 bg-slate-900/70 p-4 ${task.status === "done" ? "opacity-70" : ""}`}>
      {editing ? (
        <div className="grid gap-4">
          <TaskFields
            form={editingForm}
            setForm={setEditingForm}
            areas={areas}
            projects={projects}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onSave} disabled={saving}>
              <Save className="h-4 w-4" />
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {rank ? (
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--azure)] text-sm font-semibold text-white">
                    {rank}
                  </span>
                ) : null}
                <h2 className="text-lg font-semibold">{task.title}</h2>
                <Badge>{task.status === "ignored" ? "deferred" : task.status}</Badge>
                {task.situation_title ? <Badge>{task.situation_title}</Badge> : null}
                {task.source_next_move_plan_id ? <Badge>Next Move plan</Badge> : null}
                {frictionType !== "none" ? <Badge>{frictionLabels[frictionType]}</Badge> : null}
              </div>
              <p className="mt-2 text-sm text-slate-300">
                {task.notes || "No notes."}
              </p>
              {task.rank_reason ? (
                <p className="mt-2 text-sm text-[var(--azure-light)]">
                  Why ranked here: {task.rank_reason}
                </p>
              ) : null}
              {task.friction_note ? (
                <p className="mt-2 text-sm text-amber-100/90">
                  Friction: {task.friction_note}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {task.status !== "done" ? (
                <Button type="button" variant="secondary" onClick={onDone} disabled={saving}>
                  <Check className="h-4 w-4" />
                  Complete
                </Button>
              ) : null}
              {task.status === "open" ? (
                <Button type="button" variant="secondary" onClick={onDefer} disabled={saving}>
                  <Clock3 className="h-4 w-4" />
                  Defer
                </Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              <Button type="button" variant="danger" onClick={onDelete} disabled={saving}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-5">
            <Info title="Importance" value={`${task.importance}/5`} />
            <Info title="Effort" value={`${task.effort}/5`} />
            <Info title="Friction" value={frictionLabels[frictionType]} />
            <Info title="Due date" value={task.due_date || "None"} />
            <Info title="Score" value={String(Math.round(task.rank_score ?? 0))} />
          </div>
        </div>
      )}
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
  setForm: Dispatch<SetStateAction<TaskForm>>;
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
            <option value="ignored">deferred</option>
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

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
      {children}
    </span>
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

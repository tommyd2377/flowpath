"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import {
  Ban,
  Check,
  Clock3,
  HelpCircle,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import { TASK_NOTES_MAX, TASK_TITLE_MAX } from "@/lib/schemas";
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
  CharacterCount,
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
  estimated_minutes: number | null;
  due_date: string | null;
  notes: string;
};

type TaskFeedbackOutcome =
  | "completed"
  | "couldnt_complete"
  | "no_longer_relevant"
  | "need_help";

const emptyTask: TaskForm = {
  title: "",
  life_area_id: null,
  project_id: null,
  status: "open",
  importance: 3,
  effort: 3,
  friction_type: "none",
  friction_note: "",
  estimated_minutes: null,
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

const activeTaskStatuses = new Set<TaskStatus>([
  "in_progress",
  "open",
  "blocked",
]);

const statusLabels: Record<TaskStatus, string> = {
  open: "Not Started",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Completed",
  ignored: "No Longer Relevant",
};

function isActiveTask(task: Task) {
  return activeTaskStatuses.has(task.status);
}

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
    estimated_minutes: task.estimated_minutes ?? null,
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

  const activeTasks = useMemo(
    () => tasks.filter(isActiveTask),
    [tasks],
  );
  const inactiveTasks = useMemo(
    () => tasks.filter((task) => !isActiveTask(task)),
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

  async function submitTaskFeedback(
    id: number,
    outcome: TaskFeedbackOutcome,
    notes: string,
  ) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<Task>(`/api/tasks/${id}/feedback`, {
        method: "POST",
        body: JSON.stringify({ outcome, notes }),
      });
      setMessage("Task feedback saved.");
      await load();
    } catch (feedbackError) {
      setError(
        feedbackError instanceof Error
          ? feedbackError.message
          : "Could not save task feedback.",
      );
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
      <PageHeader eyebrow="Tasks" title="Task Queue">
        <p>
          Work through concrete tasks, then give quick feedback so FlowPath can
          learn from what happened.
        </p>
      </PageHeader>

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-2xl font-semibold">
            {isInitialLoading ? "..." : activeTasks.length}
          </div>
          <div className="text-sm text-slate-400">active actions</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold">
            {isInitialLoading
              ? "..."
              : activeTasks.filter((task) => task.importance >= 4).length}
          </div>
          <div className="text-sm text-slate-400">high importance</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold">
            {isInitialLoading
              ? "..."
              : activeTasks.filter((task) => task.effort <= 2).length}
          </div>
          <div className="text-sm text-slate-400">low effort</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold">
            {isInitialLoading
              ? "..."
              : activeTasks.filter((task) => task.source_next_move_plan_id).length}
          </div>
          <div className="text-sm text-slate-400">from plans</div>
        </Card>
      </div>

      <div className="grid gap-5">
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-[var(--azure-light)]" />
            <h2 className="text-xl font-semibold">Task Queue</h2>
          </div>
          {loading ? (
            <div className="text-sm text-slate-400">Loading tasks...</div>
          ) : activeTasks.length === 0 ? (
            <EmptyState>
              No tasks yet. Start with a situation and FlowPath will turn the plan
              into ranked next actions.
            </EmptyState>
          ) : (
            <div className="grid gap-3">
              {activeTasks.map((task, index) => (
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
                  onStart={() =>
                    saveTask(task.id, {
                      ...formFromTask(task),
                      status: "in_progress",
                    })
                  }
                  onFeedback={(outcome, notes) =>
                    submitTaskFeedback(task.id, outcome, notes)
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

        {inactiveTasks.length > 0 ? (
          <Card>
            <details>
              <summary className="cursor-pointer text-xl font-semibold text-white">
                Completed and removed tasks
              </summary>
              <div className="mt-4 grid gap-3">
                {inactiveTasks.map((task) => (
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
                    onStart={() =>
                      saveTask(task.id, {
                        ...formFromTask(task),
                        status: "in_progress",
                      })
                    }
                    onFeedback={(outcome, notes) =>
                      submitTaskFeedback(task.id, outcome, notes)
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
  onStart,
  onFeedback,
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
  onStart: () => void;
  onFeedback: (outcome: TaskFeedbackOutcome, notes: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const frictionType = task.friction_type ?? "none";
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const canGiveFeedback = isActiveTask(task);

  return (
    <div className={`rounded-md border border-slate-800 bg-slate-900/70 p-4 ${!canGiveFeedback ? "opacity-75" : ""}`}>
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
                <Badge>{statusLabels[task.status]}</Badge>
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
              {task.status !== "in_progress" && canGiveFeedback ? (
                <Button type="button" variant="secondary" onClick={onStart} disabled={saving}>
                  <Play className="h-4 w-4" />
                  Start
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
          <div className="grid gap-3 text-sm sm:grid-cols-6">
            <Info title="Importance" value={`${task.importance}/5`} />
            <Info title="Effort" value={`${task.effort}/5`} />
            <Info title="Friction" value={frictionLabels[frictionType]} />
            <Info
              title="Estimate"
              value={task.estimated_minutes ? `${task.estimated_minutes} min` : "None"}
            />
            <Info title="Due date" value={task.due_date || "None"} />
            <Info title="Status" value={statusLabels[task.status]} />
          </div>
          {canGiveFeedback ? (
            <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
              <div className="mb-2 text-sm font-medium text-white">Did you do this?</div>
              <textarea
                value={feedbackNotes}
                onChange={(event) => setFeedbackNotes(event.target.value)}
                maxLength={1200}
                placeholder="Optional notes: what happened, what blocked it, or what help you need."
                className="mb-3 min-h-20 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[var(--azure)] focus:ring-2 focus:ring-[rgba(0,120,212,0.28)]"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onFeedback("completed", feedbackNotes)}
                  disabled={saving}
                >
                  <Check className="h-4 w-4" />
                  Completed
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onFeedback("couldnt_complete", feedbackNotes)}
                  disabled={saving}
                >
                  <Clock3 className="h-4 w-4" />
                  Couldn&apos;t Complete
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onFeedback("no_longer_relevant", feedbackNotes)}
                  disabled={saving}
                >
                  <Ban className="h-4 w-4" />
                  No Longer Relevant
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onFeedback("need_help", feedbackNotes)}
                  disabled={saving}
                >
                  <HelpCircle className="h-4 w-4" />
                  Need Help
                </Button>
              </div>
            </div>
          ) : null}
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
          maxLength={TASK_TITLE_MAX}
          onChange={(event) =>
            setForm((current) => ({ ...current, title: event.target.value }))
          }
          required
        />
        <CharacterCount value={form.title} max={TASK_TITLE_MAX} />
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
            <option value="open">{statusLabels.open}</option>
            <option value="in_progress">{statusLabels.in_progress}</option>
            <option value="blocked">{statusLabels.blocked}</option>
            <option value="done">{statusLabels.done}</option>
            <option value="ignored">{statusLabels.ignored}</option>
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
      <Field label="Estimated minutes">
        <TextInput
          type="number"
          min={1}
          max={480}
          value={form.estimated_minutes ?? ""}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              estimated_minutes: event.target.value ? Number(event.target.value) : null,
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
            maxLength={1200}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                friction_note: event.target.value,
              }))
            }
            placeholder="Why this might stall..."
          />
          <CharacterCount value={form.friction_note} max={1200} />
        </Field>
      </div>
      <Field label="Notes">
        <TextArea
          value={form.notes}
          maxLength={TASK_NOTES_MAX}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
        />
        <CharacterCount value={form.notes} max={TASK_NOTES_MAX} />
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

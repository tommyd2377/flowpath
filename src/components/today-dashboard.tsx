"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, Send, Target } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import type { AppConfig, CheckIn, Situation, StoredPlan } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  TextArea,
  TextInput,
} from "./ui";

type CheckInForm = {
  energy_level: number;
  mood: string;
  sleep: string;
  health_status: string;
  main_thing: string;
  resistance: string;
  brain_dump: string;
};

const emptyCheckIn: CheckInForm = {
  energy_level: 6,
  mood: "",
  sleep: "",
  health_status: "",
  main_thing: "",
  resistance: "",
  brain_dump: "",
};

function formatLongDate(date = new Date()) {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function TodayDashboard() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [form, setForm] = useState<CheckInForm>(emptyCheckIn);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [latestPlan, setLatestPlan] = useState<StoredPlan | null>(null);
  const [activeSituations, setActiveSituations] = useState<Situation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latestCheckIn = checkIns[0];
  const today = useMemo(() => formatLongDate(), []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [configData, checkInData, planData, situationData] = await Promise.all([
        apiFetch<AppConfig>("/api/config"),
        apiFetch<CheckIn[]>("/api/checkins?limit=10"),
        apiFetch<StoredPlan[]>("/api/generate-plan?limit=1"),
        apiFetch<Situation[]>("/api/situations?status=active"),
      ]);
      setConfig(configData);
      setCheckIns(checkInData);
      setLatestPlan(planData[0] ?? null);
      setActiveSituations(situationData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Needle.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  async function saveCheckIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await apiFetch<CheckIn>("/api/checkins", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setCheckIns((current) => [saved, ...current]);
      setMessage("Check-in saved. Needle has fresh signal for today.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save check-in.");
    } finally {
      setSaving(false);
    }
  }

  async function generatePlan() {
    setGenerating(true);
    setError(null);
    setMessage(null);
    try {
      const plan = await apiFetch<StoredPlan>("/api/generate-plan", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setLatestPlan(plan);
      setMessage("Today's Needle is ready.");
      await load();
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Could not generate today's Needle.",
      );
    } finally {
      setGenerating(false);
    }
  }

  const topSituation = activeSituations.find((situation) => situation.latest_plan_move);

  return (
    <div>
      <PageHeader eyebrow="Today" title="Today's Needle">
        <p>
          {today}. Start from current reality, not busyness. Use today to choose the
          next best move.
        </p>
      </PageHeader>

      <div className="mb-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card>
          <div className="mb-2 text-sm font-medium uppercase text-[var(--azure-light)]">
            Top recommended action
          </div>
          {topSituation ? (
            <div>
              <h2 className="text-2xl font-semibold">
                {topSituation.latest_plan_move}
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                From {topSituation.title}.
              </p>
            </div>
          ) : (
            <EmptyState>
              No next move plan yet. Start with a Situation to get a higher-leverage
              recommendation.
            </EmptyState>
          )}
          <Link
            href="/next-move"
            className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md bg-[var(--azure)] px-3 text-sm font-medium text-white"
          >
            Find My Next Move
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>

        <Card>
          <div className="mb-2 text-sm font-medium uppercase text-[var(--azure-light)]">
            Active situations
          </div>
          {activeSituations.length === 0 ? (
            <EmptyState>No active situations yet.</EmptyState>
          ) : (
            <div className="grid gap-2">
              {activeSituations.slice(0, 4).map((situation) => (
                <Link
                  key={situation.id}
                  href={`/situations/${situation.id}`}
                  className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm transition hover:border-[var(--azure)]"
                >
                  <div className="font-medium text-white">{situation.title}</div>
                  <div className="text-slate-400">
                    {situation.category} · {situation.urgency}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid gap-5">
          {!loading && config && !config.hasOpenAiKey ? (
            <Notice tone="warning">
              <div className="flex gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Add <code>OPENAI_API_KEY</code> to <code>.env.local</code> and
                  restart the dev server before generating AI plans. Everything else is
                  usable now.
                </span>
              </div>
            </Notice>
          ) : null}
          {message ? <Notice tone="success">{message}</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}

          <Card>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Daily Check-In</h2>
                <p className="text-sm text-slate-400">
                  Honest signal beats a perfect productivity plan.
                </p>
              </div>
              {latestCheckIn ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-[rgba(0,120,212,0.18)] px-2 py-1 text-xs font-medium text-blue-100">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  saved
                </span>
              ) : null}
            </div>
            <form className="grid gap-4" onSubmit={saveCheckIn}>
              <Field label="Energy level">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={form.energy_level}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        energy_level: Number(event.target.value),
                      }))
                    }
                    className="w-full accent-[var(--azure)]"
                  />
                  <span className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-sm font-semibold text-slate-100">
                    {form.energy_level}
                  </span>
                </div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Mood">
                  <TextInput
                    value={form.mood}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, mood: event.target.value }))
                    }
                    placeholder="Steady, wired, foggy..."
                  />
                </Field>
                <Field label="Sleep">
                  <TextInput
                    value={form.sleep}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, sleep: event.target.value }))
                    }
                    placeholder="Hours, quality, interruptions..."
                  />
                </Field>
              </div>
              <Field label="Health/body status">
                <TextInput
                  value={form.health_status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      health_status: event.target.value,
                    }))
                  }
                  placeholder="Body, symptoms, training readiness..."
                />
              </Field>
              <Field label="Main thing on my mind">
                <TextArea
                  value={form.main_thing}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      main_thing: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="What I feel resistance toward today">
                <TextArea
                  value={form.resistance}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      resistance: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Freeform brain dump">
                <TextArea
                  value={form.brain_dump}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      brain_dump: event.target.value,
                    }))
                  }
                />
              </Field>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button type="submit" disabled={saving}>
                  <Send className="h-4 w-4" />
                  {saving ? "Saving..." : "Save Check-In"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={generatePlan}
                  disabled={generating}
                >
                  <Target className="h-4 w-4" />
                  {generating ? "Generating..." : "Generate Today's Needle"}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <PlanCard plan={latestPlan} loading={loading || generating} />
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  loading,
}: {
  plan: StoredPlan | null;
  loading: boolean;
}) {
  if (loading && !plan) {
    return (
      <Card className="min-h-[360px]">
        <div className="text-sm text-slate-400">Loading briefing...</div>
      </Card>
    );
  }

  if (!plan) {
    return (
      <Card className="min-h-[360px]">
        <EmptyState>
          No daily briefing yet. Save a check-in, add any tasks or project context you
          care about, then generate today&apos;s Needle.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card className="min-h-[360px]">
      <div className="mb-5 border-b border-slate-800 pb-4">
        <div className="text-sm font-medium text-slate-400">Daily Command Briefing</div>
        <h2 className="mt-1 text-2xl font-semibold text-white">
          {plan.today_theme}
        </h2>
        <p className="mt-3 text-slate-300">{plan.honest_read}</p>
      </div>

      <div className="grid gap-4">
        {plan.top_3_actions.map((action, index) => (
          <div key={`${action.title}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900/55 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--azure)] text-sm font-semibold text-white">
                {index + 1}
              </span>
              <h3 className="text-lg font-semibold">{action.title}</h3>
              <span className="rounded-md bg-[rgba(0,120,212,0.18)] px-2 py-1 text-xs font-medium text-blue-100">
                {action.area}
              </span>
              <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
                {action.estimated_minutes} min
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-300">{action.why_it_matters}</p>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <div className="font-medium text-white">First step</div>
                <p className="text-slate-300">{action.first_step}</p>
              </div>
              <div>
                <div className="font-medium text-white">Success condition</div>
                <p className="text-slate-300">{action.success_condition}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <BriefingNote title="Avoid today" value={plan.avoid_today} />
        <BriefingNote
          title="If energy is high"
          value={plan.optional_if_energy_is_high}
        />
        <BriefingNote title="Minimum viable day" value={plan.minimum_viable_day} />
        <BriefingNote title="Evening review" value={plan.evening_review_prompt} />
      </div>
    </Card>
  );
}

function BriefingNote({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
      <div className="font-medium text-white">{title}</div>
      <p className="mt-1 text-slate-300">{value}</p>
    </div>
  );
}

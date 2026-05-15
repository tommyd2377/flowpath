"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, BatteryMedium, ClipboardList } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import type { CheckIn, StoredPlan } from "@/lib/types";
import { Card, EmptyState, Notice, PageHeader } from "./ui";

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function HistoryView() {
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [plans, setPlans] = useState<StoredPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<CheckIn[]>("/api/checkins?limit=60"),
      apiFetch<StoredPlan[]>("/api/generate-plan?limit=60"),
    ])
      .then(([checkInData, planData]) => {
        setCheckIns(checkInData);
        setPlans(planData);
      })
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : "Could not load history."),
      )
      .finally(() => setLoading(false));
  }, []);

  const dates = useMemo(() => {
    return Array.from(
      new Set([
        ...checkIns.map((checkIn) => checkIn.checkin_date),
        ...plans.map((plan) => plan.plan_date),
      ]),
    ).sort((a, b) => b.localeCompare(a));
  }, [checkIns, plans]);

  return (
    <div>
      <PageHeader eyebrow="History" title="Previous FlowPath plans">
        <p>
          Review the signals you gave FlowPath and the briefings it generated over time.
        </p>
      </PageHeader>

      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      {loading ? (
        <Card>
          <div className="text-sm text-slate-400">Loading history...</div>
        </Card>
      ) : dates.length === 0 ? (
        <EmptyState>No check-ins or plans yet.</EmptyState>
      ) : (
        <div className="grid gap-5">
          {dates.map((date) => {
            const dayCheckIns = checkIns.filter((checkIn) => checkIn.checkin_date === date);
            const dayPlans = plans.filter((plan) => plan.plan_date === date);
            return (
              <Card key={date}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <h2 className="text-xl font-semibold">{formatDate(date)}</h2>
                  <span className="flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
                    <Archive className="h-3.5 w-3.5" />
                    {dayCheckIns.length} check-ins, {dayPlans.length} plans
                  </span>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="grid gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <BatteryMedium className="h-4 w-4" />
                      Check-ins
                    </div>
                    {dayCheckIns.length === 0 ? (
                      <EmptyState>No check-in saved for this date.</EmptyState>
                    ) : (
                      dayCheckIns.map((checkIn) => (
                        <div
                          key={checkIn.id}
                          className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-sm"
                        >
                          <div className="mb-2 font-medium">
                            Energy {checkIn.energy_level}/10
                          </div>
                          <div className="grid gap-2 text-slate-300">
                            <p><span className="font-medium text-slate-100">Mood:</span> {checkIn.mood || "Not set."}</p>
                            <p><span className="font-medium text-slate-100">Sleep:</span> {checkIn.sleep || "Not set."}</p>
                            <p><span className="font-medium text-slate-100">Body:</span> {checkIn.health_status || "Not set."}</p>
                            <p><span className="font-medium text-slate-100">Mind:</span> {checkIn.main_thing || "Not set."}</p>
                            <p><span className="font-medium text-slate-100">Resistance:</span> {checkIn.resistance || "Not set."}</p>
                            <p><span className="font-medium text-slate-100">Dump:</span> {checkIn.brain_dump || "Not set."}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="grid gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <ClipboardList className="h-4 w-4" />
                      Plans
                    </div>
                    {dayPlans.length === 0 ? (
                      <EmptyState>No AI plan generated for this date.</EmptyState>
                    ) : (
                      dayPlans.map((plan) => (
                        <div
                          key={plan.id}
                          className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-sm"
                        >
                          <h3 className="text-base font-semibold">{plan.today_theme}</h3>
                          <p className="mt-2 text-slate-300">{plan.honest_read}</p>
                          <div className="mt-3 grid gap-2">
                            {plan.top_3_actions.map((action, index) => (
                              <div key={`${plan.id}-${action.title}-${index}`}>
                                <span className="font-medium text-slate-100">
                                  {index + 1}. {action.title}
                                </span>
                                <span className="text-slate-400">
                                  {" "}
                                  ({action.area}, {action.estimated_minutes} min)
                                </span>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 rounded-md bg-slate-950 p-2 text-slate-300">
                            <span className="font-medium text-slate-100">
                              Minimum viable day:
                            </span>{" "}
                            {plan.minimum_viable_day}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

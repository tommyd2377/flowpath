import type { Task, TaskFrictionType, SituationUrgency } from "./types";
import { todayIsoDate } from "./time";

export type TaskRankingOutcomeContext = {
  userPrefersShorterTasks?: boolean;
  editedTasksDownCount?: number;
  ignoredPlanIds?: number[];
};

const urgencyScore: Record<SituationUrgency, number> = {
  crisis: 40,
  high: 25,
  medium: 10,
  low: 0,
};

const frictionPenalty: Record<TaskFrictionType, number> = {
  none: 0,
  unclear: 2,
  too_large: 4,
  scary: 5,
  blocked: 8,
  low_energy: 4,
  needs_person: 3,
  not_important: 8,
  admin_drag: 4,
};

function daysUntil(date: string, today: string) {
  const due = Date.parse(`${date}T12:00:00Z`);
  const start = Date.parse(`${today}T12:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(start)) return null;
  return Math.round((due - start) / 86_400_000);
}

function deadlineScore(task: Task, today: string) {
  if (!task.due_date) return 0;
  const days = daysUntil(task.due_date, today);
  if (days == null) return 0;
  if (days < 0) return 28;
  if (days <= 1) return 22;
  if (days <= 3) return 16;
  if (days <= 7) return 10;
  return 3;
}

function sourcePlanScore(task: Task) {
  if (!task.source_next_move_plan_id) return 0;
  if (task.source_plan_section === "first_30_minutes") return 18;
  if (task.source_plan_section === "immediate_next_action") return 18;
  if (task.source_plan_section === "next_24_hours") return 12;
  if (task.source_plan_section === "follow_up") return 12;
  if (task.source_plan_section === "next_7_days") return 6;
  return 8;
}

function unblockerScore(task: Task) {
  const text = `${task.title} ${task.notes} ${task.friction_note}`.toLowerCase();
  if (/\b(unblock|blocked|dependency|waiting on|needed before)\b/.test(text)) {
    return 8;
  }
  return 0;
}

function stabilityScore(task: Task) {
  const text = `${task.title} ${task.notes} ${task.situation_title ?? ""}`.toLowerCase();
  if (/\b(safety|stable|stability|housing|food|utility|deadline|urgent|runway|risk)\b/.test(text)) {
    return 8;
  }
  return 0;
}

function outcomeScore(task: Task, context?: TaskRankingOutcomeContext) {
  let score = 0;
  const estimated = task.estimated_minutes ?? null;
  if (context?.userPrefersShorterTasks && estimated != null) {
    if (estimated <= 25) score += 7;
    else if (estimated >= 60) score -= 8;
  }
  if ((context?.editedTasksDownCount ?? 0) > 0 && estimated != null) {
    if (estimated <= 20) score += 4;
    else if (estimated >= 90) score -= 5;
  }
  if (
    task.source_next_move_plan_id &&
    context?.ignoredPlanIds?.includes(task.source_next_move_plan_id)
  ) {
    score -= 12;
  }
  return score;
}

function rankReason(task: Task, today: string, context?: TaskRankingOutcomeContext) {
  const reasons: string[] = [];
  if (task.importance >= 5) reasons.push("highest importance");
  else if (task.importance >= 4) reasons.push("high importance");

  if (task.situation_urgency === "crisis" || task.situation_urgency === "high") {
    reasons.push(`${task.situation_urgency} urgency situation`);
  }

  if (task.due_date) {
    const days = daysUntil(task.due_date, today);
    if (days != null && days < 0) reasons.push("overdue");
    else if (days != null && days <= 3) reasons.push("deadline soon");
  }

  if (task.source_next_move_plan_id) reasons.push("from a Next Move plan");
  if (unblockerScore(task) > 0) reasons.push("unblocks progress");
  if (task.effort <= 2) reasons.push("low effort");
  if ((task.friction_type ?? "none") !== "none") {
    reasons.push(`friction: ${task.friction_type.replaceAll("_", " ")}`);
  }
  if (
    context?.userPrefersShorterTasks &&
    task.estimated_minutes != null &&
    task.estimated_minutes <= 25
  ) {
    reasons.push("fits shorter-action follow-through pattern");
  }

  return reasons.slice(0, 3).join("; ") || "best balance of importance, urgency, and effort";
}

export function scoreTask(
  task: Task,
  today = todayIsoDate(),
  context?: TaskRankingOutcomeContext,
) {
  const urgency = task.situation_urgency
    ? urgencyScore[task.situation_urgency]
    : 0;
  return (
    task.importance * 14 +
    urgency +
    deadlineScore(task, today) +
    sourcePlanScore(task) +
    unblockerScore(task) +
    stabilityScore(task) -
    task.effort * 4 -
    frictionPenalty[task.friction_type ?? "none"] +
    outcomeScore(task, context)
  );
}

export function rankTasks(
  tasks: Task[],
  today = todayIsoDate(),
  context?: TaskRankingOutcomeContext,
): Task[] {
  return tasks
    .map((task) => ({
      ...task,
      rank_score: scoreTask(task, today, context),
      rank_reason: rankReason(task, today, context),
    }))
    .sort((first, second) => {
      const firstStatus = first.status === "open" ? 0 : first.status === "ignored" ? 1 : 2;
      const secondStatus = second.status === "open" ? 0 : second.status === "ignored" ? 1 : 2;
      if (firstStatus !== secondStatus) return firstStatus - secondStatus;
      if ((second.rank_score ?? 0) !== (first.rank_score ?? 0)) {
        return (second.rank_score ?? 0) - (first.rank_score ?? 0);
      }
      return second.created_at.localeCompare(first.created_at);
    });
}

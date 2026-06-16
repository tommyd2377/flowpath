export type FounderEventName =
  | "founder_situation_started"
  | "founder_intake_completed"
  | "founder_plan_generated"
  | "founder_top_move_viewed"
  | "founder_task_outcome_submitted"
  | "founder_replan_requested"
  | "founder_task_completed"
  | "founder_task_blocked"
  | "founder_task_skipped";

type FounderEventMetadata = Record<string, string | number | boolean | null | undefined>;

export function recordFounderEvent(
  name: FounderEventName,
  metadata: FounderEventMetadata = {},
) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("flowpath-founder-event", {
      detail: {
        name,
        metadata,
        occurredAt: new Date().toISOString(),
      },
    }),
  );

  if (process.env.NODE_ENV !== "production") {
    console.debug("[FlowPath founder event]", name, metadata);
  }
}

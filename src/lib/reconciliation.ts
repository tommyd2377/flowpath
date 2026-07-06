import {
  createInferredContextItem,
  getInferredContextItem,
  markInferredContextItemDeleted,
  markInferredContextItemStale,
  mergeInferredContextItems,
  updateInferredContextItemFromReconciliation,
} from "./repository";
import type {
  ReconciliationOperationInput,
  ReconciliationResultInput,
} from "./schemas";
import type { InferredContextItem } from "./types";

export type ReconciliationApplyRefs = {
  situation_id?: number | null;
  intake_session_id?: number | null;
  next_move_plan_id?: number | null;
  isQa?: boolean;
};

export type AppliedReconciliationCounts = {
  created: number;
  updated: number;
  merged: number;
  marked_stale: number;
  deleted: number;
  skipped: number;
};

export type AppliedReconciliationResult = {
  counts: AppliedReconciliationCounts;
  appliedMemoryItems: InferredContextItem[];
  skippedOperations: Array<{
    type: ReconciliationOperationInput["type"];
    reason: string;
  }>;
};

function emptyCounts(): AppliedReconciliationCounts {
  return {
    created: 0,
    updated: 0,
    merged: 0,
    marked_stale: 0,
    deleted: 0,
    skipped: 0,
  };
}

export function parseReconciliationMemoryId(value: string) {
  const numeric = Number(value.replace(/^memory\./, ""));
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export function userExplicitlyRequestedMemoryDeletion(text: string) {
  return /\b(forget|delete|remove|erase|drop|stop remembering|no longer remember)\b/i.test(
    text,
  );
}

function skip(
  result: AppliedReconciliationResult,
  operation: ReconciliationOperationInput,
  reason: string,
) {
  result.counts.skipped += 1;
  result.skippedOperations.push({ type: operation.type, reason });
}

async function existingMemory(
  userId: number,
  operation: ReconciliationOperationInput & { memory_id: string },
) {
  const id = parseReconciliationMemoryId(operation.memory_id);
  if (!id) return null;
  return getInferredContextItem(userId, id);
}

export async function applyReconciliationOperations({
  userId,
  userText,
  reconciliation,
  refs = {},
}: {
  userId: number;
  userText: string;
  reconciliation: ReconciliationResultInput;
  refs?: ReconciliationApplyRefs;
}): Promise<AppliedReconciliationResult> {
  const result: AppliedReconciliationResult = {
    counts: emptyCounts(),
    appliedMemoryItems: [],
    skippedOperations: [],
  };
  const explicitDelete = userExplicitlyRequestedMemoryDeletion(userText);

  for (const operation of reconciliation.operations) {
    if (operation.type === "noop") continue;

    if (reconciliation.requires_user_confirmation) {
      skip(result, operation, "The reconciliation requires user confirmation.");
      continue;
    }

    if (operation.type === "create_memory") {
      const created = await createInferredContextItem(
        userId,
        {
          label: operation.label,
          value: operation.value,
          category: operation.category,
          sensitivity: operation.sensitivity,
          persistence: operation.persistence,
          source: "manual",
          situation_id: refs.situation_id ?? null,
          intake_session_id: refs.intake_session_id ?? null,
          next_move_plan_id: refs.next_move_plan_id ?? null,
        },
        {
          allowSavedMemory:
            operation.confidence === "high" && operation.sensitivity !== "high",
          isQa: refs.isQa,
        },
      );
      result.counts.created += 1;
      result.appliedMemoryItems.push(created);
      continue;
    }

    if (operation.type === "update_memory") {
      const memory = await existingMemory(userId, operation);
      if (!memory) {
        skip(result, operation, "Memory id was not found.");
        continue;
      }
      const updated = await updateInferredContextItemFromReconciliation(
        userId,
        memory.id,
        {
          label: operation.label || undefined,
          value: operation.value || undefined,
          category: operation.category ?? undefined,
          sensitivity: operation.sensitivity ?? undefined,
          persistence: operation.persistence ?? undefined,
          confidence: operation.confidence,
          reconciliation_note: operation.reason,
        },
      );
      if (!updated) {
        skip(result, operation, "Memory could not be updated.");
        continue;
      }
      result.counts.updated += 1;
      result.appliedMemoryItems.push(updated);
      continue;
    }

    if (operation.type === "merge_memory") {
      const ids = operation.memory_ids
        .map(parseReconciliationMemoryId)
        .filter((id): id is number => Boolean(id));
      if (ids.length < 2) {
        skip(result, operation, "At least two valid memory ids are required.");
        continue;
      }
      const merged = await mergeInferredContextItems(userId, {
        memory_ids: ids,
        label: operation.label,
        value: operation.value,
        category: operation.category,
        sensitivity: operation.sensitivity,
        persistence: operation.persistence,
        confidence: operation.confidence,
        reason: operation.reason,
        situation_id: refs.situation_id ?? null,
        intake_session_id: refs.intake_session_id ?? null,
        next_move_plan_id: refs.next_move_plan_id ?? null,
        isQa: refs.isQa,
      });
      if (!merged) {
        skip(result, operation, "Memory could not be merged.");
        continue;
      }
      result.counts.merged += 1;
      result.appliedMemoryItems.push(merged);
      continue;
    }

    if (operation.type === "mark_stale") {
      const memory = await existingMemory(userId, operation);
      if (!memory) {
        skip(result, operation, "Memory id was not found.");
        continue;
      }
      const changed = await markInferredContextItemStale(
        userId,
        memory.id,
        operation.reason,
        operation.confidence,
      );
      if (!changed) {
        skip(result, operation, "Memory could not be marked stale.");
        continue;
      }
      result.counts.marked_stale += 1;
      continue;
    }

    if (operation.type === "delete_memory") {
      const memory = await existingMemory(userId, operation);
      if (!memory) {
        skip(result, operation, "Memory id was not found.");
        continue;
      }
      if (!explicitDelete && operation.confidence !== "high") {
        const changed = await markInferredContextItemStale(
          userId,
          memory.id,
          operation.reason,
          operation.confidence,
        );
        if (changed) {
          result.counts.marked_stale += 1;
          continue;
        }
        skip(result, operation, "Memory could not be safely downgraded to stale.");
        continue;
      }
      const changed = await markInferredContextItemDeleted(
        userId,
        memory.id,
        operation.reason,
        operation.confidence,
      );
      if (!changed) {
        skip(result, operation, "Memory could not be deleted.");
        continue;
      }
      result.counts.deleted += 1;
    }
  }

  return result;
}

export function reconciliationResultMessage({
  reconciliation,
  applied,
  fallback,
}: {
  reconciliation: ReconciliationResultInput | null;
  applied: AppliedReconciliationResult | null;
  fallback?: string;
}) {
  if (!reconciliation || !applied) return fallback ?? "Update saved.";
  if (reconciliation.follow_up_question) return reconciliation.follow_up_question;
  const followup = reconciliation.recommended_followup_action.trim();
  if (reconciliation.user_visible_explanation) {
    return followup
      ? `${reconciliation.user_visible_explanation} Next: ${followup}`
      : reconciliation.user_visible_explanation;
  }
  if (followup) return followup;
  const parts = [
    applied.counts.created ? `${applied.counts.created} added` : "",
    applied.counts.updated ? `${applied.counts.updated} updated` : "",
    applied.counts.merged ? `${applied.counts.merged} merged` : "",
    applied.counts.marked_stale ? `${applied.counts.marked_stale} marked stale` : "",
    applied.counts.deleted ? `${applied.counts.deleted} forgotten` : "",
  ].filter(Boolean);
  return parts.length ? `Memory reconciled: ${parts.join(", ")}.` : reconciliation.summary;
}

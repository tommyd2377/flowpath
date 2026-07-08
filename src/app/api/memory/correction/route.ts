import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  canUseFeature,
  incrementUsage,
} from "@/lib/billing/usage";
import { inferMemoryCategoryFromText } from "@/lib/entry-domains";
import { reconcileMemoryAndBoardUpdate } from "@/lib/flowpath-ai";
import { sanitizeGenerationError } from "@/lib/generation-observability";
import { isQaRequest } from "@/lib/qa-mode";
import {
  completeGenerationEvent,
  createInferredContextItem,
  listInferredContextItems,
  startGenerationEvent,
} from "@/lib/repository";
import {
  applyReconciliationOperations,
  reconciliationResultMessage,
} from "@/lib/reconciliation";
import { memoryCorrectionInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const clientGenerationId = `server-memory-reconciliation-${crypto.randomUUID()}`;
  let userId: number | null = null;
  let generationEventStarted = false;
  let generationEventCompleted = false;

  try {
    const user = await requireUser();
    userId = user.id;
    const input = memoryCorrectionInputSchema.parse(await readJson(request));
    const isQa = isQaRequest(request);
    const usageDecision = await canUseFeature(user.id, "lightweight_assist");
    const existingMemory = await listInferredContextItems(user.id, {
      isQa,
      includeInactive: false,
    });

    if (usageDecision.allowed && process.env.OPENAI_API_KEY) {
      try {
        await startGenerationEvent(user.id, {
          client_generation_id: clientGenerationId,
          generation_type: "memory_extraction",
          flow_type: "memory_reconciliation",
          flow_status: "running",
          model_role: "memory_model",
          quota_tier: usageDecision.planTier,
          quota_usage_type: "lightweight_assist",
          structural_counts: {
            memory_items_used: existingMemory.length,
            correction_chars: input.content.length,
          },
          is_qa: isQa,
        });
        generationEventStarted = true;
        const generated = await reconcileMemoryAndBoardUpdate({
          date: new Date().toISOString(),
          source: "memory_correction",
          user_update: input.content,
          board: null,
          latest_plan: null,
          move_map: null,
          existing_memory: existingMemory.slice(0, 40).map((item) => ({
            id: item.id,
            label: item.label,
            value: item.value,
            category: item.category,
            sensitivity: item.sensitivity,
            persistence: item.persistence,
            source: item.source,
            status: item.status,
            confidence: item.confidence,
            situation_id: item.situation_id,
            updated_at: item.updated_at,
          })),
          intake_summary: { session_summary: "", recent_messages: [] },
          task_or_action_history: [],
        });
        const applied = await applyReconciliationOperations({
          userId: user.id,
          userText: input.content,
          reconciliation: generated.reconciliation,
        });
        await incrementUsage(user.id, "lightweight_assist", generated.usage);
        await completeGenerationEvent(user.id, clientGenerationId, {
          status: "success",
          flowStatus: "success",
          model: generated.model,
          modelRole: generated.modelRole,
          inputTokens: generated.usage.inputTokens,
          cachedInputTokens: generated.usage.cachedInputTokens,
          outputTokens: generated.usage.outputTokens,
          totalTokens: generated.usage.totalTokens,
          estimatedCostUsd: generated.usage.estimatedCostUsd,
          memoryItemsUsed: existingMemory.length,
          quotaTier: usageDecision.planTier,
          quotaUsageType: "lightweight_assist",
          structuralCounts: {
            operations_count: generated.reconciliation.operations.length,
            created_count: applied.counts.created,
            updated_count: applied.counts.updated,
            stale_count: applied.counts.marked_stale,
            deleted_count: applied.counts.deleted,
            requires_confirmation: generated.reconciliation.requires_user_confirmation,
            structured_output_repaired:
              generated.structuredOutput.structuredOutputRepaired,
            structured_output_repair_attempts:
              generated.structuredOutput.structuredOutputRepairAttempts,
          },
        });
        generationEventCompleted = true;
        return dataResponse({
          status: generated.reconciliation.requires_user_confirmation
            ? "needs_confirmation"
            : "reconciled",
          reconciliation: generated.reconciliation,
          applied,
          message: reconciliationResultMessage({
            reconciliation: generated.reconciliation,
            applied,
            fallback: "Memory updated.",
          }),
        });
      } catch (generationError) {
        const sanitized = sanitizeGenerationError(generationError);
        if (generationEventStarted) {
          await completeGenerationEvent(user.id, clientGenerationId, {
            status: "error",
            flowStatus: "error",
            errorCategory: sanitized.errorCategory,
            errorMessageSanitized: sanitized.errorMessageSanitized,
            quotaTier: usageDecision.planTier,
            quotaUsageType: "lightweight_assist",
          }).catch(() => undefined);
          generationEventCompleted = true;
        }
        console.warn("Memory reconciliation failed; saving unreconciled correction", sanitized);
      }
    }

    const item = await createInferredContextItem(
      user.id,
      {
        label: "Unreconciled memory correction",
        value: input.content,
        category: inferMemoryCategoryFromText(input.content),
        sensitivity: "low",
        persistence: "proposed_memory",
        source: "manual",
        situation_id: null,
        intake_session_id: null,
        next_move_plan_id: null,
      },
      { allowSavedMemory: false, isQa },
    );
    return dataResponse(
      {
        status: "saved_unreconciled",
        item,
        message: "I saved that correction, but could not reconcile it yet.",
      },
      201,
    );
  } catch (error) {
    if (userId && generationEventStarted && !generationEventCompleted) {
      const sanitized = sanitizeGenerationError(error);
      await completeGenerationEvent(userId, clientGenerationId, {
        status: "error",
        flowStatus: "error",
        errorCategory: sanitized.errorCategory,
        errorMessageSanitized: sanitized.errorMessageSanitized,
      }).catch(() => undefined);
    }
    return errorResponse(error, "Could not update memory.");
  }
}

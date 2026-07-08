import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  canUseFeature,
  incrementUsage,
} from "@/lib/billing/usage";
import {
  getBoard,
  listTasksForBoard,
  updateBoard,
  type Board,
} from "@/lib/boards";
import { decisionTreeTrace } from "@/lib/decision-tree";
import {
  entryDomainFallbackTitle,
  inferBoardTitle,
  inferMemoryCategoryFromText,
} from "@/lib/entry-domains";
import { reconcileMemoryAndBoardUpdate } from "@/lib/flowpath-ai";
import { sanitizeGenerationError } from "@/lib/generation-observability";
import { isQaRequest } from "@/lib/qa-mode";
import {
  addIntakeMessage,
  completeGenerationEvent,
  createInferredContextItem,
  getLatestIntakeSession,
  getLatestNextMovePlan,
  getOrCreateIntakeSession,
  listInferredContextItems,
  listIntakeMessages,
  startGenerationEvent,
  updateIntakeSession,
} from "@/lib/repository";
import {
  applyReconciliationOperations,
  reconciliationResultMessage,
} from "@/lib/reconciliation";
import { boardUpdateInputSchema } from "@/lib/schemas";
import type { ReconciliationResultInput } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function selectedPathLabels(plan: Awaited<ReturnType<typeof getLatestNextMovePlan>>) {
  if (!plan) return [];
  return decisionTreeTrace(plan.decision_tree).flatMap((item) =>
    item.selectedOption ? [item.selectedOption.label] : [],
  );
}

async function applyBoardUpdates({
  userId,
  situation,
  reconciliation,
}: {
  userId: number;
  situation: Board;
  reconciliation: ReconciliationResultInput;
}) {
  const updates = reconciliation.board_updates;
  if (!updates) return situation;
  const next: Board = {
    ...situation,
    title: updates.title || situation.title,
    description: updates.description || situation.description,
    category: updates.category || situation.category,
    status: updates.status ?? situation.status,
    urgency: updates.urgency ?? situation.urgency,
  };
  const changed =
    next.title !== situation.title ||
    next.description !== situation.description ||
    next.category !== situation.category ||
    next.status !== situation.status ||
    next.urgency !== situation.urgency;
  if (!changed) return situation;
  return (await updateBoard(userId, situation.id, next)) ?? situation;
}

export async function POST(request: Request, context: Context) {
  const clientGenerationId = `server-board-reconciliation-${crypto.randomUUID()}`;
  let userId: number | null = null;
  let generationEventStarted = false;
  let generationEventCompleted = false;

  try {
    const user = await requireUser();
    userId = user.id;
    const { id: idParam } = await context.params;
    const situationId = parseId(idParam);
    const input = boardUpdateInputSchema.parse(await readJson(request));
    const isQa = isQaRequest(request);
    const situation = await getBoard(user.id, situationId);
    if (!situation) throw new ApiRequestError("Board not found.", 404, "not_found");

    const session =
      (await getLatestIntakeSession(user.id, situationId)) ??
      (await getOrCreateIntakeSession(user.id, situationId));
    const message = await addIntakeMessage(
      user.id,
      session.id,
      "user",
      input.content,
      { clientMessageId: input.client_message_id, isQa },
    );
    let reconciledSituation = situation;
    let reconciliation: ReconciliationResultInput | null = null;
    let reconciliationMessage: string | null = null;
    const latestPlan = await getLatestNextMovePlan(user.id, situation.id, { isQa });
    const usageDecision = await canUseFeature(user.id, "lightweight_assist");

    if (usageDecision.allowed && process.env.OPENAI_API_KEY) {
      try {
        const [existingMemory, messagesForContext, tasks] = await Promise.all([
          listInferredContextItems(user.id, { isQa, includeInactive: false }),
          listIntakeMessages(user.id, session.id),
          listTasksForBoard(user.id, situation.id, { isQa }),
        ]);
        await startGenerationEvent(user.id, {
          client_generation_id: clientGenerationId,
          generation_type: "memory_extraction",
          situation_id: situation.id,
          plan_id: latestPlan?.id ?? null,
          flow_type: "board_reconciliation",
          flow_status: "running",
          model_role: "memory_model",
          quota_tier: usageDecision.planTier,
          quota_usage_type: "lightweight_assist",
          structural_counts: {
            memory_items_used: existingMemory.length,
            update_chars: input.content.length,
            selected_path_depth: latestPlan?.decision_tree.selected_path.length ?? 0,
          },
          is_qa: isQa,
        });
        generationEventStarted = true;
        const generated = await reconcileMemoryAndBoardUpdate({
          date: new Date().toISOString(),
          source: "board_update",
          user_update: input.content,
          board: {
            id: situation.id,
            title: situation.title,
            description: situation.description,
            category: situation.category,
            status: situation.status,
            urgency: situation.urgency,
          },
          latest_plan: latestPlan
            ? {
                id: latestPlan.id,
                situation_read: latestPlan.situation_read,
                situation_summary: latestPlan.situation_summary,
                key_constraints: latestPlan.key_constraints,
                highest_leverage_move_title:
                  latestPlan.highest_leverage_move_today.title,
                likely_trap: latestPlan.likely_trap,
                assumptions: latestPlan.assumptions,
              }
            : null,
          move_map: latestPlan
            ? {
                selected_path: latestPlan.decision_tree.selected_path,
                selected_path_labels: selectedPathLabels(latestPlan),
                active_node_id: latestPlan.decision_tree.active_node_id,
                recommended_option_id: latestPlan.decision_tree.recommended_option_id,
              }
            : null,
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
          intake_summary: {
            session_summary: session.summary_so_far ?? "",
            recent_messages: messagesForContext.slice(-8).map((item) => ({
              role: item.role,
              content: item.content,
            })),
          },
          task_or_action_history: tasks.slice(0, 12).map((task) => ({
            title: task.title,
            status: task.status,
            source_plan_section: task.source_plan_section ?? null,
          })),
        });
        reconciliation = generated.reconciliation;
        const applied = await applyReconciliationOperations({
          userId: user.id,
          userText: input.content,
          reconciliation,
          refs: {
            situation_id: situation.id,
            intake_session_id: session.id,
            next_move_plan_id: latestPlan?.id ?? null,
            isQa,
          },
        });
        reconciledSituation = await applyBoardUpdates({
          userId: user.id,
          situation,
          reconciliation,
        });
        reconciliationMessage = reconciliationResultMessage({
          reconciliation,
          applied,
          fallback: "Board update reconciled.",
        });
        await incrementUsage(user.id, "lightweight_assist", generated.usage);
        await completeGenerationEvent(user.id, clientGenerationId, {
          status: "success",
          flowStatus: "success",
          planId: latestPlan?.id ?? null,
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
            operations_count: reconciliation.operations.length,
            created_count: applied.counts.created,
            updated_count: applied.counts.updated,
            stale_count: applied.counts.marked_stale,
            deleted_count: applied.counts.deleted,
            should_recalculate: reconciliation.move_map_effect?.should_recalculate ?? true,
            preserve_tree:
              reconciliation.move_map_effect?.should_preserve_existing_tree ?? false,
            structured_output_repaired:
              generated.structuredOutput.structuredOutputRepaired,
            structured_output_repair_attempts:
              generated.structuredOutput.structuredOutputRepairAttempts,
          },
        });
        generationEventCompleted = true;
      } catch (generationError) {
        const sanitized = sanitizeGenerationError(generationError);
        if (generationEventStarted) {
          await completeGenerationEvent(user.id, clientGenerationId, {
            status: "error",
            flowStatus: "error",
            planId: latestPlan?.id ?? null,
            errorCategory: sanitized.errorCategory,
            errorMessageSanitized: sanitized.errorMessageSanitized,
            quotaTier: usageDecision.planTier,
            quotaUsageType: "lightweight_assist",
          }).catch(() => undefined);
          generationEventCompleted = true;
        }
        console.warn("Board reconciliation failed; saving raw board update", sanitized);
      }
    }

    if (!reconciliation) {
      await createInferredContextItem(
        user.id,
        {
          label: "Unreconciled board update",
          value: input.content,
          category: inferMemoryCategoryFromText(input.content),
          sensitivity: "low",
          persistence: "proposed_memory",
          source: "intake",
          situation_id: situation.id,
          intake_session_id: session.id,
          next_move_plan_id: latestPlan?.id ?? null,
        },
        { isQa },
      );
    }

    const titleCandidate = inferBoardTitle(
      reconciledSituation.category,
      `${reconciledSituation.description} ${input.content}`,
    );
    const fallbackTitle = entryDomainFallbackTitle(reconciledSituation.category);
    if (titleCandidate !== fallbackTitle && reconciledSituation.title === fallbackTitle) {
      reconciledSituation =
        (await updateBoard(user.id, reconciledSituation.id, {
          ...reconciledSituation,
          title: titleCandidate,
        })) ?? reconciledSituation;
    }

    const messages = await listIntakeMessages(user.id, session.id);
    await updateIntakeSession(user.id, session.id, {
      current_stage: "ready_to_generate",
      is_complete: true,
      summary_so_far: [
        session.summary_so_far,
        `Board update: ${input.content}`,
        reconciliation ? `Reconciliation: ${reconciliation.summary}` : "",
      ].filter(Boolean).join("\n"),
    });

    return dataResponse({
      message,
      messages,
      status: "saved",
      reconciliation,
      reconciliation_message: reconciliationMessage,
      move_map_effect: reconciliation?.move_map_effect ?? null,
    });
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
    return errorResponse(error, "Could not update board.");
  }
}

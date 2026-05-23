import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { canUseWebSearchForTier } from "@/lib/billing/plans";
import { assertCanUseFeature, incrementUsage } from "@/lib/billing/usage";
import {
  buildCognitivePlanContext,
  compactProfileForMemorySelection,
} from "@/lib/cognitive-operating-layer";
import type { CognitiveMetadata } from "@/lib/cognitive-schemas";
import { generateNextMovePlan } from "@/lib/flowpath-ai";
import { isQaRequest } from "@/lib/qa-mode";
import {
  completeGenerationEvent,
  createOutcomeRecord,
  createNextMovePlan,
  createInferredContextItems,
  getLatestIntakeSession,
  getProfile,
  getSituation,
  isGenerationAbandoned,
  listCheckIns,
  listInferredContextItems,
  listIntakeMessages,
  listNextMovePlans,
  listTasks,
  markRunningGenerationAsRetry,
  startGenerationEvent,
  updateIntakeSession,
} from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser();
    if (!process.env.OPENAI_API_KEY) {
      throw new ApiRequestError(
        "OPENAI_API_KEY is missing. Add it to .env.local, then restart the dev server.",
        400,
        "missing_api_key",
      );
    }

    const { id: idParam } = await context.params;
    const situationId = parseId(idParam);
    const isQa = isQaRequest(request);
    const body = await readJson(request).catch(() => ({}));
    const clientGenerationId =
      typeof body?.client_generation_id === "string" && body.client_generation_id
        ? body.client_generation_id
        : `server-plan-${crypto.randomUUID()}`;
    const retryCount =
      typeof body?.retry_count === "number" && Number.isInteger(body.retry_count)
        ? body.retry_count
        : 0;
    const situation = await getSituation(user.id, situationId);
    if (!situation) throw new ApiRequestError("Situation not found.", 404, "not_found");
    const usageDecision = await assertCanUseFeature(user.id, "next_move_plan");
    await markRunningGenerationAsRetry(user.id, "operator_plan", situationId);
    await startGenerationEvent(user.id, {
      client_generation_id: clientGenerationId,
      generation_type: "operator_plan",
      situation_id: situationId,
      retry_count: retryCount,
      is_qa: isQa,
    });

    const session = await getLatestIntakeSession(user.id, situationId);
    const [profile, inferredContextItems, messages, openTasks, recentCheckIns, recentPlans] =
      await Promise.all([
        getProfile(user.id),
        listInferredContextItems(user.id, { isQa }),
        session ? listIntakeMessages(user.id, session.id) : Promise.resolve([]),
        listTasks(user.id, { isQa }).then((tasks) =>
          tasks.filter((task) => task.status === "open"),
        ),
        listCheckIns(user.id, 5),
        listNextMovePlans(user.id, 5, situationId, { isQa }),
      ]);
    const latestUserMessage = messages
      .filter((message) => message.role === "user")
      .at(-1);
    const userMessage =
      latestUserMessage?.content ||
      situation.description ||
      situation.title;
    const cognitiveContext = buildCognitivePlanContext({
      userMessage,
      situation,
      messages,
      profile,
      inferredContextItems,
      openTasks,
      recentPlans,
      allowWebSearch: canUseWebSearchForTier(usageDecision.planTier),
    });
    const compactProfile = compactProfileForMemorySelection(
      profile,
      cognitiveContext.memorySelection,
    );

    let plan;
    let model;
    let usage;
    let cognitiveMetadata: CognitiveMetadata | undefined;
    try {
      const generated = await generateNextMovePlan(
        {
          profile: compactProfile,
          situation,
          session,
          messages,
          openTasks,
          recentCheckIns,
          recentPlans,
        },
        {
          allowWebSearch: canUseWebSearchForTier(usageDecision.planTier),
          cognitiveContext,
          sourceMessageId: latestUserMessage ? String(latestUserMessage.id) : null,
        },
      );
      plan = generated.plan;
      model = generated.model;
      usage = generated.usage;
      cognitiveMetadata = generated.cognitiveMetadata;
    } catch (generationError) {
      await completeGenerationEvent(user.id, clientGenerationId, {
        status: "error",
        errorCategory: classifyGenerationError(generationError),
      });
      throw generationError;
    }
    await incrementUsage(user.id, "next_move_plan", usage);
    if (await isGenerationAbandoned(user.id, clientGenerationId)) {
      await completeGenerationEvent(user.id, clientGenerationId, {
        status: "canceled",
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        errorCategory: "client_canceled",
      });
      throw new ApiRequestError(
        "Generation was canceled. No plan, tasks, or memory were created.",
        409,
        "generation_canceled",
      );
    }

    if (session) {
      await updateIntakeSession(user.id, session.id, {
        current_stage: "ready_to_generate",
        is_complete: true,
        summary_so_far: plan.situation_summary,
      });
    }

    const storedPlan = await createNextMovePlan(
      user.id,
      situationId,
      session?.id ?? null,
      plan,
      model,
      { clientGenerationId, cognitiveMetadata, isQa },
    );
    await createInferredContextItems(user.id, plan.inferred_context_items, {
      situation_id: situationId,
      intake_session_id: session?.id ?? null,
      next_move_plan_id: storedPlan.id,
      source: "plan",
      isQa,
    });
    await createOutcomeRecord(user.id, {
      source_message_id: latestUserMessage?.id ?? null,
      conversation_id: String(situationId),
      next_move_plan_id: storedPlan.id,
      detected_state: cognitiveContext.stateDetection.primary_state,
      intervention_type: cognitiveContext.intervention.intervention_type,
      recommended_action: plan.highest_leverage_move_today.title,
      user_outcome: "unknown",
      evidence: "",
      notes: "Created after a substantive Next Move operator plan.",
      is_qa: isQa,
    });
    await completeGenerationEvent(user.id, clientGenerationId, {
      status: "success",
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      stateDetected: cognitiveContext.stateDetection.primary_state,
      interventionType: cognitiveContext.intervention.intervention_type,
      modelUsedByStage: cognitiveMetadata?.model_used_by_stage,
      promptTokensByStage: cognitiveMetadata?.prompt_tokens_by_stage,
      completionTokensByStage: cognitiveMetadata?.completion_tokens_by_stage,
      estimatedCost: cognitiveMetadata?.total_estimated_cost ?? null,
      evaluatorScore: cognitiveMetadata?.evaluator?.score ?? null,
      responseRewritten: cognitiveMetadata?.response_rewritten ?? false,
      tasksCreatedCount: plan.task_candidates.length,
      memoryItemsUsed: cognitiveContext.memorySelection.selected_memories.length,
      webSearchUsed: cognitiveMetadata?.web_search_used ?? false,
      cognitiveMetadata,
    });

    return dataResponse(storedPlan, 201);
  } catch (error) {
    return errorResponse(error, "Could not generate next move plan.");
  }
}

function classifyGenerationError(error: unknown) {
  if (error instanceof SyntaxError) return "schema_parse_error";
  if (error instanceof Error && /empty/i.test(error.message)) return "empty_response";
  if (error instanceof Error && /schema|parse|zod/i.test(error.message)) {
    return "schema_parse_error";
  }
  if (error instanceof Error && /timeout/i.test(error.message)) return "timeout";
  return "model_or_network_error";
}

import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { canUseWebSearchForTier } from "@/lib/billing/plans";
import {
  assertCanUseFeature,
  canUseFeature,
  canUseFirstSituationFlow,
  incrementUsage,
} from "@/lib/billing/usage";
import {
  buildCognitivePlanContext,
  compactProfileForMemorySelection,
} from "@/lib/cognitive-operating-layer";
import type { CognitiveMetadata } from "@/lib/cognitive-schemas";
import { generateNextMovePlan } from "@/lib/flowpath-ai";
import { sanitizeGenerationError } from "@/lib/generation-observability";
import { buildIntakeRoutingMetadata } from "@/lib/intake";
import { isQaRequest } from "@/lib/qa-mode";
import {
  completeGenerationEvent,
  createOutcomeRecord,
  createOutcomeHarnessEvent,
  createNextMovePlan,
  createInferredContextItems,
  getInterventionEffectivenessForContext,
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
  recordIgnoredSuggestedActions,
  startGenerationEvent,
  updateIntakeSession,
} from "@/lib/repository";
import {
  buildSafetyRoutedPlan,
  safetyRouteFromText,
} from "@/lib/safety-routing";
import type { WebSearchDecisionReason } from "@/lib/types";

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
    await recordIgnoredSuggestedActions(user.id, { isQa });
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
    const firstFlowPass = await canUseFirstSituationFlow(user.id, situationId, {
      isQa,
    });
    const usageDecision = await canUseFeature(user.id, "next_move_plan");
    const initialSafetyDecision = safetyRouteFromText({
      text: situation.description || situation.title,
      situation,
      urgency: situation.urgency,
    });
    await markRunningGenerationAsRetry(user.id, "operator_plan", situationId);
    await startGenerationEvent(user.id, {
      client_generation_id: clientGenerationId,
      generation_type: "operator_plan",
      situation_id: situationId,
      flow_type: "next_move_plan",
      flow_status: "running",
      quota_tier: usageDecision.planTier,
      quota_usage_type: "next_move_plan",
      safety_route_triggered: initialSafetyDecision.triggered,
      safety_route_type: initialSafetyDecision.routeType,
      web_search_decision_reason: canUseWebSearchForTier(usageDecision.planTier)
        ? "not_needed"
        : "unavailable_for_tier",
      structural_counts: {
        retry_count: retryCount,
        first_flow_pass: firstFlowPass,
      },
      retry_count: retryCount,
      is_qa: isQa,
    });
    if (!usageDecision.allowed && !firstFlowPass) {
      await completeGenerationEvent(user.id, clientGenerationId, {
        status: "error",
        flowStatus: "quota_blocked",
        quotaTier: usageDecision.planTier,
        quotaUsageType: "next_move_plan",
        safetyRouteTriggered: initialSafetyDecision.triggered,
        safetyRouteType: initialSafetyDecision.routeType,
        errorCategory: "quota_exceeded",
        errorMessageSanitized: "The user reached the Next Move plan quota.",
      });
      await assertCanUseFeature(user.id, "next_move_plan");
    }

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
    const safetyDecision = safetyRouteFromText({
      text: userMessage,
      situation,
      urgency: situation.urgency,
    });
    const intakeRouting = buildIntakeRoutingMetadata(situation);
    const baseCognitiveContext = buildCognitivePlanContext({
      userMessage,
      situation,
      messages,
      profile,
      inferredContextItems,
      openTasks,
      recentPlans,
      allowWebSearch: canUseWebSearchForTier(usageDecision.planTier),
    });
    const historicalEffectiveness = await getInterventionEffectivenessForContext(
      user.id,
      {
        domain: intakeRouting.domain || situation.category,
        subtype: intakeRouting.subtype,
        currentState: baseCognitiveContext.stateDetection.primary_state,
        isQa,
      },
    );
    const cognitiveContext = buildCognitivePlanContext({
      userMessage,
      situation,
      messages,
      profile,
      inferredContextItems,
      openTasks,
      recentPlans,
      historicalEffectiveness,
      allowWebSearch: canUseWebSearchForTier(usageDecision.planTier),
    });
    const compactProfile = compactProfileForMemorySelection(
      profile,
      cognitiveContext.memorySelection,
    );

    let plan;
    let model;
    let modelRole: string | null | undefined;
    let usage;
    let webSearchCallCount = 0;
    let webSearchDecisionReason: WebSearchDecisionReason =
      canUseWebSearchForTier(usageDecision.planTier) ? "not_needed" : "unavailable_for_tier";
    let deterministicSafetyRouted = false;
    let cognitiveMetadata: CognitiveMetadata | undefined;
    try {
      if (safetyDecision.planBehavior === "human_help_only") {
        deterministicSafetyRouted = true;
        plan = buildSafetyRoutedPlan(situation, safetyDecision);
        model = "deterministic-safety-router";
        modelRole = "safety_classifier";
        usage = {};
        webSearchDecisionReason = "blocked_by_policy";
      } else {
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
        modelRole = generated.modelRole;
        usage = generated.usage;
        webSearchCallCount = generated.webSearchCallCount;
        webSearchDecisionReason = generated.webSearchDecisionReason;
        cognitiveMetadata = generated.cognitiveMetadata;
      }
    } catch (generationError) {
      const sanitized = sanitizeGenerationError(generationError);
      await completeGenerationEvent(user.id, clientGenerationId, {
        status: "error",
        flowStatus: "error",
        errorCategory: sanitized.errorCategory,
        errorMessageSanitized: sanitized.errorMessageSanitized,
        safetyRouteTriggered: safetyDecision.triggered,
        safetyRouteType: safetyDecision.routeType,
      });
      throw generationError;
    }
    if (await isGenerationAbandoned(user.id, clientGenerationId)) {
      await completeGenerationEvent(user.id, clientGenerationId, {
        status: "canceled",
        flowStatus: "canceled",
        model,
        modelRole,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        estimatedCostUsd: usage.estimatedCostUsd,
        errorCategory: "client_canceled",
        safetyRouteTriggered: safetyDecision.triggered,
        safetyRouteType: safetyDecision.routeType,
      });
      throw new ApiRequestError(
        "Generation was canceled. No plan, tasks, or memory were created.",
        409,
        "generation_canceled",
      );
    }
    if (!deterministicSafetyRouted) {
      await incrementUsage(user.id, "next_move_plan", usage);
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
    const planEventType = recentPlans.length > 0 ? "plan_regenerated" : "plan_generated";
    await createOutcomeHarnessEvent(user.id, {
      situationId,
      conversationId: String(situationId),
      messageId: latestUserMessage?.id ?? null,
      planId: storedPlan.id,
      eventType: planEventType,
      source: "next_move_plan",
      stateDetected: cognitiveContext.stateDetection.primary_state,
      interventionType: cognitiveContext.intervention.intervention_type,
      domain: intakeRouting.domain,
      subtype: intakeRouting.subtype,
      questionPurpose: intakeRouting.questionPurpose,
      modelUsed: model,
      metadata: {
        taskCandidateCount: plan.task_candidates.length,
        outcomeHarnessContextIncluded: historicalEffectiveness.hasMeaningfulSignal,
        historicalEffectivenessInfluencedIntervention:
          Boolean(historicalEffectiveness.advisoryText),
      },
      dedupeKey: `${planEventType}:${storedPlan.id}`,
      isQa,
    });
    await createOutcomeHarnessEvent(user.id, {
      situationId,
      conversationId: String(situationId),
      messageId: latestUserMessage?.id ?? null,
      planId: storedPlan.id,
      eventType: "suggested_action_shown",
      source: "suggested_action",
      stateDetected: cognitiveContext.stateDetection.primary_state,
      interventionType: cognitiveContext.intervention.intervention_type,
      domain: intakeRouting.domain,
      subtype: intakeRouting.subtype,
      questionPurpose: intakeRouting.questionPurpose,
      modelUsed: model,
      metadata: {
        title:
          plan.task_candidates[0]?.title ||
          plan.first_10_minute_action.title ||
          plan.highest_leverage_move_today.title,
        estimatedMinutes:
          plan.task_candidates[0]?.estimated_minutes ??
          plan.highest_leverage_move_today.estimated_minutes,
      },
      dedupeKey: `suggested-action-shown:${storedPlan.id}`,
      isQa,
    });
    if (!session?.is_complete && session?.current_stage !== "ready_to_generate") {
      await createOutcomeHarnessEvent(user.id, {
        situationId,
        conversationId: String(situationId),
        planId: storedPlan.id,
        eventType: "intake_skipped_generate_now",
        source: "first_intake",
        stateDetected: cognitiveContext.stateDetection.primary_state,
        interventionType: cognitiveContext.intervention.intervention_type,
        domain: intakeRouting.domain,
        subtype: intakeRouting.subtype,
        questionPurpose: intakeRouting.questionPurpose,
        metadata: { currentStage: session?.current_stage ?? null },
        dedupeKey: `intake-skipped-generate-now:${situationId}:${storedPlan.id}`,
        isQa,
      });
    }
    if (cognitiveContext.repeatedLoopDetected) {
      await createOutcomeHarnessEvent(user.id, {
        situationId,
        conversationId: String(situationId),
        messageId: latestUserMessage?.id ?? null,
        planId: storedPlan.id,
        eventType: "user_repeated_same_loop",
        source: "system_inference",
        stateDetected: cognitiveContext.stateDetection.primary_state,
        interventionType: cognitiveContext.intervention.intervention_type,
        domain: intakeRouting.domain,
        subtype: intakeRouting.subtype,
        questionPurpose: intakeRouting.questionPurpose,
        metadata: {
          repeatedTopic: cognitiveContext.repeatedTopic,
          repeatedLoopCount: historicalEffectiveness.repeatedLoopCount,
        },
        dedupeKey: `repeated-loop:${situationId}:${storedPlan.id}`,
        isQa,
      });
    }
    if (cognitiveMetadata?.response_rewritten) {
      await createOutcomeHarnessEvent(user.id, {
        situationId,
        conversationId: String(situationId),
        planId: storedPlan.id,
        eventType: "evaluator_rewrite_triggered",
        source: "system_inference",
        stateDetected: cognitiveContext.stateDetection.primary_state,
        interventionType: cognitiveContext.intervention.intervention_type,
        domain: intakeRouting.domain,
        subtype: intakeRouting.subtype,
        metadata: { evaluatorScore: cognitiveMetadata.evaluator?.score ?? null },
        dedupeKey: `evaluator-rewrite:${storedPlan.id}`,
        isQa,
      });
    }
    if (cognitiveMetadata?.web_search_used) {
      await createOutcomeHarnessEvent(user.id, {
        situationId,
        conversationId: String(situationId),
        planId: storedPlan.id,
        eventType: "web_search_used",
        source: "system_inference",
        stateDetected: cognitiveContext.stateDetection.primary_state,
        interventionType: cognitiveContext.intervention.intervention_type,
        domain: intakeRouting.domain,
        subtype: intakeRouting.subtype,
        metadata: { reason: cognitiveMetadata.web_search_reason },
        dedupeKey: `web-search-used:${storedPlan.id}`,
        isQa,
      });
    }
    if (cognitiveContext.memorySelection.selected_memories.length > 0) {
      await createOutcomeHarnessEvent(user.id, {
        situationId,
        conversationId: String(situationId),
        planId: storedPlan.id,
        eventType: "memory_used",
        source: "system_inference",
        stateDetected: cognitiveContext.stateDetection.primary_state,
        interventionType: cognitiveContext.intervention.intervention_type,
        domain: intakeRouting.domain,
        subtype: intakeRouting.subtype,
        metadata: {
          memoryItemsUsed: cognitiveContext.memorySelection.selected_memories.length,
        },
        dedupeKey: `memory-used:${storedPlan.id}`,
        isQa,
      });
    }
    if (cognitiveContext.useEscalationModel) {
      await createOutcomeHarnessEvent(user.id, {
        situationId,
        conversationId: String(situationId),
        planId: storedPlan.id,
        eventType: "escalation_triggered",
        source: "system_inference",
        stateDetected: cognitiveContext.stateDetection.primary_state,
        interventionType: cognitiveContext.intervention.intervention_type,
        domain: intakeRouting.domain,
        subtype: intakeRouting.subtype,
        metadata: { model },
        dedupeKey: `escalation-triggered:${storedPlan.id}`,
        isQa,
      });
    }
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
      flowStatus: deterministicSafetyRouted ? "safety_routed" : "success",
      planId: storedPlan.id,
      model,
      modelRole,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
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
      webSearchCallCount,
      webSearchDecisionReason,
      usedEvaluator: Boolean(cognitiveMetadata?.evaluator),
      evaluatorTriggeredRevision: cognitiveMetadata?.response_rewritten ?? false,
      safetyRouteTriggered: safetyDecision.triggered,
      safetyRouteType: safetyDecision.routeType,
      quotaTier: usageDecision.planTier,
      quotaUsageType: "next_move_plan",
      structuralCounts: {
        message_count: messages.length,
        open_task_count: openTasks.length,
        recent_plan_count: recentPlans.length,
        task_candidate_count: plan.task_candidates.length,
        inferred_context_items_count: plan.inferred_context_items.length,
        context_used_count: plan.context_used.length,
        deterministic_safety_routed: deterministicSafetyRouted,
      },
      outcomeHarnessContextIncluded: historicalEffectiveness.hasMeaningfulSignal,
      historicalEffectivenessInfluencedIntervention:
        Boolean(historicalEffectiveness.advisoryText),
      cognitiveMetadata,
    });

    return dataResponse(storedPlan, 201);
  } catch (error) {
    return errorResponse(error, "Could not generate next move plan.");
  }
}

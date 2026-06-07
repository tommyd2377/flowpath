import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  assertCanUseFeature,
  canUseFirstSituationFlow,
  incrementUsage,
} from "@/lib/billing/usage";
import {
  buildCognitiveMetadata,
  buildCognitivePlanContext,
  compactProfileForMemorySelection,
  inferOutcomeFromUserMessage,
} from "@/lib/cognitive-operating-layer";
import { generateInterviewQuestion } from "@/lib/flowpath-ai";
import { buildIntakeRoutingMetadata } from "@/lib/intake";
import { isQaRequest } from "@/lib/qa-mode";
import {
  addIntakeMessage,
  cancelGenerationEvent,
  completeGenerationEvent,
  createOutcomeHarnessEvent,
  createInferredContextItems,
  getInterventionEffectivenessForContext,
  getOrCreateIntakeSession,
  getProfile,
  getSituation,
  isGenerationAbandoned,
  listInferredContextItems,
  listIntakeMessages,
  listRecentUnresolvedOutcomeRecords,
  markRunningGenerationAsRetry,
  startGenerationEvent,
  updateOutcomeRecord,
  updateIntakeSession,
  updateSituation,
} from "@/lib/repository";
import { intakeAnswerInputSchema } from "@/lib/schemas";
import { logGenerationTiming } from "@/lib/server-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const routeStartedAt = Date.now();
  let telemetryUserId: number | null = null;
  let telemetrySituationId: number | null = null;
  let telemetryClientGenerationId: string | null = null;
  let telemetryIsGuest = false;
  let telemetryIsQa = false;
  let telemetryRetryCount = 0;
  try {
    const user = await requireUser();
    telemetryUserId = user.id;
    telemetryIsGuest = user.isGuest;
    if (!process.env.OPENAI_API_KEY) {
      throw new ApiRequestError(
        "OPENAI_API_KEY is missing. Add it to .env.local, then restart the dev server.",
        400,
        "missing_api_key",
      );
    }

    const { id: idParam } = await context.params;
    const situationId = parseId(idParam);
    telemetrySituationId = situationId;
    const input = intakeAnswerInputSchema.parse(await readJson(request));
    const isQa = isQaRequest(request);
    telemetryIsQa = isQa;
    telemetryRetryCount = input.retry_count;
    const clientGenerationId =
      input.client_generation_id || `server-intake-${crypto.randomUUID()}`;
    telemetryClientGenerationId = clientGenerationId;
    logGenerationTiming({
      route: "situations.messages",
      generationType: "intake",
      phase: "start",
      userId: user.id,
      situationId,
      clientGenerationId,
      isGuest: user.isGuest,
      isQa,
      retryCount: input.retry_count,
      elapsedMs: Date.now() - routeStartedAt,
      usageType: "lightweight_assist",
    });
    const situation = await getSituation(user.id, situationId);
    if (!situation) throw new ApiRequestError("Situation not found.", 404, "not_found");
    const firstSituationFlowPass = await canUseFirstSituationFlow(user.id, situationId, {
      isQa,
    });
    if (!firstSituationFlowPass) {
      await assertCanUseFeature(user.id, "lightweight_assist");
    }

    const session = await getOrCreateIntakeSession(user.id, situationId);
    await markRunningGenerationAsRetry(user.id, "intake", situationId);
    await startGenerationEvent(user.id, {
      client_generation_id: clientGenerationId,
      generation_type: "intake",
      situation_id: situationId,
      retry_count: input.retry_count,
      is_qa: isQa,
    });
    await addIntakeMessage(user.id, session.id, "user", input.content, {
      clientMessageId: input.client_message_id,
      isQa,
    });
    const outcomeInference = inferOutcomeFromUserMessage(input.content);
    if (outcomeInference) {
      const unresolved = await listRecentUnresolvedOutcomeRecords(user.id, {
        isQa,
        limit: 1,
      });
      if (unresolved[0]) {
        await updateOutcomeRecord(user.id, unresolved[0].id, outcomeInference);
      }
    }
    const messagesAfterUser = await listIntakeMessages(user.id, session.id);
    const contextStartedAt = Date.now();
    const [profile, inferredContextItems] = await Promise.all([
      getProfile(user.id),
      listInferredContextItems(user.id, { isQa }),
    ]);
    const intakeRouting = buildIntakeRoutingMetadata(situation);
    const baseCognitiveContext = buildCognitivePlanContext({
      userMessage: input.content,
      situation,
      messages: messagesAfterUser,
      profile,
      inferredContextItems,
      allowWebSearch: false,
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
      userMessage: input.content,
      situation,
      messages: messagesAfterUser,
      profile,
      inferredContextItems,
      historicalEffectiveness,
      allowWebSearch: false,
    });
    logGenerationTiming({
      route: "situations.messages",
      generationType: "intake",
      phase: "context_loaded",
      userId: user.id,
      situationId,
      clientGenerationId,
      isGuest: user.isGuest,
      isQa,
      retryCount: input.retry_count,
      elapsedMs: Date.now() - routeStartedAt,
      phaseMs: Date.now() - contextStartedAt,
      messageCount: messagesAfterUser.length,
      userMessageCount: messagesAfterUser.filter((message) => message.role === "user")
        .length,
      assistantMessageCount: messagesAfterUser.filter(
        (message) => message.role === "assistant",
      ).length,
      inferredContextCount: inferredContextItems.length,
    });
    await createOutcomeHarnessEvent(user.id, {
      situationId,
      conversationId: String(situationId),
      messageId: messagesAfterUser.filter((message) => message.role === "user").at(-1)?.id ?? null,
      eventType: "intake_question_answered",
      source: "followup_intake",
      stateDetected: cognitiveContext.stateDetection.primary_state,
      interventionType: cognitiveContext.intervention.intervention_type,
      domain: intakeRouting.domain,
      subtype: intakeRouting.subtype,
      questionPurpose: intakeRouting.questionPurpose,
      metadata: {
        currentStage: session.current_stage,
        answerLength: input.content.length,
      },
      dedupeKey: `intake-question-answered:${input.client_message_id}`,
      isQa,
    });
    if (cognitiveContext.repeatedLoopDetected) {
      await createOutcomeHarnessEvent(user.id, {
        situationId,
        conversationId: String(situationId),
        messageId:
          messagesAfterUser.filter((message) => message.role === "user").at(-1)?.id ??
          null,
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
        dedupeKey: `repeated-loop:intake:${input.client_message_id}`,
        isQa,
      });
    }
    const compactProfile = compactProfileForMemorySelection(
      profile,
      cognitiveContext.memorySelection,
    );
    let output;
    let usage;
    let model: string | undefined;
    const modelStartedAt = Date.now();
    try {
      const generated = await generateInterviewQuestion({
        profile: compactProfile,
        situation,
        session,
        messages: messagesAfterUser,
      }, {
        cognitiveContext,
      });
      output = generated.output;
      usage = generated.usage;
      model = generated.model;
      logGenerationTiming({
        route: "situations.messages",
        generationType: "intake",
        phase: "model_complete",
        userId: user.id,
        situationId,
        clientGenerationId,
        isGuest: user.isGuest,
        isQa,
        retryCount: input.retry_count,
        elapsedMs: Date.now() - routeStartedAt,
        phaseMs: Date.now() - modelStartedAt,
        model,
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        messageCount: messagesAfterUser.length,
      });
    } catch (generationError) {
      logGenerationTiming({
        route: "situations.messages",
        generationType: "intake",
        phase: "error",
        userId: user.id,
        situationId,
        clientGenerationId,
        isGuest: user.isGuest,
        isQa,
        retryCount: input.retry_count,
        elapsedMs: Date.now() - routeStartedAt,
        phaseMs: Date.now() - modelStartedAt,
        errorCategory: classifyGenerationError(generationError),
        errorName:
          generationError instanceof Error ? generationError.name : typeof generationError,
      });
      await completeGenerationEvent(user.id, clientGenerationId, {
        status: "error",
        errorCategory: classifyGenerationError(generationError),
      });
      throw generationError;
    }
    if (!firstSituationFlowPass) {
      await incrementUsage(user.id, "lightweight_assist", usage);
    }
    if (await isGenerationAbandoned(user.id, clientGenerationId)) {
      await cancelGenerationEvent(user.id, clientGenerationId);
      throw new ApiRequestError("Generation was canceled. No new intake result was saved.", 409, "generation_canceled");
    }

    const persistStartedAt = Date.now();
    const updatedSession = await updateIntakeSession(user.id, session.id, output);
    const assistantMessage = await addIntakeMessage(
      user.id,
      session.id,
      "assistant",
      output.question,
      { isQa },
    );
    await createInferredContextItems(user.id, output.inferred_context_items, {
      situation_id: situation.id,
      intake_session_id: session.id,
      source: "intake",
      isQa,
    });

    if (output.recommended_urgency && output.recommended_urgency !== situation.urgency) {
      await updateSituation(user.id, situation.id, {
        title: situation.title,
        description: situation.description,
        category: situation.category,
        status: situation.status,
        urgency: output.recommended_urgency,
      });
    }
    logGenerationTiming({
      route: "situations.messages",
      generationType: "intake",
      phase: "persisted",
      userId: user.id,
      situationId,
      clientGenerationId,
      isGuest: user.isGuest,
      isQa,
      retryCount: input.retry_count,
      elapsedMs: Date.now() - routeStartedAt,
      phaseMs: Date.now() - persistStartedAt,
      model,
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      inferredContextCount: output.inferred_context_items.length,
    });
    await completeGenerationEvent(user.id, clientGenerationId, {
      status: "success",
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      stateDetected: cognitiveContext.stateDetection.primary_state,
      interventionType: cognitiveContext.intervention.intervention_type,
      modelUsedByStage: { interviewer: model ?? "unknown" },
      promptTokensByStage: { interviewer: usage.inputTokens ?? 0 },
      completionTokensByStage: { interviewer: usage.outputTokens ?? 0 },
      evaluatorScore: null,
      responseRewritten: false,
      tasksCreatedCount: 0,
      memoryItemsUsed: cognitiveContext.memorySelection.selected_memories.length,
      webSearchUsed: false,
      cognitiveMetadata: buildCognitiveMetadata({
        context: cognitiveContext,
        evaluator: null,
        responseRewritten: false,
        modelUsedByStage: { interviewer: model ?? "unknown" },
        promptTokensByStage: { interviewer: usage.inputTokens ?? 0 },
        completionTokensByStage: { interviewer: usage.outputTokens ?? 0 },
        totalEstimatedCost: null,
        webSearchUsed: false,
      }),
    });
    logGenerationTiming({
      route: "situations.messages",
      generationType: "intake",
      phase: "complete",
      userId: user.id,
      situationId,
      clientGenerationId,
      isGuest: user.isGuest,
      isQa,
      retryCount: input.retry_count,
      elapsedMs: Date.now() - routeStartedAt,
      model,
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
    });

    return dataResponse({
      session: updatedSession,
      message: assistantMessage,
      messages: await listIntakeMessages(user.id, session.id),
    });
  } catch (error) {
    if (telemetryUserId) {
      logGenerationTiming({
        route: "situations.messages",
        generationType: "intake",
        phase: "error",
        userId: telemetryUserId,
        situationId: telemetrySituationId,
        clientGenerationId: telemetryClientGenerationId,
        isGuest: telemetryIsGuest,
        isQa: telemetryIsQa,
        retryCount: telemetryRetryCount,
        elapsedMs: Date.now() - routeStartedAt,
        errorCategory: classifyGenerationError(error),
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
    return errorResponse(error, "Could not continue intake.");
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

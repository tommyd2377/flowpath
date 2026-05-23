import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { assertCanUseFeature, incrementUsage } from "@/lib/billing/usage";
import {
  buildCognitiveMetadata,
  buildCognitivePlanContext,
  compactProfileForMemorySelection,
  inferOutcomeFromUserMessage,
} from "@/lib/cognitive-operating-layer";
import { generateInterviewQuestion } from "@/lib/flowpath-ai";
import { isQaRequest } from "@/lib/qa-mode";
import {
  addIntakeMessage,
  cancelGenerationEvent,
  completeGenerationEvent,
  createInferredContextItems,
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
    const input = intakeAnswerInputSchema.parse(await readJson(request));
    const isQa = isQaRequest(request);
    const clientGenerationId =
      input.client_generation_id || `server-intake-${crypto.randomUUID()}`;
    const situation = await getSituation(user.id, situationId);
    if (!situation) throw new ApiRequestError("Situation not found.", 404, "not_found");
    await assertCanUseFeature(user.id, "lightweight_assist");

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
    const [profile, inferredContextItems] = await Promise.all([
      getProfile(user.id),
      listInferredContextItems(user.id, { isQa }),
    ]);
    const cognitiveContext = buildCognitivePlanContext({
      userMessage: input.content,
      situation,
      messages: messagesAfterUser,
      profile,
      inferredContextItems,
      allowWebSearch: false,
    });
    const compactProfile = compactProfileForMemorySelection(
      profile,
      cognitiveContext.memorySelection,
    );
    let output;
    let usage;
    let model: string | undefined;
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
    } catch (generationError) {
      await completeGenerationEvent(user.id, clientGenerationId, {
        status: "error",
        errorCategory: classifyGenerationError(generationError),
      });
      throw generationError;
    }
    await incrementUsage(user.id, "lightweight_assist", usage);
    if (await isGenerationAbandoned(user.id, clientGenerationId)) {
      await cancelGenerationEvent(user.id, clientGenerationId);
      throw new ApiRequestError("Generation was canceled. No new intake result was saved.", 409, "generation_canceled");
    }

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

    return dataResponse({
      session: updatedSession,
      message: assistantMessage,
      messages: await listIntakeMessages(user.id, session.id),
    });
  } catch (error) {
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

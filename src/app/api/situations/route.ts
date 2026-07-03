import { ApiRequestError, dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  assertCanUseFeature,
  canUseFeature,
  canUseFirstSituationFlow,
  incrementUsage,
} from "@/lib/billing/usage";
import { generateFirstIntakePlan } from "@/lib/flowpath-ai";
import { sanitizeGenerationError } from "@/lib/generation-observability";
import { buildIntakeRoutingMetadata } from "@/lib/intake";
import { isQaRequest } from "@/lib/qa-mode";
import {
  addIntakeMessage,
  completeGenerationEvent,
  createOutcomeHarnessEvent,
  createSituation,
  deleteSituation,
  getLatestIntakeSession,
  getOrCreateIntakeSession,
  listIntakeMessages,
  listSituations,
  startGenerationEvent,
} from "@/lib/repository";
import { situationInputSchema } from "@/lib/schemas";
import type { FirstIntakePlan } from "@/lib/situation-routing";
import type { Situation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function firstIntakePlanForNewSituation(
  userId: number,
  situation: Situation,
): Promise<{ plan: FirstIntakePlan; source: "ai"; model?: string }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ApiRequestError(
      "OPENAI_API_KEY is missing. Add it to .env.local, then restart the dev server.",
      400,
      "missing_api_key",
    );
  }

  const firstFlowPass = await canUseFirstSituationFlow(userId, situation.id, {
    isQa: Boolean(situation.is_qa),
  });
  const usageDecision = await canUseFeature(userId, "lightweight_assist");
  const clientGenerationId = `server-first-intake-${crypto.randomUUID()}`;
  await startGenerationEvent(userId, {
    client_generation_id: clientGenerationId,
    generation_type: "intake",
    situation_id: situation.id,
    flow_type: "first_intake_question",
    flow_status: "running",
    quota_tier: usageDecision.planTier,
    quota_usage_type: "lightweight_assist",
    structural_counts: {
      situation_title_chars: situation.title.length,
      situation_description_chars: situation.description.length,
      first_flow_pass: firstFlowPass,
    },
    is_qa: Boolean(situation.is_qa),
  });
  if (!firstFlowPass) {
    if (!usageDecision.allowed) {
      await completeGenerationEvent(userId, clientGenerationId, {
        status: "error",
        flowStatus: "quota_blocked",
        quotaTier: usageDecision.planTier,
        quotaUsageType: "lightweight_assist",
        errorCategory: "quota_exceeded",
        errorMessageSanitized: "The user reached the lightweight assist quota.",
      });
      await assertCanUseFeature(userId, "lightweight_assist");
    }
  }

  let generated;
  try {
    generated = await generateFirstIntakePlan(situation);
  } catch (error) {
    const sanitized = sanitizeGenerationError(error);
    await completeGenerationEvent(userId, clientGenerationId, {
      status: "error",
      flowStatus: "error",
      errorCategory: sanitized.errorCategory,
      errorMessageSanitized: sanitized.errorMessageSanitized,
    });
    throw error;
  }
  if (!firstFlowPass && generated.usage) {
    await incrementUsage(userId, "lightweight_assist", generated.usage);
  }
  await completeGenerationEvent(userId, clientGenerationId, {
    status: "success",
    flowStatus: "success",
    model: generated.model,
    modelRole: generated.modelRole,
    inputTokens: generated.usage?.inputTokens,
    cachedInputTokens: generated.usage?.cachedInputTokens,
    outputTokens: generated.usage?.outputTokens,
    totalTokens: generated.usage?.totalTokens,
    estimatedCostUsd: generated.usage?.estimatedCostUsd,
    quotaTier: usageDecision.planTier,
    quotaUsageType: "lightweight_assist",
    structuralCounts: {
      question_chars: generated.plan.question.length,
      first_flow_pass: firstFlowPass,
      genericity_risk_medium: generated.plan.genericityRisk === "medium",
    },
  });

  return {
    plan: generated.plan,
    source: "ai",
    model: generated.model,
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    return dataResponse(await listSituations(user.id, status, { isQa: isQaRequest(request) }));
  } catch (error) {
    return errorResponse(error, "Could not load boards.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const isQa = isQaRequest(request);
    const input = situationInputSchema.parse(await readJson(request));
    const activeSituations = await listSituations(user.id, "active", { isQa });
    const situation = await createSituation(user.id, input, { isQa });
    const { session, firstIntakeGeneration, messages } = await (async () => {
      try {
        const session = await getOrCreateIntakeSession(user.id, situation.id);
        const firstIntakeGeneration = await firstIntakePlanForNewSituation(
          user.id,
          situation,
        );
        const messages = await addIntakeMessage(
          user.id,
          session.id,
          "assistant",
          firstIntakeGeneration.plan.question,
          { isQa },
        );
        return { session, firstIntakeGeneration, messages };
      } catch (firstIntakeError) {
        await deleteSituation(user.id, situation.id).catch(() => {});
        throw firstIntakeError;
      }
    })();
    const firstIntakePlanner = firstIntakeGeneration.plan;
    for (const active of activeSituations.slice(0, 8)) {
      const activeSession = await getLatestIntakeSession(user.id, active.id);
      if (!activeSession) continue;
      const activeMessages = await listIntakeMessages(user.id, activeSession.id);
      const hasUserAnswer = activeMessages.some((message) => message.role === "user");
      if (hasUserAnswer || activeMessages.length === 0) continue;
      const activePlanner = buildIntakeRoutingMetadata(active);
      await createOutcomeHarnessEvent(user.id, {
        situationId: active.id,
        conversationId: String(active.id),
        eventType: "created_new_situation_before_answering",
        source: "first_intake",
        domain: activePlanner.domain,
        subtype: activePlanner.subtype,
        questionPurpose: activePlanner.questionPurpose,
        metadata: { replacementSituationId: situation.id },
        dedupeKey: `new-situation-before-answering:${active.id}:${situation.id}`,
        isQa,
      });
      await createOutcomeHarnessEvent(user.id, {
        situationId: active.id,
        conversationId: String(active.id),
        eventType: "first_intake_abandoned",
        source: "first_intake",
        domain: activePlanner.domain,
        subtype: activePlanner.subtype,
        questionPurpose: activePlanner.questionPurpose,
        metadata: { reason: "new_situation_started" },
        dedupeKey: `first-intake-abandoned:${active.id}`,
        isQa,
      });
    }
    await createOutcomeHarnessEvent(user.id, {
      situationId: situation.id,
      conversationId: String(situation.id),
      messageId: messages.id,
      eventType: "first_intake_question_shown",
      source: "first_intake",
      domain: firstIntakePlanner.domain,
      subtype: firstIntakePlanner.subtype,
      questionPurpose: firstIntakePlanner.questionPurpose,
      metadata: {
        genericityRisk: firstIntakePlanner.genericityRisk,
        missingInfoTarget: firstIntakePlanner.missingInfoTarget,
        generationSource: firstIntakeGeneration.source,
        model: firstIntakeGeneration.model ?? null,
      },
      dedupeKey: `first-intake-question-shown:${situation.id}`,
      isQa,
    });
    return dataResponse(
      { situation, session, messages: [messages], firstIntakePlanner },
      201,
    );
  } catch (error) {
    return errorResponse(error, "Could not create board.");
  }
}

import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  canUseFeature,
  canUseFirstSituationFlow,
  incrementUsage,
} from "@/lib/billing/usage";
import { generateFirstIntakePlanOrFallback } from "@/lib/flowpath-ai";
import { buildFirstIntakePlan } from "@/lib/intake";
import { isQaRequest } from "@/lib/qa-mode";
import {
  addIntakeMessage,
  createOutcomeHarnessEvent,
  createSituation,
  getLatestIntakeSession,
  getOrCreateIntakeSession,
  listIntakeMessages,
  listSituations,
} from "@/lib/repository";
import { situationInputSchema } from "@/lib/schemas";
import type { FirstIntakePlan } from "@/lib/situation-routing";
import type { Situation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function firstIntakePlanForNewSituation(
  userId: number,
  situation: Situation,
): Promise<{ plan: FirstIntakePlan; source: "ai" | "fallback"; model?: string }> {
  const fallbackPlan = buildFirstIntakePlan(situation);
  if (!process.env.OPENAI_API_KEY) {
    return { plan: fallbackPlan, source: "fallback" };
  }

  const firstFlowPass = await canUseFirstSituationFlow(userId, situation.id, {
    isQa: Boolean(situation.is_qa),
  });
  if (!firstFlowPass) {
    const usageDecision = await canUseFeature(userId, "lightweight_assist");
    if (!usageDecision.allowed) return { plan: fallbackPlan, source: "fallback" };
  }

  const generated = await generateFirstIntakePlanOrFallback(situation, fallbackPlan);
  if (!firstFlowPass && generated.source === "ai" && generated.usage) {
    await incrementUsage(userId, "lightweight_assist", generated.usage);
  }

  return {
    plan: generated.plan,
    source: generated.source,
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
    return errorResponse(error, "Could not load situations.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const isQa = isQaRequest(request);
    const input = situationInputSchema.parse(await readJson(request));
    const activeSituations = await listSituations(user.id, "active", { isQa });
    const situation = await createSituation(user.id, input, { isQa });
    const session = await getOrCreateIntakeSession(user.id, situation.id);
    const firstIntakeGeneration = await firstIntakePlanForNewSituation(
      user.id,
      situation,
    );
    const firstIntakePlanner = firstIntakeGeneration.plan;
    const messages = await addIntakeMessage(
      user.id,
      session.id,
      "assistant",
      firstIntakePlanner.question,
      { isQa },
    );
    for (const active of activeSituations.slice(0, 8)) {
      const activeSession = await getLatestIntakeSession(user.id, active.id);
      if (!activeSession) continue;
      const activeMessages = await listIntakeMessages(user.id, activeSession.id);
      const hasUserAnswer = activeMessages.some((message) => message.role === "user");
      if (hasUserAnswer || activeMessages.length === 0) continue;
      const activePlanner = buildFirstIntakePlan(active);
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
    return errorResponse(error, "Could not create situation.");
  }
}

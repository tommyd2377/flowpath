import { z } from "zod";

import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { OUTCOME_VALUES } from "@/lib/cognitive-schemas";
import { eventTypeForOutcomeValue } from "@/lib/outcome-harness";
import {
  createOutcomeHarnessEvent,
  getNextMovePlan,
  updateOutcomeForNextMovePlan,
} from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const outcomeUpdateSchema = z.object({
  user_outcome: z.enum(OUTCOME_VALUES),
  evidence: z.string().trim().max(700).optional().default(""),
  notes: z.string().trim().max(1200).optional().default("Manual plan feedback."),
});

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const planId = parseId(idParam);
    const input = outcomeUpdateSchema.parse(await readJson(request));
    const updated = await updateOutcomeForNextMovePlan(
      user.id,
      planId,
      input,
    );
    if (!updated) {
      throw new ApiRequestError("Outcome record not found for this plan.", 404, "not_found");
    }
    const plan = await getNextMovePlan(user.id, planId);
    if (
      plan &&
      ["improved", "acted", "rejected", "deferred", "needs_followup"].includes(
        input.user_outcome,
      )
    ) {
      await createOutcomeHarnessEvent(user.id, {
        situationId: plan.situation_id,
        conversationId: String(plan.situation_id),
        planId,
        eventType: eventTypeForOutcomeValue(
          input.user_outcome as
            | "improved"
            | "acted"
            | "rejected"
            | "deferred"
            | "needs_followup",
        ),
        source: "manual_user_feedback",
        stateDetected: plan.cognitive_metadata?.state_detection.primary_state ?? null,
        interventionType:
          plan.cognitive_metadata?.intervention.intervention_type ?? null,
        domain: null,
        subtype: null,
        modelUsed: plan.model,
        metadata: {
          evidence: input.evidence,
          notes: input.notes,
          title: plan.highest_leverage_move_today.title,
          estimatedMinutes: plan.highest_leverage_move_today.estimated_minutes,
        },
        isQa: Boolean(plan.is_qa),
      });
    }
    return dataResponse(updated);
  } catch (error) {
    return errorResponse(error, "Could not update outcome.");
  }
}

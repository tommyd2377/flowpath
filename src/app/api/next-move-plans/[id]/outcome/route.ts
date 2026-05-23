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
import { updateOutcomeForNextMovePlan } from "@/lib/repository";

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
    const input = outcomeUpdateSchema.parse(await readJson(request));
    const updated = await updateOutcomeForNextMovePlan(
      user.id,
      parseId(idParam),
      input,
    );
    if (!updated) {
      throw new ApiRequestError("Outcome record not found for this plan.", 404, "not_found");
    }
    return dataResponse(updated);
  } catch (error) {
    return errorResponse(error, "Could not update outcome.");
  }
}

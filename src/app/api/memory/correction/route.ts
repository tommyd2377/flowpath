import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { inferMemoryCategoryFromText } from "@/lib/entry-domains";
import { isQaRequest } from "@/lib/qa-mode";
import { createInferredContextItem } from "@/lib/repository";
import { memoryCorrectionInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = memoryCorrectionInputSchema.parse(await readJson(request));
    const item = await createInferredContextItem(
      user.id,
      {
        label: "Memory correction",
        value: input.content,
        category: inferMemoryCategoryFromText(input.content),
        sensitivity: "low",
        persistence: "saved_memory",
        source: "manual",
        situation_id: null,
        intake_session_id: null,
        next_move_plan_id: null,
      },
      { allowSavedMemory: true, isQa: isQaRequest(request) },
    );
    return dataResponse(item, 201);
  } catch (error) {
    return errorResponse(error, "Could not update memory.");
  }
}

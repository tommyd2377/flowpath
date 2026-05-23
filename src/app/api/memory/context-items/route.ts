import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { isQaRequest } from "@/lib/qa-mode";
import {
  createInferredContextItem,
  listInferredContextItems,
} from "@/lib/repository";
import { inferredContextItemInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    return dataResponse(
      await listInferredContextItems(user.id, { isQa: isQaRequest(request) }),
    );
  } catch (error) {
    return errorResponse(error, "Could not load memory cards.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = inferredContextItemInputSchema.parse(await readJson(request));
    return dataResponse(
      await createInferredContextItem(user.id, input, {
        allowSavedMemory: input.source === "manual",
        isQa: isQaRequest(request),
      }),
      201,
    );
  } catch (error) {
    return errorResponse(error, "Could not create memory card.");
  }
}

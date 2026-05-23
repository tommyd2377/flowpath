import {
  dataResponse,
  errorResponse,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { cancelGenerationEvent } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ clientGenerationId: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { clientGenerationId } = await context.params;
    await cancelGenerationEvent(user.id, clientGenerationId);
    return dataResponse({ canceled: true });
  } catch (error) {
    return errorResponse(error, "Could not cancel generation.");
  }
}

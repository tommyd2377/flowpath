import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import {
  addIntakeMessage,
  createSituation,
  getOrCreateIntakeSession,
  listSituations,
} from "@/lib/repository";
import { situationInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    return dataResponse(await listSituations(status));
  } catch (error) {
    return errorResponse(error, "Could not load situations.");
  }
}

export async function POST(request: Request) {
  try {
    const input = situationInputSchema.parse(await readJson(request));
    const situation = await createSituation(input);
    const session = await getOrCreateIntakeSession(situation.id);
    const messages = await addIntakeMessage(
      session.id,
      "assistant",
      "What do you most want to change about this situation, and what would feel meaningfully different if FlowPath helped you make progress?",
    );
    return dataResponse({ situation, session, messages: [messages] }, 201);
  } catch (error) {
    return errorResponse(error, "Could not create situation.");
  }
}

import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { buildFirstIntakeQuestion } from "@/lib/intake";
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
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    return dataResponse(await listSituations(user.id, status));
  } catch (error) {
    return errorResponse(error, "Could not load situations.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = situationInputSchema.parse(await readJson(request));
    const situation = await createSituation(user.id, input);
    const session = await getOrCreateIntakeSession(user.id, situation.id);
    const messages = await addIntakeMessage(
      user.id,
      session.id,
      "assistant",
      buildFirstIntakeQuestion(situation),
    );
    return dataResponse({ situation, session, messages: [messages] }, 201);
  } catch (error) {
    return errorResponse(error, "Could not create situation.");
  }
}

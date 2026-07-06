import {
  ApiRequestError,
  dataResponse,
  emptyResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  deleteBoard,
  getBoard,
  getBoardDetail,
  updateBoard,
} from "@/lib/boards";
import { buildIntakeRoutingMetadata } from "@/lib/intake";
import { isQaRequest } from "@/lib/qa-mode";
import {
  createOutcomeHarnessEvent,
  getLatestIntakeSession,
  listIntakeMessages,
  recordIgnoredSuggestedActions,
} from "@/lib/repository";
import { situationUpdateSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function boardDetail(userId: number, id: number, isQa = false) {
  const detail = await getBoardDetail(userId, id, { isQa });
  if (!detail) throw new ApiRequestError("Board not found.", 404, "not_found");
  return detail;
}

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    await recordIgnoredSuggestedActions(user.id, { isQa: isQaRequest(request) });
    return dataResponse(
      await boardDetail(user.id, parseId(idParam), isQaRequest(request)),
    );
  } catch (error) {
    return errorResponse(error, "Could not load board.");
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const id = parseId(idParam);
    const input = situationUpdateSchema.parse(await readJson(request));
    const existingSession = await getLatestIntakeSession(user.id, id);
    const existingMessages = existingSession
      ? await listIntakeMessages(user.id, existingSession.id)
      : [];
    const hasUserAnswer = existingMessages.some((message) => message.role === "user");
    const existingBoard = await getBoard(user.id, id);
    const board = await updateBoard(user.id, id, input);
    if (!board) throw new ApiRequestError("Board not found.", 404, "not_found");
    if (existingBoard && !hasUserAnswer) {
      const planner = buildIntakeRoutingMetadata(board);
      await createOutcomeHarnessEvent(user.id, {
        situationId: id,
        conversationId: String(id),
        eventType: "board_edited_before_answering",
        source: "first_intake",
        domain: planner.domain,
        subtype: planner.subtype,
        questionPurpose: planner.questionPurpose,
        metadata: {
          originalTitle: existingBoard.title,
          newTitle: board.title,
          originalDescription: existingBoard.description,
          newDescription: board.description,
        },
        dedupeKey: `board-edited-before-answering:${id}:${board.updated_at}`,
        isQa: isQaRequest(request),
      });
    }
    return dataResponse(await boardDetail(user.id, id, isQaRequest(request)));
  } catch (error) {
    return errorResponse(error, "Could not update board.");
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const deleted = await deleteBoard(user.id, parseId(idParam));
    if (!deleted) throw new ApiRequestError("Board not found.", 404, "not_found");
    return emptyResponse();
  } catch (error) {
    return errorResponse(error, "Could not delete board.");
  }
}

import {
  createSituation,
  deleteSituation,
  getLatestIntakeSession,
  getLatestNextMovePlan,
  getOrCreateIntakeSession,
  getSituation,
  listIntakeMessages,
  listNextMovePlans,
  listSituations,
  listTasksForSituation,
  updateSituation,
} from "./repository";
import type { SituationInput, SituationUpdate } from "./schemas";
import type {
  IntakeMessage,
  IntakeSession,
  Situation,
  StoredNextMovePlan,
  Task,
} from "./types";

export type Board = Situation;
export type BoardInput = SituationInput;
export type BoardUpdate = SituationUpdate;
export type BoardStatus = Board["status"];
export type BoardUrgency = Board["urgency"];

export type BoardDetail = {
  board: Board;
  situation: Board;
  session: IntakeSession;
  messages: IntakeMessage[];
  latestPlan: StoredNextMovePlan | null;
  plans: StoredNextMovePlan[];
  tasks: Task[];
};

type QaOptions = { isQa?: boolean };

function boardToUpdate(board: Board, status: BoardStatus = board.status): BoardUpdate {
  return {
    title: board.title,
    description: board.description,
    category: board.category,
    urgency: board.urgency,
    status,
  };
}

export function listBoards(
  userId: number,
  status?: string,
  options?: QaOptions,
) {
  return listSituations(userId, status, options);
}

export function getBoard(userId: number, id: number) {
  return getSituation(userId, id);
}

export function createBoard(
  userId: number,
  input: BoardInput,
  options?: QaOptions,
) {
  return createSituation(userId, input, options);
}

export function updateBoard(userId: number, id: number, input: BoardUpdate) {
  return updateSituation(userId, id, input);
}

export async function resolveBoard(userId: number, id: number) {
  const board = await getBoard(userId, id);
  if (!board) return null;
  return updateBoard(userId, id, boardToUpdate(board, "resolved"));
}

export async function archiveBoard(userId: number, id: number) {
  const board = await getBoard(userId, id);
  if (!board) return null;
  return updateBoard(userId, id, boardToUpdate(board, "archived"));
}

export function deleteBoard(userId: number, id: number) {
  return deleteSituation(userId, id);
}

export function getLatestBoardPlan(
  userId: number,
  boardId?: number,
  options?: QaOptions,
) {
  return getLatestNextMovePlan(userId, boardId, options);
}

export function listBoardPlans(
  userId: number,
  limit = 20,
  boardId?: number,
  options?: QaOptions,
) {
  return listNextMovePlans(userId, limit, boardId, options);
}

export function listTasksForBoard(
  userId: number,
  boardId: number,
  options?: QaOptions,
) {
  return listTasksForSituation(userId, boardId, options);
}

export async function getBoardDetail(
  userId: number,
  boardId: number,
  { isQa = false }: QaOptions = {},
): Promise<BoardDetail | null> {
  const board = await getBoard(userId, boardId);
  if (!board) return null;
  const session =
    (await getLatestIntakeSession(userId, boardId)) ??
    (await getOrCreateIntakeSession(userId, boardId));
  const [messages, latestPlan, plans, tasks] = await Promise.all([
    listIntakeMessages(userId, session.id),
    getLatestBoardPlan(userId, boardId, { isQa }),
    listBoardPlans(userId, 10, boardId, { isQa }),
    listTasksForBoard(userId, boardId, { isQa }),
  ]);
  return {
    board,
    situation: board,
    session,
    messages,
    latestPlan,
    plans,
    tasks,
  };
}

# Board Adapter Notes

FlowPath now treats **Boards** as the app-facing product concept. The database
still stores those records in the existing `situations` table so this pass can
stay migration-free and preserve legacy data compatibility.

## Boundary

- `src/lib/boards.ts` is the Board-facing adapter over the existing situation
  repository functions.
- App-facing `/api/boards/*` routes should prefer adapter helpers such as
  `getBoard()`, `listBoards()`, `updateBoard()`, `getBoardDetail()`, and
  `listTasksForBoard()`.
- Adapter detail responses currently include both `board` and `situation` so
  older callers keep working while new callers use Board language.

## Deferred

- Renaming the `situations` table, `situation_id` columns, and older persisted
  plan fields is intentionally deferred.
- Move Map data continues to persist through `next_move_plans.raw_json`.

## New Board Flow

After intake produces a plan, the normal user path now opens
`/boards/[id]`, where the Move Map is the answer surface. The onboarding flow
does not render the old report-style plan/task cards as the happy-path result.

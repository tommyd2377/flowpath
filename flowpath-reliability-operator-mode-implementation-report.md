# FlowPath Reliability + Operator Plan Mode Implementation Report

## Summary
- What changed:
  - Added recoverable generation states, client generation IDs, cancel endpoint, and privacy-aware generation telemetry.
  - Added DB-backed QA mode, long-input validation/character counts, deterministic scenario routing, operator-plan schema fields, context-used display, and clearer task conversion confirmation.
  - Added the 8 comparative scenario fixtures and regression coverage for routing, schema, task ranking metadata, and memory safety.

## Files changed
- Core AI/schema/routing: `src/lib/flowpath-ai.ts`, `src/lib/schemas.ts`, `src/lib/types.ts`, `src/lib/intake.ts`, `src/lib/situation-routing.ts`, `src/lib/scenario-fixtures.ts`
- Persistence/API: `src/lib/repository.ts`, `src/lib/api-response.ts`, `src/lib/client-api.ts`, `src/lib/qa-mode.ts`, `migrations/010_reliability_operator_qa.sql`
- UI: `src/components/next-move-flow.tsx`, `src/components/next-move-plan-card.tsx`, `src/components/generation-status.tsx`, `src/components/qa-mode-banner.tsx`, `src/components/ui.tsx`, `src/components/tasks-manager.tsx`, `src/components/profile-editor.tsx`, `src/components/app-shell.tsx`
- Routes/tests: generation cancel, QA clear, situation/task/memory route updates, and new/updated tests.

## The 11 recommendations
1. Timeout/retry/cancel: Added generation IDs, cancel endpoint, AbortController use, retry marking, abandoned-generation checks, and recoverable UI controls.
2. Latency/recovery: Added staged loading copy, elapsed time, 20s soft warning, 90s hard timeout, and plain-language recovery actions.
3. Validation/character counts: Added primary description field, optional short title, exact validation payloads, and visible counts for situation/intake/task/memory fields.
4. Category/state bleed: Added deterministic routing/domain confidence and regression tests; Scenario 7 no longer routes to money.
5. Task creation confirmation: Task conversion now returns created/existing state, task titles, and global ranks.
6. Add Ranked Tasks top/bottom: Plan card shows the action near the recommendation and again at the bottom, switching to View ranked tasks after creation.
7. Context transparency: Operator plans include `context_used`; plan UI shows compact context with sensitivity/source/persistence and links to Memory.
8. Operator plan mode: Extended plan schema/prompt with `generation_mode`, situation read, bottleneck, constraints, first 10-minute action, task candidates, assumptions, and safety boundary.
9. QA/test mode: `?qa=true` enables a banner, QA headers, DB `is_qa` marking/filtering, and a clear-QA endpoint.
10. Telemetry: Added `generation_events` with type, status, duration, retry count, model, token usage, error category, and QA flag.
11. Scenario fixtures: Added the 8 comparative fixtures and routing tests without live AI calls.

## Testing
- `npm run test`: passed, 48 tests.
- `npm run lint`: passed.
- `npm run build`: passed.
- Brave manual QA:
  - Opened `http://localhost:3000/next-move?qa=true`.
  - Verified QA banner and character count UI.
  - Applied local migration with `npm run db:init`.
  - Created the “Too Many Open Loops” QA situation without a live AI call.
  - Verified the first intake question was broad/open-loops oriented, not money-specific.
  - Rechecked after fixing a QA banner hydration mismatch.

## Known limitations
- I did not run live plan generation because no new live API budget was provided and the local account showed the Next Move limit reached.
- Timeout/retry/cancel behavior is implemented in UI/API plumbing, but a true slow-model manual test was not run.
- QA clear action was visible, but I did not click it through Brave because it is a delete action; the endpoint is covered by implementation and can be used intentionally.

## Follow-up recommendations
- Add a small mock/dev-only delayed generation route or flag to manually test timeout/retry/cancel without live AI.
- Add a lightweight QA telemetry view for generation duration/status in QA mode.
- Consider allowing internal/unlimited users to bypass local Next Move quota in QA mode only, if that matches product policy.

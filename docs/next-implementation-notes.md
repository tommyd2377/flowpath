# FlowPath Next Implementation Notes

## Provisional Next Move

Not implemented in this pass.

The current plan route is synchronous: the UI waits for `POST /api/situations/[id]/generate-plan` to finish and then renders the stored Next Move plan. A provisional next move would be safest as a separate flow:

- Add a compact `provisional_next_move` flow type to `generation_events`.
- Compute it after intake readiness using deterministic safety routing first.
- Use a cheap model or deterministic heuristic that returns only title, reason, first 10 minutes, and safety boundary.
- Store it separately from `next_move_plans` so it cannot be confused with the final plan.
- Render it as explicitly provisional while the full plan is still generating.
- Reconcile or dismiss it when the full plan is saved.

This likely needs a small UI state change and either polling or a separate background action. It is low-risk conceptually, but not small enough to add without product review.

## Task Auto-Generation

Not implemented in this pass.

Task conversion remains deterministic and idempotent through `createTasksFromNextMovePlan`. The manual conversion route now records timing and generated task counts.

Auto-generation can be added later if the product decision is that every successful Next Move plan should immediately produce tasks. The safe path:

- Run deterministic conversion after `createNextMovePlan` succeeds.
- Keep the existing idempotency check by `source_next_move_plan_id`.
- Log `task_generation` with `plan_id`, generated count, and duration.
- Make the UI clearly show that tasks were created from the plan.
- Avoid duplicate work on regeneration, reload, or retry.

The main product question is whether task creation should be automatic or remain a deliberate user action.

## Task Feedback Loop

Not materially changed in this pass.

Existing task feedback and outcome context already affect ranking for shorter accepted patterns and ignored plan IDs. A useful next step would be to make the confirmation copy more explicit and add a small deterministic summary of feedback signals to future plan context without storing private feedback content in generation telemetry.

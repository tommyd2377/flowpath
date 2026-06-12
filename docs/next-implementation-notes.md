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

Implemented in this pass.

Task conversion remains deterministic and idempotent through `createTasksFromNextMovePlan`. After a Next Move plan is saved, `POST /api/situations/[id]/generate-plan` now runs the same deterministic converter and returns `taskConversion` so the UI can tell whether ranked tasks were created or already existed.

Implementation notes:

- No AI model is called for task generation.
- Idempotency is still keyed by `source_next_move_plan_id`; refreshes, retries, manual conversion, and repeated route calls do not duplicate tasks.
- Auto and manual conversion share `createTasksFromNextMovePlanWithTelemetry`.
- `task_generation` events record duration, `plan_id`, `returned_task_count`, `already_existed`, and `generated_task_count`.
- Plan generation remains successful if the saved-plan path completes but deterministic task conversion unexpectedly fails; the manual conversion route remains the recovery path.

Production metrics to check after this ships: `task_generation` p50/p90 duration, the count of conversion errors, and whether `already_existed` spikes unexpectedly.

## Primary Next-Action UI

Implemented in this pass.

When ranked tasks exist, the UI now treats the top ranked task as the canonical recommendation:

- Today labels the primary card "Do this next" and continues to use the top actionable ranked task.
- Situation detail renders the top ranked task before the plan-level move.
- The Next Move plan card defaults to a compact summary: primary task, bottleneck, first 10 minutes, why this move, and what not to waste time on.
- Full 24h/7d structure, context used, mentor insight, resources, and non-elevated safety boundary details remain available under "Full plan details."

## Task Feedback Loop

Small deterministic update implemented in this pass.

Task feedback now shows user-facing confirmation copy that matches current behavior:

- Completed tasks leave the active queue.
- Blocked / need-help tasks stay behind directly actionable work.
- No-longer-relevant tasks leave the active queue.
- Dismissed task feedback now also counts as an ignored-plan signal for deterministic ranking when the task came from a plan.

No raw task feedback content is added to generation telemetry. A possible future pass is to summarize aggregate feedback signals into future plan context without storing private feedback text in generation events.

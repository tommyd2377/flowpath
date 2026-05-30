# FlowPath Outcome Harness

FlowPath's Outcome Harness is the life/work decision equivalent of Cursor's
coding workflow loop. Cursor is useful because the model sits inside codebase
context, edits, tests, accept/reject feedback, and iteration. FlowPath should do
the same for action: situation, state, intervention, suggested action, task,
user interaction, outcome signal, and better future suggestions.

## Event Model

Fine-grained events live in `outcome_harness_events`. Each event is user-scoped
and may point at a situation, intake message, task, or next move plan. Events
store operational metadata only: titles, estimated minutes, changed fields,
model/stage names, genericity risk, and compact counters. They must not store
private chain-of-thought.

Primary event families:

- Suggested action lifecycle: shown, accepted, edited, dismissed, completed,
  ignored.
- Task lifecycle: created from AI, created manually, edited, completed,
  dismissed.
- Plan feedback: helpful, not helpful, acted, deferred, still stuck.
- Intake lifecycle: first question shown, answered, skipped, abandoned, edited
  before answering.
- System signals: repeated loop, evaluator rewrite, web search, memory use, and
  escalation.

`outcome_records` still exists for backward-compatible plan-level outcome state.
The harness event stream is the fine-grained source of product learning.

## Suggested Action Lifecycle

The suggested action card exposes compact workflow controls:

- `Accept` creates exactly one task from the highlighted suggested action.
- `Edit` lets the user change title, description, and estimated minutes before
  saving.
- `Dismiss` hides the suggestion and records that it did not fit.
- `Mark done` completes the suggested action/task.
- `Not useful` records negative feedback and syncs the plan-level outcome.

Edits record a lightweight diff:

```json
{
  "originalTitle": "...",
  "newTitle": "...",
  "originalDescription": "...",
  "newDescription": "...",
  "changedFields": ["title", "estimated_minutes"],
  "estimatedMinutesBefore": 60,
  "estimatedMinutesAfter": 15
}
```

This is the FlowPath version of an accepted or edited code suggestion.

## Intervention Effectiveness

`intervention_effectiveness_summaries` derives counts per user, QA scope,
domain, subtype, and intervention type.

Positive signals: accepted, completed, reported helpful, reported acted.
Negative signals: dismissed, not useful, still stuck, repeated loop, and stale
ignored. Edited is treated as mixed but valuable.

The score is a simple clamped heuristic from `-100` to `100`. Low-sample
summaries are advisory only. Plan generation receives a compact sentence such
as:

> Historically, for this user in product_strategy situations,
> concise_execution_plan has stronger follow-through signals.

The model should treat that as context, not as a hard rule.

## Stale And Ignored Detection

There is no background worker. Stale detection runs lazily when situations,
tasks, plans, or the debug dashboard are loaded.

Thresholds:

- Low urgency: 72 hours.
- Medium urgency: 24 hours.
- High urgency: 6 hours.
- Crisis/safety: disabled.

This creates `suggested_action_ignored` once per plan through a dedupe key. It
is for learning, not for nagging the user.

## Loop Detection

FlowPath combines existing repeated-topic detection with recent harness signals:
still stuck, ignored, repeated loop, and unresolved active situations. When a
loop is detected, generation is instructed to avoid a longer version of the same
answer, name the unresolved uncertainty, and propose one concrete experiment.

## Dashboard Metrics

The debug dashboard is at `/debug/outcome-harness` and is available only in
development, QA mode, or when `NEXT_PUBLIC_FLOWPATH_COGNITIVE_DEBUG=true`.

It summarizes:

- Suggested actions shown, accepted, edited, completed, dismissed, not useful,
  and ignored.
- Accept/edit/completion/dismiss/not-useful/ignored rates.
- Strongest and weakest interventions.
- First intake shown, answered, skipped, and abandoned.
- Evaluator rewrite and escalation rates.
- Average estimated minutes for accepted vs dismissed actions.
- Domains/subtypes with poor acceptance.

All data is scoped to the current FlowPath user and QA mode.

## Privacy Notes

Outcome events track product behavior, not sensitive identity traits and not
correctness of medical, legal, financial, or safety advice. For high-stakes
topics, events mean only that the user found something useful, acted, dismissed
it, or remained stuck.

Do not store:

- Chain-of-thought.
- Raw secrets, keys, account numbers, exact balances, or identity data.
- Inferred sensitive traits beyond operational product behavior.

## Fixtures And Tuning

Fixture situations live in `src/lib/outcome-harness-fixtures.ts`. Add a fixture
when changing first-intake routing, intervention selection, task creation caps,
or high-stakes caution behavior.

Ranking is tuned in `src/lib/task-ranking.ts`. Outcome-aware adjustments should
stay small relative to urgency, importance, effort, and friction. The harness
should improve follow-through without hiding genuinely urgent work.

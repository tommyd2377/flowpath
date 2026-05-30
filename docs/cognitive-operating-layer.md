# Cognitive Operating Layer

FlowPath's cognitive operating layer wraps the existing Next Move flow. It does
not replace the operator plan generator; it routes, constrains, evaluates, and
records the plan so the product gets better at turning guidance into action.

## Pipeline

```text
user message / situation
  -> update recent unresolved outcomes
  -> load compact outcome harness effectiveness signals
  -> state detection
  -> intervention selection
  -> compact memory selection
  -> web search gating
  -> operator plan generation
  -> deterministic evaluator
  -> one optional rewrite
  -> plan + cognitive metadata + outcome record
  -> outcome harness events
  -> user-confirmed task conversion
```

## Schemas

State detection returns:

```ts
{
  primary_state,
  secondary_states,
  confidence,
  user_intent,
  emotional_temperature,
  action_readiness,
  risk_flags,
  needs_web_search,
  needs_memory,
  needs_task_creation,
  needs_escalation,
  recommended_intervention,
  reasoning_summary
}
```

Intervention selection returns:

```ts
{
  intervention_type,
  response_length,
  tone,
  should_create_tasks,
  max_tasks,
  should_ask_question,
  question_if_needed,
  must_include,
  must_avoid,
  success_criteria
}
```

Outcome records are stored in `outcome_records` with the source message, optional
conversation and plan id, detected state, intervention, recommended action, task
ids created, user outcome, evidence, follow-up time, notes, and QA flag.

Fine-grained workflow signals are stored separately in
`outcome_harness_events`. These events capture accepted, edited, dismissed,
completed, ignored, helpful, not-helpful, still-stuck, repeated-loop, and intake
lifecycle signals. They are operational product behavior signals, not claims
that FlowPath was medically, legally, financially, or objectively correct. See
`docs/outcome-harness.md`.

## Model Routing

Model names are centralized in `src/lib/model-routing.ts`.

Roles:

- `classifier_model`
- `memory_model`
- `generator_model`
- `escalation_model`
- `evaluator_model`
- `extraction_model`

Each role can be overridden with an env var such as `OPENAI_CLASSIFIER_MODEL`.
Unset role vars fall back to `OPENAI_MODEL`, then `gpt-5.5`. The current state
detector, memory selector, and evaluator are deterministic, but the role config
exists so those stages can move to cheap model calls later without changing
route code.

## Web Search

Search is gated before generation. It turns on for explicit search requests,
current events, laws/regulations/policies, pricing, product/tool
recommendations, software/API docs likely to have changed, and health/legal/
financial factual caution. It stays off for pure creative work, rumination,
personal reflection, stable explanations, and requests where FlowPath memory or
local repo context is the source of truth.

The plan metadata records whether search was allowed/used and why.

## Evaluator

The evaluator checks the generated plan against the intervention criteria. It
penalizes generic motivation, excessive length, abstract tasks, missed selected
memory, missing next action, overconfident high-stakes advice, and too many task
candidates. If it fails, generation gets one rewrite attempt with explicit
rewrite instructions. There is no loop.

## Telemetry

`generation_events` now records:

- `state_detected`
- `intervention_type`
- `model_used_by_stage_json`
- `prompt_tokens_by_stage_json`
- `completion_tokens_by_stage_json`
- `estimated_cost`
- `evaluator_score`
- `response_rewritten`
- `tasks_created_count`
- `memory_items_used`
- `web_search_used`
- `outcome_harness_context_included`
- `historical_effectiveness_influenced_intervention`
- `cognitive_metadata_json`

Cost is `null` unless `OPENAI_MODEL_PRICING_JSON` is configured.

## Tuning

Tune the deterministic layer in `src/lib/cognitive-operating-layer.ts`.

Useful thresholds:

- Repeated-topic overlap: `0.62`
- Memory candidate relevance: `0.14`
- Evaluator pass score: `0.72`
- Memory budget: up to 8 selected memories, preferring 3-8 when memory matters
- Task cap: 1 for rumination/anxiety, up to 3 for execution/product/coding

## Testing

Run:

```bash
npm run test
npm run lint
npm run build
```

The test suite covers state classification, intervention selection, task caps,
web-search gating, memory budget, evaluator failures, outcome inference,
outcome persistence, telemetry-compatible metadata, and model routing.

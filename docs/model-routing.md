# FlowPath Model Routing

FlowPath uses named model roles instead of assuming one global expensive model fits every generation flow.

Defaults live in `src/lib/model-routing.ts` and can be overridden with environment variables.

## Roles

- `intake_fast`: first and follow-up intake by default.
- `intake_escalated`: intake when safety, high stakes, or complexity justify stronger reasoning.
- `plan_standard`: normal Next Move plan generation.
- `plan_escalated`: high-stakes, safety-sensitive, complex, or quality-recovery plan generation.
- `evaluator_fast`: evaluator or lightweight quality work.
- `revision_standard`: default revision after evaluator failure.
- `safety_classifier`: deterministic/cheap safety routing support.
- `dictation`: transcription.

Legacy role env vars remain supported for compatibility:

- `OPENAI_CLASSIFIER_MODEL`
- `OPENAI_MEMORY_MODEL`
- `OPENAI_GENERATOR_MODEL`
- `OPENAI_ESCALATION_MODEL`
- `OPENAI_EVALUATOR_MODEL`
- `OPENAI_EXTRACTION_MODEL`

New role-specific overrides:

- `OPENAI_INTAKE_FAST_MODEL`
- `OPENAI_INTAKE_ESCALATED_MODEL`
- `OPENAI_PLAN_STANDARD_MODEL`
- `OPENAI_PLAN_ESCALATED_MODEL`
- `OPENAI_EVALUATOR_FAST_MODEL`
- `OPENAI_REVISION_STANDARD_MODEL`
- `OPENAI_SAFETY_CLASSIFIER_MODEL`
- `OPENAI_TRANSCRIPTION_MODEL`

## Escalation Signals

FlowPath escalates only when there is evidence that a stronger model is likely worth the latency/cost:

- Safety route or crisis/high urgency.
- Serious legal, medical, housing, employment, financial, abuse, or physical-safety signals.
- Many constraints or competing priorities.
- Web search is needed for volatile/current facts.
- Prior validation failed.
- Evaluator requested a revision, especially for unsafe, generic, or low-scoring output.
- Very large prompt/context payloads.

FlowPath does not escalate merely because the user wrote a long message.

## Cost Estimation

Token counts are captured when the OpenAI response includes usage metadata. Cost estimates are opt-in through:

```env
OPENAI_MODEL_PRICING_JSON={"gpt-5.4-mini":{"input_per_1m":0.75,"cached_input_per_1m":0.075,"output_per_1m":4.5}}
```

Keep this config current with official OpenAI pricing. If a model has no known pricing entry, FlowPath records tokens and leaves `estimated_cost_usd` null.

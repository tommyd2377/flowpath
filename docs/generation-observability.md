# FlowPath Generation Observability

FlowPath records privacy-safe generation metadata in `generation_events`.

The observability fields are for internal diagnostics only. They must not store raw user messages, prompts, model outputs, task titles, profile facts, or transcript text.

## Safe Fields

- `flow_type`: first intake, follow-up intake, next move plan, evaluator, revision, task generation, task ranking, or Today dashboard.
- `flow_status`: success, error, quota blocked, safety routed, canceled, timeout, retry, or running.
- `model_role` and `model`: which configured role/model was selected.
- Token counts: input, cached input, output, and total tokens.
- `estimated_cost_usd`: optional estimate when `OPENAI_MODEL_PRICING_JSON` is configured.
- Web search metadata: decision reason and call count.
- Evaluator metadata: whether an evaluator was used and whether it triggered revision.
- Safety metadata: whether safety routing triggered and the route type.
- Quota metadata: plan tier and usage type.
- `structural_counts_json`: counts only, such as message count, task candidate count, and context item count.
- Sanitized errors: category and generic message only.

## Internal Report

Run:

```bash
npm run generation:report
```

Optional arguments:

```bash
npm run generation:report -- --days=30 --limit=5000
```

The report prints aggregate latency, token, cost, web-search, evaluator, quota, and safety-route summaries from local or configured libSQL data.

## Pricing Config

Cost estimates are opt-in:

```env
OPENAI_MODEL_PRICING_JSON={"gpt-5.4-mini":{"input_per_1m":0.75,"cached_input_per_1m":0.075,"output_per_1m":4.5}}
```

Verify current model pricing against the official OpenAI API pricing page before updating this config.

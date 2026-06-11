# FlowPath QA Benchmark

The benchmark lives in `qa/flowpath-benchmark/`.

It is intentionally manual/local-first. It does not call external chatbot APIs and does not require paid competitor access.

## Files

- `scenarios.json`: fixed messy-situation scenarios and expected FlowPath behavior.
- `runs.example.json`: example run-result shape for storing latency, token, safety, task, and manual rating data.

## Suggested Workflow

1. Run FlowPath locally.
2. For each scenario, create a situation and complete the normal intake/plan flow.
3. Record latency and non-private operational metadata from `generation_events` or `npm run generation:report`.
4. Paste or summarize the generated output into a local run file only if it is safe and intentionally part of QA review.
5. Manually paste competitor outputs into separate local notes if desired. Do not automate paid external API calls by default.
6. Score with the rubric below.

## Rubric

Score each scenario from 1-5:

- Time to first useful action.
- Word count before first concrete recommendation.
- Quality and specificity of the first intake question.
- Constraint awareness.
- Bottleneck clarity.
- Whether the answer names wasted motion.
- Whether it gives an insider/practical next move.
- Anti-generic quality.
- Whether the top task is doable in 10-15 minutes.
- Task concreteness.
- Continuity across the situation.
- Likelihood the user would act.
- Safety/human-help handling.

The benchmark is meant to answer whether FlowPath creates clearer action than a general chatbot, not whether it writes the longest or most polished answer.

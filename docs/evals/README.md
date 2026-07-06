# FlowPath Evals

FlowPath evals are a lightweight quality harness for boards, Move Maps, branch
expansion, memory reconciliation, and search honesty. They are designed to run
offline by default so normal tests never call OpenAI or web search.

## What They Measure

The current rubric scores ten dimensions:

- Domain correctness
- Board-state accuracy
- Branch quality
- Recommended line quality
- Action concreteness
- Search honesty
- Memory use
- Tone and realism
- Safety / urgent stability
- Output shape / schema

Critical failures automatically fail a scenario:

- local/current hallucination without search
- unsafe urgent-stability handling
- stale memory used after deletion/stale marking
- selected primary domain overwritten
- duplicate branches
- action leaf missing a concrete action
- invalid structured output

## Offline Evals

Run the offline eval suite:

```bash
npm run evals
```

Offline mode uses fixtures in `src/lib/evals/fixtures.ts` and mocked structured
outputs in `src/lib/evals/mock-outputs.ts`.

Reports are written to:

- `docs/evals/latest-flowpath-eval.md`
- `docs/evals/runs/<timestamp>.json`

To score without writing reports:

```bash
npm run evals -- --no-write
```

## Live Evals

Live evals are disabled unless explicitly enabled. They should only be run when
you intentionally want to spend a bounded number of OpenAI calls.

```bash
FLOWPATH_LIVE_EVALS=1 \
FLOWPATH_LIVE_EVAL_MAX_CALLS=3 \
FLOWPATH_LIVE_EVAL_MAX_SCENARIOS=3 \
npm run evals:live
```

Optional web search during live evals:

```bash
FLOWPATH_LIVE_EVAL_WEB_SEARCH=1
```

Live evals use QA-style in-memory board/session objects and should not write
production data. They still call the configured model, so keep the call budget
small.

## Adding A Fixture

1. Add the scenario to `src/lib/evals/fixtures.ts`.
2. Add a corresponding mock output to `src/lib/evals/mock-outputs.ts`.
3. Include expected keywords for:
   - primary and secondary domains
   - title and goal
   - constraints/assets
   - branch groups
   - recommended branch
   - action wording
   - search-honesty expectations
   - memory expectations, if relevant
4. Run `npm test` and `npm run evals -- --no-write`.

## Interpreting Results

Use critical failures first. Numeric scores are useful for trend tracking, but a
critical failure means FlowPath violated a product invariant.

Common diagnosis:

- Branch quality failure: Move Map output is mixing strategy branches with
  sequential tasks or producing duplicates.
- Search honesty failure: a tree or branch claims local/current verification
  without an actual search call.
- Memory failure: stale/deleted/merged memory is still being selected into
  generation context.
- Safety failure: urgent stability boards are being treated like normal growth
  boards.

## Files

- `src/lib/evals/types.ts`: shared eval types.
- `src/lib/evals/fixtures.ts`: scenario definitions.
- `src/lib/evals/mock-outputs.ts`: offline structured outputs.
- `src/lib/evals/rubric.ts`: scoring and critical-failure checks.
- `src/lib/evals/report.ts`: Markdown/JSON report generation.
- `src/lib/evals/run-evals.ts`: CLI runner.

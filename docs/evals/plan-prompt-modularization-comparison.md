# Plan Prompt Modularization Eval Note

Date: 2026-07-06

Mode: offline evals only. No live OpenAI or web-search calls were run.

## Baseline

Command:

```bash
npm run evals -- --no-write
```

Result before prompt modularization:

- Overall: PASS
- Score: 283.8 / 300
- Critical failures: none

## After Modularization

Command:

```bash
npm run evals -- --no-write
```

Result after prompt modularization:

- Overall: PASS
- Score: 283.8 / 300
- Critical failures: none

## Interpretation

The prompt refactor preserved the existing offline quality contracts while making
the main plan-generation instruction easier to tune. The score did not move
because the offline eval harness uses static mock outputs; live evals are still
required to measure model-output quality changes from the prompt wording itself.

The new contract tests now guard:

- Board snapshot instructions
- Branch-vs-step distinction
- Concrete action-leaf requirements
- Search-honesty wording
- Memory extraction wording
- Safety/urgent-stability wording
- Social/community tone requirements
- Avoidance of old report/project/life-area framing in the assembled plan prompt

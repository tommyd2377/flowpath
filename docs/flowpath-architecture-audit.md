# FlowPath Architecture Audit

Date: 2026-07-06

Scope: read-only architecture audit of the current FlowPath codebase. This report describes the implementation as found in the repository. It does not include live OpenAI calls, web searches, production data inspection, production database introspection, migrations, or product changes.

## 1. Executive summary

FlowPath currently generates answers through a layered pipeline:

1. A user creates a board from one of three entry domains in `src/components/next-move-flow.tsx`.
2. The board is persisted in the `situations` table through `/api/boards`, despite user-facing "Boards" language.
3. Intake messages are stored in `intake_sessions` and `intake_messages`.
4. Follow-up intake questions are generated with OpenAI structured outputs from `generateInterviewQuestion()` in `src/lib/flowpath-ai.ts`.
5. Completed or skipped intake calls `/api/boards/[id]/generate-plan`, which builds deterministic cognitive context, optionally uses OpenAI web search through the Responses API, calls `generateNextMovePlan()`, validates a large structured plan schema, stores the plan in `next_move_plans`, writes the full model output into `raw_json`, creates inferred memory rows, creates outcome/telemetry rows, and converts up to three task candidates into `tasks`.
6. The Board detail page renders a Move Map from `next_move_plans.raw_json.decision_tree`, normalized by `src/lib/decision-tree.ts`.
7. Branch expansion currently does not call the model. `/api/boards/[id]/move-map/expand` uses deterministic helper logic to add a child fork or action leaf, then persists the modified tree back into `raw_json`.

The strongest infrastructure pieces are:

- Structured Zod validation for model outputs in `src/lib/schemas.ts`.
- Quota gating before model calls and usage increment after success in the AI routes.
- Generation telemetry in `generation_events`.
- Deterministic cognitive routing for state, memory selection, web-search gating, and evaluator checks.
- A normalized Move Map fallback for older plans.

The biggest answer-quality bottlenecks are:

- The main plan prompt is extremely large and contains overlapping product eras: boards, situations, tasks, projects, operator analysis, proposed memory, saved memory, safety, search, and recursive decision-tree instructions all live in one prompt.
- Branch expansion is deterministic and pattern-based, not model/search-backed, so the recursive tree can mechanically expand while producing generic or mismatched forks.
- Search status is not strongly post-validated against actual web-search calls. The model can output `search_status: "searched"` and local-looking content without a separate source-of-truth check.
- Memory correction is append-only. "Tell FlowPath what is wrong..." creates a saved memory row; it does not interpretively merge, delete, or rewrite old conflicting memory.
- Board title inference is mostly deterministic and can still fall back to clipped user text when no hardcoded pattern matches.
- The database and repository layer still use `situations` as the canonical board table/type, and legacy `projects`, `life_areas`, `plans`, and proposed/saved memory distinctions still shape joins, prompts, tests, and schemas.

Highest-leverage improvement opportunities:

1. Add a real branch-expansion model prompt and schema, with optional gated search, instead of deterministic `expandDecisionTreeAtOption()` only.
2. Split the monolithic plan prompt into narrower prompt modules: board snapshot, branch generation, action leaf, task extraction, memory extraction, and safety boundary.
3. Add post-generation validators that compare tree search statuses and local claims against actual `web_search_call_count` and stored sources.
4. Replace append-only memory correction with a memory reconciliation route that can update, merge, mark stale, or forget existing rows.
5. Add golden/eval fixtures for board quality, branch distinction, local search honesty, and recursive expansion quality.
6. Create an adapter boundary that exposes "Board" types to the app while isolating the `situations` table as storage detail, or migrate the table/API names in a controlled pass.

## 2. System map

High-level user-to-output flow:

```text
Home / Today
  src/app/page.tsx
  src/components/today-dashboard.tsx
    -> /next-move?domain=<entry_domain>

New board / intake
  src/app/next-move/page.tsx
  src/components/next-move-flow.tsx
    -> POST /api/boards
       src/app/api/boards/route.ts
       createSituation() in src/lib/repository.ts
       generateFirstIntakePlan() in src/lib/flowpath-ai.ts
    -> POST /api/boards/[id]/messages
       src/app/api/boards/[id]/messages/route.ts
       generateInterviewQuestion() in src/lib/flowpath-ai.ts

Plan generation
  src/components/next-move-flow.tsx generatePlan()
    -> POST /api/boards/[id]/generate-plan
       src/app/api/boards/[id]/generate-plan/route.ts
       buildCognitivePlanContext() in src/lib/cognitive-operating-layer.ts
       safetyRouteFromText() in src/lib/safety-routing.ts
       generateNextMovePlan() in src/lib/flowpath-ai.ts
       createNextMovePlan() in src/lib/repository.ts
       createTasksFromNextMovePlanWithTelemetry() in src/lib/task-conversion.ts

Board detail / Move Map
  src/app/boards/[id]/page.tsx
  src/components/board-detail-view.tsx
    -> GET /api/boards/[id]
       src/app/api/boards/[id]/route.ts
       getLatestNextMovePlan(), listTasksForSituation()
    -> DecisionTreeMap
       src/components/decision-tree-map.tsx
       normalizeDecisionTree() / decisionTreeTrace()

Branch expansion
  DecisionTreeMap "Continue this path"
    -> POST /api/boards/[id]/move-map/expand
       src/app/api/boards/[id]/move-map/expand/route.ts
       expandDecisionTreeAtOption() in src/lib/decision-tree.ts
       updateNextMovePlanDecisionTree() in src/lib/repository.ts

Board update / recalculation
  Board detail "Tell FlowPath what changed"
    -> POST /api/boards/[id]/board-update
       src/app/api/boards/[id]/board-update/route.ts
       addIntakeMessage(), createInferredContextItem(), updateIntakeSession()
    -> POST /api/boards/[id]/generate-plan

Memory
  src/app/memory/page.tsx
  src/components/profile-editor.tsx
    -> GET /api/profile
    -> GET /api/memory/context-items
    -> POST /api/memory/correction
    -> PATCH/DELETE /api/memory/context-items/[id]

Tasks
  src/app/tasks/page.tsx
  src/components/tasks-manager.tsx
    -> GET/POST /api/tasks
    -> PUT/DELETE /api/tasks/[id]
    -> POST /api/tasks/[id]/feedback
    -> POST /api/tasks/[id]/revise
```

## 3. Database map

Database access:

- Library: `@libsql/client`
- Database wrapper: `src/lib/db.ts`
- Environment helpers: `src/lib/env.ts`
- Default local database: `file:./data/flowpath.db`
- Production-capable database: libSQL/Turso through `DATABASE_URL` plus `TURSO_AUTH_TOKEN` or `LIBSQL_AUTH_TOKEN`
- There is no ORM. SQL lives in migrations and `src/lib/repository.ts`.

Migrations:

- `migrations/001_init.sql` through `migrations/015_generation_observability.sql`
- Applied by `scripts/init-db.mjs`

Relevant tables and purposes:

### `users`

Created in `migrations/004_auth_users.sql`, extended in `006_billing_usage.sql` and `012_guest_users.sql`.

Key fields:

- `id`
- `clerk_user_id`
- `email`
- `role`
- `plan_tier`
- `billing_status`
- Stripe fields: `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `current_period_start`, `current_period_end`
- `internal_unlimited`
- Guest fields: `guest_session_id`, `is_guest`

Used by:

- `src/lib/auth.ts`
- billing/usage gates
- all repository queries through `user_id`

Notes:

- Guest mode is implemented by creating local user rows with a guest session cookie.
- Paywall is disabled in `src/lib/billing/plans.ts`, but billing fields remain.

### `profile`

Created in `001_init.sql`, rebuilt in `004_auth_users.sql`, extended by `007_context_constraints.sql`.

Key fields:

- `user_id`
- `personal_profile`
- `current_season`
- `core_priorities`
- `constraints`
- `operating_principles`
- `remember`
- `challenge_on`
- `context_constraints_json`

Used by:

- `getProfile()`, `updateProfile()` in `src/lib/repository.ts`
- `src/app/api/profile/route.ts`
- `src/components/profile-editor.tsx`
- cognitive memory selection

Legacy/stale notes:

- The UI is now "What FlowPath Knows", but profile fields still exist and are folded into the unified memory bank.
- Profile fields can still indirectly influence prompts through compact profile memory selection.

### `life_areas`

Created in `001_init.sql`, rebuilt in `004_auth_users.sql`.

Key fields:

- `name`
- `description`
- `priority_level`
- `desired_outcome`
- `current_bottleneck`

Used by:

- Repository functions `listLifeAreas()`, `getLifeArea()`, `createLifeArea()`, `updateLifeArea()`, `deleteLifeArea()`
- Task joins in `listTasks()`
- Nullable task field `life_area_id`

Current status:

- Legacy. The current working tree no longer shows top-level Life Areas pages/API routes, but the table and repository functions remain.
- Tasks still join this table, so removing it would require task schema cleanup.

### `projects`

Created in `001_init.sql`, rebuilt in `004_auth_users.sql`.

Key fields:

- `life_area_id`
- `status`
- `description`
- `next_milestone`
- `current_bottleneck`
- `why_it_matters`

Used by:

- Repository functions `listProjects()`, `getProject()`, `createProject()`, `updateProject()`, `deleteProject()`
- Task joins in `listTasks()`
- Nullable task field `project_id`

Current status:

- Legacy. It is no longer a primary product concept, but task joins still include it.

### `tasks`

Created in `001_init.sql`, extended in `002_next_move.sql`, `003_phase_one.sql`, `004_auth_users.sql`, `013_outcome_harness.sql`, and rebuilt in `014_task_feedback_statuses.sql`.

Key fields:

- `user_id`
- `title`
- `life_area_id`
- `project_id`
- `situation_id`
- `status`: `open`, `in_progress`, `blocked`, `done`, `ignored`
- `importance`
- `effort`
- `due_date`
- `notes`
- `source_next_move_plan_id`
- `source_plan_section`
- `friction_type`
- `friction_note`
- `estimated_minutes`
- `is_qa`

Used by:

- `src/components/tasks-manager.tsx`
- `/api/tasks`
- `/api/tasks/[id]`
- `/api/tasks/[id]/feedback`
- `/api/tasks/[id]/revise`
- `/api/next-move-plans/[id]/tasks`
- `/api/next-move-plans/[id]/suggested-action`
- `createTasksFromNextMovePlan()`
- `saveSuggestedActionTask()`

Canonical vs legacy:

- `situation_id` is the canonical board link, but named for the old `situations` table.
- `life_area_id` and `project_id` are legacy optional links.
- `source_plan_section = decision_branch:<optionId>` is used for branch-specific tasks.

### `situations`

Created in `002_next_move.sql`, rebuilt in `004_auth_users.sql`, extended by `010_reliability_operator_qa.sql`.

Key fields:

- `user_id`
- `title`
- `description`
- `category`
- `status`: `active`, `resolved`, `archived`
- `urgency`: `low`, `medium`, `high`, `crisis`
- `is_qa`
- timestamps

Used by:

- All board routes as the storage table.
- `Situation` type in `src/lib/types.ts`
- `createSituation()`, `listSituations()`, `getSituation()`, `updateSituation()`, `deleteSituation()`
- Board UI imports often alias `Situation` as board.

Canonical status:

- This is currently the canonical board table even though the UI says "Boards".
- `/api/boards` wraps the situation repository functions.

Legacy/stale risk:

- Prompt text and tests still use "situation" in many places.
- Output fields such as `situation_read`, `situation_summary`, `situation_id` remain throughout plan/task schemas.

### `intake_sessions`

Created in `002_next_move.sql`, rebuilt in `004_auth_users.sql`, extended by `007_context_constraints.sql` and `010_reliability_operator_qa.sql`.

Key fields:

- `user_id`
- `situation_id`
- `current_stage`: `understanding_goals`, `mapping_constraints`, `identifying_options`, `ready_to_generate`
- `is_complete`
- `summary_so_far`
- `context_constraints_json`
- `is_qa`

Used by:

- Intake creation, follow-up question generation, and board update.
- `getOrCreateIntakeSession()` creates one incomplete session per board if available.

### `intake_messages`

Created in `002_next_move.sql`, rebuilt in `004_auth_users.sql`, extended by `010_reliability_operator_qa.sql`.

Key fields:

- `user_id`
- `session_id`
- `role`: `user` or `assistant`
- `content`
- `client_message_id`
- `is_qa`

Used by:

- Intake history.
- Plan context.
- Outcome inference.
- Board update messages.

### `next_move_plans`

Created in `002_next_move.sql`, rebuilt in `004_auth_users.sql`, extended by `003`, `005`, `008`, `010`, and `011`.

Key fields:

- `user_id`
- `situation_id`
- `intake_session_id`
- `model`
- `mode`
- `generation_mode`
- `situation_read`
- `likely_bottleneck`
- `key_constraints_json`
- `situation_summary`
- `core_bottleneck`
- `highest_leverage_move_json`
- `why_this_move`
- `first_10_minute_action_json`
- `first_30_minutes_json`
- `next_24_hours_json`
- `next_7_days_json`
- `what_not_to_do_json`
- `likely_trap`
- `recommendation_basis_json`
- `restraint_guidance_json`
- `operator_insight_json`
- `friction_pattern`
- `local_reality_scout_json`
- `resources_to_seek_json`
- `when_to_get_human_help`
- `safety_boundary_json`
- `context_used_json`
- `task_candidates_json`
- `inferred_context_items_json`
- `confidence_level`
- `assumptions_json`
- `follow_up_questions_json`
- `client_generation_id`
- `cognitive_metadata_json`
- `raw_json`
- `is_qa`

Where `raw_json` is stored:

- In `next_move_plans.raw_json`.
- Written by `createNextMovePlan()` in `src/lib/repository.ts`.
- Parsed by `rowToNextMovePlan()` and `normalizeDecisionTree()`.

Where `decision_tree` / Move Map data is stored:

- No dedicated table.
- The model's `decision_tree` lives in `raw_json.decision_tree`.
- `updateNextMovePlanDecisionTree()` rewrites only `raw_json` with an updated `decision_tree`.
- Structured plan columns do not contain the tree.

Risks:

- `raw_json` is a compatibility bucket and can silently diverge from extracted columns.
- If parsing fails, fallback tree generation can hide corrupt or outdated model output.

### `inferred_context_items`

Created in `008_inferred_context_items.sql`, extended by `010_reliability_operator_qa.sql`.

Key fields:

- `user_id`
- `label`
- `value`
- `category`
- `sensitivity`: `low`, `moderate`, `high`
- `persistence`: `session_only`, `proposed_memory`, `saved_memory`
- `source`: `intake`, `plan`, `manual`
- `situation_id`
- `intake_session_id`
- `next_move_plan_id`
- `is_qa`

Used by:

- `src/components/profile-editor.tsx`
- `/api/memory/context-items`
- `/api/memory/correction`
- intake and plan prompt context
- cognitive memory selection

Current status:

- User-facing memory is unified, but internal statuses still preserve proposed/saved/session distinctions.
- Memory correction appends new rows; it does not reconcile existing rows.

### `plans` and `checkins`

Created in `001_init.sql`, partially extended by later migrations.

Current status:

- Legacy daily planning tables.
- `/api/generate-plan` and POST `/api/checkins` are deprecated.
- `checkins` can still be read and passed into plan generation as `recentCheckIns`.

### `monthly_usage`, `stripe_events`

Created in `006_billing_usage.sql`.

Current status:

- Billing and quota plumbing remains.
- `PAYWALL_DISABLED = true` in `src/lib/billing/plans.ts`, so limits are effectively unlocked.

### `generation_events`

Created in `010_reliability_operator_qa.sql`, extended by `011` and `015`.

Key fields:

- `client_generation_id`
- `generation_type`
- `status`
- `situation_id`
- `plan_id`
- `task_id`
- `flow_type`
- `flow_status`
- `model_role`
- token/cost fields
- `web_search_used`
- `web_search_call_count`
- `web_search_decision_reason`
- evaluator and safety fields
- `structural_counts_json`
- `cognitive_metadata_json`

Used by:

- all AI routes for observability, retry/cancel, and cost tracking.

### `outcome_records`

Created in `011_cognitive_operating_layer.sql`.

Stores:

- detected state
- intervention type
- recommended action
- user outcome
- evidence/notes
- link to source message and plan

Used by:

- outcome inference from future intake messages
- manual plan outcome endpoint
- cognitive context effectiveness

### `outcome_harness_events` and `intervention_effectiveness_summaries`

Created in `013_outcome_harness.sql`.

Stores:

- event stream for suggested actions, tasks, plans, intake, search, memory, and effectiveness feedback
- summarized intervention effectiveness

Important schema drift:

- `src/lib/outcome-harness.ts` includes newer event types such as `board_edited_before_answering`, `created_new_board_before_answering`, `move_map_branch_expanded`, and `move_map_action_leaf_reached`, plus source `move_map`.
- `migrations/013_outcome_harness.sql` still has the older CHECK values `situation_edited_before_answering`, `created_new_situation_before_answering`, and does not include `move_map`.
- If a database was initialized from the migrations without a later corrective migration, inserting newer events can violate CHECK constraints. The move-map expansion route catches telemetry failures, but some other routes do not.

## 4. Prompt map

All major prompts are static strings in `src/lib/flowpath-ai.ts`. There is no prompt table, prompt registry, or explicit prompt versioning.

| Prompt / fragment | File | Purpose | Caller | Model role | Inputs | Output schema | Downstream |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `selectiveWebSearchInstruction` | `src/lib/flowpath-ai.ts` | Rules for when to use OpenAI web search and how not to hallucinate local/current facts | composed into daily and plan prompts | generator/plan | included in system instruction | none by itself | affects web search behavior |
| `phaseOneInstruction` | `src/lib/flowpath-ai.ts` | Explain recommendation basis, restraint, friction, local reality, safety | composed into daily and plan prompts | generator/plan | profile/tasks/projects/checkins/situations wording | none by itself | plan fields |
| `operatorLeverageInstruction` | `src/lib/flowpath-ai.ts` | Domain-insider/operator framing | composed into daily and plan prompts | generator/plan | user context | none by itself | `operator_insight`, branch rationale |
| `boardNextMoveInstruction` | `src/lib/flowpath-ai.ts` | Board metaphor, domains, title, primary/secondary domain preservation, safety | composed into intake and plan prompts | intake/plan | selected category and board context | none by itself | intake, plan, tree |
| `privacyAwareConstraintInstruction` | `src/lib/flowpath-ai.ts` | Sensitive data minimization and high-stakes boundaries | intake and plan prompts | intake/plan | user context | none by itself | intake questions, memory, safety |
| `socialConnectionInstruction` | `src/lib/flowpath-ai.ts` | Social/dating/community guidance and safety boundaries | intake and plan prompts | intake/plan | social boards | none by itself | social board questions/plans |
| `intakeInferredMemoryInstruction` | `src/lib/flowpath-ai.ts` | Infer context items and task candidates | intake and plan prompts | intake/plan | user answers | none by itself | `inferred_context_items`, `task_candidates` |
| `systemPrompt` | `src/lib/flowpath-ai.ts` | Legacy/daily plan generation | `generateFlowPathPlan()` | `generator_model` | profile, life areas, projects, tasks, checkins | `dailyPlanJsonSchema` | legacy `plans` flow; POST deprecated |
| `interviewerSystemPrompt` | `src/lib/flowpath-ai.ts` | Follow-up intake interviewer | `generateInterviewQuestion()` | selected by `selectModelForGeneration()` for `followup_intake_question` | profile, board, session, messages, selected memory, cognitive context | `interviewerJsonSchema` then `interviewerOutputSchema` | persisted session/message, inferred memory, urgency update |
| `firstIntakeQuestionSystemPrompt` | `src/lib/flowpath-ai.ts` | Generate first AI follow-up after board creation | `generateFirstIntakePlan()` | selected for `first_intake_question` | board title/description/category/urgency and route metadata | `firstIntakeQuestionJsonSchema` then parser | first assistant message |
| `operatorPlanInstruction` | `src/lib/flowpath-ai.ts` | Main next-move plan and decision-tree instructions | `generateNextMovePlan()` through `strategistSystemPrompt` | `plan_standard` or `plan_escalated` | profile, board, intake messages, tasks, checkins, recent plans, memory, cognitive context, search decision | `nextMovePlanJsonSchema` then `nextMovePlanSchema` | `next_move_plans`, tasks, memory, Move Map |
| `strategistSystemPrompt` | `src/lib/flowpath-ai.ts` | Main plan system prompt composed from board, operator, search, privacy, social, memory instructions | `generateNextMovePlan()` | `plan_standard` / `plan_escalated` | full plan context | `nextMovePlanJsonSchema` | stored plan |
| `taskRevisionSystemPrompt` | `src/lib/flowpath-ai.ts` | Revise one task from feedback | `generateTaskRevision()` | `revision_standard` | task and user revision instruction | `taskRevisionJsonSchema` | updated task row |
| `buildRevisionInstruction()` | `src/lib/cognitive-operating-layer.ts` | Converts deterministic evaluator failures into rewrite instructions | `generateNextMovePlan()` after failed evaluator | same plan model role | evaluator output, prior model plan | `nextMovePlanJsonSchema` | rewritten plan |

Prompt issues:

- `phaseOneInstruction` and `intakeInferredMemoryInstruction` still use "tasks, projects, check-ins, situations" and "proposed_memory/saved_memory" language.
- `boardNextMoveInstruction` starts with "Treat the user's situation as a board", mixing old and new language.
- `operatorPlanInstruction` asks for both a best next move and a recursive decision tree in one large schema. That can encourage dense report output and branch/step mixing.
- Prompt fragments are duplicated across first intake, follow-up intake, daily plan, and next-move plan. Some duplication is intentional, but there is no versioning or central prompt contract per flow.
- No prompt found that specifically expands a selected Move Map branch. Branch expansion is deterministic code, not prompted generation.

## 5. Model call map

OpenAI client creation:

- `src/lib/flowpath-ai.ts`
  - `getOpenAIClient()`
  - `createStructuredResponse()`
  - `generateFlowPathPlan()`
- `src/app/api/dictation/transcribe/route.ts`
  - creates an `OpenAI` client directly for transcription.

Model routing:

- `src/lib/model-routing.ts`
- Default model: `gpt-5.4-mini`
- Global fallback env var: `OPENAI_MODEL`

Model roles and env vars:

| Role | Env var | Default |
| --- | --- | --- |
| `classifier_model` | `OPENAI_CLASSIFIER_MODEL` | `gpt-5.4-mini` |
| `memory_model` | `OPENAI_MEMORY_MODEL` | `gpt-5.4-mini` |
| `generator_model` | `OPENAI_GENERATOR_MODEL` | `gpt-5.4-mini` |
| `escalation_model` | `OPENAI_ESCALATION_MODEL` | `gpt-5.4` |
| `evaluator_model` | `OPENAI_EVALUATOR_MODEL` | `gpt-5.4-mini` |
| `extraction_model` | `OPENAI_EXTRACTION_MODEL` | `gpt-5.4-mini` |
| `intake_fast` | `OPENAI_INTAKE_FAST_MODEL` | `gpt-5.4-mini` |
| `intake_escalated` | `OPENAI_INTAKE_ESCALATED_MODEL` | `gpt-5.4` |
| `plan_standard` | `OPENAI_PLAN_STANDARD_MODEL` | `gpt-5.4-mini` |
| `plan_escalated` | `OPENAI_PLAN_ESCALATED_MODEL` | `gpt-5.4` |
| `evaluator_fast` | `OPENAI_EVALUATOR_FAST_MODEL` | `gpt-5.4-mini` |
| `revision_standard` | `OPENAI_REVISION_STANDARD_MODEL` | `gpt-5.4-mini` |
| `safety_classifier` | `OPENAI_SAFETY_CLASSIFIER_MODEL` | `gpt-5.4-mini` |
| `dictation` | `OPENAI_TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` |

Actual model calls:

1. `generateFirstIntakePlan()`
   - File: `src/lib/flowpath-ai.ts`
   - Route: `POST /api/boards`
   - Non-streaming OpenAI Responses API
   - Structured output: `firstIntakeQuestionJsonSchema`
   - No web search

2. `generateInterviewQuestion()`
   - File: `src/lib/flowpath-ai.ts`
   - Route: `POST /api/boards/[id]/messages`
   - Non-streaming OpenAI Responses API
   - Structured output: `interviewerJsonSchema`
   - No web search

3. `generateNextMovePlan()`
   - File: `src/lib/flowpath-ai.ts`
   - Route: `POST /api/boards/[id]/generate-plan`
   - Non-streaming OpenAI Responses API
   - Structured output: `nextMovePlanJsonSchema`
   - Optional OpenAI Responses `web_search` tool
   - Deterministic evaluator may trigger one rewrite call

4. `generateTaskRevision()`
   - File: `src/lib/flowpath-ai.ts`
   - Route: `POST /api/tasks/[id]/revise`
   - Non-streaming OpenAI Responses API
   - Structured output: `taskRevisionJsonSchema`
   - No web search

5. `generateFlowPathPlan()`
   - File: `src/lib/flowpath-ai.ts`
   - Legacy daily plan function
   - Uses OpenAI Responses API and `dailyPlanJsonSchema`
   - `/api/generate-plan` POST is now deprecated, so this should not be active in normal product flow.

6. Dictation transcription
   - File: `src/app/api/dictation/transcribe/route.ts`
   - Uses `openai.audio.transcriptions.create`
   - Model defaults to `gpt-4o-mini-transcribe`

Provider abstraction:

- There is model-role abstraction, but no provider abstraction. The implementation is OpenAI-specific.

Structured output:

- JSON schemas are built manually in `src/lib/flowpath-ai.ts`.
- Zod validation and defaults are in `src/lib/schemas.ts`.
- `createStructuredResponse()` expects `response.output_text`, parses JSON, and throws if empty.

Retries/fallbacks:

- No generic automatic retry wrapper.
- Plan generation has one evaluator-triggered rewrite if `evaluateNextMovePlan()` fails.
- Client-side generation flows support retry by sending a new request and marking prior running generation as retry.
- Some timeout recovery is client-side reconciliation: after a plan error, `NextMoveFlow` reloads detail to see whether a plan was saved anyway.

Cost/token controls:

- Usage gates live in `src/lib/billing/usage.ts`.
- Model usage increments after successful generation.
- Estimated cost only works if `OPENAI_MODEL_PRICING_JSON` is configured.
- `max_output_tokens` is set per call in `src/lib/flowpath-ai.ts`.
- Live model calls are not run by tests unless explicitly invoked outside the unit suite.

Streaming:

- No streaming model calls were found. All model calls are non-streaming.

Branch expansion:

- `/api/boards/[id]/move-map/expand` does not call OpenAI. It is deterministic.

## 6. Board/intake/plan generation flow

### Entry screen

Files:

- `src/app/page.tsx`
- `src/components/today-dashboard.tsx`
- `src/lib/entry-domains.ts`

Home loads:

- `/api/next-move-plans?limit=1`
- `/api/boards`
- `/api/tasks`

New/empty state:

- Shows the heading "What are you trying to figure out?"
- Shows three entry cards from `ENTRY_DOMAINS`.
- Hides returning-user dashboard modules until boards/tasks/plans exist.

Entry domains:

- `work_money_career`
- `people_community_belonging`
- `craft_creativity_mastery`

### New board intake

Files:

- `src/app/next-move/page.tsx`
- `src/components/next-move-flow.tsx`
- `src/lib/entry-domains.ts`

Client behavior:

- If URL has `?domain=<domain>`, `NextMoveFlow` preselects it.
- It shows one selected domain badge and one domain-specific first textarea.
- It submits `{ description, category }` to `POST /api/boards`.
- It does not submit manual title or manual urgency from the UI.

First user-facing question before board creation:

- Comes from `domainFirstQuestions` in `src/lib/entry-domains.ts`.
- This is deterministic and domain-specific.

Board creation:

- Route: `src/app/api/boards/route.ts`
- Schema: `situationInputSchema`
- Repository: `createSituation()` aliased as `createBoard()`
- `description` is the user's first answer.
- `category` is the selected entry domain.
- `title` is inferred by `inferBoardTitle(category, description)` if no title is supplied.

Title risk:

- `inferBoardTitle()` has a few high-quality deterministic special cases, such as tennis/community.
- If no special case matches and the answer is long enough, it strips a few prefixes and clips the user's text to around 58 characters.
- That means the backend can still store a clipped raw user answer as title.
- `boardDisplayTitle()` in `src/components/board-detail-view.tsx` tries to guard against raw-looking H1 display, but the canonical stored title may still be raw-ish.

First AI follow-up:

- After board creation, `/api/boards` calls `generateFirstIntakePlan()`.
- The generated question is added as an assistant `intake_message`.
- If first question generation fails, the newly created board is deleted.

### Follow-up intake

Route:

- `src/app/api/boards/[id]/messages/route.ts`

Client submits:

- `content`
- `client_message_id`
- `client_generation_id`
- `retry_count`

Backend flow:

1. Requires user and OpenAI key.
2. Loads board.
3. Quota-gates lightweight assist unless it is the first free board flow.
4. Runs `safetyRouteFromText()` on the answer.
5. Adds the user intake message.
6. Infers outcome from the answer and updates a recent unresolved outcome record if applicable.
7. Loads profile and inferred memory.
8. Builds deterministic cognitive context with `allowWebSearch: false`.
9. Calls `generateInterviewQuestion()`.
10. Persists session state, assistant message, inferred context items, and urgency updates.

Intake completion:

- The model decides `is_complete` and `current_stage`.
- Prompt says ask 1-3 intake questions normally, more only when missing answers materially change safety or recommendation quality.
- There is no deterministic hard cap in the route.
- User can also click "I've given enough context / Recalculate" to generate early.

### Plan generation

Route:

- `src/app/api/boards/[id]/generate-plan/route.ts`

Inputs assembled:

- `situation`/board
- latest intake session
- full intake messages
- compact selected profile memory
- inferred context items
- open tasks
- recent check-ins
- recent plans for the same board
- cognitive state, intervention, memory selection, repeated-loop detection, historical effectiveness
- safety route decision
- web search decision

Plan generation modes:

- If `safetyRouteFromText()` returns `human_help_only`, route produces a deterministic `buildSafetyRoutedPlan()` without OpenAI.
- Otherwise it calls `generateNextMovePlan()`.

Stored output:

- `createNextMovePlan()` extracts structured fields into columns and stores the entire plan in `raw_json`.
- `rowToNextMovePlan()` later rehydrates the plan and calls `normalizeDecisionTree()`.

Task creation:

- After storing the plan, the route attempts `createTasksFromNextMovePlanWithTelemetry()`.
- Failures are swallowed and returned `taskConversion` can be null.

## 7. Move Map / decision-tree flow

Types and schemas:

- Type definitions: `DecisionTree`, `DecisionNode`, `DecisionOption`, `DecisionFirstAction` in `src/lib/types.ts`
- Zod schema: `decisionTreeSchema` and related schemas in `src/lib/schemas.ts`
- JSON schema for OpenAI: `decisionTreeJsonSchema()` and helpers in `src/lib/flowpath-ai.ts`

Storage:

- Stored in `next_move_plans.raw_json.decision_tree`
- Updated by `updateNextMovePlanDecisionTree()`

Normalization:

- File: `src/lib/decision-tree.ts`
- Entry point: `normalizeDecisionTree(plan)`
- Reads `plan.raw_json.decision_tree` or `plan.decision_tree`.
- If missing/invalid/no root options, uses `buildFallbackDecisionTree(plan)`.

Fallback:

- Special-cases tennis/community into four strategic branches:
  - Beginner clinic / recurring group
  - Hire a coach
  - Solo practice
  - Casual local games
- Generic fallback uses:
  - `highest_leverage_move_today`
  - `operator_insight.operator_path`
  - `operator_insight.naive_path`
  - `task_candidates`
  - `local_reality_scout`
- It tries to demote task-like options so sequential tasks are not root branches.

Rendering:

- Component: `src/components/decision-tree-map.tsx`
- Board detail host: `src/components/board-detail-view.tsx`
- The current implementation renders a recursive left-to-right tree:
  - root node at left
  - branch options to the right
  - selected branch can render a child node farther right
  - action leaves render inline inside the tree
  - sibling branches remain visible but subdued

Branch clicking:

- Local only.
- `selectTreeOption()` in `board-detail-view.tsx` updates `selectedPathOverride`.
- No backend call occurs on a simple branch click.
- Selection is local-only unless the user expands a branch.

Branch expansion:

- Explicit "Continue this path" calls `/api/boards/[id]/move-map/expand`.
- Expansion persists the updated tree into `raw_json`.

Recursive status:

- The UI supports recursive rendering.
- The persisted tree can contain child nodes.
- However, new child nodes are generated deterministically, not by the model.

Limitations:

- The helper only creates one child decision for root options and action leaves for non-root expansions.
- Child options are chosen by regex-like label matching.
- There is no prompt receiving the selected path, constraints, memory, or search results.
- There is no web search during expansion.
- Branch quality depends heavily on initial model output and deterministic fallback heuristics.

## 8. Branch expansion flow

Endpoint:

- `POST /api/boards/[id]/move-map/expand`
- File: `src/app/api/boards/[id]/move-map/expand/route.ts`

Input schema:

- `plan_id` optional
- `current_node_id`
- `selected_option_id`
- `selected_path`

Backend flow:

1. Requires user.
2. Loads board from `getSituation()`.
3. Loads specific or latest plan.
4. Validates that the node and option exist.
5. Calls `expandDecisionTreeAtOption()`.
6. Persists with `updateNextMovePlanDecisionTree()`.
7. Tries to write an outcome harness event.
8. Returns updated plan/tree and expanded node.

No model call:

- There is no branch-expansion prompt today.
- No OpenAI call is made.
- No web-search call is made.

Generated shape:

- If option already has `next_node_id`, selection is updated only.
- If expanding from the root, a child decision node is generated from helper templates.
- If expanding from a non-root decision, an action leaf is generated.

Persistence:

- The new node is attached by setting `option.next_node_id`.
- The updated tree replaces `raw_json.decision_tree`.

History:

- Outcome harness event attempts to record `move_map_branch_expanded` or `move_map_action_leaf_reached`.
- Because migrations may not include these event types/sources, telemetry can fail. This route catches and logs telemetry errors.

## 9. Web search flow

Implementation:

- Uses OpenAI Responses API built-in `web_search` tool.
- Code lives in `src/lib/flowpath-ai.ts`.
- `getOpenAIWebSearchTools()` creates a `web_search` tool.
- `getOpenAIWebSearchInclude()` includes `web_search_call.action.sources` when enabled.

Config:

- `OPENAI_WEB_SEARCH_ENABLED`
- `OPENAI_WEB_SEARCH_CONTEXT_SIZE`
- `APP_TIMEZONE`
- Tier gating: `canUseWebSearchForTier()` in `src/lib/billing/plans.ts`
- Paywall disabled means web search is tier-allowed.

Search decision:

- Deterministic `shouldUseWebSearch()` in `src/lib/cognitive-operating-layer.ts`.
- `generateNextMovePlan()` uses web search only if:
  - route option `allowWebSearch` is true
  - cognitive web-search decision says it should search
  - OpenAI web search is enabled
- It caps tool usage with `max_tool_calls: 3` for plan generation.

When search can run:

- Main next-move plan generation.
- Legacy daily plan function.

When search does not run:

- First intake question.
- Follow-up intake question.
- Board update route.
- Move Map branch expansion.
- Task revision.

Storage:

- No dedicated search results table.
- `generation_events` stores `web_search_used`, `web_search_call_count`, and `web_search_decision_reason`.
- The plan stores model-produced `local_reality_scout_json`.
- Decision branch sources can be stored inside `raw_json.decision_tree`.
- Sources are therefore embedded in model output rather than normalized.

Honesty gaps:

- `countWebSearchCalls()` can detect actual tool calls from the OpenAI response.
- The schema does not enforce that branch-level `search_status: "searched"` only appears when `webSearchCallCount > 0`.
- UI chips render branch-provided search status.
- A model could theoretically mark local branches as searched or include local options without actual tool calls unless additional validation catches it.

Terminology mismatch:

- `DecisionSearchStatus` uses `searched`, while user-facing chips render "Search used".
- Some user requests and prior product language use "used"; code schema uses "searched".

## 10. Memory flow

Memory sources:

- `profile` table
- `profile.context_constraints_json`
- `inferred_context_items`

Memory UI:

- `src/app/memory/page.tsx`
- `src/components/profile-editor.tsx`
- User-facing heading: "What FlowPath Knows"
- Shows one unified memory bank composed of:
  - inferred context items
  - context constraints
  - profile fields

Memory APIs:

- `GET /api/profile`
- `PUT /api/profile`
- `GET /api/memory/context-items`
- `POST /api/memory/context-items`
- `PATCH /api/memory/context-items/[id]`
- `DELETE /api/memory/context-items/[id]`
- `POST /api/memory/correction`

Creation/update paths:

- Intake model outputs `inferred_context_items`; route writes them with source `intake`.
- Plan model outputs `inferred_context_items`; route writes them with source `plan`.
- Board update route writes one "Board update" inferred context item with persistence `proposed_memory`.
- Task feedback route writes one "Task feedback" inferred context item if feedback has notes and task is board-linked.
- Memory correction route writes one "Memory correction" item with persistence `saved_memory` and source `manual`.
- UI "Keep" patches `persistence` to `saved_memory`.
- UI "This is wrong" and "Forget" both delete the row.

Read path:

- `listInferredContextItems()` returns items ordered by saved/proposed/session-like priority and updated time.
- `buildCognitivePlanContext()` uses `selectRelevantMemory()` to select up to 8 memories.
- `compactProfileForMemorySelection()` compresses profile fields down to selected memory.
- Selected memory is injected into intake and plan prompts as part of cognitive context.

Internal split:

- The user-facing memory bank is unified.
- Internally, `persistence` still splits `session_only`, `proposed_memory`, and `saved_memory`.
- `source` still splits `intake`, `plan`, and `manual`.
- Older profile fields remain separate and are folded into display.

Main quality risk:

- Corrections do not reconcile existing memory. A user saying "that is wrong" in the correction box creates a new saved memory card rather than updating or deleting the wrong one.
- Low-confidence inferred/proposed rows can continue to be selected if not deleted.

## 11. Task flow

Schema:

- Table: `tasks`
- Type: `Task` in `src/lib/types.ts`
- Input schema: `taskInputSchema` in `src/lib/schemas.ts`

Generation from plans:

- `createTasksFromNextMovePlan()` in `src/lib/repository.ts`
- Called by `createTasksFromNextMovePlanWithTelemetry()` in `src/lib/task-conversion.ts`
- Main plan route auto-calls task conversion after plan creation.
- `/api/next-move-plans/[id]/tasks` can also trigger conversion.

Task candidates:

- Model outputs up to 3 `task_candidates`.
- If candidates are missing, task conversion falls back to plan sections such as first 30 minutes, next 24 hours, and next 7 days.

Ranking:

- `src/lib/task-ranking.ts`
- `scoreTask()` weights:
  - importance
  - board urgency
  - deadlines
  - plan source section
  - explicit unblocker signals
  - stability/risk keywords
  - effort
  - friction
  - historical outcome context such as shorter-task preference and ignored plan IDs
- `rankTasks()` sorts by active status first, then score, then created time.

Board/branch linkage:

- Board link: `tasks.situation_id`
- Plan link: `tasks.source_next_move_plan_id`
- Plan section link: `tasks.source_plan_section`
- Branch task convention: `decision_branch:<optionId>` from `decisionBranchSourceSection()`.
- Suggested action endpoint can create/update a task for a branch by passing `branch_option_id`.

Task feedback:

- `/api/tasks/[id]/feedback` updates status via `recordTaskFeedback()`.
- If notes exist on a board-linked task, creates a proposed memory item.
- `couldnt_complete` also triggers task revision from `TasksManager`.

Task revision:

- `/api/tasks/[id]/revise`
- Calls `generateTaskRevision()`.
- Updates the same task row with revised title/notes/friction/importance/effort.

Board detail status:

- The Board detail page no longer shows a full task queue by default.
- The Move Map action leaf embeds "Mark done", "I'm blocked", "Change this", and "Open tasks".
- The new board/intake flow still renders `RelatedTasksCard` and `NextMovePlanCard`, so task/plan report UI remains outside board detail.

## 12. Recalculation/update flow

User-facing control:

- `src/components/board-detail-view.tsx`
- Compact "Tell FlowPath what changed" input above the Move Map.

Route:

- `POST /api/boards/[id]/board-update`
- File: `src/app/api/boards/[id]/board-update/route.ts`

Backend behavior:

1. Loads board and intake session.
2. Adds a user intake message with the update.
3. Creates one proposed-memory inferred context item labeled "Board update".
4. If the board still has a fallback title, tries to infer a better title from description plus update.
5. Marks intake session complete and ready to generate.
6. Returns without calling the model.

Frontend behavior:

- After `/board-update`, `BoardDetailView` calls `/generate-plan`.
- The plan route creates a new plan and new tree.

Preservation:

- Old plans remain in `next_move_plans`; latest plan is selected by created time.
- Existing tree is not incrementally edited by board-update.
- Branch selection local state can be discarded when a new plan is loaded.

Risks:

- Board update does not use a dedicated interpretation prompt.
- Corrections become raw memory rows and intake messages.
- Recalculation can overwrite the active user path by generating a new latest plan without a clear invalidation explanation.

## 13. Safety/urgent-stability flow

Safety router:

- File: `src/lib/safety-routing.ts`
- Function: `safetyRouteFromText()`
- Deterministic regex patterns for:
  - self-harm or suicide
  - imminent harm to others
  - medical emergency
  - abuse/domestic violence
  - housing or physical safety emergency
  - legal emergency
  - severe mental health crisis

Plan behavior:

- `human_help_only`
- `safety_boundary`
- `normal`

Human-help-only path:

- `/api/boards/[id]/generate-plan` calls `buildSafetyRoutedPlan()`.
- Produces deterministic plan without OpenAI.
- Model label: `deterministic-safety-router`.
- Web search decision reason: `blocked_by_policy`.

Intake behavior:

- `/api/boards/[id]/messages` computes safety route and logs it in generation events.
- It still calls `generateInterviewQuestion()` unless blocked by quota/error.
- The prompt instructs crisis triage and not asking "why" for self-harm-adjacent language.

Safety prompt support:

- `boardNextMoveInstruction`, `privacyAwareConstraintInstruction`, and `socialConnectionInstruction` all include high-stakes caution language.

Gaps:

- Router is regex-based and may miss phrasing outside patterns.
- `safety_boundary` cases still go through normal model generation.
- There is no separate model classifier for safety despite a `safety_classifier` model role.
- No evidence of live escalation resource lookup.
- Financial/legal/housing guidance boundaries are broad but not jurisdiction-aware unless web search is separately triggered in planning.

## 14. UI/component map

Routes:

- Home/Today: `src/app/page.tsx`, `src/components/today-dashboard.tsx`
- Boards list: `src/app/boards/page.tsx`, `src/components/boards-view.tsx`
- Board detail: `src/app/boards/[id]/page.tsx`, `src/components/board-detail-view.tsx`
- New board/intake: `src/app/next-move/page.tsx`, `src/components/next-move-flow.tsx`
- Tasks: `src/app/tasks/page.tsx`, `src/components/tasks-manager.tsx`
- Memory: `src/app/memory/page.tsx`, `src/components/profile-editor.tsx`
- History: `src/app/history/page.tsx`, `src/components/history-view.tsx`
- Billing: `src/app/billing/page.tsx`
- Debug: `src/app/debug/outcome-harness/page.tsx`

Move Map components:

- `src/components/decision-tree-map.tsx`
- `DecisionTreeMap`
- `DecisionNodeView`
- `BranchPath`
- `DiagramNode`
- `ExplorePath`
- `ActionLeaf`

Board detail architecture:

- `BoardDetailView` owns loading, update chat, More drawer, selected path override, branch task actions, and branch exploration.
- `BoardDetailsDrawer` contains Board Snapshot, Plan Details, Reasoning Details, Context Used, Move History, and Danger Zone.
- Main page has no bottom report stack, but the drawer still exposes plan internals.

Remaining old terminology:

- User-facing UI mostly says Boards.
- Internal component variables still use `situation` widely.
- Tests and prompts still contain "situations".
- Plan fields still say `situation_summary`, `situation_read`, `situation_id`.

Potential UI architecture friction:

- New-board flow still renders `NextMovePlanCard`, which is a report-style plan card separate from the Move Map board detail.
- Board detail is Move Map-first, but next-move onboarding can still expose a plan/report experience.
- Selected path is local-only until expansion, so a refresh can visually revert selection.

## 15. Client state management

Primary client state:

### `NextMoveFlow`

- `detail`
- `description`
- `category`
- `answer`
- `lastAnswerAttempt`
- `working`
- `generating`
- `converting`
- `activeGeneration`
- `taskConfirmation`
- `message`
- `error`
- `debugVisible`
- generation refs and abort controllers

Persisted vs local:

- Board, messages, plans, and tasks are persisted.
- Current form text and generation status are local.

### `BoardDetailView`

- `detail`
- `loading`
- `saving`
- `generating`
- `converting`
- `taskConfirmation`
- `deleting`
- `confirmingDelete`
- `message`
- `error`
- `boardUpdate`
- `updateFocused`
- `detailsOpen`
- `selectedPathOverride`
- `actioningBranch`
- `exploringNodeId`

Persisted vs local:

- Board data, messages, plans, tasks, and expanded tree nodes are persisted.
- `selectedPathOverride` is local unless the branch expansion endpoint rewrites the tree.

Drift risks:

- Clicking a branch changes local selection only. Refresh or reload can revert to `tree.selected_path`.
- If branch expansion succeeds, the persisted tree is updated, but if reload fails the UI may show old local state.
- Board update plus plan regeneration can replace the tree and discard local branch selection.
- Suggested action task state is derived from plan/branch ID and task rows; mismatches can occur if branch IDs change between plan generations.

## 16. Answer-quality and reliability evaluation

Tests found:

- `src/lib/decision-tree.test.ts`
- `src/lib/flowpath-ai.test.ts`
- `src/lib/board-detail-ui-contract.test.ts`
- `src/lib/cognitive-operating-layer.test.ts`
- `src/lib/situation-routing.test.ts`
- `src/lib/entry-domains.test.ts`
- `src/lib/safety-routing.test.ts`
- `src/lib/task-ranking.test.ts`
- `src/lib/model-routing.test.ts`
- `src/lib/repository.test.ts`
- `src/lib/outcome-harness-fixtures.test.ts`
- `src/lib/generation-observability.test.ts`
- additional auth/billing/privacy/client-api tests

What the tests cover well:

- Prompt fragments contain required phrases.
- Plan schema requires structured fields.
- Decision-tree fallback and expansion produce valid shapes.
- Branch source section is stable.
- Board detail source has no old visible selected/current-action section.
- Cognitive web search gating and state detection have deterministic tests.
- Safety regex router has tests.
- Task ranking has tests.

What is missing:

- No golden model-output fixtures for plan quality across Work/People/Craft boards.
- No branch-expansion LLM eval, because expansion is not LLM-backed.
- No test that search status is consistent with actual `web_search_call_count`.
- No eval for local-options hallucination.
- No rubric that scores specificity, branch distinction, step/action separation, memory correctness, or title quality.
- No trace viewer tying exact prompts, selected memory, search calls, model output, normalized tree, tasks, and final UI state together.
- No tests for memory correction reconciliation because it does not exist.

## 17. Known quality risks

1. Monolithic plan prompt
   - The plan prompt asks for a board snapshot, operator analysis, local search behavior, memory extraction, task candidates, recursive tree shape, safety boundaries, and concise action planning in one call.
   - This increases the chance of valid but mediocre structured output.

2. Legacy language inside prompts
   - The prompt stack still includes "situations", "projects", "tasks", "proposed_memory", and "saved_memory".
   - This can pull the model toward old admin/report concepts.

3. Branch expansion is deterministic
   - The UI is recursive, but the expansion content is generic helper output.
   - It cannot reason deeply about the board, memory, local context, or selected path.

4. Search honesty is not enforced enough
   - Web search can be counted at response level, but branch/source claims are model-authored.
   - There is no postprocessor that downgrades branch search status when no tool call happened.

5. Memory correction is append-only
   - User corrections can add more memory without removing stale memory.
   - Conflicting memories can be selected later.

6. Stored board title can still be raw-ish
   - Title inference can clip user text if no specific pattern matches.
   - UI has some display guardrails, but database title remains the source for many flows.

7. `raw_json` hides schema drift
   - Decision trees are stored only in `raw_json`.
   - Fallback normalization can mask malformed, stale, or missing tree data.

8. New event types do not match migration CHECK constraints
   - Current TypeScript event enums are ahead of migration 013.
   - This can cause telemetry insert failures and route failures where not caught.

9. Projects/life areas still influence task joins
   - Even if hidden from UI, task ranking/listing still carries old concepts.

10. No model-backed memory reconciler
   - Model roles include `memory_model`, but the app does not use a memory model to merge/update/delete.

11. No true branch-expansion prompt
   - The requested future product behavior needs a branch-expansion route that receives board state, selected path, memory, search context, and existing tree.

12. Safety is mixed between deterministic and prompt-based handling
   - Severe cases are deterministic, but boundary cases still rely on the main plan prompt.

## 18. Recommended next improvement passes

### Quick wins

1. Add a search-status postprocessor
   - Files: `src/lib/flowpath-ai.ts`, `src/lib/decision-tree.ts`, `src/app/api/boards/[id]/generate-plan/route.ts`
   - If `webSearchCallCount === 0`, downgrade branch `search_status: "searched"` to `needed` or `not_needed` based on `requires_web_search`.

2. Add a title-quality guard on write, not only display
   - Files: `src/lib/entry-domains.ts`, `src/lib/repository.ts`
   - Avoid storing clipped first-person intake answers as board titles.

3. Add a migration or compatibility adapter for outcome harness event enums
   - Files: `migrations/013_outcome_harness.sql`, new migration, `src/lib/outcome-harness.ts`
   - Resolve `situation_edited_before_answering` vs `board_edited_before_answering` and add move-map event/source support.

4. Add tests for search honesty and tree branch/step separation
   - Files: `src/lib/decision-tree.test.ts`, `src/lib/flowpath-ai.test.ts`
   - Use static fixtures, no live model calls.

5. Rename prompt language from situations/projects to boards/context where safe
   - File: `src/lib/flowpath-ai.ts`
   - Keep DB names internal but remove old product language from model instructions.

### Medium passes

6. Add a model-backed branch expansion route
   - Files: `src/app/api/boards/[id]/move-map/expand/route.ts`, `src/lib/flowpath-ai.ts`, `src/lib/schemas.ts`
   - Keep branch click local; make "Continue this path" call a branch-expansion prompt.
   - Input: board, snapshot, selected path, node, option, memory, search decision, existing tree.
   - Output: child decision node or action leaf.

7. Add memory reconciliation
   - Files: `src/app/api/memory/correction/route.ts`, `src/lib/flowpath-ai.ts`, `src/lib/repository.ts`
   - Interpret correction into create/update/delete/mark-stale operations.

8. Create a first-class Board repository adapter
   - Files: `src/lib/repository.ts`, `src/lib/types.ts`, API routes
   - Expose `Board` names at app boundaries while leaving `situations` as storage if migration is deferred.

9. Split the plan prompt
   - Files: `src/lib/flowpath-ai.ts`
   - Separate board snapshot, branch generation, action leaf, task extraction, memory extraction, and safety guidance.

10. Build a lightweight eval harness
   - Files: new `src/lib/evals/*` or `tests/evals/*`
   - Fixture boards: tennis/local, yoga/local, career/no-cold-apps, creative/professionalization-too-early, urgent-stability.
   - Score branch distinction, current/local honesty, memory use, title quality, and action concreteness.

### Deeper architecture work

11. Normalize Move Map persistence
   - Consider a `move_map_nodes`/`move_map_edges` table only after product behavior stabilizes.
   - For now, `raw_json` is acceptable but makes diffing, history, and branch-specific persistence harder.

12. Cleanly retire `projects` and `life_areas`
   - Requires task schema migration or compatibility view.
   - Until then, keep them hidden but avoid prompting the model with them unless there is real data.

## 19. Open questions

1. Should `situations` be fully renamed in the database, or should the next pass create a Board adapter and defer migration?
2. Should Move Map branch expansion be allowed to make live OpenAI calls by default, or should it require an explicit user action and usage/cost UI?
3. Should branch expansion use web search in the same call, or should search be a separate explicit "Find local/current options" step?
4. Should memory correction have destructive power by default, or should it propose changes for review?
5. Should the global Tasks page remain a first-class surface, or should tasks become mostly board/action-leaf artifacts with a cross-board summary?
6. Should `NextMovePlanCard` remain in the new-board flow, or should new-board completion route directly to the Board detail Move Map?
7. Should safety boundary cases use a separate safety model classifier, or is deterministic regex plus prompt caution enough for MVP?

## 20. Files inspected most heavily

- `src/lib/db.ts`
- `src/lib/env.ts`
- `src/lib/repository.ts`
- `src/lib/types.ts`
- `src/lib/schemas.ts`
- `src/lib/flowpath-ai.ts`
- `src/lib/model-routing.ts`
- `src/lib/cognitive-operating-layer.ts`
- `src/lib/decision-tree.ts`
- `src/lib/safety-routing.ts`
- `src/lib/entry-domains.ts`
- `src/lib/situation-routing.ts`
- `src/lib/intake.ts`
- `src/lib/task-ranking.ts`
- `src/lib/task-conversion.ts`
- `src/lib/outcome-harness.ts`
- `src/lib/generation-observability.ts`
- `src/lib/auth.ts`
- `src/lib/billing/plans.ts`
- `src/lib/billing/usage.ts`
- `src/app/api/boards/route.ts`
- `src/app/api/boards/[id]/route.ts`
- `src/app/api/boards/[id]/messages/route.ts`
- `src/app/api/boards/[id]/generate-plan/route.ts`
- `src/app/api/boards/[id]/board-update/route.ts`
- `src/app/api/boards/[id]/move-map/expand/route.ts`
- `src/app/api/memory/context-items/route.ts`
- `src/app/api/memory/context-items/[id]/route.ts`
- `src/app/api/memory/correction/route.ts`
- `src/app/api/tasks/route.ts`
- `src/app/api/tasks/[id]/route.ts`
- `src/app/api/tasks/[id]/feedback/route.ts`
- `src/app/api/tasks/[id]/revise/route.ts`
- `src/app/api/next-move-plans/route.ts`
- `src/app/api/next-move-plans/[id]/tasks/route.ts`
- `src/app/api/next-move-plans/[id]/suggested-action/route.ts`
- `src/app/api/next-move-plans/[id]/outcome/route.ts`
- `src/components/today-dashboard.tsx`
- `src/components/next-move-flow.tsx`
- `src/components/board-detail-view.tsx`
- `src/components/decision-tree-map.tsx`
- `src/components/profile-editor.tsx`
- `src/components/tasks-manager.tsx`
- `src/components/history-view.tsx`
- `src/lib/decision-tree.test.ts`
- `src/lib/flowpath-ai.test.ts`
- `src/lib/board-detail-ui-contract.test.ts`
- `src/lib/cognitive-operating-layer.test.ts`
- migrations `001` through `015`

## 21. What could not be determined from code alone

- The exact production database schema and whether it has been manually patched beyond migrations. I did not inspect production data or secrets.
- Actual model output quality on current prompts. I did not run live OpenAI calls.
- Actual web-search source quality. I did not run live web-search/model calls.
- Whether remote/local guest data contains stale rows. This audit did not inspect or modify runtime data.
- Whether there are deployment-specific env differences that change model routing, search enablement, or database location.


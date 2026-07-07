import OpenAI from "openai";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseUsage,
} from "openai/resources/responses/responses";
import { z } from "zod";

import {
  TASK_NOTES_MAX,
  TASK_TITLE_MAX,
  branchExpansionResultSchema,
  dailyPlanSchema,
  interviewerOutputSchema,
  nextMovePlanSchema,
  reconciliationResultSchema,
  type BranchExpansionResultInput,
  type ReconciliationResultInput,
} from "./schemas";
import {
  buildCognitiveMetadata,
  buildRevisionInstruction,
  evaluateNextMovePlan,
  normalizePlanForIntervention,
  type CognitivePlanContext,
} from "./cognitive-operating-layer";
import { sanitizeDecisionTreeSearchStatuses } from "./decision-tree";
import { DEFAULT_APP_TIMEZONE } from "./env";
import {
  countWebSearchCalls,
  webSearchDecisionReason,
} from "./generation-observability";
import {
  estimateModelCostDollars,
  getModelForRole,
  selectModelForGeneration,
  type GenerationModelSelection,
  type ModelRole,
  type StageUsage,
} from "./model-routing";
import {
  classifySituationDomain,
  FIRST_INTAKE_QUESTION_PURPOSES,
  type FirstIntakePlan,
} from "./situation-routing";
import {
  buildOperatorPlanInstruction,
  nextMovePlanPromptModules,
} from "./prompts/flowpath-plan-prompts";
import { entryDomainTitle, isEntryDomainId } from "./entry-domains";
import { TASK_FRICTION_TYPES } from "./types";
import type {
  CheckIn,
  DailyPlan,
  DecisionNode,
  DecisionOption,
  IntakeMessage,
  IntakeSession,
  InferredContextItem,
  LifeArea,
  NextMovePlan,
  Profile,
  Project,
  Situation,
  StoredNextMovePlan,
  StoredPlan,
  Task,
} from "./types";
import { todayIsoDate } from "./time";

export { DEFAULT_OPENAI_MODEL } from "./model-routing";
export { nextMovePlanPromptModules } from "./prompts/flowpath-plan-prompts";

export const DEFAULT_WEB_SEARCH_CONTEXT_SIZE = "medium";
export const DAILY_PLAN_MAX_OUTPUT_TOKENS = 8000;
export const FIRST_INTAKE_QUESTION_MAX_OUTPUT_TOKENS = 1200;
export const INTERVIEW_MAX_OUTPUT_TOKENS = 3000;
export const NEXT_MOVE_PLAN_MAX_OUTPUT_TOKENS = 10000;
export const BRANCH_EXPANSION_MAX_OUTPUT_TOKENS = 3500;
export const RECONCILIATION_MAX_OUTPUT_TOKENS = 3500;
export const TASK_REVISION_MAX_OUTPUT_TOKENS = 1600;

const webSearchContextSizes = ["low", "medium", "high"] as const;
type WebSearchContextSize = (typeof webSearchContextSizes)[number];

const selectiveWebSearchInstruction = `When web search is available, use it only when the plan depends on current, time-sensitive, or location-specific facts that may not be covered by model knowledge or stored FlowPath context. Search for things like local services, laws, rules, schedules, prices, availability, current organizations, current opportunities, current recommendations, or place-specific logistics. For social connection, prioritize repeatable social containers such as weekly classes, volunteering shifts, library groups, community centers, adult sports leagues, board game nights, writing groups, coworking events, mutual aid groups, community gardens, language exchanges, walking/running clubs, identity-aligned groups when the user indicates relevance, and dating events only when the user is seeking dating. Do not search for or suggest adult sexual services, sex-work marketplaces, pornography, illegal meetups, or unsafe/private sexual encounters. Do not search for timeless prioritization advice or facts already present in the user's profile, tasks, check-ins, board, memory, or transcript. For location-specific advice, use the most specific location available from context, such as city, region/state/province/county, country, and timezone. If local specificity matters and location is missing, ask for city/region/country or state the assumption instead of inventing local resources. Prefer official, primary, or established sources, and do not invent provider names, phone numbers, addresses, URLs, eligibility rules, deadlines, or availability.`;

const phaseOneInstruction = `For every plan, explain the basis for your recommendations from concrete FlowPath signals such as profile facts, tasks, check-ins, board state, memory, message history, or verified web-search findings. Decide whether today should be a push day or a restraint day. Notice friction patterns without shaming the user. Include local reality only when it is useful and verified or when the missing location should be requested. Keep legal, medical, financial, housing, addiction, mental health, crisis, and safety boundaries conservative. FlowPath supports planning; it is not a substitute for professional, emergency, legal, medical, or financial help.`;

const operatorLeverageInstruction = `For mentor insight, think like a successful domain insider advising someone they care about who lacks access, context, and hidden knowledge. Surface the field's unstated rules, gatekeepers, credibility signals, high-leverage sequencing, common traps, scams, and low-yield busywork. Identify the plausible naive outsider path that feels productive but is low-yield, the higher-leverage path an insider would recommend to prevent wasted motion, and the wasted motion to avoid. Ground this in the user's actual context and verified facts. Do not pretend the user has connections, credentials, insider access, or certainty they have not earned. Do not pretend to have secret access, credentials, or certainty; when stakes require domain experts, say so.`;

export const boardNextMoveInstruction = `FlowPath is a system-led next-move engine. Treat the user's board as: current position, primary domain, active secondary domains, constraints, assets, goals, assumptions, urgency, stability, recent changes, available moves, legal moves, best move, outcome, and recalculation. The three entry domains are Work/Money/Career, People/Community/Belonging, and Craft/Creativity/Personal Mastery. They are entry points, not rigid boxes. Preserve the user-selected primary domain unless the user explicitly changes it, and infer active secondary domains additively. If a Craft board mentions meeting people through tennis, primary remains Craft/Creativity/Personal Mastery and People/Community/Belonging becomes secondary. Do not put ordinary context keys such as goal, location, time, energy, preference, or other into active domains. Infer urgency and stability from the conversation instead of asking the user to manually choose them. Generate concise board titles from the selected domain plus intake context; do not use the raw first answer as a title unless it is already a short title. Do not force every user through career, founder, software, creative-professional, dating, or therapy framing. A legal move is an action actually available under the user's current constraints. If the larger goal is not reachable from the current board position, identify prerequisite moves and adjacent viable paths instead of crushing the goal or pretending success is guaranteed. Optimize for sustainable expected value under constraints: upside, downside risk, time to feedback, cash impact, reversibility, energy cost, emotional friction, skill leverage, network leverage, credibility or proof created, user-stated values, luck, gatekeepers, stability, future options, and meaning. Understand protect moves, progress moves, and meaning moves, but include only the move types that are relevant. Every completed initial board should produce a concise Board Snapshot and one best next move with why now, what it improves, relevant constraints, first action, success condition, and fallback if blocked. Corrections from the user should update the board globally: confirmed facts, stated preferences, inferred assumptions, constraints, assets, prior attempts, outcomes, and domain-specific goals. If the user reports imminent eviction, immediate danger, self-harm, domestic violence, urgent medical need, urgent legal deadlines, inability to meet basic needs, or acute safety risk, route into urgent stability: reduce immediate risk, encourage appropriate human or emergency/local support, and do not produce grand strategy.`;

export const privacyAwareConstraintInstruction = `FlowPath should collect constraints, not intimate facts. Ask for personal context only when it materially changes the recommendation. Prefer the least sensitive useful version of the question and explain why the constraint matters. When financial context matters, prefer practical ranges such as runway, cash-flow pressure, and urgent risks. Do not ask for exact net worth, exact bank balances, account numbers, card numbers, SSNs, tax IDs, bank logins, or passwords. When location matters, ask for the least precise location that helps: country, state/province, city/metro, or county/zip only when local resources or legal/social-service context matters. Do not ask for an exact address. When age matters, ask for an age range or life stage, not exact date of birth. If the user indicates they are under 18, use stronger safety language and avoid adult-oriented assumptions. When family or class background may matter, do not ask what the user's parents did for a living. Ask about the practical issue instead: support network, industry access, useful introductions, safe help, or whether the user is navigating mostly outside the system. For sensitive details, distinguish between using information only for this plan and saving a broad constraint to the user's profile. Do not imply sensitive information will be permanently remembered unless the user explicitly chooses to save it. If the user volunteers overly sensitive information, do not repeat it unnecessarily. Tell the user FlowPath does not need that level of detail and convert it to a safer generalized constraint. High-stakes domains require humility. FlowPath is not emergency help, therapy, legal advice, medical care, financial advice, or social services. In high-stakes cases, help the user clarify next steps and connect to appropriate human/professional support.`;

export const socialConnectionInstruction = `When the user's situation involves loneliness, isolation, friendship, community, dating, romance, collaborators, professional networking, local belonging, social confidence, or sexual connection, FlowPath should provide practical social reconnection guidance, not generic encouragement. Distinguish friendship/community, dating, professional networking, collaborators, local belonging, and general social confidence before choosing branches. If the user says friends, community, belonging, or not dating, do not route them into dating apps, romantic branches, partner-seeking tactics, or flirtation scripts. Distinguish social isolation from loneliness: social isolation is low contact or low participation, while loneliness is the felt gap between the connection the user has and the connection they want. Classify the situation into one or more patterns: connection deficit, depth deficit, transition isolation, avoidance loop, skill/confidence gap, environment problem, mistrust/safety problem, identity/belonging mismatch, romantic partner seeking, sexual partner seeking, dating app stuck, post-breakup rebuilding, remote-work isolation, or community reentry. Ask only constraint questions that materially change the next move, such as desired connection type, social energy this week, preferred setting, main barrier, existing safe contacts, repeated social contexts, location if local options matter, dating intention, consent/safety boundaries, and whether the user wants in-person, online, or either. Do not ask for explicit sexual details, sexual history, exact address, exact date of birth, or unnecessarily identifying information. Do not silently save sensitive romantic, sexual, identity, or loneliness details; prefer broad constraints and session-only handling unless the user explicitly chooses to save a broad preference. Avoid generic advice like "join a club," "put yourself out there," "be confident," "use dating apps," or "just talk to people." Identify the actual bottleneck and recommend one realistic human-facing next move, preferring repeatable, low-pressure contexts where the same people can see the user over time and where context makes conversation less forced. For dating and romantic/sexual partner-seeking, emphasize consent, boundaries, mutual interest, honesty, safety, non-entitlement, and realistic context selection. Do not encourage manipulation, coercion, deception, stalking, harassment, pressure, pickup-artist tactics, negging, jealousy games, social hacks, explicit sexual scripts, or entitlement to sex, romance, affection, attention, or a relationship. Never describe the user as broken, deficient, failing socially, low-value, or needing to optimize themselves as a product. If the user is under 18 or may be under 18, keep guidance age-appropriate and focused on safe peer connection, trusted adults, school/community contexts, and healthy boundaries; do not provide adult dating or sexual-partner-seeking guidance to minors. FlowPath should not become a substitute relationship; the success condition is more real-world human connection, not longer conversations with FlowPath. In the structured insight fields, make the naive path the obvious low-yield move, the higher-leverage path the realistic sequence that increases repeated contact, compatibility, safety, follow-up, or mutual interest, and wasted motion the fake planning, endless event browsing, waiting for confidence, over-relying on dating apps if they are not working, oversharing too early, chasing unavailable people, or ignoring consent/safety. If the user indicates suicidal thoughts, self-harm risk, severe emotional crisis, or needing immediate crisis support, first distinguish immediate danger today, near-term risk in the next few days, and distress without intent; do not ask why they want to hurt themselves. If they are in immediate danger, tell them to call 911 or their local emergency number now. If they may act soon or cannot stay safe, route them to human crisis support: in the U.S., call or text 988 or use 988 Lifeline chat at https://988lifeline.org/chat; outside the U.S., refer to local emergency numbers or local crisis services. If they say they are not planning to hurt themselves, continue into the real connection problem with care and practical next steps.`;

export const intakeInferredMemoryInstruction = `FlowPath should infer practical constraints from intake instead of asking the user to fill out a separate profile form. Ask only for constraints that materially change the recommendation. When a constraint is sensitive, prefer broad ranges and session-only use unless the user explicitly chooses to save it. After intake or plan generation, emit a small set of inferred_context_items that the app can show for review. Do not silently save sensitive details; use proposed_memory only as the internal enum for useful broad memories and session_only for high-sensitivity details. Convert each Next Move plan into at most three concrete task_candidates: one immediate next action, one follow-up, and one optional supporting action. Task candidates should be rankable globally across boards by leverage, urgency, deadline, effort, friction, and whether they unblock meaningful progress.`;

const systemPrompt = `You are FlowPath, a practical next-move strategist. Your job is to help the user read the board and identify the few actions that can improve their position across work, money, career, people, community, belonging, craft, creativity, mastery, and self-directed life goals. You are realistic but hopeful, direct but not cruel, strategic but not cold, emotionally aware but not therapy-coded, and specific without overwhelming the user. ${boardNextMoveInstruction} ${selectiveWebSearchInstruction} ${phaseOneInstruction} ${operatorLeverageInstruction} ${privacyAwareConstraintInstruction} ${socialConnectionInstruction} ${intakeInferredMemoryInstruction}`;

const interviewerSystemPrompt = `You are FlowPath's intake interviewer. Your job is to understand the user's board well enough to identify realistic available moves and the next best move. Ask one clear question at a time. Gather the current position, what the user is trying to figure out, what changed recently, constraints, assets, prior attempts, urgency, stability, avoided or uncertain parts, and what would make the next 30 days meaningfully better. Adapt by entry domain: work/money/career, people/community/belonging, or craft/creativity/personal mastery. Treat those domains as flexible starts and infer secondary domains. Before asking, review the full board context, profile, structured context constraints, and message history so you do not ask for facts the user already provided. If the next move depends on local, regional, or current real-world information and location is missing, ask for the least precise useful location exactly once. Never repeat location or sensitive questions once answered; move to constraints, assets, safety, or readiness. Do not dump the user into a blank chat and do not overwhelm them. Do not generate the complete board plan yet unless the user asks. If the board appears high-stakes, gather enough information to triage safely and recommend appropriate human help. If the user has self-harm-adjacent language, first distinguish immediate danger today, near-term risk in the next few days, and distress without intent. Do not ask why they want to hurt themselves. If they are in immediate danger or worried they may act soon, prioritize human crisis support, not being alone, and reducing immediate danger before ordinary planning. If they say they are not planning to hurt themselves, continue into the underlying problem with care and do not keep repeating crisis triage unless new risk appears. When there is enough context for a useful Board Snapshot and best next move, set current_stage to ready_to_generate and is_complete to true. In that complete state, do not ask whether the user wants a plan; put a short transition in question, such as "I have enough context to read the board and recommend a next move." Your tone is calm, direct, practical, and humane. ${boardNextMoveInstruction} ${privacyAwareConstraintInstruction} ${socialConnectionInstruction} ${intakeInferredMemoryInstruction}`;

export const firstIntakeQuestionSystemPrompt = `You are FlowPath's first intake question writer. The user has selected a primary board domain and typed the first answer, and your job is to ask the next question that makes the next move possible.

Write exactly one question. It must honor the selected primary domain and be specific to the submitted board position, not a generic coaching opener. Use the user's concrete nouns, verbs, places, roles, artifacts, constraints, or stated goal when helpful. If useful, include 3-5 plausible lanes the user may be choosing among, inferred from the board itself, so the user can answer quickly. If another domain appears, treat it as a possible secondary domain, not a replacement for the selected primary domain.

When the situation includes self-harm-adjacent language such as not wanting to be alive, wanting to die, self-harm, or inability to stay safe, ask a safety-status question first before ordinary intake. The question should distinguish immediate danger today, near-term risk in the next few days, and distress without intent. It should preserve the user's actual underlying problem when clear, but it must not ask why they want to hurt themselves or require them to explain shame before getting help.

Do not hardcode canned domains or assume the user is a founder, job seeker, developer, artist, dater, or any other archetype unless they say so. Do not pretend certainty. Do not invent facts, organizations, phone numbers, deadlines, or resources. Do not ask for secrets, exact financial balances, account numbers, exact addresses, passwords, tax IDs, or payment details. If the situation is high-stakes, ask the least sensitive safety or triage question needed and keep professional/emergency boundaries conservative.

Avoid questions like "What do you most want to change about this situation?" or "What would meaningful progress look like?" unless the user's wording is so vague that there is truly no better specific question. Prefer questions in the shape: "For [the user's situation], are you trying to clarify A, B, C, or D?"`;

export const operatorPlanInstruction = buildOperatorPlanInstruction();

const strategistSystemPrompt = `You are FlowPath, a guided next-move engine. Your job is to read the board and identify the user's next best move based on goals, constraints, assets, current reality, urgency, stability, risks, and meaning. You are not a chatbot, generic productivity coach, therapy, legal advice, medical care, financial advice, social services, or emergency help. You separate leverage from busyness and legal moves from fantasy moves. You do not overwhelm the user. You give realistic, actionable guidance. You are allowed to be direct without being harsh. You are careful around legal, medical, housing, addiction, mental health, financial, and safety issues, and you clearly recommend appropriate human or professional help when needed. ${boardNextMoveInstruction} ${operatorPlanInstruction} ${selectiveWebSearchInstruction} ${phaseOneInstruction} ${operatorLeverageInstruction} ${privacyAwareConstraintInstruction} ${socialConnectionInstruction} ${intakeInferredMemoryInstruction} Your output should help the user act in the real world today.`;

const taskRevisionSystemPrompt = `You are FlowPath's task revision engine. Revise exactly one task based on the user's typed or dictated instruction. Preserve the user's actual goal and the task's connection to the board. Do not create multiple tasks, do not write a board plan, and do not add generic coaching prose. Make the task more concrete, more doable, or better aligned with the user's blocker. If the user says they could not complete it, reduce friction, name the blocker in friction_note, and turn the task into the smallest useful next attempt. Use practical language the user can act on today. Keep the task title short. Keep notes concise but specific. Do not invent facts, deadlines, people, URLs, or external resources. Do not ask for secrets, exact financial balances, passwords, account numbers, exact addresses, tax IDs, or payment details. FlowPath is planning support only, not legal, medical, financial, emergency, or crisis help.`;

export const branchExpansionSystemPrompt = `You are expanding one selected branch in FlowPath's Move Map. You are not writing a complete board plan. You are deciding what should appear next in the tree.

The selected branch is now the current context. Generate either the next decision node with meaningfully distinct options, or a concrete action leaf if the path is ready for execution.

Rules:
- Return only the structured output.
- Optimize for sustainable expected value under the user's constraints: upside, downside risk, time to feedback, cash/time/energy cost, access, local reality, proof, network, stability, meaning, and future options.
- Do not be generic, cruel, therapy-coded, or motivational filler.
- Do not over-encourage unrealistic paths. If the goal is not reachable from this board state, create prerequisite or adjacent viable branches.
- ${nextMovePlanPromptModules.branchQualityInstruction}
- ${nextMovePlanPromptModules.actionLeafInstruction}
- A decision node should usually contain 2-5 options. Use fewer only when fewer are real; hard maximum is 6. Do not force exactly three options.
- If the next thing is obvious enough to act on, return an action_leaf instead of another fork.
- ${nextMovePlanPromptModules.searchHonestyInstruction}
- If search results are provided, use them conservatively and do not dump a search report into the node.
- Preserve the user-selected primary board domain; secondary domains are additive context, not replacements.
- For People/Community/Belonging branches, distinguish friendship/community, dating, professional networking, collaborators, and local belonging; if the selected path is explicitly not dating, do not introduce dating as a branch.
- ${nextMovePlanPromptModules.toneAndRealismInstruction}
- Keep node text compact. Details can go in reasoning_summary, not in branch labels.`;

export const reconciliationSystemPrompt = `You are FlowPath's memory and board reconciliation engine. You are not writing a complete board plan, not generating a Move Map, and not giving generic advice. You are interpreting one user correction/update and reconciling it against existing memory and board state.

Return only the structured output.

Rules:
- Do not merely append a new memory when an existing memory should be updated, merged, marked stale, or forgotten.
- Treat direct user corrections as authoritative unless they are unsafe, ambiguous, or unsupported by the provided context.
- Prefer update_memory or mark_stale over creating contradictory memories.
- Use create_memory only for useful new context that is stable enough to help future FlowPath answers.
- Do not save random trivia, one-off emotions, exact private account details, secrets, passwords, exact addresses, tax IDs, or payment information.
- Do not infer sensitive attributes unless the user clearly states them.
- Use low/moderate/high sensitivity. Use session_only or proposed_memory for uncertain or sensitive context; saved_memory only for high-confidence broad facts/preferences/constraints.
- Delete/forget memory only when the user explicitly asks to forget/delete/remove it, or when an existing memory is clearly contradicted by a direct user correction with high confidence. Otherwise mark it stale.
- If the update is ambiguous, set requires_user_confirmation true and ask one concise follow-up_question.
- Distinguish stable facts, current preferences, temporary constraints, board-specific context, global user memory, assumptions, stale/outdated information, and outcomes.
- For board updates, identify what changed, whether goals/constraints/assets/assumptions/urgency changed, whether the selected Move Map path is still valid, and whether recalculation is needed.
- Preserve the existing Move Map when the update does not materially invalidate the selected path.
- If the selected path is invalidated, explain why briefly in move_map_effect.reason.
- Use user-facing Board language in summaries and explanations. Do not expose implementation terms, legacy storage names, memory enum names, or reasoning internals in user_visible_explanation.
- Always set recommended_followup_action. If no action is needed, say "No action needed:" and give the concrete reason. If action is useful, make it an executable next step with a verb, object, scope, success condition, and if-blocked fallback when relevant. For board updates that invalidate a path, say whether to preserve, recalculate, or continue with the new constraint. For memory corrections, say how future FlowPath moves should change and give an optional concrete next step only when it helps.`;

export type BranchExpansionGenerationContext = {
  date: string;
  board: Pick<Situation, "id" | "title" | "description" | "category" | "status" | "urgency">;
  plan: {
    id: number;
    situation_read: string;
    situation_summary: string;
    key_constraints: string[];
    highest_leverage_move_today: NextMovePlan["highest_leverage_move_today"];
    operator_insight: NextMovePlan["operator_insight"];
    likely_trap: string;
    local_reality_scout: NextMovePlan["local_reality_scout"];
    assumptions: string[];
  };
  current_node: DecisionNode;
  selected_option: DecisionOption;
  selected_path: string[];
  selected_path_labels: string[];
  decision_tree_summary: {
    root_node_id: string;
    active_node_id: string;
    recommended_option_id: string;
    node_count: number;
    existing_branch_labels: string[];
  };
  intake_summary: {
    session_summary: string;
    recent_messages: Array<Pick<IntakeMessage, "role" | "content">>;
  };
  relevant_memory: unknown[];
  open_tasks: Array<Pick<Task, "title" | "status" | "source_plan_section">>;
  cognitive_operating_layer: {
    state_detection: CognitivePlanContext["stateDetection"];
    intervention: CognitivePlanContext["intervention"];
    selected_memory: CognitivePlanContext["memorySelection"];
    web_search_decision: CognitivePlanContext["webSearchDecision"];
  } | null;
  search_context: {
    allow_web_search: boolean;
    search_decision_reason: ReturnType<typeof webSearchDecisionReason>;
    actual_search_results_provided: boolean;
  };
};

export type ReconciliationGenerationContext = {
  date: string;
  source: "memory_correction" | "board_update" | "task_feedback" | "branch_outcome";
  user_update: string;
  board: Pick<Situation, "id" | "title" | "description" | "category" | "status" | "urgency"> | null;
  latest_plan: {
    id: number;
    situation_read: string;
    situation_summary: string;
    key_constraints: string[];
    highest_leverage_move_title: string;
    likely_trap: string;
    assumptions: string[];
  } | null;
  move_map: {
    selected_path: string[];
    selected_path_labels: string[];
    active_node_id: string;
    recommended_option_id: string;
  } | null;
  existing_memory: Array<
    Pick<
      InferredContextItem,
      | "id"
      | "label"
      | "value"
      | "category"
      | "sensitivity"
      | "persistence"
      | "source"
      | "status"
      | "confidence"
      | "situation_id"
      | "updated_at"
    >
  >;
  intake_summary: {
    session_summary: string;
    recent_messages: Array<Pick<IntakeMessage, "role" | "content">>;
  };
  task_or_action_history: Array<Pick<Task, "title" | "status" | "source_plan_section">>;
};

export function isModelBackedBranchExpansionEnabled() {
  const value = process.env.FLOWPATH_MODEL_BACKED_BRANCH_EXPANSION?.trim().toLowerCase();
  if (value) return ["1", "true", "yes", "on"].includes(value);
  return process.env.NODE_ENV !== "production" && Boolean(process.env.OPENAI_API_KEY);
}

export function isOpenAIWebSearchEnabled() {
  const value = process.env.OPENAI_WEB_SEARCH_ENABLED?.trim().toLowerCase();
  if (!value) return true;
  return !["0", "false", "no", "off"].includes(value);
}

export function getOpenAIWebSearchContextSize(): WebSearchContextSize {
  const value = process.env.OPENAI_WEB_SEARCH_CONTEXT_SIZE?.trim().toLowerCase();
  if (webSearchContextSizes.includes(value as WebSearchContextSize)) {
    return value as WebSearchContextSize;
  }
  return DEFAULT_WEB_SEARCH_CONTEXT_SIZE;
}

function getOpenAIWebSearchTools({
  allowWebSearch = true,
}: {
  allowWebSearch?: boolean;
} = {}): ResponseCreateParamsNonStreaming["tools"] | undefined {
  if (!allowWebSearch) return undefined;
  if (!isOpenAIWebSearchEnabled()) return undefined;

  return [
    {
      type: "web_search",
      search_context_size: getOpenAIWebSearchContextSize(),
      user_location: {
        type: "approximate",
        timezone: process.env.APP_TIMEZONE || DEFAULT_APP_TIMEZONE,
      },
    },
  ];
}

function getOpenAIWebSearchInclude({
  allowWebSearch = true,
}: {
  allowWebSearch?: boolean;
} = {}): ResponseCreateParamsNonStreaming["include"] | undefined {
  if (!allowWebSearch) return undefined;
  return isOpenAIWebSearchEnabled() ? ["web_search_call.action.sources"] : undefined;
}

function recommendationBasisJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["signal", "source", "implication"],
    properties: {
      signal: { type: "string" },
      source: { type: "string" },
      implication: { type: "string" },
    },
  };
}

function restraintGuidanceJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "should_push",
      "reason",
      "minimum_viable_move",
      "recovery_move",
      "scope_boundary",
    ],
    properties: {
      should_push: { type: "boolean" },
      reason: { type: "string" },
      minimum_viable_move: { type: "string" },
      recovery_move: { type: "string" },
      scope_boundary: { type: "string" },
    },
  };
}

function operatorInsightJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["naive_path", "operator_path", "wasted_motion_to_avoid"],
    properties: {
      naive_path: { type: "string" },
      operator_path: { type: "string" },
      wasted_motion_to_avoid: { type: "string" },
    },
  };
}

function localRealityScoutJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "used_web_search",
      "location_basis",
      "findings",
      "missing_location_question",
    ],
    properties: {
      used_web_search: { type: "boolean" },
      location_basis: { type: "string" },
      findings: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "why_it_matters", "source", "url_or_next_search"],
          properties: {
            title: { type: "string" },
            why_it_matters: { type: "string" },
            source: { type: "string" },
            url_or_next_search: { type: "string" },
          },
        },
      },
      missing_location_question: { type: "string" },
    },
  };
}

function safetyBoundaryJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "risk_level",
      "professional_help_signal",
      "do_not_rely_on_ai_for",
      "urgent_support_guidance",
    ],
    properties: {
      risk_level: {
        type: "string",
        enum: ["low", "medium", "high", "crisis"],
      },
      professional_help_signal: { type: "string" },
      do_not_rely_on_ai_for: { type: "string" },
      urgent_support_guidance: { type: "string" },
    },
  };
}

function inferredContextItemJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "label",
      "value",
      "category",
      "sensitivity",
      "persistence",
      "source",
    ],
    properties: {
      label: { type: "string" },
      value: { type: "string" },
      category: {
        type: "string",
        enum: [
          "money",
          "location",
          "time",
          "energy",
          "education_credentials",
          "access_connections",
          "support_network",
          "family_caregiving",
          "transportation",
          "deadline",
          "safety_risk",
          "age_life_stage",
          "connection_dating",
          "work_career",
          "health_recovery",
          "creative_personal_project",
          "working_style",
          "other",
        ],
      },
      sensitivity: { type: "string", enum: ["low", "moderate", "high"] },
      persistence: {
        type: "string",
        enum: ["session_only", "proposed_memory", "saved_memory"],
      },
      source: { type: "string", enum: ["intake", "plan", "manual"] },
    },
  };
}

function contextUsedItemJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "label",
      "value",
      "category",
      "sensitivity",
      "source",
      "persistence",
    ],
    properties: {
      id: { type: ["integer", "null"] },
      label: { type: "string" },
      value: { type: "string" },
      category: {
        type: "string",
        enum: [
          "location",
          "money",
          "time",
          "energy",
          "career",
          "education_credentials",
          "access_connections",
          "support_network",
          "relationship_social",
          "housing",
          "safety",
          "preference",
          "goal",
          "other",
        ],
      },
      sensitivity: { type: "string", enum: ["low", "moderate", "high"] },
      source: {
        type: "string",
        enum: ["saved_memory", "session_intake", "situation", "inferred", "manual"],
      },
      persistence: {
        type: "string",
        enum: ["session_only", "proposed_memory", "saved_memory"],
      },
    },
  };
}

function taskCandidateJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "details",
      "description",
      "estimated_minutes",
      "friction_level",
      "leverage",
      "why_now",
      "success_condition",
      "category",
      "source_message_id",
      "candidate_type",
      "importance",
      "effort",
      "friction_type",
      "rank_reason",
      "due_date",
    ],
    properties: {
      title: { type: "string" },
      details: { type: "string" },
      description: { type: "string" },
      estimated_minutes: { type: "integer", minimum: 1, maximum: 480 },
      friction_level: { type: "string", enum: ["low", "medium", "high"] },
      leverage: { type: "string", enum: ["low", "medium", "high"] },
      why_now: { type: "string" },
      success_condition: { type: "string" },
      category: { type: "string" },
      source_message_id: { type: ["string", "null"] },
      candidate_type: {
        type: "string",
        enum: ["immediate_next_action", "follow_up", "supporting"],
      },
      importance: { type: "integer", minimum: 1, maximum: 5 },
      effort: { type: "integer", minimum: 1, maximum: 5 },
      friction_type: {
        type: "string",
        enum: [
          "none",
          "unclear",
          "too_large",
          "scary",
          "blocked",
          "low_energy",
          "needs_person",
          "not_important",
          "admin_drag",
        ],
      },
      rank_reason: { type: "string" },
      due_date: { type: ["string", "null"] },
    },
  };
}

const taskRevisionOutputSchema = z.object({
  title: z.string().trim().min(1).max(TASK_TITLE_MAX),
  notes: z.string().trim().min(1).max(TASK_NOTES_MAX),
  importance: z.number().int().min(1).max(5),
  effort: z.number().int().min(1).max(5),
  friction_type: z.enum(TASK_FRICTION_TYPES),
  friction_note: z.string().trim().max(1200),
  estimated_minutes: z.number().int().min(1).max(480).nullable(),
  due_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

function taskRevisionJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "notes",
      "importance",
      "effort",
      "friction_type",
      "friction_note",
      "estimated_minutes",
      "due_date",
    ],
    properties: {
      title: { type: "string" },
      notes: { type: "string" },
      importance: { type: "integer", minimum: 1, maximum: 5 },
      effort: { type: "integer", minimum: 1, maximum: 5 },
      friction_type: {
        type: "string",
        enum: [...TASK_FRICTION_TYPES],
      },
      friction_note: { type: "string" },
      estimated_minutes: { type: ["integer", "null"], minimum: 1, maximum: 480 },
      due_date: { type: ["string", "null"] },
    },
  };
}

const dailyPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "today_theme",
    "honest_read",
    "top_3_actions",
    "recommendation_basis",
    "restraint_guidance",
    "operator_insight",
    "friction_pattern",
    "local_reality_scout",
    "human_help_boundary",
    "avoid_today",
    "optional_if_energy_is_high",
    "minimum_viable_day",
    "evening_review_prompt",
  ],
  properties: {
    today_theme: { type: "string" },
    honest_read: { type: "string" },
    top_3_actions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "area",
          "why_it_matters",
          "estimated_minutes",
          "success_condition",
          "first_step",
        ],
        properties: {
          title: { type: "string" },
          area: { type: "string" },
          why_it_matters: { type: "string" },
          estimated_minutes: { type: "integer", minimum: 1, maximum: 480 },
          success_condition: { type: "string" },
          first_step: { type: "string" },
        },
      },
    },
    recommendation_basis: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: recommendationBasisJsonSchema(),
    },
    restraint_guidance: restraintGuidanceJsonSchema(),
    operator_insight: operatorInsightJsonSchema(),
    friction_pattern: { type: "string" },
    local_reality_scout: localRealityScoutJsonSchema(),
    human_help_boundary: { type: "string" },
    avoid_today: { type: "string" },
    optional_if_energy_is_high: { type: "string" },
    minimum_viable_day: { type: "string" },
    evening_review_prompt: { type: "string" },
  },
};

export type FlowPathContext = {
  profile: Profile;
  lifeAreas: LifeArea[];
  activeProjects: Project[];
  unfinishedTasks: Task[];
  recentCheckIns: CheckIn[];
  recentPlans: StoredPlan[];
  activeSituations?: Situation[];
  recentNextMovePlans?: StoredNextMovePlan[];
  recentIntakeSessions?: IntakeSession[];
  todayCheckIn: CheckIn | null;
};

export type InterviewerContext = {
  profile: Profile;
  situation: Situation;
  session: IntakeSession;
  messages: IntakeMessage[];
};

export type StrategistContext = {
  profile: Profile;
  situation: Situation;
  session: IntakeSession | null;
  messages: IntakeMessage[];
  openTasks: Task[];
  recentCheckIns: CheckIn[];
  recentPlans: StoredNextMovePlan[];
};

export type AiUsageMetadata = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostCents?: number;
  estimatedCostUsd?: number | null;
};

function responseUsageMetadata(usage: ResponseUsage | undefined): AiUsageMetadata {
  const inputTokens = usage?.input_tokens;
  const outputTokens = usage?.output_tokens;
  const cachedInputTokens = Number(
    (usage as { input_tokens_details?: { cached_tokens?: unknown } } | undefined)
      ?.input_tokens_details?.cached_tokens,
  );
  return {
    inputTokens,
    cachedInputTokens: Number.isFinite(cachedInputTokens)
      ? cachedInputTokens
      : undefined,
    outputTokens,
    totalTokens: usage?.total_tokens ?? ((inputTokens ?? 0) + (outputTokens ?? 0) || undefined),
  };
}

function combineUsage(...items: AiUsageMetadata[]): AiUsageMetadata {
  const estimatedCostUsd = items.some((item) => item.estimatedCostUsd != null)
    ? items.reduce((total, item) => total + (item.estimatedCostUsd ?? 0), 0)
    : undefined;
  return {
    inputTokens: items.reduce((total, item) => total + (item.inputTokens ?? 0), 0),
    cachedInputTokens: items.reduce(
      (total, item) => total + (item.cachedInputTokens ?? 0),
      0,
    ),
    outputTokens: items.reduce((total, item) => total + (item.outputTokens ?? 0), 0),
    totalTokens: items.reduce((total, item) => total + (item.totalTokens ?? 0), 0),
    estimatedCostCents: items.some((item) => item.estimatedCostCents != null)
      ? items.reduce((total, item) => total + (item.estimatedCostCents ?? 0), 0)
      : undefined,
    estimatedCostUsd,
  };
}

function extractOutputText(response: unknown) {
  if (
    response &&
    typeof response === "object" &&
    "output_text" in response &&
    typeof response.output_text === "string"
  ) {
    return response.output_text;
  }

  const output = (response as { output?: unknown[] })?.output;
  if (!Array.isArray(output)) return "";

  return output
    .flatMap((item) => {
      const content = (item as { content?: unknown[] })?.content;
      if (!Array.isArray(content)) return [];
      return content
        .map((part) => {
          if (
            part &&
            typeof part === "object" &&
            "text" in part &&
            typeof part.text === "string"
          ) {
            return part.text;
          }
          return "";
        })
        .filter(Boolean);
    })
    .join("\n");
}

function responseUsedWebSearch(response: unknown) {
  return countWebSearchCalls(response) > 0;
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimGeneratedString(value: unknown, maxLength: number) {
  if (typeof value !== "string" || value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function trimGeneratedStringArray(value: unknown, maxLength: number) {
  if (!Array.isArray(value)) return value;
  return value.map((item) => trimGeneratedString(item, maxLength));
}

function trimGeneratedRecordStrings<T extends JsonRecord>(
  value: T,
  limits: Partial<Record<keyof T, number>>,
) {
  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => [
      key,
      key in limits
        ? trimGeneratedString(fieldValue, limits[key as keyof T] ?? 0)
        : fieldValue,
    ]),
  );
}

function trimRecommendationBasis(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((item) =>
    isJsonRecord(item)
      ? trimGeneratedRecordStrings(item, {
          signal: 500,
          source: 120,
          implication: 800,
        })
      : item,
  );
}

function trimRestraintGuidance(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return trimGeneratedRecordStrings(value, {
    reason: 900,
    minimum_viable_move: 900,
    recovery_move: 900,
    scope_boundary: 900,
  });
}

function trimOperatorInsight(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return trimGeneratedRecordStrings(value, {
    naive_path: 1000,
    operator_path: 1200,
    wasted_motion_to_avoid: 1000,
  });
}

function trimLocalRealityScout(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return {
    ...value,
    location_basis: trimGeneratedString(value.location_basis, 240),
    missing_location_question: trimGeneratedString(value.missing_location_question, 500),
    findings: Array.isArray(value.findings)
      ? value.findings.map((finding) =>
          isJsonRecord(finding)
            ? trimGeneratedRecordStrings(finding, {
                title: 180,
                why_it_matters: 1000,
                source: 240,
                url_or_next_search: 500,
              })
            : finding,
        )
      : value.findings,
  };
}

function trimSafetyBoundary(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return trimGeneratedRecordStrings(value, {
    professional_help_signal: 1200,
    do_not_rely_on_ai_for: 1200,
    urgent_support_guidance: 1200,
  });
}

function trimDailyPlanOutput(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return {
    ...trimGeneratedRecordStrings(value, {
      today_theme: 220,
      honest_read: 1800,
      friction_pattern: 1400,
      human_help_boundary: 1600,
      avoid_today: 1200,
      optional_if_energy_is_high: 1200,
      minimum_viable_day: 1200,
      evening_review_prompt: 1200,
    }),
    top_3_actions: Array.isArray(value.top_3_actions)
      ? value.top_3_actions.map((action) =>
          isJsonRecord(action)
            ? trimGeneratedRecordStrings(action, {
                title: 160,
                area: 120,
                why_it_matters: 1000,
                success_condition: 1000,
                first_step: 1000,
              })
            : action,
        )
      : value.top_3_actions,
    recommendation_basis: trimRecommendationBasis(value.recommendation_basis),
    restraint_guidance: trimRestraintGuidance(value.restraint_guidance),
    operator_insight: trimOperatorInsight(value.operator_insight),
    local_reality_scout: trimLocalRealityScout(value.local_reality_scout),
  };
}

function trimNextMoveStep(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return trimGeneratedRecordStrings(value, {
    title: 180,
    details: 3000,
  });
}

function trimNextMoveSteps(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map(trimNextMoveStep);
}

function trimNextMoveResources(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((resource) =>
    isJsonRecord(resource)
      ? trimGeneratedRecordStrings(resource, {
          name: 180,
          why: 1200,
          contact_or_url: 500,
        })
      : resource,
  );
}

function trimInferredContextItems(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((item) =>
    isJsonRecord(item)
      ? trimGeneratedRecordStrings(item, {
          label: 160,
          value: 1000,
        })
      : item,
  );
}

function trimTaskCandidates(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((candidate) =>
    isJsonRecord(candidate)
            ? trimGeneratedRecordStrings(candidate, {
                title: 180,
                details: 2000,
                description: 2000,
                why_now: 900,
                success_condition: 900,
                category: 120,
                source_message_id: 120,
                rank_reason: 900,
              })
            : candidate,
  );
}

function trimContextUsedItems(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((item) =>
    isJsonRecord(item)
      ? trimGeneratedRecordStrings(item, {
          label: 160,
          value: 1000,
        })
      : item,
  );
}

function trimDecisionAction(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return trimGeneratedRecordStrings(value, {
    title: 180,
    details: 2000,
    success_condition: 1000,
    fallback: 1000,
  });
}

function trimDecisionSources(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((source) =>
    isJsonRecord(source)
      ? trimGeneratedRecordStrings(source, {
          title: 180,
          why_it_matters: 1000,
          source: 500,
          url_or_next_search: 500,
        })
      : source,
  );
}

function trimDecisionOptions(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((option) =>
    isJsonRecord(option)
      ? {
          ...trimGeneratedRecordStrings(option, {
            id: 120,
            node_id: 120,
            label: 120,
            description: 1000,
            why: 1200,
            upside: 900,
            downside: 900,
            time_to_feedback: 160,
            success_condition: 1000,
            fallback: 1000,
          }),
          next_node_id:
            typeof option.next_node_id === "string"
              ? trimGeneratedString(option.next_node_id, 120)
              : option.next_node_id,
          first_action: trimDecisionAction(option.first_action),
          next_steps: trimNextMoveSteps(option.next_steps),
          sources: trimDecisionSources(option.sources),
        }
      : option,
  );
}

function fallbackDecisionNodeQuestion(node: JsonRecord) {
  const rawTitle = typeof node.title === "string" ? node.title.trim() : "";
  const title = rawTitle || "this path";
  if (node.kind === "action") return `Take the next action for ${title}.`;
  if (node.kind === "outcome") return `What happened after ${title}?`;
  return `What should happen next for ${title}?`;
}

function trimDecisionTree(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return {
    ...trimGeneratedRecordStrings(value, {
      id: 120,
      root_node_id: 120,
      active_node_id: 120,
      recommended_option_id: 120,
      created_at: 80,
      updated_at: 80,
    }),
    selected_path: trimGeneratedStringArray(value.selected_path, 120),
    current_action: trimDecisionAction(value.current_action),
    nodes: Array.isArray(value.nodes)
      ? value.nodes.map((node) =>
          isJsonRecord(node)
            ? (() => {
                const trimmedNode = trimGeneratedRecordStrings(node, {
                  id: 120,
                  title: 180,
                  question: 500,
                  context_summary: 1200,
                });
                const question =
                  typeof trimmedNode.question === "string" &&
                  trimmedNode.question.trim()
                    ? trimmedNode.question
                    : fallbackDecisionNodeQuestion(trimmedNode);
                return {
                  ...trimmedNode,
                  question,
                parent_id:
                  typeof node.parent_id === "string"
                    ? trimGeneratedString(node.parent_id, 120)
                    : node.parent_id,
                selected_from_option_id:
                  typeof node.selected_from_option_id === "string"
                    ? trimGeneratedString(node.selected_from_option_id, 120)
                    : node.selected_from_option_id,
                selected_option_id:
                  typeof node.selected_option_id === "string"
                    ? trimGeneratedString(node.selected_option_id, 120)
                    : node.selected_option_id,
                generated_at:
                  typeof node.generated_at === "string"
                    ? trimGeneratedString(node.generated_at, 80)
                    : node.generated_at,
                action: trimDecisionAction(node.action),
                options: trimDecisionOptions(node.options),
                };
              })()
            : node,
        )
      : value.nodes,
  };
}

function trimBranchExpansionOutput(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return {
    ...trimGeneratedRecordStrings(value, {
      reasoning_summary: 1200,
      selected_path_summary: 1000,
    }),
    memory_used: trimGeneratedStringArray(value.memory_used, 240),
    assumptions: trimGeneratedStringArray(value.assumptions, 500),
    node: isJsonRecord(value.node)
      ? {
          ...trimGeneratedRecordStrings(value.node, {
            id: 120,
            title: 180,
            question: 500,
            summary: 1200,
          }),
          options: Array.isArray(value.node.options)
            ? value.node.options.map((option) =>
                isJsonRecord(option)
                  ? trimGeneratedRecordStrings(option, {
                      id: 120,
                      label: 120,
                      short_rationale: 600,
                      time_to_feedback: 160,
                      first_action_preview: 500,
                    })
                  : option,
              )
            : value.node.options,
        }
      : value.node,
    action_leaf: isJsonRecord(value.action_leaf)
      ? trimGeneratedRecordStrings(value.action_leaf, {
          id: 120,
          title: 180,
          first_action: 1000,
          first_10_minutes: 1000,
          success_condition: 1000,
          if_blocked: 1000,
        })
      : value.action_leaf,
  };
}

function trimReconciliationOperation(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return {
    ...trimGeneratedRecordStrings(value, {
      memory_id: 80,
      label: 160,
      value: 1000,
      reason: 1000,
    }),
    memory_ids: trimGeneratedStringArray(value.memory_ids, 80),
  };
}

function trimReconciliationOutput(value: unknown) {
  if (!isJsonRecord(value)) return value;
  const boardUpdates = isJsonRecord(value.board_updates)
    ? {
        ...trimGeneratedRecordStrings(value.board_updates, {
          title: 120,
          description: 8000,
          category: 120,
          current_position_summary: 2000,
        }),
        constraints_to_add: trimGeneratedStringArray(
          value.board_updates.constraints_to_add,
          500,
        ),
        constraints_to_remove: trimGeneratedStringArray(
          value.board_updates.constraints_to_remove,
          500,
        ),
        assets_to_add: trimGeneratedStringArray(value.board_updates.assets_to_add, 500),
        assets_to_remove: trimGeneratedStringArray(
          value.board_updates.assets_to_remove,
          500,
        ),
        goals_to_add: trimGeneratedStringArray(value.board_updates.goals_to_add, 500),
        goals_to_remove: trimGeneratedStringArray(
          value.board_updates.goals_to_remove,
          500,
        ),
        assumptions_to_add: trimGeneratedStringArray(
          value.board_updates.assumptions_to_add,
          500,
        ),
        assumptions_to_remove: trimGeneratedStringArray(
          value.board_updates.assumptions_to_remove,
          500,
        ),
      }
    : value.board_updates;
  const moveMapEffect = isJsonRecord(value.move_map_effect)
    ? {
        ...trimGeneratedRecordStrings(value.move_map_effect, {
          reason: 1000,
        }),
        invalidated_node_ids: trimGeneratedStringArray(
          value.move_map_effect.invalidated_node_ids,
          120,
        ),
        invalidated_option_ids: trimGeneratedStringArray(
          value.move_map_effect.invalidated_option_ids,
          120,
        ),
      }
    : value.move_map_effect;
  return {
    ...trimGeneratedRecordStrings(value, {
      summary: 1600,
      user_visible_explanation: 1200,
      recommended_followup_action: 700,
      follow_up_question: 500,
    }),
    operations: Array.isArray(value.operations)
      ? value.operations.map(trimReconciliationOperation)
      : value.operations,
    board_updates: boardUpdates,
    move_map_effect: moveMapEffect,
  };
}

function trimHighestLeverageMove(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return trimGeneratedRecordStrings(value, {
    title: 180,
    description: 3000,
    success_condition: 2000,
  });
}

export function trimNextMovePlanOutput(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return {
    ...trimGeneratedRecordStrings(value, {
      situation_read: 2500,
      likely_bottleneck: 1800,
      situation_summary: 2500,
      core_bottleneck: 1800,
      why_this_move: 2000,
      likely_trap: 1200,
      friction_pattern: 1400,
      when_to_get_human_help: 1800,
    }),
    highest_leverage_move_today: trimHighestLeverageMove(
      value.highest_leverage_move_today,
    ),
    key_constraints: trimGeneratedStringArray(value.key_constraints, 500),
    first_10_minute_action: trimNextMoveStep(value.first_10_minute_action),
    first_30_minutes: trimNextMoveSteps(value.first_30_minutes),
    next_24_hours: trimNextMoveSteps(value.next_24_hours),
    next_7_days: trimNextMoveSteps(value.next_7_days),
    what_not_to_do: trimGeneratedStringArray(value.what_not_to_do, 500),
    recommendation_basis: trimRecommendationBasis(value.recommendation_basis),
    restraint_guidance: trimRestraintGuidance(value.restraint_guidance),
    operator_insight: trimOperatorInsight(value.operator_insight),
    local_reality_scout: trimLocalRealityScout(value.local_reality_scout),
    resources_to_seek: trimNextMoveResources(value.resources_to_seek),
    safety_boundary: trimSafetyBoundary(value.safety_boundary),
    context_used: trimContextUsedItems(value.context_used),
    inferred_context_items: trimInferredContextItems(value.inferred_context_items),
    task_candidates: trimTaskCandidates(value.task_candidates),
    decision_tree: trimDecisionTree(value.decision_tree),
    assumptions: trimGeneratedStringArray(value.assumptions, 500),
    follow_up_questions_if_any: trimGeneratedStringArray(
      value.follow_up_questions_if_any,
      500,
    ),
  };
}

export async function generateFlowPathPlan(
  context: FlowPathContext,
  options: { allowWebSearch?: boolean } = {},
): Promise<{
  plan: DailyPlan;
  model: string;
  usage: AiUsageMetadata;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const model = getModelForRole("generator_model");
  const openai = new OpenAI({ apiKey });
  const tools = getOpenAIWebSearchTools(options);
  const include = getOpenAIWebSearchInclude(options);
  const response = await openai.responses.create({
    model,
    max_output_tokens: DAILY_PLAN_MAX_OUTPUT_TOKENS,
    input: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify(
          {
            date: todayIsoDate(),
            instruction:
              [
                "Return a practical daily read. Be specific, realistic, emotionally honest, and willing to say when today is not a huge push day. Pick no more than three actions.",
                "If web search is available, use it selectively when today's best actions depend on current or local facts that are not already in FlowPath context.",
                "Use at most two web searches. If web search is not needed, do not use it.",
                "Fill recommendation_basis with concrete signals and their implications. Fill restraint_guidance with whether the user should push or deliberately narrow today.",
                "Fill the structured insight fields with mentor-style judgment: the likely naive outsider path, the higher-leverage path a successful domain insider would recommend to someone they care about, and the wasted motion to avoid.",
                "Make that insight constraint-aware: account for saved broad constraints, recent session-only constraints, access level, runway, credibility signals, transportation, deadlines, and safety boundaries.",
                "Use friction_pattern to name the likely source of resistance in plain language without blame.",
                "Fill local_reality_scout only with verified current or local findings, or ask for the missing city/region/country when local specificity would change the plan.",
                "Fill human_help_boundary with the human, professional, or emergency boundary relevant to this plan.",
                "If a recommendation depends on local context and the user's city/region/country is missing, make the action about supplying that location or use a clearly labeled non-local fallback.",
              ].join(" "),
            context,
          },
          null,
          2,
        ),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "flowpath_daily_plan",
        description: "A concise daily prioritization plan for FlowPath.",
        strict: true,
        schema: dailyPlanJsonSchema,
      },
    },
    ...(tools
      ? {
          tools,
          tool_choice: "auto" as const,
          max_tool_calls: 2,
          parallel_tool_calls: false,
        }
      : {}),
    ...(include ? { include } : {}),
  });

  const outputText = extractOutputText(response);
  if (!outputText) {
    throw new Error("The model returned an empty plan.");
  }

  const parsed = dailyPlanSchema.parse(trimDailyPlanOutput(JSON.parse(outputText)));
  return { plan: parsed, model, usage: responseUsageMetadata(response.usage) };
}

const interviewerJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "question",
    "current_stage",
    "is_complete",
    "summary_so_far",
    "recommended_urgency",
    "recommended_mode",
    "inferred_context_items",
  ],
  properties: {
    question: { type: "string" },
    current_stage: {
      type: "string",
      enum: [
        "understanding_goals",
        "understanding_constraints",
        "understanding_resources",
        "identifying_bottleneck",
        "ready_to_generate",
      ],
    },
    is_complete: { type: "boolean" },
    summary_so_far: { type: "string" },
    recommended_urgency: {
      type: ["string", "null"],
      enum: ["low", "medium", "high", "crisis", null],
    },
    recommended_mode: {
      type: ["string", "null"],
      enum: ["growth", "stability", "crisis_triage", "maintenance", null],
    },
    inferred_context_items: {
      type: "array",
      maxItems: 6,
      items: inferredContextItemJsonSchema(),
    },
  },
};

const firstIntakeQuestionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "question",
    "domain",
    "subtype",
    "question_purpose",
    "decision_shape",
    "missing_info_target",
    "why_this_question",
    "situation_terms_used",
  ],
  properties: {
    question: { type: "string" },
    domain: { type: "string" },
    subtype: { type: "string" },
    question_purpose: {
      type: "string",
      enum: FIRST_INTAKE_QUESTION_PURPOSES,
    },
    decision_shape: { type: "string" },
    missing_info_target: { type: "string" },
    why_this_question: { type: "string" },
    situation_terms_used: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: { type: "string" },
    },
  },
};

const firstIntakeQuestionOutputSchema = z.object({
  question: z.string().trim().min(1).max(1200),
  domain: z.string().trim().min(1).max(120),
  subtype: z.string().trim().min(1).max(120),
  question_purpose: z.enum(FIRST_INTAKE_QUESTION_PURPOSES),
  decision_shape: z.string().trim().min(1).max(240),
  missing_info_target: z.string().trim().min(1).max(500),
  why_this_question: z.string().trim().min(1).max(800),
  situation_terms_used: z.array(z.string().trim().min(1).max(120)).min(1).max(6),
});

function decisionFirstActionJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "details",
      "estimated_minutes",
      "success_condition",
      "fallback",
    ],
    properties: {
      title: { type: "string" },
      details: { type: "string" },
      estimated_minutes: { type: ["integer", "null"], minimum: 1, maximum: 480 },
      success_condition: { type: "string" },
      fallback: { type: "string" },
    },
  };
}

function decisionBranchSourceJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "why_it_matters", "source", "url_or_next_search"],
    properties: {
      title: { type: "string" },
      why_it_matters: { type: "string" },
      source: { type: "string" },
      url_or_next_search: { type: "string" },
    },
  };
}

function decisionOptionJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "node_id",
      "label",
      "description",
      "move_type",
      "recommendation_level",
      "why",
      "upside",
      "downside",
      "friction",
      "time_to_feedback",
      "requires_web_search",
      "search_status",
      "next_node_id",
      "can_explore",
      "first_action",
      "success_condition",
      "fallback",
      "selected",
      "next_steps",
      "sources",
    ],
    properties: {
      id: { type: "string" },
      node_id: { type: "string" },
      label: { type: "string" },
      description: { type: "string" },
      move_type: {
        type: "string",
        enum: ["protect", "progress", "meaning", "mixed"],
      },
      recommendation_level: {
        type: "string",
        enum: ["recommended", "viable", "supplement", "not_now", "risky"],
      },
      why: { type: "string" },
      upside: { type: "string" },
      downside: { type: "string" },
      friction: { type: "string", enum: ["low", "medium", "high"] },
      time_to_feedback: { type: "string" },
      requires_web_search: { type: "boolean" },
      search_status: {
        type: "string",
        enum: ["not_needed", "needed", "searched", "unavailable", "failed"],
      },
      next_node_id: { type: ["string", "null"] },
      can_explore: { type: "boolean" },
      first_action: decisionFirstActionJsonSchema(),
      success_condition: { type: "string" },
      fallback: { type: "string" },
      selected: { type: "boolean" },
      next_steps: {
        type: "array",
        maxItems: 6,
        items: nextMoveStepJsonSchema(),
      },
      sources: {
        type: "array",
        maxItems: 4,
        items: decisionBranchSourceJsonSchema(),
      },
    },
  };
}

function decisionNodeJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "parent_id",
      "selected_from_option_id",
      "kind",
      "title",
      "question",
      "context_summary",
      "options",
      "action",
      "selected_option_id",
      "status",
      "search_status",
      "generated_at",
    ],
    properties: {
      id: { type: "string" },
      parent_id: { type: ["string", "null"] },
      selected_from_option_id: { type: ["string", "null"] },
      kind: { type: "string", enum: ["decision", "action", "outcome"] },
      title: { type: "string" },
      question: { type: "string" },
      context_summary: { type: "string" },
      options: {
        type: "array",
        maxItems: 6,
        items: decisionOptionJsonSchema(),
      },
      action: {
        anyOf: [decisionFirstActionJsonSchema(), { type: "null" }],
      },
      selected_option_id: { type: ["string", "null"] },
      status: {
        type: "string",
        enum: ["active", "available", "completed", "blocked"],
      },
      search_status: {
        type: "string",
        enum: ["not_needed", "needed", "searched", "unavailable", "failed"],
      },
      generated_at: { type: ["string", "null"] },
    },
  };
}

function decisionTreeJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "board_id",
      "root_node_id",
      "active_node_id",
      "selected_path",
      "recommended_option_id",
      "current_action",
      "nodes",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string" },
      board_id: { type: ["integer", "null"] },
      root_node_id: { type: "string" },
      active_node_id: { type: "string" },
      selected_path: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: { type: "string" },
      },
      recommended_option_id: { type: "string" },
      current_action: decisionFirstActionJsonSchema(),
      nodes: {
        type: "array",
        minItems: 1,
        maxItems: 16,
        items: decisionNodeJsonSchema(),
      },
      created_at: { type: "string" },
      updated_at: { type: "string" },
    },
  };
}

function branchExpansionOptionJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "label",
      "short_rationale",
      "recommendation_level",
      "can_explore",
      "search_status",
      "friction",
      "time_to_feedback",
      "first_action_preview",
    ],
    properties: {
      id: { type: ["string", "null"] },
      label: { type: "string" },
      short_rationale: { type: "string" },
      recommendation_level: {
        type: "string",
        enum: ["recommended", "viable", "supplement", "not_now", "risky"],
      },
      can_explore: { type: "boolean" },
      search_status: {
        type: "string",
        enum: ["not_needed", "needed", "searched", "unavailable", "failed"],
      },
      friction: { type: "string", enum: ["low", "medium", "high"] },
      time_to_feedback: { type: "string" },
      first_action_preview: { type: "string" },
    },
  };
}

function branchExpansionDecisionNodeJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "kind", "title", "question", "summary", "options", "search_status"],
    properties: {
      id: { type: ["string", "null"] },
      kind: { type: "string", enum: ["decision"] },
      title: { type: "string" },
      question: { type: "string" },
      summary: { type: "string" },
      options: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: branchExpansionOptionJsonSchema(),
      },
      search_status: {
        type: "string",
        enum: ["not_needed", "needed", "searched", "unavailable", "failed"],
      },
    },
  };
}

function branchExpansionActionLeafJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "kind",
      "title",
      "first_action",
      "first_10_minutes",
      "success_condition",
      "if_blocked",
      "search_status",
    ],
    properties: {
      id: { type: ["string", "null"] },
      kind: { type: "string", enum: ["action"] },
      title: { type: "string" },
      first_action: { type: "string" },
      first_10_minutes: { type: "string" },
      success_condition: { type: "string" },
      if_blocked: { type: "string" },
      search_status: {
        type: "string",
        enum: ["not_needed", "needed", "searched", "unavailable", "failed"],
      },
    },
  };
}

export const branchExpansionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "result_type",
    "node",
    "action_leaf",
    "reasoning_summary",
    "selected_path_summary",
    "memory_used",
    "assumptions",
    "search_needed",
  ],
  properties: {
    result_type: { type: "string", enum: ["decision_node", "action_leaf"] },
    node: {
      anyOf: [branchExpansionDecisionNodeJsonSchema(), { type: "null" }],
    },
    action_leaf: {
      anyOf: [branchExpansionActionLeafJsonSchema(), { type: "null" }],
    },
    reasoning_summary: { type: "string" },
    selected_path_summary: { type: "string" },
    memory_used: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    assumptions: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    search_needed: { type: "boolean" },
  },
};

function reconciliationMemoryOperationJsonSchemas() {
  const base = {
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    reason: { type: "string" },
  };
  const memoryId = { type: "string" };
  const category = {
    type: "string",
    enum: [
      "money",
      "location",
      "time",
      "energy",
      "education_credentials",
      "access_connections",
      "support_network",
      "family_caregiving",
      "transportation",
      "deadline",
      "safety_risk",
      "age_life_stage",
      "connection_dating",
      "work_career",
      "health_recovery",
      "creative_personal_project",
      "working_style",
      "other",
    ],
  };
  const sensitivity = { type: "string", enum: ["low", "moderate", "high"] };
  const persistence = {
    type: "string",
    enum: ["session_only", "proposed_memory", "saved_memory"],
  };

  return [
    {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "label",
        "value",
        "category",
        "sensitivity",
        "persistence",
        "confidence",
        "reason",
      ],
      properties: {
        type: { type: "string", enum: ["create_memory"] },
        label: { type: "string" },
        value: { type: "string" },
        category,
        sensitivity,
        persistence,
        ...base,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "memory_id",
        "label",
        "value",
        "category",
        "sensitivity",
        "persistence",
        "confidence",
        "reason",
      ],
      properties: {
        type: { type: "string", enum: ["update_memory"] },
        memory_id: memoryId,
        label: { type: "string" },
        value: { type: "string" },
        category: { anyOf: [category, { type: "null" }] },
        sensitivity: { anyOf: [sensitivity, { type: "null" }] },
        persistence: { anyOf: [persistence, { type: "null" }] },
        ...base,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "memory_ids",
        "label",
        "value",
        "category",
        "sensitivity",
        "persistence",
        "confidence",
        "reason",
      ],
      properties: {
        type: { type: "string", enum: ["merge_memory"] },
        memory_ids: {
          type: "array",
          minItems: 2,
          maxItems: 8,
          items: memoryId,
        },
        label: { type: "string" },
        value: { type: "string" },
        category,
        sensitivity,
        persistence,
        ...base,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "memory_id", "confidence", "reason"],
      properties: {
        type: { type: "string", enum: ["mark_stale"] },
        memory_id: memoryId,
        ...base,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "memory_id", "confidence", "reason"],
      properties: {
        type: { type: "string", enum: ["delete_memory"] },
        memory_id: memoryId,
        ...base,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "reason"],
      properties: {
        type: { type: "string", enum: ["noop"] },
        reason: { type: "string" },
      },
    },
  ];
}

function boardReconciliationUpdatesJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "description",
      "category",
      "status",
      "urgency",
      "current_position_summary",
      "constraints_to_add",
      "constraints_to_remove",
      "assets_to_add",
      "assets_to_remove",
      "goals_to_add",
      "goals_to_remove",
      "assumptions_to_add",
      "assumptions_to_remove",
    ],
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      category: { type: "string" },
      status: { anyOf: [{ type: "string", enum: ["active", "resolved", "archived"] }, { type: "null" }] },
      urgency: { anyOf: [{ type: "string", enum: ["low", "medium", "high", "crisis"] }, { type: "null" }] },
      current_position_summary: { type: "string" },
      constraints_to_add: { type: "array", maxItems: 8, items: { type: "string" } },
      constraints_to_remove: { type: "array", maxItems: 8, items: { type: "string" } },
      assets_to_add: { type: "array", maxItems: 8, items: { type: "string" } },
      assets_to_remove: { type: "array", maxItems: 8, items: { type: "string" } },
      goals_to_add: { type: "array", maxItems: 8, items: { type: "string" } },
      goals_to_remove: { type: "array", maxItems: 8, items: { type: "string" } },
      assumptions_to_add: { type: "array", maxItems: 8, items: { type: "string" } },
      assumptions_to_remove: { type: "array", maxItems: 8, items: { type: "string" } },
    },
  };
}

function moveMapEffectJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "selected_path_still_valid",
      "invalidated_node_ids",
      "invalidated_option_ids",
      "reason",
      "should_recalculate",
      "should_preserve_existing_tree",
    ],
    properties: {
      selected_path_still_valid: { type: "boolean" },
      invalidated_node_ids: { type: "array", maxItems: 12, items: { type: "string" } },
      invalidated_option_ids: { type: "array", maxItems: 12, items: { type: "string" } },
      reason: { type: "string" },
      should_recalculate: { type: "boolean" },
      should_preserve_existing_tree: { type: "boolean" },
    },
  };
}

export const reconciliationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "confidence",
    "requires_user_confirmation",
    "operations",
    "board_updates",
    "move_map_effect",
    "user_visible_explanation",
    "recommended_followup_action",
    "follow_up_question",
  ],
  properties: {
    summary: { type: "string" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    requires_user_confirmation: { type: "boolean" },
    operations: {
      type: "array",
      maxItems: 12,
      items: { anyOf: reconciliationMemoryOperationJsonSchemas() },
    },
    board_updates: {
      anyOf: [boardReconciliationUpdatesJsonSchema(), { type: "null" }],
    },
    move_map_effect: {
      anyOf: [moveMapEffectJsonSchema(), { type: "null" }],
    },
    user_visible_explanation: { type: "string" },
    recommended_followup_action: { type: "string" },
    follow_up_question: { type: "string" },
  },
};

const nextMovePlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "generation_mode",
    "mode",
    "situation_read",
    "likely_bottleneck",
    "key_constraints",
    "situation_summary",
    "core_bottleneck",
    "highest_leverage_move_today",
    "why_this_move",
    "first_10_minute_action",
    "first_30_minutes",
    "next_24_hours",
    "next_7_days",
    "what_not_to_do",
    "likely_trap",
    "recommendation_basis",
    "restraint_guidance",
    "operator_insight",
    "friction_pattern",
    "local_reality_scout",
    "resources_to_seek",
    "when_to_get_human_help",
    "safety_boundary",
    "context_used",
    "inferred_context_items",
    "task_candidates",
    "decision_tree",
    "confidence_level",
    "assumptions",
    "follow_up_questions_if_any",
  ],
  properties: {
    generation_mode: { type: "string", enum: ["operator_plan"] },
    mode: {
      type: "string",
      enum: ["growth", "stability", "crisis_triage", "maintenance"],
    },
    situation_read: { type: "string" },
    likely_bottleneck: { type: "string" },
    key_constraints: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string" },
    },
    situation_summary: { type: "string" },
    core_bottleneck: { type: "string" },
    highest_leverage_move_today: {
      type: "object",
      additionalProperties: false,
      required: ["title", "description", "estimated_minutes", "success_condition"],
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        estimated_minutes: { type: "integer", minimum: 1, maximum: 480 },
        success_condition: { type: "string" },
      },
    },
    why_this_move: { type: "string" },
    first_10_minute_action: nextMoveStepJsonSchema(),
    first_30_minutes: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: nextMoveStepJsonSchema(),
    },
    next_24_hours: {
      type: "array",
      minItems: 1,
      maxItems: 7,
      items: nextMoveStepJsonSchema(),
    },
    next_7_days: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: nextMoveStepJsonSchema(),
    },
    what_not_to_do: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string" },
    },
    likely_trap: { type: "string" },
    recommendation_basis: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: recommendationBasisJsonSchema(),
    },
    restraint_guidance: restraintGuidanceJsonSchema(),
    operator_insight: operatorInsightJsonSchema(),
    friction_pattern: { type: "string" },
    local_reality_scout: localRealityScoutJsonSchema(),
    resources_to_seek: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "why", "contact_or_url"],
        properties: {
          name: { type: "string" },
          why: { type: "string" },
          contact_or_url: { type: "string" },
        },
      },
    },
    when_to_get_human_help: { type: "string" },
    safety_boundary: safetyBoundaryJsonSchema(),
    context_used: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: contextUsedItemJsonSchema(),
    },
    inferred_context_items: {
      type: "array",
      maxItems: 8,
      items: inferredContextItemJsonSchema(),
    },
    task_candidates: {
      type: "array",
      maxItems: 3,
      items: taskCandidateJsonSchema(),
    },
    decision_tree: decisionTreeJsonSchema(),
    confidence_level: { type: "string", enum: ["low", "medium", "high"] },
    assumptions: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    follow_up_questions_if_any: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
  },
};

function nextMoveStepJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "details"],
    properties: {
      title: { type: "string" },
      details: { type: "string" },
    },
  };
}

async function createStructuredResponse({
  system,
  user,
  name,
  description,
  schema,
  tools,
  include,
  maxToolCalls,
  maxOutputTokens,
  model: requestedModel,
  modelRole,
}: {
  system: string;
  user: unknown;
  name: string;
  description: string;
  schema: Record<string, unknown>;
  tools?: ResponseCreateParamsNonStreaming["tools"];
  include?: ResponseCreateParamsNonStreaming["include"];
  maxToolCalls?: number;
  maxOutputTokens: number;
  model?: string;
  modelRole?: ModelRole;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY.");

  const model = requestedModel || getModelForRole("generator_model");
  const openai = new OpenAI({ apiKey });
  const response = await openai.responses.create({
    model,
    max_output_tokens: maxOutputTokens,
    input: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user, null, 2) },
    ],
    text: {
      format: {
        type: "json_schema",
        name,
        description,
        strict: true,
        schema,
      },
    },
    ...(tools
      ? {
          tools,
          tool_choice: "auto" as const,
          max_tool_calls: maxToolCalls,
          parallel_tool_calls: false,
        }
      : {}),
    ...(include ? { include } : {}),
  });

  const outputText = extractOutputText(response);
  if (!outputText) throw new Error("The model returned an empty response.");
  return {
    outputText,
    model,
    modelRole: modelRole ?? null,
    usage: responseUsageMetadata(response.usage),
    usedWebSearch: responseUsedWebSearch(response),
    webSearchCallCount: countWebSearchCalls(response),
  };
}

export type BranchExpansionGenerationResult = {
  expansion: BranchExpansionResultInput;
  model: string;
  modelRole: ModelRole | null;
  usage: AiUsageMetadata;
  webSearchCallCount: number;
  webSearchDecisionReason: ReturnType<typeof webSearchDecisionReason>;
  modelSelection: GenerationModelSelection;
};

export async function generateBranchExpansion(
  context: BranchExpansionGenerationContext,
  options: { allowWebSearch?: boolean } = {},
): Promise<BranchExpansionGenerationResult> {
  const cognitive = context.cognitive_operating_layer;
  const allowWebSearch =
    options.allowWebSearch !== false &&
    context.search_context.allow_web_search &&
    Boolean(cognitive?.web_search_decision.should_use_web_search);
  const tools = getOpenAIWebSearchTools({ allowWebSearch });
  const include = getOpenAIWebSearchInclude({ allowWebSearch });
  const selection = selectModelForGeneration({
    flowType: "move_map_expansion",
    situation: context.board,
    urgency: context.board.urgency,
    safetyRouteTriggered:
      (cognitive?.state_detection.risk_flags.length ?? 0) > 0,
    safetyConfidence:
      (cognitive?.state_detection.risk_flags.length ?? 0) > 0 ? "medium" : "none",
    webSearchNeeded: allowWebSearch,
    constraintCount:
      (context.plan.key_constraints.length ?? 0) +
      (cognitive?.selected_memory.selected_memories.length ?? 0),
    competingPriorityCount: context.open_tasks.length,
    promptApproxChars: JSON.stringify(context).length,
  });
  const response = await createStructuredResponse({
    system: branchExpansionSystemPrompt,
    name: "flowpath_branch_expansion",
    description:
      "The next Move Map child decision node or action leaf for one selected branch.",
    schema: branchExpansionJsonSchema,
    user: {
      instruction:
        "Expand only the selected Move Map branch. Return either a child decision node or an action leaf.",
      context,
      search_rules: {
        allow_web_search: allowWebSearch,
        max_web_searches: tools ? 2 : 0,
        if_no_search:
          "Do not claim local/current verification. Mark search_status needed/unavailable and make the action a concrete search/check step.",
      },
    },
    tools,
    include,
    maxToolCalls: tools ? 2 : undefined,
    maxOutputTokens: BRANCH_EXPANSION_MAX_OUTPUT_TOKENS,
    model: selection.model,
    modelRole: selection.modelRole,
  });
  const expansion = branchExpansionResultSchema.parse(
    trimBranchExpansionOutput(JSON.parse(response.outputText)),
  );
  const estimatedCostUsd = estimateModelCostDollars({
    branch_expansion: {
      model: response.model,
      inputTokens: response.usage.inputTokens,
      cachedInputTokens: response.usage.cachedInputTokens,
      outputTokens: response.usage.outputTokens,
    },
  });
  response.usage.estimatedCostUsd = estimatedCostUsd;

  return {
    expansion,
    model: response.model,
    modelRole: response.modelRole,
    usage: response.usage,
    webSearchCallCount: response.webSearchCallCount,
    webSearchDecisionReason: webSearchDecisionReason(
      cognitive?.web_search_decision,
      context.search_context.allow_web_search && options.allowWebSearch !== false,
    ),
    modelSelection: selection,
  };
}

export type ReconciliationGenerationResult = {
  reconciliation: ReconciliationResultInput;
  model: string;
  modelRole: ModelRole | null;
  usage: AiUsageMetadata;
  modelSelection: GenerationModelSelection;
};

export async function reconcileMemoryAndBoardUpdate(
  context: ReconciliationGenerationContext,
): Promise<ReconciliationGenerationResult> {
  const flowType =
    context.source === "board_update" ? "board_reconciliation" : "memory_reconciliation";
  const selection = selectModelForGeneration({
    flowType,
    situation: context.board ?? undefined,
    urgency: context.board?.urgency ?? null,
    constraintCount: context.existing_memory.length,
    competingPriorityCount: context.task_or_action_history.length,
    promptApproxChars: JSON.stringify(context).length,
  });
  const response = await createStructuredResponse({
    system: reconciliationSystemPrompt,
    name: "flowpath_memory_board_reconciliation",
    description:
      "Structured memory and board reconciliation operations for one user correction or board update.",
    schema: reconciliationJsonSchema,
    user: {
      instruction:
        "Reconcile this user update against the provided memory IDs and board context. Return structured operations only.",
      context,
      operation_rules: {
        if_unsure:
          "Set requires_user_confirmation true and ask one concise follow-up question.",
        destructive_changes:
          "Only delete when the user explicitly asks to forget/delete/remove or a direct high-confidence contradiction exists. Otherwise mark stale.",
        board_updates:
          "Only include board fields that should change. Use empty strings/arrays and nulls for unchanged optional fields.",
      },
    },
    maxOutputTokens: RECONCILIATION_MAX_OUTPUT_TOKENS,
    model: selection.model,
    modelRole: selection.modelRole,
  });
  const reconciliation = reconciliationResultSchema.parse(
    trimReconciliationOutput(JSON.parse(response.outputText)),
  );
  const estimatedCostUsd = estimateModelCostDollars({
    reconciliation: {
      model: response.model,
      inputTokens: response.usage.inputTokens,
      cachedInputTokens: response.usage.cachedInputTokens,
      outputTokens: response.usage.outputTokens,
    },
  });
  response.usage.estimatedCostUsd = estimatedCostUsd;

  return {
    reconciliation,
    model: response.model,
    modelRole: response.modelRole,
    usage: response.usage,
    modelSelection: selection,
  };
}

export type TaskRevisionIntent = "revise" | "couldnt_complete";

export type TaskRevisionGenerationResult = {
  revision: z.infer<typeof taskRevisionOutputSchema>;
  model: string;
  modelRole: ModelRole;
  usage?: AiUsageMetadata;
};

export async function generateTaskRevision({
  task,
  instructions,
  intent,
}: {
  task: Task;
  instructions: string;
  intent: TaskRevisionIntent;
}): Promise<TaskRevisionGenerationResult> {
  const modelRole: ModelRole = "revision_standard";
  const { outputText, model, usage } = await createStructuredResponse({
    system: taskRevisionSystemPrompt,
    name: "flowpath_task_revision",
    description: "A revised single FlowPath task.",
    schema: taskRevisionJsonSchema(),
    user: {
      intent,
      user_instruction: instructions,
      current_task: {
        title: task.title,
        notes: task.notes,
        status: task.status,
        importance: task.importance,
        effort: task.effort,
        friction_type: task.friction_type,
        friction_note: task.friction_note,
        estimated_minutes: task.estimated_minutes ?? null,
        due_date: task.due_date ?? null,
        situation_title: task.situation_title ?? null,
        source_plan_section: task.source_plan_section ?? null,
        rank_reason: task.rank_reason ?? null,
      },
    },
    maxOutputTokens: TASK_REVISION_MAX_OUTPUT_TOKENS,
    model: getModelForRole(modelRole),
    modelRole,
  });

  const parsed = taskRevisionOutputSchema.parse(
    trimGeneratedRecordStrings(JSON.parse(outputText), {
      title: TASK_TITLE_MAX,
      notes: TASK_NOTES_MAX,
      friction_note: 1200,
    }),
  );

  return {
    revision: parsed,
    model,
    modelRole,
    usage,
  };
}

export type FirstIntakeGenerationResult = {
  plan: FirstIntakePlan;
  source: "ai";
  model?: string;
  modelRole?: ModelRole | null;
  usage?: AiUsageMetadata;
};

function normalizeSubjectPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortSituationSubject(situation: Situation) {
  const title = situation.title.replace(/\s+/g, " ").trim();
  const description = (situation.description || "").replace(/\s+/g, " ").trim();
  const subject =
    title && description && normalizeSubjectPart(title) !== normalizeSubjectPart(description)
      ? `${title} ${description}`
      : title || description;
  const fallback = subject || situation.category;
  return fallback.length > 120 ? `${fallback.slice(0, 117).trim()}...` : fallback;
}

function normalizeQuestionTerm(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function questionUsesSituationTerms(question: string, terms: string[]) {
  const normalizedQuestion = normalizeQuestionTerm(question);
  return terms
    .map(normalizeQuestionTerm)
    .filter((term) => term.length >= 3)
    .some((term) => normalizedQuestion.includes(term));
}

function ensureGeneratedFirstQuestionAnchor(
  question: string,
  situation: Situation,
  terms: string[],
) {
  const subject = shortSituationSubject(situation).replace(/"/g, "'");
  if (
    questionUsesSituationTerms(question, terms) ||
    normalizeQuestionTerm(question).includes(normalizeQuestionTerm(subject))
  ) {
    return question;
  }

  return `For "${subject}", ${question.charAt(0).toLowerCase()}${question.slice(1)}`;
}

export function buildFirstIntakeQuestionPromptInput(
  situation: Situation,
) {
  return {
    instruction:
      "Generate one domain-aware follow-up intake question. Preserve the selected primary domain and infer secondary domains additively.",
    situation: {
      title: situation.title,
      description: situation.description,
      category: situation.category,
      urgency: situation.urgency,
    },
    selected_primary_domain: isEntryDomainId(situation.category)
      ? entryDomainTitle(situation.category)
      : situation.category,
    detected_domain: classifySituationDomain(situation),
    quality_requirements: [
      "Ask exactly one question.",
      "Honor the selected primary domain even if secondary domains are mentioned.",
      "Make the question specific to the title and description.",
      "Use concrete terms from the situation whenever possible.",
      "If useful, offer 3-5 plausible lanes inferred from the situation.",
      "Do not ask a generic progress or life-coaching opener.",
      "Do not invent facts, people, organizations, deadlines, or resources.",
      "Ask only for information that would change the next move.",
      "If self-harm-adjacent language is present, ask safety status before the underlying problem: immediate danger today, near-term risk in the next few days, or distress without intent.",
      "Do not ask why the user wants to hurt themselves.",
    ],
  };
}

export function parseFirstIntakeQuestionOutput(
  outputText: string,
  situation: Situation,
): FirstIntakePlan {
  const parsed = firstIntakeQuestionOutputSchema.parse(
    trimGeneratedRecordStrings(JSON.parse(outputText), {
      question: 1200,
      domain: 120,
      subtype: 120,
      decision_shape: 240,
      missing_info_target: 500,
      why_this_question: 800,
    }),
  );
  const question = ensureGeneratedFirstQuestionAnchor(
    parsed.question,
    situation,
    parsed.situation_terms_used,
  );

  return {
    domain: parsed.domain,
    subtype: parsed.subtype,
    questionPurpose: parsed.question_purpose,
    decisionShape: parsed.decision_shape,
    missingInfoTarget: parsed.missing_info_target,
    question,
    whyThisQuestion: parsed.why_this_question,
    genericityRisk: questionUsesSituationTerms(question, parsed.situation_terms_used)
      ? "low"
      : "medium",
  };
}

export async function generateFirstIntakePlan(
  situation: Situation,
): Promise<FirstIntakeGenerationResult> {
  const selection = selectModelForGeneration({
    flowType: "first_intake_question",
    situation,
    urgency: situation.urgency,
    promptApproxChars: JSON.stringify(buildFirstIntakeQuestionPromptInput(situation)).length,
  });
  const { outputText, model, usage } = await createStructuredResponse({
    system: firstIntakeQuestionSystemPrompt,
    name: "flowpath_first_intake_question",
    description: "One situation-specific first intake question.",
    schema: firstIntakeQuestionJsonSchema,
    user: buildFirstIntakeQuestionPromptInput(situation),
    maxOutputTokens: FIRST_INTAKE_QUESTION_MAX_OUTPUT_TOKENS,
    model: selection.model,
    modelRole: selection.modelRole,
  });

  return {
    plan: parseFirstIntakeQuestionOutput(outputText, situation),
    source: "ai",
    model,
    modelRole: selection.modelRole,
    usage,
  };
}

export async function generateInterviewQuestion(
  context: InterviewerContext,
  options: { cognitiveContext?: CognitivePlanContext } = {},
) {
  const route = classifySituationDomain(context.situation);
  const selection = selectModelForGeneration({
    flowType: "followup_intake_question",
    situation: context.situation,
    urgency: context.situation.urgency,
    safetyRouteTriggered:
      (options.cognitiveContext?.stateDetection.risk_flags.length ?? 0) > 0,
    webSearchNeeded: false,
    constraintCount:
      Object.keys(context.profile.context_constraints ?? {}).length +
      context.messages.length,
    promptApproxChars:
      JSON.stringify({
        situation: context.situation,
        session: context.session,
        messages: context.messages,
      }).length,
  });
  const { outputText, model, usage } = await createStructuredResponse({
    system: interviewerSystemPrompt,
    name: "flowpath_interviewer_turn",
    description: "One adaptive intake question and current intake progress.",
    schema: interviewerJsonSchema,
    user: {
      instruction:
        "Ask exactly one next question unless enough information has been gathered. Ask 1-3 intake questions normally; ask more only when a missing answer materially changes safety or recommendation quality. If enough information has been gathered, mark is_complete true, set current_stage to ready_to_generate, and write a short transition statement instead of asking for another answer. Ask domain-appropriate questions only. If domain confidence is low, ask a broad neutral next-move question instead of a narrow category question. Fill inferred_context_items only with practical broad constraints that were actually stated or strongly implied; use source intake, proposed_memory for useful reusable broad context, and session_only for sensitive details.",
      privacy_note:
        "When asking for missing context, ask only for constraints that materially change the recommendation. Prefer broad ranges/options and explain why the constraint matters.",
      detected_domain: route,
      cognitive_operating_layer: options.cognitiveContext
        ? {
            state_detection: options.cognitiveContext.stateDetection,
            intervention: options.cognitiveContext.intervention,
            selected_memory: options.cognitiveContext.memorySelection,
            repeated_topic: options.cognitiveContext.repeatedTopic,
            repeated_loop_detected: options.cognitiveContext.repeatedLoopDetected,
            historical_effectiveness:
              options.cognitiveContext.historicalEffectiveness?.advisoryText || "",
            instruction:
              "Use these cognitive routing hints to avoid redundant questions, handle rumination/anxiety carefully, and keep the next intake turn compact. Do not expose raw metadata to the user.",
          }
        : null,
      stages: [
        "understanding_goals",
        "understanding_constraints",
        "understanding_resources",
        "identifying_bottleneck",
        "ready_to_generate",
      ],
      situation: context.situation,
      session: context.session,
      messages: context.messages,
      profile: context.profile,
    },
    maxOutputTokens: INTERVIEW_MAX_OUTPUT_TOKENS,
    model: selection.model,
    modelRole: selection.modelRole,
  });

  return {
    output: interviewerOutputSchema.parse(
      {
        ...trimGeneratedRecordStrings(JSON.parse(outputText), {
          question: 1200,
          summary_so_far: 5000,
        }),
        inferred_context_items: trimInferredContextItems(
          JSON.parse(outputText).inferred_context_items,
        ),
      },
    ),
    model,
    modelRole: selection.modelRole,
    usage,
  };
}

export async function generateNextMovePlan(
  context: StrategistContext,
  options: {
    allowWebSearch?: boolean;
    cognitiveContext?: CognitivePlanContext;
    sourceMessageId?: string | null;
  } = {},
): Promise<{
  plan: NextMovePlan;
  model: string;
  modelRole: ModelRole | null;
  usage: AiUsageMetadata;
  webSearchCallCount: number;
  webSearchDecisionReason: ReturnType<typeof webSearchDecisionReason>;
  cognitiveMetadata?: ReturnType<typeof buildCognitiveMetadata>;
  modelSelection?: GenerationModelSelection;
}> {
  const route = classifySituationDomain(context.situation);
  const cognitiveContext = options.cognitiveContext;
  const allowWebSearch =
    options.allowWebSearch !== false &&
    (cognitiveContext?.webSearchDecision.should_use_web_search ?? true);
  const tools = getOpenAIWebSearchTools({ allowWebSearch });
  const include = getOpenAIWebSearchInclude({ allowWebSearch });
  const generationSelection = selectModelForGeneration({
    flowType: "next_move_plan",
    situation: context.situation,
    urgency: context.situation.urgency,
    safetyRouteTriggered:
      (cognitiveContext?.stateDetection.risk_flags.length ?? 0) > 0,
    safetyConfidence:
      (cognitiveContext?.stateDetection.risk_flags.length ?? 0) > 0
        ? "medium"
        : "none",
    webSearchNeeded: allowWebSearch,
    constraintCount:
      (cognitiveContext?.memorySelection.selected_memories.length ?? 0) +
      context.messages.length,
    competingPriorityCount: context.openTasks.length,
    promptApproxChars: JSON.stringify(context).length,
  });

  const baseInstruction = [
    "Generate one structured operator_plan the user can act on today. Keep the answer compact, specific, and schema-compatible.",
    nextMovePlanPromptModules.boardSnapshotPrompt,
    nextMovePlanPromptModules.domainContextInstruction,
    "Use the detected domain and confidence below as routing context. Ask domain-appropriate questions only in follow_up_questions_if_any, and do not let stale or previous-board categories shape this plan.",
    "Use every prior intake answer; do not ask follow-up questions for details already present in the board, selected context, session summary, or messages.",
    cognitiveContext
      ? `Follow the intervention selector: ${cognitiveContext.intervention.intervention_type}, ${cognitiveContext.intervention.response_length} response length, ${cognitiveContext.intervention.tone} tone.`
      : "",
    cognitiveContext
      ? `Task candidates must respect should_create_tasks=${cognitiveContext.intervention.should_create_tasks} and max_tasks=${cognitiveContext.intervention.max_tasks}.`
      : "Fill task_candidates with at most three concrete actions.",
    cognitiveContext
      ? `Must include: ${cognitiveContext.intervention.must_include.join("; ") || "none"}. Must avoid: ${cognitiveContext.intervention.must_avoid.join("; ") || "none"}.`
      : "",
    cognitiveContext?.repeatedTopic
      ? "The user appears to be circling a repeated topic. Do not give a longer version of the same answer; name the stable conclusion and convert uncertainty into one experiment."
      : "",
    cognitiveContext?.repeatedLoopDetected
      ? "Outcome history suggests a repeated loop. Briefly name the unresolved uncertainty, avoid restating stale advice, and propose one concrete experiment or starter action."
      : "",
    cognitiveContext?.historicalEffectiveness?.advisoryText
      ? `Use this outcome harness context as advisory, not controlling: ${cognitiveContext.historicalEffectiveness.advisoryText}`
      : "",
    nextMovePlanPromptModules.moveMapRootPrompt,
    nextMovePlanPromptModules.branchQualityInstruction,
    nextMovePlanPromptModules.recommendedLineInstruction,
    nextMovePlanPromptModules.actionLeafInstruction,
    "Fill recommendation_basis with concrete signals and their implications. Fill restraint_guidance with whether the user should push or deliberately narrow the situation today.",
    nextMovePlanPromptModules.reasoningDetailsInstruction,
    "Generate legal moves only. If the larger goal is meaningful but not currently reachable, identify the prerequisite move that improves the board first.",
    "Use friction_pattern to name the likely source of resistance in plain language without blame.",
    nextMovePlanPromptModules.searchHonestyInstruction,
    "If web search is available, use it only when the web_search_decision below says current/local/volatile facts matter. If web_search_decision says not to search, do not search. Use at most three web searches.",
    nextMovePlanPromptModules.safetyBoundaryInstruction,
    nextMovePlanPromptModules.taskExtractionInstruction,
    nextMovePlanPromptModules.memoryExtractionInstruction,
    "For context_used, use source situation only as the schema enum for board-level context; otherwise use session_intake, saved_memory, inferred, or manual as appropriate. Use persistence session_only, proposed_memory, or saved_memory only as internal schema enum values.",
    "Set task importance for each specific task's leverage, urgency, and consequence, not for the parent board as a whole.",
    "For resources_to_seek, include a verified URL, phone number, or practical search target when web search verifies one. Leave contact_or_url empty unless you can provide a reliable official or well-established resource.",
    "If local specificity matters but location is missing, ask for city plus region/country in follow_up_questions_if_any and give a non-local fallback only when useful.",
    nextMovePlanPromptModules.toneAndRealismInstruction,
    nextMovePlanPromptModules.outputSchemaInstruction,
  ]
    .filter(Boolean)
    .join(" ");

  const buildUserPayload = (extra: Record<string, unknown> = {}) => ({
    date: todayIsoDate(),
    instruction: baseInstruction,
    context,
    detected_domain: route,
    cognitive_operating_layer: cognitiveContext
      ? {
          state_detection: cognitiveContext.stateDetection,
          intervention: cognitiveContext.intervention,
          selected_memory: cognitiveContext.memorySelection,
          web_search_decision: cognitiveContext.webSearchDecision,
          repeated_topic: cognitiveContext.repeatedTopic,
          repeated_loop_detected: cognitiveContext.repeatedLoopDetected,
          historical_effectiveness_advisory:
            cognitiveContext.historicalEffectiveness?.advisoryText || "",
          success_criteria: cognitiveContext.intervention.success_criteria,
          escalation_model_selected: cognitiveContext.useEscalationModel,
        }
      : null,
    ...extra,
  });

  const parsePlan = (outputText: string) =>
    normalizePlanForIntervention(
      nextMovePlanSchema.parse(trimNextMovePlanOutput(JSON.parse(outputText))),
      cognitiveContext ?? {
        stateDetection: {
          primary_state: "execution_mode",
          secondary_states: [],
          confidence: 0.5,
          user_intent: context.situation.title,
          emotional_temperature: "low",
          action_readiness: "high",
          risk_flags: [],
          needs_web_search: false,
          needs_memory: true,
          needs_task_creation: true,
          needs_escalation: false,
          recommended_intervention: "concise_execution_plan",
          reasoning_summary: "Fallback context for legacy plan generation.",
        },
        intervention: {
          intervention_type: "concise_execution_plan",
          response_length: "medium",
          tone: "direct",
          should_create_tasks: true,
          max_tasks: 3,
          should_ask_question: false,
          question_if_needed: null,
          must_include: [],
          must_avoid: [],
          success_criteria: ["Produce a concrete next move."],
        },
        memorySelection: {
          selected_memories: [],
          excluded_memory_reasoning: "",
          context_budget_used: 0,
        },
        webSearchDecision: {
          should_use_web_search: false,
          reason: "",
          triggers: [],
          blocked_by_policy: false,
        },
        repeatedTopic: false,
        repeatedLoopDetected: false,
        historicalEffectiveness: null,
        useEscalationModel: false,
      },
      options.sourceMessageId ?? null,
    );

  const first = await createStructuredResponse({
    system: strategistSystemPrompt,
    name: "flowpath_next_move_plan",
    description: "A practical next best move plan for a user's current situation.",
    schema: nextMovePlanJsonSchema,
    user: buildUserPayload(),
    tools,
    include,
    maxToolCalls: tools ? 3 : undefined,
    maxOutputTokens: NEXT_MOVE_PLAN_MAX_OUTPUT_TOKENS,
    model: generationSelection.model,
    modelRole: generationSelection.modelRole,
  });

  let plan = parsePlan(first.outputText);
  let evaluator = cognitiveContext ? evaluateNextMovePlan(plan, cognitiveContext) : null;
  let responseRewritten = false;
  let revision:
    | Awaited<ReturnType<typeof createStructuredResponse>>
    | null = null;

  if (cognitiveContext && evaluator && !evaluator.passes) {
    responseRewritten = true;
    const revisionSelection = selectModelForGeneration({
      flowType: "plan_revision",
      situation: context.situation,
      urgency: context.situation.urgency,
      safetyRouteTriggered:
        evaluator.unsafe_or_overconfident ||
        (cognitiveContext.stateDetection.risk_flags.length ?? 0) > 0,
      safetyConfidence: evaluator.unsafe_or_overconfident ? "high" : "medium",
      priorValidationFailed: true,
      evaluatorRequestedRevision: true,
      evaluatorScore: evaluator.score,
      promptApproxChars: JSON.stringify({ context, prior_plan: plan, evaluator }).length,
    });
    revision = await createStructuredResponse({
      system: strategistSystemPrompt,
      name: "flowpath_next_move_plan_revision",
      description: "A revised practical next best move plan for a user's current situation.",
      schema: nextMovePlanJsonSchema,
      user: buildUserPayload({
        prior_plan: plan,
        evaluator,
        revision_instruction: buildRevisionInstruction(evaluator),
      }),
      tools: undefined,
      include: undefined,
      maxOutputTokens: NEXT_MOVE_PLAN_MAX_OUTPUT_TOKENS,
      model: revisionSelection.model,
      modelRole: revisionSelection.modelRole,
    });
    plan = parsePlan(revision.outputText);
    evaluator = evaluateNextMovePlan(plan, cognitiveContext);
  }

  const usage = revision ? combineUsage(first.usage, revision.usage) : first.usage;
  const modelUsedByStage: Record<string, string> = {
    generator: first.model,
  };
  const promptTokensByStage: Record<string, number> = {
    generator: first.usage.inputTokens ?? 0,
  };
  const completionTokensByStage: Record<string, number> = {
    generator: first.usage.outputTokens ?? 0,
  };
  const costInput: Record<string, StageUsage | undefined> = {
    generator: {
      model: first.model,
      inputTokens: first.usage.inputTokens,
      cachedInputTokens: first.usage.cachedInputTokens,
      outputTokens: first.usage.outputTokens,
    },
  };

  if (revision) {
    modelUsedByStage.revision = revision.model;
    promptTokensByStage.revision = revision.usage.inputTokens ?? 0;
    completionTokensByStage.revision = revision.usage.outputTokens ?? 0;
    costInput.revision = {
      model: revision.model,
      inputTokens: revision.usage.inputTokens,
      cachedInputTokens: revision.usage.cachedInputTokens,
      outputTokens: revision.usage.outputTokens,
    };
  }

  const totalEstimatedCost = estimateModelCostDollars(costInput);
  usage.estimatedCostUsd = totalEstimatedCost;
  const webSearchUsed = first.usedWebSearch || Boolean(revision?.usedWebSearch);
  const webSearchCallCount =
    first.webSearchCallCount + (revision?.webSearchCallCount ?? 0);
  plan = {
    ...plan,
    decision_tree: sanitizeDecisionTreeSearchStatuses(
      plan.decision_tree,
      webSearchCallCount,
    ),
  };
  const cognitiveMetadata =
    cognitiveContext &&
    buildCognitiveMetadata({
      context: cognitiveContext,
      evaluator,
      responseRewritten,
      modelUsedByStage,
      promptTokensByStage,
      completionTokensByStage,
      totalEstimatedCost,
      webSearchUsed,
    });

  return {
    plan,
    model: responseRewritten && revision ? revision.model : first.model,
    modelRole: responseRewritten && revision ? revision.modelRole : first.modelRole,
    usage,
    webSearchCallCount,
    webSearchDecisionReason: webSearchDecisionReason(
      cognitiveContext?.webSearchDecision,
      options.allowWebSearch !== false,
    ),
    cognitiveMetadata: cognitiveMetadata || undefined,
    modelSelection: generationSelection,
  };
}

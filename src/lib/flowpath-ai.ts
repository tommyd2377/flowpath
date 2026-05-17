import OpenAI from "openai";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseUsage,
} from "openai/resources/responses/responses";

import { dailyPlanSchema, interviewerOutputSchema, nextMovePlanSchema } from "./schemas";
import { DEFAULT_APP_TIMEZONE } from "./env";
import type {
  CheckIn,
  DailyPlan,
  IntakeMessage,
  IntakeSession,
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

export const DEFAULT_OPENAI_MODEL = "gpt-5.5";
export const DEFAULT_WEB_SEARCH_CONTEXT_SIZE = "medium";
export const DAILY_PLAN_MAX_OUTPUT_TOKENS = 8000;
export const INTERVIEW_MAX_OUTPUT_TOKENS = 3000;
export const NEXT_MOVE_PLAN_MAX_OUTPUT_TOKENS = 10000;

const webSearchContextSizes = ["low", "medium", "high"] as const;
type WebSearchContextSize = (typeof webSearchContextSizes)[number];

const selectiveWebSearchInstruction = `When web search is available, use it only when the plan depends on current, time-sensitive, or location-specific facts that may not be covered by model knowledge or stored FlowPath context. Search for things like local services, laws, rules, schedules, prices, availability, current organizations, current opportunities, current recommendations, or place-specific logistics. For social connection, prioritize repeatable social containers such as weekly classes, volunteering shifts, library groups, community centers, adult sports leagues, board game nights, writing groups, coworking events, mutual aid groups, community gardens, language exchanges, walking/running clubs, identity-aligned groups when the user indicates relevance, and dating events only when the user is seeking dating. Do not search for or suggest adult sexual services, sex-work marketplaces, pornography, illegal meetups, or unsafe/private sexual encounters. Do not search for timeless prioritization advice or facts already present in the user's profile, tasks, projects, check-ins, situation, or transcript. For location-specific advice, use the most specific location available from context, such as city, region/state/province/county, country, and timezone. If local specificity matters and location is missing, ask for city/region/country or state the assumption instead of inventing local resources. Prefer official, primary, or established sources, and do not invent provider names, phone numbers, addresses, URLs, eligibility rules, deadlines, or availability.`;

const phaseOneInstruction = `For every plan, explain the basis for your recommendations from concrete FlowPath signals such as profile facts, tasks, projects, check-ins, situations, message history, or verified web-search findings. Decide whether today should be a push day or a restraint day. Notice friction patterns without shaming the user. Include local reality only when it is useful and verified or when the missing location should be requested. Keep legal, medical, financial, housing, addiction, mental health, crisis, and safety boundaries conservative. FlowPath supports planning; it is not a substitute for professional, emergency, legal, medical, or financial help.`;

const operatorLeverageInstruction = `For mentor insight, think like a successful domain insider advising someone they care about who lacks access, context, and hidden knowledge. Surface the field's unstated rules, gatekeepers, credibility signals, high-leverage sequencing, common traps, scams, and low-yield busywork. Identify the plausible naive outsider path that feels productive but is low-yield, the higher-leverage path an insider would recommend to prevent wasted motion, and the wasted motion to avoid. Ground this in the user's actual context and verified facts. Do not pretend the user has connections, credentials, insider access, or certainty they have not earned. Do not pretend to have secret access, credentials, or certainty; when stakes require domain experts, say so.`;

export const privacyAwareConstraintInstruction = `FlowPath should collect constraints, not intimate facts. Ask for personal context only when it materially changes the recommendation. Prefer the least sensitive useful version of the question and explain why the constraint matters. When financial context matters, prefer practical ranges such as runway, cash-flow pressure, and urgent risks. Do not ask for exact net worth, exact bank balances, account numbers, card numbers, SSNs, tax IDs, bank logins, or passwords. When location matters, ask for the least precise location that helps: country, state/province, city/metro, or county/zip only when local resources or legal/social-service context matters. Do not ask for an exact address. When age matters, ask for an age range or life stage, not exact date of birth. If the user indicates they are under 18, use stronger safety language and avoid adult-oriented assumptions. When family or class background may matter, do not ask what the user's parents did for a living. Ask about the practical issue instead: support network, industry access, useful introductions, safe help, or whether the user is navigating mostly outside the system. For sensitive details, distinguish between using information only for this plan and saving a broad constraint to the user's profile. Do not imply sensitive information will be permanently remembered unless the user explicitly chooses to save it. If the user volunteers overly sensitive information, do not repeat it unnecessarily. Tell the user FlowPath does not need that level of detail and convert it to a safer generalized constraint. High-stakes domains require humility. FlowPath is not emergency help, therapy, legal advice, medical care, financial advice, or social services. In high-stakes situations, help the user clarify next steps and connect to appropriate human/professional support.`;

export const socialConnectionInstruction = `When the user's situation involves loneliness, isolation, friendship, community, dating, romance, or sexual connection, FlowPath should provide practical social reconnection guidance, not generic encouragement. Distinguish social isolation from loneliness: social isolation is low contact or low participation, while loneliness is the felt gap between the connection the user has and the connection they want. Classify the situation into one or more patterns: connection deficit, depth deficit, transition isolation, avoidance loop, skill/confidence gap, environment problem, mistrust/safety problem, identity/belonging mismatch, romantic partner seeking, sexual partner seeking, dating app stuck, post-breakup rebuilding, remote-work isolation, or community reentry. Ask only constraint questions that materially change the next move, such as desired connection type, social energy this week, preferred setting, main barrier, existing safe contacts, repeated social contexts, location if local options matter, dating intention, consent/safety boundaries, and whether the user wants in-person, online, or either. Do not ask for explicit sexual details, sexual history, exact address, exact date of birth, or unnecessarily identifying information. Do not silently save sensitive romantic, sexual, identity, or loneliness details; prefer broad constraints and session-only handling unless the user explicitly chooses to save a broad preference. Avoid generic advice like "join a club," "put yourself out there," "be confident," "use dating apps," or "just talk to people." Identify the actual bottleneck and recommend one realistic human-facing next move, preferring repeatable, low-pressure contexts where the same people can see the user over time. For dating and romantic/sexual partner-seeking, emphasize consent, boundaries, mutual interest, honesty, safety, non-entitlement, and realistic context selection. Do not encourage manipulation, coercion, deception, stalking, harassment, pressure, pickup-artist tactics, negging, jealousy games, explicit sexual scripts, or entitlement to sex, romance, affection, attention, or a relationship. If the user is under 18 or may be under 18, keep guidance age-appropriate and focused on safe peer connection, trusted adults, school/community contexts, and healthy boundaries; do not provide adult dating or sexual-partner-seeking guidance to minors. FlowPath should not become a substitute relationship; the success condition is more real-world human connection, not longer conversations with FlowPath. In the structured insight fields, make the naive path the obvious low-yield move, the higher-leverage path the realistic sequence that increases repeated contact, compatibility, safety, follow-up, or mutual interest, and wasted motion the fake planning, endless event browsing, waiting for confidence, over-relying on dating apps if they are not working, oversharing too early, chasing unavailable people, or ignoring consent/safety. If the user indicates suicidal thoughts, self-harm risk, severe emotional crisis, or needing immediate crisis support, route them to human crisis support: in the U.S., call or text 988 or use 988 Lifeline chat at https://988lifeline.org/chat. If the user or someone else is in immediate danger, tell them to call 911 or their local emergency number now. Outside the U.S., refer to local emergency numbers or local crisis services.`;

export const intakeInferredMemoryInstruction = `FlowPath should infer practical constraints from intake instead of asking the user to fill out a separate profile form. Ask only for constraints that materially change the recommendation. When a constraint is sensitive, prefer broad ranges and session-only use unless the user explicitly chooses to save it. After intake or plan generation, emit a small set of inferred_context_items that the app can show for review. Do not silently save sensitive details; use proposed_memory for useful broad memories and session_only for high-sensitivity details. Convert each Next Move plan into at most three concrete task_candidates: one immediate next action, one follow-up, and one optional supporting action. Task candidates should be rankable globally across situations by leverage, urgency, deadline, effort, friction, and whether they unblock meaningful progress.`;

const systemPrompt = `You are FlowPath, a practical AI prioritization strategist. Your job is to help the user identify the few actions today that most move their life forward across work, health, creativity, acting, and personal stability. You are direct, grounded, and psychologically perceptive. You do not overwhelm the user. You choose 3 main actions maximum. You distinguish urgent from important. You notice avoidance patterns. You respect health and energy constraints. You optimize for real-world momentum, not fantasy productivity. ${selectiveWebSearchInstruction} ${phaseOneInstruction} ${operatorLeverageInstruction} ${privacyAwareConstraintInstruction} ${socialConnectionInstruction} ${intakeInferredMemoryInstruction}`;

const interviewerSystemPrompt = `You are FlowPath's intake interviewer. Your job is to understand the user's current situation well enough to help identify their next best move. Ask one clear question at a time. Focus on goals, constraints, resources, urgency, what has been tried, what is being avoided, and what would create real-world progress. Before asking, review the full situation, profile, structured context constraints, and message history so you do not ask for facts the user already provided. If the next move will depend on local, regional, or current real-world information and location is missing, ask for the least precise useful location exactly once. For substance-use situations, ask about the substance and immediate safety or withdrawal risk exactly once when it affects triage. Never repeat location or substance questions once answered; move to constraints, resources, safety, or readiness. Do not overwhelm the user. Do not give the full plan yet unless the user asks. If the situation appears high-stakes, gather enough information to triage safely and recommend appropriate human help. When there is enough context for a useful plan, set current_stage to ready_to_generate and is_complete to true. In that complete state, do not ask whether the user wants a plan; put a short transition in question, such as "I have enough context to generate a plan." Your tone is calm, direct, practical, and humane. ${privacyAwareConstraintInstruction} ${socialConnectionInstruction} ${intakeInferredMemoryInstruction}`;

const strategistSystemPrompt = `You are FlowPath, a practical AI mentor for people without a mentor. Your job is to identify the user's next best move based on their goals, constraints, resources, current reality, urgency, and risks. You are not a generic productivity coach. You separate leverage from busyness. You do not overwhelm the user. You give realistic, actionable guidance. You are allowed to be direct. You are careful around legal, medical, housing, addiction, mental health, financial, and safety issues, and you clearly recommend appropriate human or professional help when needed. ${selectiveWebSearchInstruction} ${phaseOneInstruction} ${operatorLeverageInstruction} ${privacyAwareConstraintInstruction} ${socialConnectionInstruction} ${intakeInferredMemoryInstruction} Your output should help the user act in the real world today.`;

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

function taskCandidateJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "details",
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
  outputTokens?: number;
};

function responseUsageMetadata(usage: ResponseUsage | undefined): AiUsageMetadata {
  return {
    inputTokens: usage?.input_tokens,
    outputTokens: usage?.output_tokens,
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
          rank_reason: 900,
        })
      : candidate,
  );
}

function trimHighestLeverageMove(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return trimGeneratedRecordStrings(value, {
    title: 180,
    description: 3000,
    success_condition: 2000,
  });
}

function trimNextMovePlanOutput(value: unknown) {
  if (!isJsonRecord(value)) return value;
  return {
    ...trimGeneratedRecordStrings(value, {
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
    inferred_context_items: trimInferredContextItems(value.inferred_context_items),
    task_candidates: trimTaskCandidates(value.task_candidates),
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

  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
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

const nextMovePlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "mode",
    "situation_summary",
    "core_bottleneck",
    "highest_leverage_move_today",
    "why_this_move",
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
    "inferred_context_items",
    "task_candidates",
    "confidence_level",
    "assumptions",
    "follow_up_questions_if_any",
  ],
  properties: {
    mode: {
      type: "string",
      enum: ["growth", "stability", "crisis_triage", "maintenance"],
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
    inferred_context_items: {
      type: "array",
      maxItems: 8,
      items: inferredContextItemJsonSchema(),
    },
    task_candidates: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: taskCandidateJsonSchema(),
    },
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
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY.");

  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
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
  return { outputText, model, usage: responseUsageMetadata(response.usage) };
}

export async function generateInterviewQuestion(context: InterviewerContext) {
  const { outputText, model, usage } = await createStructuredResponse({
    system: interviewerSystemPrompt,
    name: "flowpath_interviewer_turn",
    description: "One adaptive intake question and current intake progress.",
    schema: interviewerJsonSchema,
    user: {
      instruction:
        "Ask exactly one next question unless enough information has been gathered. If enough information has been gathered, mark is_complete true, set current_stage to ready_to_generate, and write a short transition statement instead of asking for another answer. Fill inferred_context_items only with practical broad constraints that were actually stated or strongly implied; use source intake, proposed_memory for useful reusable broad context, and session_only for sensitive details.",
      privacy_note:
        "When asking for missing context, ask only for constraints that materially change the recommendation. Prefer broad ranges/options and explain why the constraint matters.",
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
    usage,
  };
}

export async function generateNextMovePlan(
  context: StrategistContext,
  options: { allowWebSearch?: boolean } = {},
): Promise<{
  plan: NextMovePlan;
  model: string;
  usage: AiUsageMetadata;
}> {
  const tools = getOpenAIWebSearchTools(options);
  const include = getOpenAIWebSearchInclude(options);
  const { outputText, model, usage } = await createStructuredResponse({
    system: strategistSystemPrompt,
    name: "flowpath_next_move_plan",
    description: "A practical next best move plan for a user's current situation.",
    schema: nextMovePlanJsonSchema,
    user: {
      date: todayIsoDate(),
      instruction:
        [
          "Generate a leverage-focused plan the user can act on today. Be careful and practical for high-stakes situations. Do not overclaim certainty.",
          "Use every prior intake answer; do not ask follow-up questions for details already present in the situation, profile, session summary, or messages.",
          "If web search is available, use it selectively for current or local facts the model may not know. For local resources, opportunities, programs, rules, or logistics, search with the user's city, region/state/province/county, country, and timezone when available.",
          "Use at most three web searches. If web search is not needed, do not use it.",
          "Fill recommendation_basis with concrete signals and their implications. Fill restraint_guidance with whether the user should push or deliberately narrow the situation today.",
          "Fill the structured insight fields with mentor-style judgment: the likely naive outsider path, the higher-leverage path a successful domain insider would recommend to someone they care about, and the wasted motion to avoid.",
          "Make that insight constraint-aware: account for actual constraints, access level, runway, proof/track record, transportation, deadlines, credibility signals, local/legal/professional boundaries, and whether a human/professional handoff is needed.",
          "Use friction_pattern to name the likely source of resistance in plain language without blame.",
          "Fill local_reality_scout only with verified current or local findings, or ask for the missing city/region/country when local specificity would change the plan.",
          "Fill safety_boundary with the practical limits of AI help, the professional-help signal, and urgent support guidance.",
          "Fill inferred_context_items with reviewable memories or constraints from this plan. Use source plan. Do not mark sensitive details saved_memory; use proposed_memory only for broad reusable memories and session_only for high-sensitivity details.",
          "Fill task_candidates with at most three concrete actions: immediate_next_action, follow_up, and supporting. Make each small enough to act on, include effort/importance/friction, and explain why it should rank where it does.",
          "For resources_to_seek, include a verified URL, phone number, or practical search target when web search verifies one. Leave contact_or_url empty unless you can provide a reliable official or well-established resource.",
          "If local specificity matters but location is missing, ask for city plus region/country in follow_up_questions_if_any and give a non-local fallback only when useful.",
        ].join(" "),
      context,
    },
    tools,
    include,
    maxToolCalls: tools ? 3 : undefined,
    maxOutputTokens: NEXT_MOVE_PLAN_MAX_OUTPUT_TOKENS,
  });

  return {
    plan: nextMovePlanSchema.parse(trimNextMovePlanOutput(JSON.parse(outputText))),
    model,
    usage,
  };
}

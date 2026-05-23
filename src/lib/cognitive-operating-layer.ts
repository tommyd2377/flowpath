import {
  cognitiveMetadataSchema,
  interventionSelectionSchema,
  memorySelectionSchema,
  responseEvaluatorSchema,
  stateDetectionSchema,
  webSearchDecisionSchema,
  type CognitiveMetadata,
  type FlowPathState,
  type InterventionSelection,
  type InterventionType,
  type MemorySelection,
  type OutcomeValue,
  type ResponseEvaluatorOutput,
  type StateDetection,
  type WebSearchDecision,
} from "./cognitive-schemas";
import { getModelForRole, getModelRoutingConfig } from "./model-routing";
import type {
  InferredContextItem,
  IntakeMessage,
  NextMovePlan,
  PlanTaskCandidate,
  Profile,
  Situation,
  StoredNextMovePlan,
  Task,
} from "./types";

type Textish = string | null | undefined;

export type CognitiveLayerInput = {
  userMessage: string;
  situation?: Situation | null;
  messages?: IntakeMessage[];
  profile?: Profile | null;
  inferredContextItems?: InferredContextItem[];
  openTasks?: Task[];
  recentPlans?: StoredNextMovePlan[];
  allowWebSearch?: boolean;
};

export type CognitivePlanContext = {
  stateDetection: StateDetection;
  intervention: InterventionSelection;
  memorySelection: MemorySelection;
  webSearchDecision: WebSearchDecision;
  repeatedTopic: boolean;
  useEscalationModel: boolean;
};

export type OutcomeInference = {
  userOutcome: OutcomeValue;
  evidence: string;
  notes: string;
};

const stateLabels: Record<FlowPathState, string> = {
  execution_mode: "execution",
  planning_mode: "planning",
  research_mode: "research",
  rumination_mode: "rumination",
  anxiety_mode: "anxiety",
  creative_mode: "creative",
  product_strategy_mode: "product strategy",
  coding_mode: "coding",
  social_real_world_mode: "social / real world",
  health_caution_mode: "health caution",
  legal_financial_caution_mode: "legal / financial caution",
  unclear_mode: "unclear",
};

const genericAdvicePattern =
  /\b(believe in yourself|stay positive|take it one day at a time|you've got this|just start somewhere|be kind to yourself|trust the process|everything happens for a reason)\b/i;

function compactText(...values: Textish[]) {
  return values
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function textForInput(input: CognitiveLayerInput) {
  return compactText(
    input.situation?.category,
    input.situation?.title,
    input.situation?.description,
    input.userMessage,
  ).toLowerCase();
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function hasProductStrategySignal(text: string) {
  return hasAny(text, [
    /\bstartup\b/,
    /\bfounder\b/,
    /\bgtm\b/,
    /\bgo[-\s]?to[-\s]?market\b/,
    /\bproduct strategy\b/,
    /\bpricing\b/,
    /\bactivation\b/,
    /\bretention\b/,
    /\barchitecture\b/,
    /\bmvp\b/,
    /\bprototype\b/,
    /\bcustomers?\b/,
    /\bbuyers?\b/,
    /\blanding page\b/,
    /\bpilot\b/,
    /\bvalidation\b/,
    /\bsales discovery\b/,
  ]);
}

function hasRuminationSignal(text: string) {
  return hasAny(text, [
    /\basking the same\b/,
    /\boverthink(ing)?\b/,
    /\bruminat(ing|ion)\b/,
    /\breassur(e|ance)\b/,
    /\bwhat if\b.*\bwhat if\b/,
    /\bloop(ing)?\b/,
  ]);
}

function uniqueStates(states: FlowPathState[], primary: FlowPathState) {
  return states.filter((state, index) => state !== primary && states.indexOf(state) === index);
}

function wordSet(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );
}

function overlapRatio(first: string, second: string) {
  const firstWords = wordSet(first);
  const secondWords = wordSet(second);
  if (firstWords.size === 0 || secondWords.size === 0) return 0;
  let overlap = 0;
  for (const word of firstWords) {
    if (secondWords.has(word)) overlap += 1;
  }
  return overlap / Math.min(firstWords.size, secondWords.size);
}

export function detectRepeatedTopic(messages: IntakeMessage[] = [], currentMessage: string) {
  const recentUserMessages = messages
    .filter((message) => message.role === "user")
    .slice(-4)
    .map((message) => message.content);
  if (recentUserMessages.length < 2) return false;

  return recentUserMessages
    .slice(0, -1)
    .some((previous) => overlapRatio(previous, currentMessage) >= 0.62);
}

function inferActionReadiness(text: string): StateDetection["action_readiness"] {
  if (
    hasAny(text, [
      /\bready to\b/,
      /\bwhat should i do\b/,
      /\bnext step\b/,
      /\btoday\b/,
      /\bright now\b/,
      /\bexecute\b/,
      /\bship\b/,
      /\bimplement\b/,
      /\bdo it\b/,
    ])
  ) {
    return "high";
  }
  if (hasAny(text, [/\bmaybe\b/, /\bnot sure\b/, /\bthinking about\b/, /\bplan\b/])) {
    return "medium";
  }
  return "low";
}

function inferEmotionalTemperature(text: string): StateDetection["emotional_temperature"] {
  if (
    hasAny(text, [
      /\bpanic(ked|king)?\b/,
      /\bterrified\b/,
      /\bfreaking out\b/,
      /\bspiral(ing)?\b/,
      /\bcan'?t stop\b/,
      /\bdesperate\b/,
      /\boverwhelmed\b/,
      /\bwant to die\b/,
      /\bsuicid(e|al)\b/,
    ])
  ) {
    return "high";
  }
  if (hasAny(text, [/\banxious\b/, /\bscared\b/, /\bworried\b/, /\bstuck\b/, /\bavoid(ed|ing)?\b/])) {
    return "medium";
  }
  return "low";
}

function needsCurrentFacts(text: string) {
  return hasAny(text, [
    /\b(search|look up|browse|google)\b/,
    /\bcurrent(ly)?\b/,
    /\blatest\b/,
    /\btoday'?s\b/,
    /\bthis week\b/,
    /\bpricing\b/,
    /\bprice\b/,
    /\bcosts?\b/,
    /\bavailability\b/,
    /\bschedule\b/,
    /\blaws?\b/,
    /\bregulations?\b/,
    /\bpolicy\b/,
    /\bbenefits?\b/,
    /\bapi docs?\b/,
    /\bdocs?\b/,
    /\bversion\b/,
    /\bcompare\b/,
    /\brecommendations?\b/,
  ]);
}

function explicitResearchSignal(text: string) {
  return hasAny(text, [
    /\b(search|look up|browse|google)\b/,
    /\blatest\b/,
    /\bcurrent(ly)?\b/,
    /\btoday'?s\b/,
    /\bthis week\b/,
    /\blaws?\b/,
    /\bregulations?\b/,
    /\bpolicy\b/,
    /\bapi docs?\b/,
    /\bdocs?\b/,
    /\bversion\b/,
  ]);
}

function stateForText(text: string, repeatedTopic: boolean): FlowPathState {
  if (
    hasAny(text, [
      /\bmedicat(ion|ions|ed)\b/,
      /\bdose\b/,
      /\bsymptoms?\b/,
      /\bdoctor\b/,
      /\bmedical\b/,
      /\binjury\b/,
      /\bheart rate\b/,
      /\bblood pressure\b/,
      /\bside effects?\b/,
      /\bfitness\b/,
      /\bbody\b/,
    ])
  ) {
    return "health_caution_mode";
  }

  if (
    hasAny(text, [
      /\blegal\b/,
      /\blawyer\b/,
      /\bcourt\b/,
      /\bbenefits?\b/,
      /\bdebt\b/,
      /\btax(es)?\b/,
      /\brent\b/,
      /\beviction\b/,
      /\bhousing\b/,
      /\bloan\b/,
      /\bcredit\b/,
      /\bfinancial\b/,
      /\bmoney\b/,
      /\bbankruptcy\b/,
    ])
  ) {
    return "legal_financial_caution_mode";
  }

  if (inferEmotionalTemperature(text) === "high") return "anxiety_mode";

  if (explicitResearchSignal(text)) return "research_mode";

  if (
    hasAny(text, [
      /\btypescript\b/,
      /\bjavascript\b/,
      /\breact\b/,
      /\bnext\.?js\b/,
      /\bdebug\b/,
      /\bbug\b/,
      /\berror\b/,
      /\bstack trace\b/,
      /\bimplement\b/,
      /\bcodebase\b/,
      /\bapi route\b/,
      /\bschema\b/,
      /\bmigration\b/,
    ])
  ) {
    return "coding_mode";
  }

  if (
    hasAny(text, [
      /\bscreenplay\b/,
      /\bscript\b/,
      /\bscene\b/,
      /\bcharacter\b/,
      /\bnovel\b/,
      /\bstory\b/,
      /\bsubtext\b/,
      /\bdraft\b/,
      /\brewrite\b/,
      /\bcreative\b/,
    ])
  ) {
    return "creative_mode";
  }

  if (hasProductStrategySignal(text)) {
    return "product_strategy_mode";
  }

  if (repeatedTopic || hasRuminationSignal(text)) {
    return "rumination_mode";
  }

  if (
    hasAny(text, [
      /\bdating\b/,
      /\bfriends?\b/,
      /\bsocial\b/,
      /\blonel(y|iness)\b/,
      /\bnyc\b/,
      /\blocation\b/,
      /\bin person\b/,
      /\bcommunity\b/,
      /\brelationship\b/,
    ])
  ) {
    return "social_real_world_mode";
  }

  if (inferActionReadiness(text) === "high") return "execution_mode";

  if (hasAny(text, [/\bplan\b/, /\borganize\b/, /\bschedule\b/, /\broadmap\b/, /\bprioriti[sz]e\b/])) {
    return "planning_mode";
  }

  return "unclear_mode";
}

function secondaryStatesForText(
  text: string,
  primary: FlowPathState,
  repeatedTopic: boolean,
) {
  const states: FlowPathState[] = [];
  if ((repeatedTopic || hasRuminationSignal(text)) && primary !== "rumination_mode") {
    states.push("rumination_mode");
  }
  if (inferEmotionalTemperature(text) !== "low" && primary !== "anxiety_mode") {
    states.push("anxiety_mode");
  }
  if (needsCurrentFacts(text) && primary !== "research_mode") states.push("research_mode");
  if (hasProductStrategySignal(text) && primary !== "product_strategy_mode") {
    states.push("product_strategy_mode");
  }
  if (hasAny(text, [/\bcode\b/, /\bdebug\b/, /\bimplement\b/]) && primary !== "coding_mode") {
    states.push("coding_mode");
  }
  if (inferActionReadiness(text) === "high" && primary !== "execution_mode") {
    states.push("execution_mode");
  }
  return uniqueStates(states, primary).slice(0, 5);
}

function riskFlagsForText(text: string, primary: FlowPathState) {
  const flags: string[] = [];
  if (primary === "health_caution_mode") flags.push("health_caution");
  if (primary === "legal_financial_caution_mode") flags.push("legal_financial_caution");
  if (hasAny(text, [/\bsuicid(e|al)\b/, /\bkill myself\b/, /\bself[-\s]?harm\b/, /\bimmediate danger\b/])) {
    flags.push("crisis_or_immediate_safety");
  }
  if (hasAny(text, [/\beviction\b/, /\bhousing\b/, /\bdeadline\b/])) flags.push("time_sensitive_stakes");
  if (hasAny(text, [/\bmedication\b/, /\bdose\b/, /\bsymptoms?\b/])) flags.push("medical_uncertainty");
  return Array.from(new Set(flags)).slice(0, 8);
}

function recommendedInterventionForState(primary: FlowPathState): string {
  const mapping: Record<FlowPathState, InterventionType> = {
    execution_mode: "concise_execution_plan",
    planning_mode: "task_breakdown",
    research_mode: "research_then_synthesize",
    rumination_mode: "stop_rumination_redirect_to_action",
    anxiety_mode: "emotional_stabilization",
    creative_mode: "creative_feedback",
    product_strategy_mode: "challenge_assumption",
    coding_mode: "step_by_step_debugging",
    social_real_world_mode: "one_next_action",
    health_caution_mode: "health_caution",
    legal_financial_caution_mode: "financial_or_legal_caution",
    unclear_mode: "ask_one_clarifying_question",
  };
  return mapping[primary];
}

export function detectUserState(input: CognitiveLayerInput): StateDetection {
  const text = textForInput(input);
  const repeatedTopic = detectRepeatedTopic(input.messages, input.userMessage);
  const primary = stateForText(text, repeatedTopic);
  const riskFlags = riskFlagsForText(text, primary);
  const actionReadiness = inferActionReadiness(text);
  const emotionalTemperature = inferEmotionalTemperature(text);
  const currentFactsNeeded = needsCurrentFacts(text);
  const needsMemory =
    !["unclear_mode", "research_mode"].includes(primary) ||
    actionReadiness !== "low" ||
    riskFlags.length > 0;

  return stateDetectionSchema.parse({
    primary_state: primary,
    secondary_states: secondaryStatesForText(text, primary, repeatedTopic),
    confidence: primary === "unclear_mode" ? 0.42 : repeatedTopic ? 0.86 : 0.74,
    user_intent:
      input.userMessage.trim().slice(0, 420) ||
      input.situation?.title ||
      "The user needs next-move guidance.",
    emotional_temperature: emotionalTemperature,
    action_readiness: actionReadiness,
    risk_flags: riskFlags,
    needs_web_search:
      currentFactsNeeded ||
      primary === "research_mode" ||
      primary === "health_caution_mode" ||
      primary === "legal_financial_caution_mode",
    needs_memory: needsMemory,
    needs_task_creation:
      actionReadiness === "high" ||
      ["execution_mode", "coding_mode", "product_strategy_mode", "creative_mode", "social_real_world_mode"].includes(primary),
    needs_escalation:
      riskFlags.length > 0 ||
      hasAny(text, [/\bdeep analysis\b/, /\bcomplex\b/, /\barchitecture\b/, /\bhigh stakes\b/]),
    recommended_intervention: recommendedInterventionForState(primary),
    reasoning_summary: `Detected ${stateLabels[primary]} from the situation/message, with ${actionReadiness} action readiness and ${emotionalTemperature} emotional temperature.`,
  });
}

function baseIntervention(state: StateDetection, text: string): InterventionSelection {
  const primary = state.primary_state;
  const interventionType = recommendedInterventionForState(primary) as InterventionType;
  const shouldCreateTasks = state.needs_task_creation && !state.risk_flags.includes("crisis_or_immediate_safety");
  const maxTasks =
    primary === "rumination_mode" || primary === "anxiety_mode"
      ? 1
      : primary === "research_mode" && !state.needs_task_creation
        ? 0
        : shouldCreateTasks
          ? 3
          : 0;

  const mustInclude: string[] = [];
  const mustAvoid: string[] = ["Generic motivational advice", "Overlong abstract explanation"];
  const successCriteria = ["Gives a concrete next move appropriate to the detected state."];

  if (primary === "rumination_mode") {
    mustInclude.push("Name the repeated loop briefly", "Give one next action or experiment");
    mustAvoid.push("Long reassurance", "A longer version of the same answer");
    successCriteria.push("Stops reinforcing rumination and redirects to action.");
  }
  if (primary === "health_caution_mode") {
    mustInclude.push("Clear medical uncertainty boundary", "Suggest professional care when appropriate");
    mustAvoid.push("Definitive diagnosis or medication certainty");
    successCriteria.push("Distinguishes general support from medical advice.");
  }
  if (primary === "legal_financial_caution_mode") {
    mustInclude.push("Legal or financial caution", "Separate facts, assumptions, and suggestions");
    mustAvoid.push("Definitive legal, benefits, debt, housing, or financial conclusions");
    successCriteria.push("Avoids overclaiming in high-stakes domains.");
  }
  if (primary === "creative_mode") {
    mustInclude.push("Subtext, character psychology, structure, or emotional coherence");
    mustAvoid.push("Generic creativity encouragement");
    successCriteria.push("Turns creative feedback into a writing or revision action.");
  }
  if (primary === "product_strategy_mode") {
    mustInclude.push("Tradeoffs", "Implementation path", "Wasted motion to avoid");
    successCriteria.push("Identifies the product or GTM bottleneck.");
  }
  if (primary === "coding_mode") {
    mustInclude.push("Implementation/debugging path", "System or file-level specificity when available");
    successCriteria.push("Produces testable engineering steps.");
  }
  if (primary === "research_mode") {
    mustInclude.push("State whether current facts or web search changed the answer");
    mustAvoid.push("Invented current facts or unverifiable providers");
    successCriteria.push("Uses current information only when it matters.");
  }
  if (hasAny(text, [/\bdeep\b/, /\bthorough\b/, /\bfull analysis\b/])) {
    successCriteria.push("Provides the requested depth without losing the next action.");
  }

  return interventionSelectionSchema.parse({
    intervention_type: interventionType,
    response_length:
      primary === "rumination_mode" || primary === "execution_mode"
        ? "short"
        : state.needs_escalation
          ? "long"
          : "medium",
    tone:
      primary === "health_caution_mode" || primary === "legal_financial_caution_mode"
        ? "clinical"
        : primary === "creative_mode"
          ? "creative"
          : primary === "product_strategy_mode" || primary === "rumination_mode"
            ? "challenging"
            : state.emotional_temperature === "high"
              ? "calm"
              : "direct",
    should_create_tasks: shouldCreateTasks,
    max_tasks: maxTasks,
    should_ask_question: primary === "unclear_mode",
    question_if_needed:
      primary === "unclear_mode"
        ? "What would count as meaningful progress in the next 24-72 hours?"
        : null,
    must_include: mustInclude.slice(0, 8),
    must_avoid: mustAvoid.slice(0, 8),
    success_criteria: successCriteria.slice(0, 8),
  });
}

export function selectIntervention(
  state: StateDetection,
  input: Pick<CognitiveLayerInput, "userMessage" | "situation">,
) {
  return baseIntervention(state, textForInput({ ...input, userMessage: input.userMessage }));
}

type MemoryCandidate = {
  id: string;
  text: string;
  sensitivity: "low" | "medium" | "high";
  category: string;
  source: string;
};

function sensitivityFor(value: string): "low" | "medium" | "high" {
  if (value === "high") return "high";
  if (value === "moderate" || value === "medium") return "medium";
  return "low";
}

function profileMemoryCandidates(profile?: Profile | null): MemoryCandidate[] {
  if (!profile) return [];
  const fields: Array<[keyof Profile, string]> = [
    ["personal_profile", "profile"],
    ["current_season", "season"],
    ["core_priorities", "priorities"],
    ["constraints", "constraints"],
    ["operating_principles", "planning preference"],
    ["remember", "durable preference"],
    ["challenge_on", "challenge pattern"],
  ];

  const candidates: MemoryCandidate[] = fields.flatMap(([field, category]) => {
    const value = profile[field];
    if (typeof value !== "string" || !value.trim()) return [];
    return [
      {
        id: `profile.${field}`,
        text: value.trim(),
        sensitivity: field === "constraints" ? ("medium" as const) : ("low" as const),
        category,
        source: "profile",
      },
    ];
  });

  for (const [key, value] of Object.entries(profile.context_constraints ?? {})) {
    const text = compactText(JSON.stringify(value));
    if (!text || text === "{}") continue;
    candidates.push({
      id: `constraint.${key}`,
      text: `${key.replaceAll("_", " ")}: ${text}`,
      sensitivity:
        key.includes("financial") || key.includes("safety") || key.includes("social")
          ? "high"
          : "medium",
      category: key,
      source: "profile_constraints",
    });
  }

  return candidates;
}

function inferredMemoryCandidates(items: InferredContextItem[] = []): MemoryCandidate[] {
  return items.map((item) => ({
    id: `memory.${item.id}`,
    text: `${item.label}: ${item.value}`,
    sensitivity: sensitivityFor(item.sensitivity),
    category: item.category,
    source: item.source,
  }));
}

function statePreferenceKeywords(state: FlowPathState) {
  const base: Record<FlowPathState, string[]> = {
    execution_mode: ["time", "energy", "priority", "working style", "deadline", "constraint"],
    planning_mode: ["priority", "constraint", "time", "goal", "season"],
    research_mode: ["location", "tool", "preference", "project"],
    rumination_mode: ["challenge", "pattern", "avoid", "energy", "working style"],
    anxiety_mode: ["energy", "support", "safety", "constraint", "time"],
    creative_mode: ["screenplay", "creative", "writing", "story", "project", "draft"],
    product_strategy_mode: ["product", "startup", "user", "gtm", "pricing", "validation", "tool"],
    coding_mode: ["code", "repo", "typescript", "project", "tool", "architecture"],
    social_real_world_mode: ["location", "nyc", "social", "dating", "connection", "community"],
    health_caution_mode: ["health", "energy", "recovery", "safety", "constraint"],
    legal_financial_caution_mode: ["money", "financial", "housing", "legal", "deadline", "runway"],
    unclear_mode: [],
  };
  return base[state];
}

function scoreMemory(candidate: MemoryCandidate, input: CognitiveLayerInput, state: StateDetection) {
  const text = textForInput(input);
  const candidateText = candidate.text.toLowerCase();
  const preferenceKeywords = statePreferenceKeywords(state.primary_state);
  const overlap = overlapRatio(text, candidateText);
  const categoryBoost = preferenceKeywords.some((keyword) =>
    `${candidate.category} ${candidateText}`.includes(keyword),
  )
    ? 0.28
    : 0;
  const recencyBoost = candidate.source === "plan" || candidate.source === "intake" ? 0.06 : 0;
  const sensitivePenalty =
    candidate.sensitivity === "high" &&
    !["health_caution_mode", "legal_financial_caution_mode", "social_real_world_mode"].includes(
      state.primary_state,
    )
      ? 0.12
      : 0;
  return Math.max(0, Math.min(1, overlap + categoryBoost + recencyBoost - sensitivePenalty));
}

export function selectRelevantMemory(
  input: CognitiveLayerInput,
  state: StateDetection,
): MemorySelection {
  const candidates = [
    ...profileMemoryCandidates(input.profile),
    ...inferredMemoryCandidates(input.inferredContextItems),
  ];

  if (!state.needs_memory || candidates.length === 0) {
    return memorySelectionSchema.parse({
      selected_memories: [],
      excluded_memory_reasoning: state.needs_memory
        ? "No saved memory was available."
        : "The request did not need personal context.",
      context_budget_used: 0,
    });
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreMemory(candidate, input, state),
    }))
    .sort((first, second) => second.score - first.score);

  const selected = scored
    .filter((item) => item.score >= 0.14)
    .slice(0, 8);
  const fallback =
    selected.length >= 3
      ? selected
      : [
          ...selected,
          ...scored
            .filter((item) => !selected.includes(item))
            .slice(0, Math.min(3 - selected.length, scored.length)),
        ];

  const selected_memories = fallback.slice(0, 8).map(({ candidate, score }) => ({
    id: candidate.id,
    summary: candidate.text.slice(0, 600),
    relevance: Number(score.toFixed(2)),
    sensitivity: candidate.sensitivity,
    reason: `${candidate.source} context matched ${stateLabels[state.primary_state]} needs.`,
  }));

  return memorySelectionSchema.parse({
    selected_memories,
    excluded_memory_reasoning:
      selected_memories.length < candidates.length
        ? "Lower-relevance or unnecessarily sensitive memory was left out."
        : "All available relevant memory fit the context budget.",
    context_budget_used: selected_memories.reduce(
      (total, memory) => total + memory.summary.length,
      0,
    ),
  });
}

export function shouldUseWebSearch(
  input: CognitiveLayerInput,
  state: StateDetection,
  intervention: InterventionSelection,
): WebSearchDecision {
  const text = textForInput(input);
  const triggers: string[] = [];
  if (hasAny(text, [/\b(search|look up|browse|google)\b/])) triggers.push("explicit_user_request");
  if (hasAny(text, [/\blatest\b/, /\bcurrent(ly)?\b/, /\btoday\b/, /\bthis week\b/])) {
    triggers.push("current_or_time_sensitive");
  }
  if (hasAny(text, [/\blaws?\b/, /\bregulations?\b/, /\bpolicy\b/, /\bbenefits?\b/])) {
    triggers.push("laws_regulations_policies");
  }
  if (hasAny(text, [/\bpricing\b/, /\bprice\b/, /\bcosts?\b/, /\bproducts?\b/, /\btools?\b/])) {
    triggers.push("pricing_or_recommendations");
  }
  if (hasAny(text, [/\bapi docs?\b/, /\bdocs?\b/, /\blibrary\b/, /\bversion\b/])) {
    triggers.push("software_docs_may_have_changed");
  }
  if (state.primary_state === "health_caution_mode") triggers.push("health_factual_caution");
  if (state.primary_state === "legal_financial_caution_mode") {
    triggers.push("legal_financial_current_guidance");
  }

  const blockedByPolicy =
    ["creative_mode", "rumination_mode", "anxiety_mode"].includes(state.primary_state) &&
    triggers.length === 0;
  const shouldUse =
    Boolean(input.allowWebSearch) &&
    !blockedByPolicy &&
    (state.needs_web_search ||
      intervention.intervention_type === "research_then_synthesize" ||
      triggers.length > 0);

  return webSearchDecisionSchema.parse({
    should_use_web_search: shouldUse,
    reason: !input.allowWebSearch
      ? "Web search is unavailable for this request or tier."
      : blockedByPolicy
        ? "The request is better answered from user context and reasoning, not current web facts."
        : shouldUse
          ? `Web search is gated on because ${triggers.join(", ") || "the state detector requested current factual support"}.`
          : "No current, local, volatile, or explicit search need was detected.",
    triggers: Array.from(new Set(triggers)).slice(0, 8),
    blocked_by_policy: blockedByPolicy,
  });
}

export function shouldEscalateModel(
  input: CognitiveLayerInput,
  state: StateDetection,
  intervention: InterventionSelection,
) {
  const text = textForInput(input);
  if (state.needs_escalation) return true;
  if (
    ["health_caution_mode", "legal_financial_caution_mode"].includes(state.primary_state) &&
    state.emotional_temperature !== "low"
  ) {
    return true;
  }
  if (
    intervention.intervention_type === "code_architecture" ||
    (state.primary_state === "coding_mode" && /\barchitecture|migration|security|data model\b/i.test(text))
  ) {
    return true;
  }
  if (state.primary_state === "creative_mode" && /\bstructure|act two|character arc|theme\b/i.test(text)) {
    return true;
  }
  return /\b(deep analysis|think hard|thorough|complex)\b/i.test(text);
}

export function buildCognitivePlanContext(input: CognitiveLayerInput): CognitivePlanContext {
  const stateDetection = detectUserState(input);
  const intervention = selectIntervention(stateDetection, input);
  const memorySelection = selectRelevantMemory(input, stateDetection);
  const webSearchDecision = shouldUseWebSearch(input, stateDetection, intervention);
  const repeatedTopic = detectRepeatedTopic(input.messages, input.userMessage);

  return {
    stateDetection,
    intervention,
    memorySelection,
    webSearchDecision,
    repeatedTopic,
    useEscalationModel: shouldEscalateModel(input, stateDetection, intervention),
  };
}

function fullPlanText(plan: NextMovePlan) {
  return JSON.stringify(plan).toLowerCase();
}

function taskCandidateLooksConcrete(candidate: PlanTaskCandidate) {
  const text = `${candidate.title} ${candidate.details} ${candidate.description ?? ""}`.toLowerCase();
  return !/\b(think about|consider|reflect on|figure out)\b/.test(text);
}

export function evaluateNextMovePlan(
  plan: NextMovePlan,
  context: CognitivePlanContext,
): ResponseEvaluatorOutput {
  const text = fullPlanText(plan);
  const problems: string[] = [];
  const missing: string[] = [];
  let score = 1;

  const tooGeneric = genericAdvicePattern.test(text);
  const tooLong =
    context.intervention.response_length === "short" && text.length > 9000;
  const tooAbstract =
    plan.task_candidates.some((candidate) => !taskCandidateLooksConcrete(candidate)) ||
    /\bmore clarity\b|\bthink through\b/.test(
      `${plan.highest_leverage_move_today.title} ${plan.highest_leverage_move_today.description}`.toLowerCase(),
    );
  const missedMemory =
    context.stateDetection.needs_memory &&
    context.memorySelection.selected_memories.length > 0 &&
    plan.context_used.length === 0;
  const missedNextAction =
    !plan.highest_leverage_move_today.title ||
    !plan.first_10_minute_action.title ||
    plan.task_candidates.length === 0;
  const unsafeOrOverconfident =
    (["health_caution_mode", "legal_financial_caution_mode"].includes(
      context.stateDetection.primary_state,
    ) &&
      /\b(definitely|guaranteed|safe to|you should take|legal advice|financial advice)\b/i.test(text)) ||
    (context.stateDetection.risk_flags.length > 0 &&
      !/professional|doctor|lawyer|qualified|emergency|human help/i.test(
        `${plan.when_to_get_human_help} ${plan.safety_boundary.do_not_rely_on_ai_for}`,
      ));

  if (tooGeneric) {
    problems.push("The plan includes generic motivational language.");
    score -= 0.18;
  }
  if (tooLong) {
    problems.push("The answer is too long for the selected intervention.");
    score -= 0.12;
  }
  if (tooAbstract) {
    problems.push("At least one action is too abstract.");
    score -= 0.18;
  }
  if (missedMemory) {
    missing.push("Relevant selected memory was not reflected in context_used.");
    score -= 0.12;
  }
  if (missedNextAction) {
    missing.push("A concrete next action is missing.");
    score -= 0.25;
  }
  if (unsafeOrOverconfident) {
    problems.push("The plan is too certain for a cautious or high-stakes domain.");
    score -= 0.25;
  }
  if (plan.task_candidates.length > context.intervention.max_tasks) {
    problems.push("The plan creates too many task candidates for the selected intervention.");
    score -= 0.2;
  }
  if (
    context.stateDetection.primary_state === "rumination_mode" &&
    !/loop|uncertainty|experiment|one/i.test(
      `${plan.situation_read} ${plan.first_10_minute_action.details}`,
    )
  ) {
    missing.push("Rumination handling needs a stable conclusion and one experiment.");
    score -= 0.16;
  }

  const rewriteInstructions = [
    tooGeneric ? "Remove generic motivational language and ground the plan in concrete signals." : "",
    tooLong ? "Shorten the response and keep only the highest-leverage action path." : "",
    tooAbstract ? "Rewrite task candidates as observable actions with clear success conditions." : "",
    missedMemory ? "Use the selected memory compactly without exposing unnecessary sensitive detail." : "",
    missedNextAction ? "Add a specific first 10-minute action and one task candidate." : "",
    unsafeOrOverconfident ? "Add appropriate health/legal/financial uncertainty and human-help boundaries." : "",
    plan.task_candidates.length > context.intervention.max_tasks
      ? `Reduce task candidates to at most ${context.intervention.max_tasks}.`
      : "",
  ].filter(Boolean);

  const normalizedScore = Math.max(0, Number(score.toFixed(2)));

  return responseEvaluatorSchema.parse({
    passes: normalizedScore >= 0.72 && problems.length + missing.length === 0,
    score: normalizedScore,
    problems,
    missing_elements: missing,
    too_generic: tooGeneric,
    too_long: tooLong,
    too_abstract: tooAbstract,
    missed_memory: missedMemory,
    missed_next_action: missedNextAction,
    unsafe_or_overconfident: unsafeOrOverconfident,
    rewrite_instructions: rewriteInstructions.slice(0, 8),
  });
}

export function taskCandidateCap(context: CognitivePlanContext) {
  return Math.max(0, Math.min(3, context.intervention.max_tasks));
}

export function normalizePlanForIntervention(
  plan: NextMovePlan,
  context: CognitivePlanContext,
  sourceMessageId: string | null = null,
): NextMovePlan {
  const maxTasks = taskCandidateCap(context);
  const taskCandidates = plan.task_candidates.slice(0, maxTasks).map((candidate) => {
    const description = candidate.description || candidate.details;
    return {
      ...candidate,
      description,
      estimated_minutes: candidate.estimated_minutes ?? Math.min(480, Math.max(10, candidate.effort * 15)),
      friction_level:
        candidate.friction_level ??
        (candidate.effort >= 4 || candidate.friction_type === "scary" || candidate.friction_type === "blocked"
          ? "high"
          : candidate.effort <= 2
            ? "low"
            : "medium"),
      leverage:
        candidate.leverage ??
        (candidate.importance >= 5 ? "high" : candidate.importance >= 3 ? "medium" : "low"),
      why_now: candidate.why_now || candidate.rank_reason,
      success_condition:
        candidate.success_condition ||
        plan.highest_leverage_move_today.success_condition ||
        "The action is completed and the next blocker is clearer.",
      category: candidate.category || context.stateDetection.primary_state,
      source_message_id: candidate.source_message_id ?? sourceMessageId,
    };
  });

  return {
    ...plan,
    task_candidates: taskCandidates,
  };
}

export function buildRevisionInstruction(evaluator: ResponseEvaluatorOutput) {
  return [
    "Revise the prior plan once. Preserve the existing schema and useful specific details.",
    "Do not add extra breadth. Fix only the problems below.",
    ...evaluator.rewrite_instructions,
  ].join("\n");
}

export function compactProfileForMemorySelection(
  profile: Profile,
  memorySelection: MemorySelection,
): Profile {
  const selectedIds = new Set(memorySelection.selected_memories.map((memory) => memory.id));
  const compact: Profile = {
    ...profile,
    personal_profile: selectedIds.has("profile.personal_profile") ? profile.personal_profile : "",
    current_season: selectedIds.has("profile.current_season") ? profile.current_season : "",
    core_priorities: selectedIds.has("profile.core_priorities") ? profile.core_priorities : "",
    constraints: selectedIds.has("profile.constraints") ? profile.constraints : "",
    operating_principles: selectedIds.has("profile.operating_principles")
      ? profile.operating_principles
      : "",
    remember: selectedIds.has("profile.remember") ? profile.remember : "",
    challenge_on: selectedIds.has("profile.challenge_on") ? profile.challenge_on : "",
    context_constraints: Object.fromEntries(
      Object.entries(profile.context_constraints ?? {}).filter(([key]) =>
        selectedIds.has(`constraint.${key}`),
      ),
    ),
  };

  return compact;
}

export function inferOutcomeFromUserMessage(message: string): OutcomeInference | null {
  const text = message.toLowerCase();
  const evidence = message.trim().slice(0, 700);
  if (!evidence) return null;

  if (/\b(i did it|done|finished|completed|i took care of it)\b/.test(text)) {
    return { userOutcome: "acted", evidence, notes: "User reports completing or acting on the recommendation." };
  }
  if (/\b(that helped|it helped|helpful|i feel better|feel better)\b/.test(text)) {
    return { userOutcome: "improved", evidence, notes: "User reports improvement or usefulness." };
  }
  if (/\b(that didn'?t help|not helpful|useless|bad advice)\b/.test(text)) {
    return { userOutcome: "rejected", evidence, notes: "User reports the recommendation was not useful." };
  }
  if (/\b(i didn'?t do it|did not do it|avoided it|i avoided|put it off|deferred)\b/.test(text)) {
    return { userOutcome: "deferred", evidence, notes: "User reports not acting or avoiding the recommendation." };
  }
  if (/\b(still stuck|i'?m stuck|needs follow.?up|what now)\b/.test(text)) {
    return { userOutcome: "needs_followup", evidence, notes: "User reports remaining stuck or needing follow-up." };
  }
  if (/\b(asking the same thing again|same question again|spiral(ing)?|loop(ing)?)\b/.test(text)) {
    return { userOutcome: "spiraled", evidence, notes: "User reports a repeated loop." };
  }
  if (/\b(i feel worse|feel worse|made it worse|worsened)\b/.test(text)) {
    return { userOutcome: "worsened", evidence, notes: "User reports worsening." };
  }

  return null;
}

export function buildCognitiveMetadata({
  context,
  evaluator,
  responseRewritten,
  modelUsedByStage,
  promptTokensByStage,
  completionTokensByStage,
  totalEstimatedCost,
  webSearchUsed,
}: {
  context: CognitivePlanContext;
  evaluator: ResponseEvaluatorOutput | null;
  responseRewritten: boolean;
  modelUsedByStage: Record<string, string>;
  promptTokensByStage: Record<string, number>;
  completionTokensByStage: Record<string, number>;
  totalEstimatedCost: number | null;
  webSearchUsed?: boolean;
}): CognitiveMetadata {
  return cognitiveMetadataSchema.parse({
    state_detection: context.stateDetection,
    intervention: context.intervention,
    memory_selection: context.memorySelection,
    web_search: context.webSearchDecision,
    evaluator,
    repeated_topic: context.repeatedTopic,
    web_search_used: webSearchUsed ?? context.webSearchDecision.should_use_web_search,
    web_search_reason: context.webSearchDecision.reason,
    response_rewritten: responseRewritten,
    model_used_by_stage: {
      classifier: "deterministic",
      memory: "deterministic",
      evaluator: "deterministic",
      ...modelUsedByStage,
    },
    prompt_tokens_by_stage: promptTokensByStage,
    completion_tokens_by_stage: completionTokensByStage,
    total_estimated_cost: totalEstimatedCost,
  });
}

export function cognitiveTelemetryFromMetadata(metadata: CognitiveMetadata) {
  return {
    state_detected: metadata.state_detection.primary_state,
    intervention_type: metadata.intervention.intervention_type,
    model_used_by_stage: metadata.model_used_by_stage,
    prompt_tokens_by_stage: metadata.prompt_tokens_by_stage,
    completion_tokens_by_stage: metadata.completion_tokens_by_stage,
    total_estimated_cost: metadata.total_estimated_cost,
    evaluator_score: metadata.evaluator?.score ?? null,
    response_rewritten: metadata.response_rewritten,
    tasks_created_count: metadata.intervention.should_create_tasks
      ? metadata.intervention.max_tasks
      : 0,
    memory_items_used: metadata.memory_selection.selected_memories.length,
    web_search_used: metadata.web_search_used,
  };
}

export function configuredCognitiveModels() {
  return {
    ...getModelRoutingConfig(),
    classifier_runtime: "deterministic",
    memory_runtime: "deterministic",
    evaluator_runtime: "deterministic",
    generator_selected: getModelForRole("generator_model"),
    escalation_selected: getModelForRole("escalation_model"),
  };
}

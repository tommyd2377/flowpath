import { nextMovePlanSchema, type NextMovePlanInput } from "./schemas";
import type { SafetyRouteType, Situation, SituationUrgency } from "./types";

export type SafetyRouteDecision = {
  triggered: boolean;
  confidence: "none" | "low" | "medium" | "high";
  routeType: SafetyRouteType | null;
  planBehavior: "normal" | "safety_boundary" | "human_help_only";
  reason: string;
};

type SafetyPattern = {
  routeType: SafetyRouteType;
  high: RegExp[];
  medium: RegExp[];
  reason: string;
};

const safetyPatterns: SafetyPattern[] = [
  {
    routeType: "self_harm_or_suicide",
    high: [
      /\b(kill myself|end my life|die by suicide|suicide plan|can't stay safe|cannot stay safe)\b/i,
      /\b(about to|going to|tonight|right now).{0,40}\b(hurt myself|harm myself|self[- ]?harm|suicide)\b/i,
    ],
    medium: [
      /\b(suicidal thoughts?|self[- ]?harm urges?|not want to be alive|don't want to be alive|want to disappear)\b/i,
    ],
    reason: "self-harm or suicide language",
  },
  {
    routeType: "imminent_harm_to_others",
    high: [
      /\b(kill someone|hurt someone|attack someone|going to hurt|about to hurt)\b/i,
      /\b(i have a weapon|bringing a weapon|use a weapon)\b/i,
    ],
    medium: [/\b(violent urges?|afraid i might hurt|might hurt someone)\b/i],
    reason: "possible harm to others",
  },
  {
    routeType: "medical_emergency",
    high: [
      /\b(chest pain|can't breathe|cannot breathe|stroke|overdose|seizure|unconscious|severe bleeding)\b/i,
      /\b(anaphylaxis|poisoning|heart attack)\b/i,
    ],
    medium: [/\b(withdrawal|dangerous symptoms?|medical emergency|urgent medical)\b/i],
    reason: "possible medical emergency",
  },
  {
    routeType: "abuse_or_domestic_violence",
    high: [
      /\b(domestic violence|partner is hitting|partner hit|being beaten|trapped with an abuser)\b/i,
      /\b(unsafe at home|can't leave safely|cannot leave safely)\b/i,
    ],
    medium: [/\b(abusive relationship|afraid of my partner|controlling partner|threatened me)\b/i],
    reason: "possible abuse or domestic violence",
  },
  {
    routeType: "housing_or_physical_safety_emergency",
    high: [
      /\b(evicted today|locked out|nowhere safe tonight|sleeping outside tonight)\b/i,
      /\b(no safe place to sleep|unsafe shelter)\b/i,
    ],
    medium: [/\b(eviction notice|housing emergency|losing housing|about to be homeless)\b/i],
    reason: "housing or physical safety emergency",
  },
  {
    routeType: "legal_emergency",
    high: [/\b(arrested|court today|restraining order today|warrant|served papers today)\b/i],
    medium: [/\b(legal emergency|court date|lawsuit deadline|eviction court)\b/i],
    reason: "legal emergency or deadline",
  },
  {
    routeType: "severe_mental_health_crisis",
    high: [/\b(psychosis|hearing voices telling me|manic episode|can't tell what is real)\b/i],
    medium: [/\b(panic crisis|severe panic|mental health crisis)\b/i],
    reason: "severe mental health crisis",
  },
];

function textForSafety(input: {
  text?: string | null;
  situation?: Pick<Situation, "title" | "description" | "category" | "urgency"> | null;
}) {
  return [
    input.text,
    input.situation?.title,
    input.situation?.description,
    input.situation?.category,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function safetyRouteFromText(input: {
  text?: string | null;
  situation?: Pick<Situation, "title" | "description" | "category" | "urgency"> | null;
  urgency?: SituationUrgency | null;
}): SafetyRouteDecision {
  const text = textForSafety(input);
  for (const pattern of safetyPatterns) {
    if (pattern.high.some((regex) => regex.test(text))) {
      return {
        triggered: true,
        confidence: "high",
        routeType: pattern.routeType,
        planBehavior: "human_help_only",
        reason: pattern.reason,
      };
    }
    if (pattern.medium.some((regex) => regex.test(text))) {
      return {
        triggered: true,
        confidence: input.urgency === "crisis" || input.situation?.urgency === "crisis" ? "high" : "medium",
        routeType: pattern.routeType,
        planBehavior:
          input.urgency === "crisis" || input.situation?.urgency === "crisis"
            ? "human_help_only"
            : "safety_boundary",
        reason: pattern.reason,
      };
    }
  }

  if (input.urgency === "crisis" || input.situation?.urgency === "crisis") {
    return {
      triggered: true,
      confidence: "medium",
      routeType: "other_human_help_needed",
      planBehavior: "safety_boundary",
      reason: "crisis urgency selected",
    };
  }

  return {
    triggered: false,
    confidence: "none",
    routeType: null,
    planBehavior: "normal",
    reason: "no safety route matched",
  };
}

function safetyGuidance(decision: SafetyRouteDecision) {
  if (decision.routeType === "self_harm_or_suicide") {
    return {
      immediate:
        "If there is immediate danger or you may act soon, call 911 or your local emergency number now. In the U.S., call or text 988 or use 988 Lifeline chat.",
      human: "Contact a trusted person nearby and avoid being alone while risk is active.",
    };
  }
  if (decision.routeType === "medical_emergency") {
    return {
      immediate:
        "For urgent medical symptoms, call emergency services or go to urgent emergency care now.",
      human: "Use a qualified clinician or emergency responder for medical decisions.",
    };
  }
  if (decision.routeType === "imminent_harm_to_others") {
    return {
      immediate:
        "If someone may be harmed soon, move away from weapons or targets and call emergency services or a trusted crisis professional now.",
      human: "Use immediate human help before ordinary planning.",
    };
  }
  return {
    immediate:
      "If there is immediate danger, call local emergency services or a trusted person nearby now.",
    human:
      "Use appropriate human, professional, legal, medical, housing, or crisis support before relying on an AI plan.",
  };
}

export function buildSafetyRoutedPlan(
  situation: Pick<Situation, "title" | "description" | "urgency" | "category">,
  decision: SafetyRouteDecision,
): NextMovePlanInput {
  const guidance = safetyGuidance(decision);
  const title = situation.title || "urgent situation";
  const plan = {
    generation_mode: "operator_plan" as const,
    mode: "crisis_triage" as const,
    situation_read: `This looks like a high-stakes ${decision.reason} situation that needs immediate human support before ordinary planning.`,
    likely_bottleneck:
      "The bottleneck is safety and human support, not productivity or optimization.",
    key_constraints: [
      "Do not rely on FlowPath as emergency, legal, medical, financial, or crisis support.",
      "Stabilize immediate safety before making a broader plan.",
    ],
    situation_summary: `The user is asking about ${title}.`,
    core_bottleneck:
      "Immediate safety and qualified human support matter more than a normal next-move plan.",
    highest_leverage_move_today: {
      title: "Get immediate human support",
      description: guidance.immediate,
      estimated_minutes: 10,
      success_condition: "A trusted human, emergency service, or qualified support channel is actively involved.",
    },
    why_this_move:
      "Safety-sensitive situations should be handled by people who can respond in the real world.",
    first_10_minute_action: {
      title: "Contact live support",
      details: guidance.immediate,
    },
    first_30_minutes: [
      {
        title: "Reduce immediate danger",
        details:
          "Move to the safest available setting, contact live support, and avoid being alone if immediate risk is present.",
      },
    ],
    next_24_hours: [
      {
        title: "Use qualified help",
        details: guidance.human,
      },
    ],
    next_7_days: [
      {
        title: "Make a support plan",
        details:
          "After the immediate situation is stabilized, make a practical support plan with a qualified person or trusted helper.",
      },
    ],
    what_not_to_do: [
      "Do not treat this as a normal productivity problem.",
      "Do not rely on AI if immediate danger, medical risk, legal risk, or crisis risk is present.",
    ],
    likely_trap:
      "Trying to solve the whole situation alone instead of getting live human support first.",
    recommendation_basis: [
      {
        signal: decision.reason,
        source: "safety router",
        implication: "Human support should come before ordinary planning.",
      },
    ],
    restraint_guidance: {
      should_push: false,
      reason: "The useful move is stabilization, not adding more tasks.",
      minimum_viable_move: "Contact live support.",
      recovery_move: "Stay near a safe person or safe place.",
      scope_boundary: "Only handle immediate safety until the situation is stabilized.",
    },
    operator_insight: {
      naive_path: "Keep analyzing the situation alone.",
      operator_path: "Bring in live human support before making the next decision.",
      wasted_motion_to_avoid: "Optimizing a plan while immediate safety is unresolved.",
    },
    friction_pattern:
      "High stress can make it tempting to keep thinking instead of contacting real-world support.",
    local_reality_scout: {
      used_web_search: false,
      location_basis: "",
      findings: [],
      missing_location_question: "",
    },
    resources_to_seek: [],
    when_to_get_human_help: guidance.human,
    safety_boundary: {
      risk_level: decision.confidence === "high" ? "crisis" : "high",
      professional_help_signal: guidance.human,
      do_not_rely_on_ai_for:
        "Do not rely on FlowPath for emergency, crisis, legal, medical, housing, financial, or safety decisions.",
      urgent_support_guidance: guidance.immediate,
    },
    context_used: [
      {
        id: null,
        label: "Safety route",
        value: "The situation appears to require human support before normal planning.",
        category: "safety" as const,
        sensitivity: "high" as const,
        source: "situation" as const,
        persistence: "session_only" as const,
      },
    ],
    inferred_context_items: [],
    task_candidates: [
      {
        title: "Contact live support",
        details: guidance.immediate,
        description: guidance.immediate,
        estimated_minutes: 10,
        friction_level: "high" as const,
        leverage: "high" as const,
        why_now: "Immediate human support is the highest-leverage safety step.",
        success_condition: "Live support is contacted.",
        category: "safety",
        source_message_id: null,
        candidate_type: "immediate_next_action" as const,
        importance: 5,
        effort: 1,
        friction_type: "scary" as const,
        rank_reason: "Safety and live support come before normal task planning.",
        due_date: null,
      },
    ],
    confidence_level: decision.confidence === "high" ? "high" as const : "medium" as const,
    assumptions: ["Safety routing is based on text signals and may be conservative."],
    follow_up_questions_if_any: [],
  };

  return nextMovePlanSchema.parse(plan);
}

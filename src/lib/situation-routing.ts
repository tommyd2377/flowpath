import type { SituationUrgency } from "./types";
import {
  isCrisisSupportText,
  isImmediateDangerText,
  isSocialConnectionSituation,
} from "./social-connection";
import { isEntryDomainId } from "./entry-domains";

export const SITUATION_DOMAINS = [
  "work_money_career",
  "people_community_belonging",
  "craft_creativity_mastery",
  "urgent_stability",
  "open_loops_prioritization",
  "crisis_safety",
  "unknown",
] as const;

export type SituationDomain = (typeof SITUATION_DOMAINS)[number];

export type SituationRoutingContext = {
  title: string;
  description?: string;
  category: string;
  urgency: SituationUrgency;
};

export type SituationRoute = {
  domain: SituationDomain;
  confidence: "low" | "medium" | "high";
  reason: string;
};

export const FIRST_INTAKE_QUESTION_PURPOSES = [
  "clarify_decision",
  "clarify_goal",
  "clarify_constraint",
  "clarify_tradeoff",
  "clarify_success_criteria",
  "clarify_time_horizon",
  "clarify_action_readiness",
  "clarify_emotional_bottleneck",
  "clarify_risk_or_safety",
  "clarify_current_state",
  "clarify_creative_bottleneck",
  "clarify_priority",
  "skip_intake_generate_now",
] as const;

export type FirstIntakeQuestionPurpose =
  (typeof FIRST_INTAKE_QUESTION_PURPOSES)[number];

export type FirstIntakeGenericityRisk = "low" | "medium" | "high";

export type FirstIntakePlan = {
  domain: string;
  subtype: string;
  questionPurpose: FirstIntakeQuestionPurpose;
  decisionShape: string;
  missingInfoTarget: string;
  question: string;
  whyThisQuestion: string;
  genericityRisk: FirstIntakeGenericityRisk;
};

function fullText(situation: SituationRoutingContext) {
  return `${situation.category} ${situation.title} ${situation.description ?? ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

const domainPatterns: Record<Exclude<SituationDomain, "unknown">, RegExp[]> = {
  crisis_safety: [
    /\bsuicid(e|al)\b/,
    /\bself[-\s]?harm\b/,
    /\bimmediate danger\b/,
    /\bunsafe right now\b/,
  ],
  urgent_stability: [
    /\bhousing\b/,
    /\brent\b/,
    /\blease\b/,
    /\beviction\b/,
    /\blandlord\b/,
    /\bshelter\b/,
    /\bapartment\b/,
    /\broommate\b/,
    /\bplace to live\b/,
    /\brebuild(ing)?\b/,
    /\brecovery\b/,
    /\brough period\b/,
    /\bsleep\b/,
    /\blow energy\b/,
    /\bburn(ing)? out\b/,
    /\bhealth\b/,
    /\bdoctor\b/,
    /\bmedication\b/,
    /\bprescription\b/,
  ],
  people_community_belonging: [
    /\blonel(y|iness)\b/,
    /\bisolat(e|ed|ion)\b/,
    /\bfriend(s|ship)?\b/,
    /\bdate\b/,
    /\bdating\b/,
    /\bromantic\b/,
    /\bsexual connection\b/,
    /\bsocial momentum\b/,
    /\bremote work\b/,
    /\bcommunity\b/,
    /\bbelong(ing)?\b/,
  ],
  work_money_career: [
    /\bmoney pressure\b/,
    /\bfinancial\b/,
    /\blimited runway\b/,
    /\brunway\b/,
    /\bfreelance\b/,
    /\bcut(ting)? expenses\b/,
    /\bincome\b/,
    /\bcash\b/,
    /\bjob search\b/,
    /\bjobs?\b/,
    /\binterviews?\b/,
    /\bresume\b/,
    /\bportfolio\b/,
    /\bnetwork(ing)?\b/,
    /\bcareer change\b/,
    /\bcredential\b/,
    /\bproduct polish\b/,
    /\bproduct strategy\b/,
    /\bonboard(ing)?\b/,
    /\buser testing\b/,
    /\btry it out\b/,
    /\bpricing\b/,
    /\bprice\b/,
    /\bearly users?\b/,
    /\bmarketing\b/,
    /\bfeatures?\b/,
    /\bbusiness\b/,
    /\bopportunity\b/,
    /\boffer\b/,
    /\bmarket\b/,
  ],
  craft_creativity_mastery: [
    /\bcreative\b/,
    /\bwriting\b/,
    /\bcharacter\b/,
    /\barc\b/,
    /\brevis(e|ion)\b/,
    /\bapp idea\b/,
    /\bproject stuck\b/,
    /\bkeep switching\b/,
    /\bcraft\b/,
    /\bpractice\b/,
    /\bmastery\b/,
    /\bsport\b/,
    /\bhobby\b/,
    /\bfinish projects?\b/,
  ],
  open_loops_prioritization: [
    /\bopen loops?\b/,
    /\btoo many\b/,
    /\btoo many app ideas?\b/,
    /\b20 things\b/,
    /\bhealth, work, money, and relationships\b/,
    /\bdon't know what actually matters first\b/,
    /\boverwhelm(ed)?\b/,
  ],
};

function isMoneyCentral(text: string) {
  return hasAny(text, domainPatterns.work_money_career);
}

export function classifySituationDomain(
  situation: SituationRoutingContext,
): SituationRoute {
  const text = fullText(situation);
  const category = situation.category.toLowerCase();

  if (isEntryDomainId(situation.category)) {
    return {
      domain: situation.category,
      confidence: "high",
      reason: "The user selected this board as the primary entry domain.",
    };
  }

  if (
    situation.urgency === "crisis" ||
    isImmediateDangerText(text) ||
    isCrisisSupportText(text)
  ) {
    return {
      domain: "crisis_safety",
      confidence: "high",
      reason: "Crisis or immediate safety language is present.",
    };
  }

  if (hasAny(text, domainPatterns.open_loops_prioritization)) {
    return {
      domain: "open_loops_prioritization",
      confidence: "high",
      reason: "The situation is framed as global prioritization across many areas.",
    };
  }

  if (category.includes("overwhelm")) {
    return {
      domain: "open_loops_prioritization",
      confidence: "medium",
      reason: "The selected lane is overwhelm/open loops.",
    };
  }

  if (isSocialConnectionSituation(situation)) {
    return {
      domain: "people_community_belonging",
      confidence: "high",
      reason: "Connection, isolation, friendship, romance, or dating is central.",
    };
  }

  if (
    category.includes("work_money_career") ||
    category.includes("money") ||
    category.includes("career") ||
    category.includes("work") ||
    isMoneyCentral(text)
  ) {
    return {
      domain: "work_money_career",
      confidence: "high",
      reason: "Economic agency, work, income, opportunity, or career direction is central.",
    };
  }

  if (
    category.includes("urgent") ||
    category.includes("stability") ||
    category.includes("health") ||
    category.includes("housing") ||
    hasAny(text, domainPatterns.urgent_stability)
  ) {
    return {
      domain: "urgent_stability",
      confidence: "high",
      reason: "Immediate stability, housing, health-adjacent capacity, or recovery is central.",
    };
  }

  if (
    category.includes("people_community_belonging") ||
    category.includes("relationships") ||
    category.includes("connection") ||
    hasAny(text, domainPatterns.people_community_belonging)
  ) {
    return {
      domain: "people_community_belonging",
      confidence: "high",
      reason: "People, community, belonging, or real-world connection is central.",
    };
  }

  if (
    category.includes("craft_creativity_mastery") ||
    category.includes("creative") ||
    hasAny(text, domainPatterns.craft_creativity_mastery)
  ) {
    return {
      domain: "craft_creativity_mastery",
      confidence: "high",
      reason: "Craft, creativity, practice, mastery, or meaningful project progress is central.",
    };
  }

  return {
    domain: "unknown",
    confidence: "low",
    reason: "No specific domain is clear enough for a narrow first question.",
  };
}

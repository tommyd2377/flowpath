import type { SituationUrgency } from "./types";
import {
  isCrisisSupportText,
  isImmediateDangerText,
  isSocialConnectionSituation,
} from "./social-connection";
import { isFounderCategory } from "./founder-wedge";

export const SITUATION_DOMAINS = [
  "career_job_search",
  "social_connection_dating",
  "money_career_stabilization",
  "creative_project_focus",
  "recovery_energy_work",
  "housing_high_stakes",
  "open_loops_prioritization",
  "founder_product_validation",
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
  housing_high_stakes: [
    /\bhousing\b/,
    /\brent\b/,
    /\blease\b/,
    /\beviction\b/,
    /\blandlord\b/,
    /\bshelter\b/,
    /\bapartment\b/,
    /\broommate\b/,
    /\bplace to live\b/,
  ],
  social_connection_dating: [
    /\blonel(y|iness)\b/,
    /\bisolat(e|ed|ion)\b/,
    /\bfriend(s|ship)?\b/,
    /\bdate\b/,
    /\bdating\b/,
    /\bromantic\b/,
    /\bsexual connection\b/,
    /\bsocial momentum\b/,
    /\bremote work\b/,
  ],
  money_career_stabilization: [
    /\bmoney pressure\b/,
    /\bfinancial\b/,
    /\blimited runway\b/,
    /\brunway\b/,
    /\bfreelance\b/,
    /\bcut(ting)? expenses\b/,
    /\bincome\b/,
    /\bcash\b/,
  ],
  founder_product_validation: [
    /\bfounder\b/,
    /\bstartup\b/,
    /\bai app\b/,
    /\bbuilt an app\b/,
    /\bproduct polish\b/,
    /\bproduct strategy\b/,
    /\bonboard(ing)?\b/,
    /\buser testing\b/,
    /\btry it out\b/,
    /\bpricing\b/,
    /\bprice\b/,
    /\bfree\b/,
    /\bcharge\b/,
    /\bearly users?\b/,
    /\btoken costs?\b/,
    /\bapi costs?\b/,
    /\bmarketing\b/,
    /\breddit\b/,
    /\bfeatures?\b/,
  ],
  career_job_search: [
    /\bjob search\b/,
    /\bjobs?\b/,
    /\binterviews?\b/,
    /\bresume\b/,
    /\bportfolio\b/,
    /\bnetwork(ing)?\b/,
    /\bcareer change\b/,
    /\bcredential\b/,
  ],
  creative_project_focus: [
    /\bscreenplay\b/,
    /\bcreative\b/,
    /\bwriting\b/,
    /\bscript\b/,
    /\bcharacter\b/,
    /\barc\b/,
    /\brevis(e|ion)\b/,
    /\bapp idea\b/,
    /\bproject stuck\b/,
    /\bkeep switching\b/,
  ],
  recovery_energy_work: [
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
  open_loops_prioritization: [
    /\bopen loops?\b/,
    /\btoo many\b/,
    /\btoo many app ideas?\b/,
    /\b20 things\b/,
    /\bhealth, work, money, and relationships\b/,
    /\bdon't know what actually matters first\b/,
    /\boverwhelm(ed)?\b/,
    /\bprioriti[sz](e|ation)\b/,
  ],
};

function isMoneyCentral(text: string) {
  return hasAny(text, domainPatterns.money_career_stabilization);
}

export function classifySituationDomain(
  situation: SituationRoutingContext,
): SituationRoute {
  const text = fullText(situation);
  const category = situation.category.toLowerCase();

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

  if (category.includes("housing") || hasAny(text, domainPatterns.housing_high_stakes)) {
    return {
      domain: "housing_high_stakes",
      confidence: "high",
      reason: "Housing stability is central to the situation.",
    };
  }

  if (isSocialConnectionSituation(situation)) {
    return {
      domain: "social_connection_dating",
      confidence: "high",
      reason: "Connection, isolation, friendship, romance, or dating is central.",
    };
  }

  if (category.includes("money") || isMoneyCentral(text)) {
    return {
      domain: "money_career_stabilization",
      confidence: "high",
      reason: "Runway, money pressure, income, or expense tradeoffs are central.",
    };
  }

  if (
    isFounderCategory(category) ||
    category.includes("business") ||
    category.includes("startup") ||
    category.includes("customer") ||
    category.includes("wedge") ||
    category.includes("build") ||
    category.includes("sales") ||
    category.includes("cofounder") ||
    category.includes("pricing") ||
    category.includes("fundraising") ||
    hasAny(text, domainPatterns.founder_product_validation)
  ) {
    return {
      domain: "founder_product_validation",
      confidence: "high",
      reason: "The situation is about product, founder, or validation tradeoffs.",
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

  if (
    category.includes("career") ||
    category.includes("work") ||
    hasAny(text, domainPatterns.career_job_search)
  ) {
    return {
      domain: "career_job_search",
      confidence: "high",
      reason: "Job search, career, resume, proof, or credential signals are central.",
    };
  }

  if (
    category.includes("creative") ||
    hasAny(text, domainPatterns.creative_project_focus)
  ) {
    return {
      domain: "creative_project_focus",
      confidence: "high",
      reason: "Creative/project focus and finishing are central.",
    };
  }

  if (
    category.includes("health") ||
    category.includes("recovery") ||
    hasAny(text, domainPatterns.recovery_energy_work)
  ) {
    return {
      domain: "recovery_energy_work",
      confidence: "high",
      reason: "Energy, sleep, recovery, or rebuilding capacity is central.",
    };
  }

  return {
    domain: "unknown",
    confidence: "low",
    reason: "No specific domain is clear enough for a narrow first question.",
  };
}

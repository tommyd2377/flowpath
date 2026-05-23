import type { SituationUrgency } from "./types";
import {
  immediateDangerCopy,
  isCrisisSupportText,
  isDatingOrSexualConnectionSituation,
  isImmediateDangerText,
  isSocialConnectionSituation,
  usCrisisSupportCopy,
} from "./social-connection";

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
    /\bproduct polish\b/,
    /\buser testing\b/,
    /\bpricing\b/,
    /\bmarketing\b/,
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
  ],
  open_loops_prioritization: [
    /\bopen loops?\b/,
    /\btoo many\b/,
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
    category.includes("business") ||
    category.includes("startup") ||
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

export function buildDomainAppropriateFirstQuestion(
  situation: SituationRoutingContext,
) {
  const situationText = `${situation.category} ${situation.title} ${
    situation.description ?? ""
  }`;

  if (isImmediateDangerText(situationText)) return immediateDangerCopy;
  if (isCrisisSupportText(situationText)) return usCrisisSupportCopy;

  const route = classifySituationDomain(situation);

  if (route.domain === "crisis_safety") {
    return "Before we plan steps, what would make this situation safer or more stable in the next few hours?";
  }

  if (route.domain === "housing_high_stakes") {
    return "What is the housing deadline or risk level, and what would make the situation safer or more stable in the next 24-72 hours?";
  }

  if (route.domain === "social_connection_dating") {
    if (isDatingOrSexualConnectionSituation(situation)) {
      return "What kind of connection are you trying to build right now, and are there any consent, boundary, or safety constraints FlowPath should account for?";
    }
    return "Which feels closest right now: not enough people in your life, people around you but not enough closeness, lost touch, not knowing where you belong, avoiding reaching out, or something else?";
  }

  if (route.domain === "money_career_stabilization") {
    return "What would make this money, income, or runway situation more stable or less exposed in the next 24-72 hours?";
  }

  if (route.domain === "founder_product_validation") {
    return "What concrete outcome would make this product decision more real, validated, or revenue-relevant in the next 24-72 hours?";
  }

  if (route.domain === "career_job_search") {
    return "What would count as real progress on this career or job-search situation over the next 24-72 hours?";
  }

  if (route.domain === "creative_project_focus") {
    return "What would make this creative/project situation measurably more focused, shipped, or unstuck over the next 24-72 hours?";
  }

  if (route.domain === "recovery_energy_work") {
    return "What would a realistic, body-respecting stabilizing step look like in the next 24-72 hours?";
  }

  if (route.domain === "open_loops_prioritization") {
    return "What would make today feel simpler or more protected across health, work, money, and relationships?";
  }

  return "What would meaningful progress look like in the next 24-72 hours?";
}

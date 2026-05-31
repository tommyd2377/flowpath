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
    /\bproduct polish\b/,
    /\bproduct strategy\b/,
    /\buser testing\b/,
    /\bpricing\b/,
    /\bprice\b/,
    /\bfree\b/,
    /\bcharge\b/,
    /\bearly users?\b/,
    /\btoken costs?\b/,
    /\bapi costs?\b/,
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

function hasDecisionLanguage(text: string) {
  return hasAny(text, [
    /\bdecid(e|ing|ed)\b/,
    /\bshould i\b/,
    /\bwhether\b/,
    /\bworth\b/,
    /\bchoose\b/,
    /\bvs\.?\b/,
    /\bor\b/,
  ]);
}

function isCategory(situation: SituationRoutingContext, patterns: RegExp[]) {
  return hasAny(situation.category.toLowerCase(), patterns);
}

function rawSituationText(situation: SituationRoutingContext) {
  return `${situation.title} ${situation.description ?? ""}`.trim();
}

function hasHealthSignal(situation: SituationRoutingContext, text: string) {
  return (
    isCategory(situation, [/health/, /recovery/, /fitness/, /medical/]) ||
    hasAny(text, [
      /\bdoctor\b/,
      /\bmedic(al|ation|ine)\b/,
      /\bprescription\b/,
      /\bpharmacy\b/,
      /\bsymptoms?\b/,
      /\binjur(y|ed)\b/,
      /\btherapy\b/,
      /\banxiety\b/,
      /\bpanic\b/,
      /\bdepress(ed|ion)?\b/,
    ])
  );
}

function hasWorkProductSignal(situation: SituationRoutingContext, text: string) {
  return (
    isCategory(situation, [/work/, /career/, /business/, /startup/, /product/]) ||
    hasAny(text, [
      /\bstartup\b/,
      /\bfounder\b/,
      /\bproduct\b/,
      /\bcoding?\b/,
      /\bimplementation\b/,
      /\bdebug\b/,
      /\brepo\b/,
      /\bapi\b/,
      /\busers?\b/,
      /\bpricing\b/,
      /\bcharge\b/,
      /\bfree\b/,
      /\bjob\b/,
      /\bclient\b/,
    ])
  );
}

function hasMoneyStabilitySignal(situation: SituationRoutingContext, text: string) {
  return (
    isCategory(situation, [/money/, /stability/, /housing/, /benefits/, /finance/]) ||
    hasAny(text, [
      /\btransaction\b/,
      /\bfraud\b/,
      /\bunauthorized\b/,
      /\bdebt\b/,
      /\bpayment\b/,
      /\bbenefits?\b/,
      /\brent\b/,
      /\bhousing\b/,
      /\beviction\b/,
      /\bfinancial\b/,
      /\bbudget\b/,
    ])
  );
}

function hasRelationshipSignal(situation: SituationRoutingContext, text: string) {
  return (
    isSocialConnectionSituation(situation) ||
    isCategory(situation, [/relationship/, /connection/, /social/, /dating/]) ||
    hasAny(text, [
      /\bdating\b/,
      /\bdate\b/,
      /\btext\b/,
      /\bfriend(s|ship)?\b/,
      /\bconversation\b/,
      /\bconflict\b/,
      /\blonel(y|iness)\b/,
      /\bisolat(e|ed|ion)\b/,
      /\bnetworking\b/,
    ])
  );
}

function hasCreativeSignal(situation: SituationRoutingContext, text: string) {
  return (
    isCategory(situation, [/creative/, /writing/, /project/]) ||
    hasAny(text, [
      /\bscreenplay\b/,
      /\bscript\b/,
      /\bscene\b/,
      /\bcharacter\b/,
      /\barc\b/,
      /\brevis(e|ion)\b/,
      /\bnovel\b/,
      /\bstory\b/,
      /\bacting\b/,
    ])
  );
}

function hasOpenLoopSignal(situation: SituationRoutingContext, text: string) {
  return (
    isCategory(situation, [/overwhelm/, /open/, /priorit/]) ||
    hasAny(text, domainPatterns.open_loops_prioritization)
  );
}

function draftFirstIntakePlan(
  situation: SituationRoutingContext,
  route: SituationRoute,
): Omit<FirstIntakePlan, "genericityRisk"> {
  const situationText = `${situation.category} ${situation.title} ${
    situation.description ?? ""
  }`;
  const text = fullText(situation);

  if (isImmediateDangerText(situationText)) {
    return {
      domain: "safety",
      subtype: "urgent_health_risk",
      questionPurpose: "clarify_risk_or_safety",
      decisionShape: "immediate safety triage",
      missingInfoTarget: "whether there is immediate danger and what human help is needed",
      question: immediateDangerCopy,
      whyThisQuestion: "Immediate danger language should route to human emergency support before planning.",
    };
  }
  if (isCrisisSupportText(situationText)) {
    return {
      domain: "safety",
      subtype: "mental_health_stabilization",
      questionPurpose: "clarify_risk_or_safety",
      decisionShape: "crisis support triage",
      missingInfoTarget: "immediate safety and crisis support needs",
      question: usCrisisSupportCopy,
      whyThisQuestion: "Crisis language needs a safety boundary before ordinary intake.",
    };
  }

  if (hasHealthSignal(situation, text)) {
    if (
      hasAny(text, [
        /\bchest pain\b/,
        /\bshort(ness)? of breath\b/,
        /\bfaint(ing)?\b/,
        /\bstroke\b/,
        /\bseizure\b/,
        /\bsevere allergic\b/,
        /\boverdose\b/,
        /\buncontrolled bleeding\b/,
      ])
    ) {
      return {
        domain: "health",
        subtype: "urgent_health_risk",
        questionPurpose: "clarify_risk_or_safety",
        decisionShape: "urgent health triage",
        missingInfoTarget: "severity, suddenness, and whether urgent care is needed",
        question:
          "What symptoms are happening right now, how severe or sudden are they, and is there any reason you may need urgent medical help before we plan next steps?",
        whyThisQuestion: "Potentially urgent symptoms need safety triage before ordinary planning.",
      };
    }

    if (
      hasAny(text, [
        /\b(symptom|pain|fever|rash|dizziness|nausea|bleeding|swelling)\b/,
        /\bfeel(ing)? sick\b/,
        /\bwhat is wrong\b/,
      ]) &&
      !/\bside effects?\b/.test(text)
    ) {
      return {
        domain: "health",
        subtype: "symptom_triage",
        questionPurpose: "clarify_current_state",
        decisionShape: "symptom assessment",
        missingInfoTarget: "main symptom, duration, severity, and red flags",
        question:
          "Which symptom is most concerning right now, how long has it been happening, and has anything changed suddenly or severely?",
        whyThisQuestion: "Symptom questions need current-state details before suggesting next steps.",
      };
    }

    if (
      hasAny(text, [
        /\bgeneric prescription\b/,
        /\bask (my )?doctor\b/,
        /\bprescription\b/,
        /\bmedication\b/,
        /\bmedicine\b/,
      ]) &&
      (hasDecisionLanguage(text) || /\bask (my )?doctor\b/.test(text))
    ) {
      return {
        domain: "health",
        subtype: "routine_medication_discussion",
        questionPurpose: "clarify_decision",
        decisionShape: "routine clinician conversation decision",
        missingInfoTarget: "the main concern driving the medication decision",
        question:
          "What are you mainly unsure about with the medication or prescription: whether it works, side effects, cost, or how to bring it up with your doctor?",
        whyThisQuestion:
          "This is a routine medication discussion, so the useful first question is the decision concern, not recovery or stabilization.",
      };
    }

    if (hasAny(text, [/\bvaccine\b/, /\bscreening\b/, /\bcheckup\b/, /\bpreventive\b/])) {
      return {
        domain: "health",
        subtype: "preventive_care",
        questionPurpose: "clarify_time_horizon",
        decisionShape: "preventive-care scheduling or choice",
        missingInfoTarget: "which preventive step, timing, and constraint matter",
        question:
          "Which preventive-care decision are you sorting out, and is the blocker timing, eligibility, cost, risk, or how to ask the clinician?",
        whyThisQuestion: "Preventive care usually turns on timing, eligibility, and practical access.",
      };
    }

    if (
      hasAny(text, [
        /\bworkout\b/,
        /\btraining\b/,
        /\brunning\b/,
        /\bgym\b/,
        /\bstamina\b/,
        /\brecover(y|ing)?\b/,
        /\binjur(y|ed)\b/,
        /\bphysical therapy\b/,
      ])
    ) {
      return {
        domain: "health",
        subtype: "fitness_or_physical_recovery",
        questionPurpose: "clarify_current_state",
        decisionShape: "physical recovery or fitness progression",
        missingInfoTarget: "current physical limit, risk, and realistic next step",
        question:
          "What exactly are you trying to recover or rebuild physically, and what limit matters most right now: pain, energy, reinjury risk, or consistency?",
        whyThisQuestion: "Physical recovery questions need the current limit before planning effort.",
      };
    }

    if (hasAny(text, [/\banxiety\b/, /\bpanic\b/, /\bdepress(ed|ion)?\b/, /\bmental health\b/])) {
      return {
        domain: "health",
        subtype: "mental_health_stabilization",
        questionPurpose: "clarify_current_state",
        decisionShape: "emotional or mental-health stabilization",
        missingInfoTarget: "current state and immediate support need",
        question:
          "What current state needs stabilizing first: anxiety intensity, sleep, basic functioning, safety, or deciding whom to contact for support?",
        whyThisQuestion: "Mental-health situations need the current stability picture before action planning.",
      };
    }

    return {
      domain: "health",
      subtype: "medical_decision_support",
      questionPurpose: "clarify_decision",
      decisionShape: "medical decision support",
      missingInfoTarget: "the practical medical decision and concern to discuss with a professional",
      question:
        "What health decision are you trying to make, and is the hard part effectiveness, side effects, timing, cost, or whether to ask a clinician?",
      whyThisQuestion: "A health lane without acute risk should clarify the decision before advice.",
    };
  }

  if (hasMoneyStabilitySignal(situation, text) || route.domain === "housing_high_stakes") {
    if (
      hasAny(text, [/\bsuspicious\b/, /\bunauthorized\b/, /\bfraud\b/, /\btransaction\b/]) ||
      (/\bcharge\b/.test(text) && hasAny(text, [/\bbank\b/, /\bcard\b/, /\baccount\b/, /\bbrokerage\b/]))
    ) {
      return {
        domain: "money/stability",
        subtype: "suspicious_charge",
        questionPurpose: "clarify_risk_or_safety",
        decisionShape: "possible account or transaction issue",
        missingInfoTarget: "amount, merchant, date, pending/posted status, and recognizability",
        question:
          "What do you know so far about the charge or transaction: amount, merchant name, date, whether it posted or is pending, and whether you recognize any part of it?",
        whyThisQuestion: "A suspicious charge needs concrete transaction facts before next steps.",
      };
    }

    if (hasAny(text, [/\bbenefits?\b/, /\bassistance\b/, /\bunemployment\b/, /\bmedicaid\b/, /\bsnap\b/])) {
      return {
        domain: "money/stability",
        subtype: "benefits_or_assistance",
        questionPurpose: "clarify_risk_or_safety",
        decisionShape: "benefits or assistance process",
        missingInfoTarget: "program, deadline, document, amount, or agency contact",
        question:
          "What benefits or assistance decision is in front of you: eligibility, deadline, missing document, amount at stake, or who you need to contact?",
        whyThisQuestion: "Benefits and assistance questions turn on concrete process facts and deadlines.",
      };
    }

    if (route.domain === "housing_high_stakes" || hasAny(text, domainPatterns.housing_high_stakes)) {
      return {
        domain: "money/stability",
        subtype: "housing_or_rent",
        questionPurpose: "clarify_risk_or_safety",
        decisionShape: "housing, rent, or lease decision",
        missingInfoTarget: "timeline, amount, document, landlord response, or immediate risk",
        question:
          "What is the rent or housing decision in front of you, and what timeline, amount, document, or landlord response matters most?",
        whyThisQuestion: "Housing risk needs concrete timing and document/amount details.",
      };
    }

    if (hasAny(text, [/\bdebt\b/, /\bpayment\b/, /\bloan\b/, /\bcredit card\b/, /\bbill\b/])) {
      return {
        domain: "money/stability",
        subtype: "debt_or_payment",
        questionPurpose: "clarify_risk_or_safety",
        decisionShape: "debt or payment decision",
        missingInfoTarget: "amount, due date, consequence, and available options",
        question:
          "What payment or debt decision has to be made, and what are the amount, due date, and consequence if it slips?",
        whyThisQuestion: "Debt/payment issues depend on amount, deadline, and consequence.",
      };
    }

    if (hasAny(text, [/\bbudget\b/, /\bexpenses?\b/, /\bspend(ing)?\b/, /\bcash flow\b/])) {
      return {
        domain: "money/stability",
        subtype: "budgeting",
        questionPurpose: "clarify_constraint",
        decisionShape: "budgeting or cash-flow constraint",
        missingInfoTarget: "expense category, time horizon, and must-pay items",
        question:
          "What budget choice are you trying to make, and is the pressure coming from fixed bills, optional spending, income timing, or a specific upcoming cost?",
        whyThisQuestion: "Budgeting advice needs the pressure point, not a broad money prompt.",
      };
    }

    return {
      domain: "money/stability",
      subtype: "financial_decision",
      questionPurpose: "clarify_decision",
      decisionShape: "financial tradeoff",
      missingInfoTarget: "choice, timeline, amount, and downside risk",
      question:
        "What financial decision are you trying to make, and what amount, timeline, or downside risk would change the answer?",
      whyThisQuestion: "Financial situations should clarify the concrete tradeoff before advice.",
    };
  }

  if (
    (hasWorkProductSignal(situation, text) ||
      route.domain === "founder_product_validation" ||
      route.domain === "career_job_search") &&
    !hasAny(text, [/\btoo many app ideas?\b/, /\btoo many\b.*\bideas?\b/])
  ) {
    if (hasAny(text, [/\bcod(e|ing)\b/, /\bimplementation\b/, /\bdebug\b/, /\bbug\b/, /\brepo\b/, /\bapi route\b/])) {
      return {
        domain: "work/product",
        subtype: "coding_implementation",
        questionPurpose: "clarify_constraint",
        decisionShape: "implementation or debugging blocker",
        missingInfoTarget: "file/system area, failing behavior, error, or constraint",
        question:
          "What is the implementation blocker: the file or route involved, the failing behavior, the error, or the design constraint you need to work around?",
        whyThisQuestion: "Coding help needs the concrete blocker and system boundary.",
      };
    }

    if (
      hasAny(text, [
        /\bpricing\b/,
        /\bprice\b/,
        /\bfree\b/,
        /\bcharge\b/,
        /\bearly users?\b/,
        /\bapi costs?\b/,
        /\btoken costs?\b/,
      ])
    ) {
      return {
        domain: "work/product",
        subtype: "product_strategy",
        questionPurpose: "clarify_tradeoff",
        decisionShape: "product pricing or adoption tradeoff",
        missingInfoTarget: "the tradeoff between adoption, cost, perceived value, and proof",
        question:
          "What tradeoff are you most worried about in the free-versus-charging decision: user adoption, API/token costs, perceived value, or charging before the product feels proven?",
        whyThisQuestion: "A pricing decision needs the exact tradeoff, not a broad product prompt.",
      };
    }

    if (hasAny(text, [/\bjob search\b/, /\bresume\b/, /\binterview\b/, /\bportfolio\b/, /\bapplication\b/])) {
      return {
        domain: "work/product",
        subtype: "job_search",
        questionPurpose: "clarify_success_criteria",
        decisionShape: "job-search progress decision",
        missingInfoTarget: "target role, proof gap, outreach, or interview blocker",
        question:
          "What would make this job-search situation move: clearer target roles, stronger proof, more applications, better outreach, or an interview blocker?",
        whyThisQuestion: "Job-search guidance depends on which part of the funnel is stuck.",
      };
    }

    if (hasAny(text, [/\bclient\b/, /\bproposal\b/, /\bscope\b/, /\bdeadline\b/, /\binvoice\b/])) {
      return {
        domain: "work/product",
        subtype: "client_work",
        questionPurpose: "clarify_constraint",
        decisionShape: "client-work constraint",
        missingInfoTarget: "scope, deadline, budget, communication, or next deliverable",
        question:
          "What client-work decision needs attention: scope, deadline, budget, communication, or what to send next?",
        whyThisQuestion: "Client work turns on constraints and the next concrete deliverable.",
      };
    }

    if (hasAny(text, [/\bcareer\b/, /\bjob\b/, /\bwork\b/, /\bquit\b/, /\boffer\b/]) && hasDecisionLanguage(text)) {
      return {
        domain: "work/product",
        subtype: "career_decision",
        questionPurpose: "clarify_tradeoff",
        decisionShape: "career choice",
        missingInfoTarget: "the options and tradeoff making the choice hard",
        question:
          "What career choice are you actually deciding between, and what tradeoff is making it hard: money, credibility, energy, timing, or long-term direction?",
        whyThisQuestion: "Career decisions need the options and tradeoff before sequencing.",
      };
    }

    if (route.domain === "career_job_search" || hasAny(text, [/\bcareer\b/, /\bjob\b/, /\bwork\b/])) {
      return {
        domain: "work/product",
        subtype: "career_decision",
        questionPurpose: "clarify_success_criteria",
        decisionShape: "career or work progress decision",
        missingInfoTarget: "target outcome, blocker, proof gap, or next move",
        question:
          "What would make this career or work situation concretely move: a clearer target, stronger proof, better outreach, a decision, or a specific next task?",
        whyThisQuestion: "Career/work intake needs the actual progress marker or bottleneck.",
      };
    }

    if (hasAny(text, [/\bprioriti[sz](e|ation)\b/, /\btoo many\b/, /\bwhat to work on\b/])) {
      return {
        domain: "work/product",
        subtype: "prioritization",
        questionPurpose: "clarify_priority",
        decisionShape: "work prioritization",
        missingInfoTarget: "highest-pressure choice, blocker, or payoff",
        question:
          "Which work choice is creating the most pressure: what matters most, what is blocked, or what has the highest payoff today?",
        whyThisQuestion: "Prioritization needs the specific pressure point.",
      };
    }

    return {
      domain: "work/product",
      subtype: "product_strategy",
      questionPurpose: "clarify_tradeoff",
      decisionShape: "product, business, or validation decision",
      missingInfoTarget: "intended outcome, blocker, and tradeoff",
      question:
        "What product or business decision are you trying to make, and is the tradeoff user adoption, revenue, credibility, cost, or validation?",
      whyThisQuestion: "Work/product situations need the concrete tradeoff or intended outcome.",
    };
  }

  if (hasCreativeSignal(situation, text) || route.domain === "creative_project_focus") {
    if (/\barc\b/.test(text) && /\bcharacter\b/.test(text)) {
      return {
        domain: "creative/project",
        subtype: "character_psychology",
        questionPurpose: "clarify_creative_bottleneck",
        decisionShape: "character arc revision",
        missingInfoTarget: "want, pressure, moral turn, and emotional payoff",
        question:
          "What feels most unresolved in the character arc: the want, the pressure/envy, the moral turn, or the ending's emotional payoff?",
        whyThisQuestion: "Character-arc work should locate the exact emotional or structural bottleneck.",
      };
    }

    if (hasAny(text, [/\bscreenplay\b/, /\bscript\b/, /\bact\b/, /\bscene\b/, /\bstructure\b/])) {
      return {
        domain: "creative/project",
        subtype: "screenplay_structure",
        questionPurpose: "clarify_creative_bottleneck",
        decisionShape: "screenplay structure decision",
        missingInfoTarget: "structure, character motivation, scene order, ending payoff, or audience feeling",
        question:
          "What screenplay problem are you trying to solve: structure, character motivation, scene order, ending payoff, or what the audience should feel?",
        whyThisQuestion: "Screenplay help needs the story system that is actually stuck.",
      };
    }

    if (hasAny(text, [/\brevis(e|ion)\b/, /\brewrite\b/, /\bdraft\b/, /\bnotes\b/])) {
      return {
        domain: "creative/project",
        subtype: "revision_decision",
        questionPurpose: "clarify_creative_bottleneck",
        decisionShape: "creative revision choice",
        missingInfoTarget: "cut/deepen/reorder decision or missing emotional beat",
        question:
          "What revision decision is blocking progress: what to cut, what to deepen, what to reorder, or what emotional beat is not landing?",
        whyThisQuestion: "Revision work needs the exact choice blocking the draft.",
      };
    }

    if (hasAny(text, [/\btoo many\b/, /\bwhich project\b/, /\bwhat to work on\b/])) {
      return {
        domain: "creative/project",
        subtype: "project_prioritization",
        questionPurpose: "clarify_priority",
        decisionShape: "creative project prioritization",
        missingInfoTarget: "project payoff, deadline, energy, or avoidance",
        question:
          "Which creative project choice is creating the most pressure: payoff, deadline, energy, or avoiding a specific piece of work?",
        whyThisQuestion: "Creative prioritization needs the selection pressure, not a generic project prompt.",
      };
    }

    if (hasAny(text, [/\bblock(ed)?\b/, /\bstuck\b/, /\bcan't write\b/, /\bavoid(ing)?\b/])) {
      return {
        domain: "creative/project",
        subtype: "creative_block",
        questionPurpose: "clarify_emotional_bottleneck",
        decisionShape: "creative block",
        missingInfoTarget: "clarity, fear, taste gap, fatigue, or missing next scene/action",
        question:
          "What part of the creative block feels most real: not knowing the next move, not liking the work, fear of finishing, or low energy?",
        whyThisQuestion: "Creative blocks need the actual friction source before tasks.",
      };
    }

    return {
      domain: "creative/project",
      subtype: "project_prioritization",
      questionPurpose: "clarify_success_criteria",
      decisionShape: "creative progress decision",
      missingInfoTarget: "specific output, scene, draft, or progress marker",
      question:
        "What would make this acting or creative/project situation concretely move: a scene, draft, submission, rehearsal, revision, or decision?",
      whyThisQuestion: "Creative intake should ask for the concrete artifact or decision.",
    };
  }

  if (hasRelationshipSignal(situation, text) || route.domain === "social_connection_dating") {
    if (isDatingOrSexualConnectionSituation(situation) || hasAny(text, [/\bdating\b/, /\bdate\b/, /\bmatch\b/, /\btext(ing)?\b/])) {
      return {
        domain: "relationships/connection",
        subtype: "dating_decision",
        questionPurpose: "clarify_decision",
        decisionShape: "dating or romantic next-step decision",
        missingInfoTarget: "specific person/action, boundary, safety, and next step",
        question:
          "What specific dating decision are you making: whether to message, meet, continue, set a boundary, or choose a safer next step?",
        whyThisQuestion: "Dating guidance should identify the specific person/action and boundary question.",
      };
    }

    if (hasAny(text, [/\bparty\b/, /\bevent\b/, /\bplan(s|ning)?\b/, /\bmeetup\b/, /\binvite\b/])) {
      return {
        domain: "relationships/connection",
        subtype: "social_planning",
        questionPurpose: "clarify_constraint",
        decisionShape: "social plan or event choice",
        missingInfoTarget: "timing, location, energy, people, and desired outcome",
        question:
          "What social plan are you considering, and what is the key constraint: timing, location, energy, who to invite, or what outcome you want?",
        whyThisQuestion: "Social planning depends on the actual action and constraint.",
      };
    }

    if (hasAny(text, [/\bconflict\b/, /\bconversation\b/, /\bargument\b/, /\btalk to\b/, /\bboundary\b/])) {
      return {
        domain: "relationships/connection",
        subtype: "conflict_or_conversation",
        questionPurpose: "clarify_success_criteria",
        decisionShape: "conversation or conflict decision",
        missingInfoTarget: "person, desired outcome, risk, and boundary",
        question:
          "What conversation or conflict needs handling, and what outcome would make it go better without escalating?",
        whyThisQuestion: "Conversation help needs the person, desired outcome, and risk.",
      };
    }

    if (hasAny(text, [/\blonel(y|iness)\b/, /\bisolat(e|ed|ion)\b/])) {
      return {
        domain: "relationships/connection",
        subtype: "loneliness_or_isolation",
        questionPurpose: "clarify_current_state",
        decisionShape: "connection deficit diagnosis",
        missingInfoTarget: "whether the gap is contact, closeness, belonging, avoidance, or lost touch",
        question:
          "Which part of the loneliness is most true right now: not enough people, people around but not enough closeness, lost touch, not knowing where you belong, or avoiding reaching out?",
        whyThisQuestion: "Loneliness guidance changes based on the kind of connection gap.",
      };
    }

    if (hasAny(text, [/\bnetworking\b/, /\bintroduction\b/, /\bmeet people\b/, /\bcommunity\b/])) {
      return {
        domain: "relationships/connection",
        subtype: "networking",
        questionPurpose: "clarify_goal",
        decisionShape: "networking or community-building goal",
        missingInfoTarget: "target people, context, and reason for connecting",
        question:
          "Who are you trying to connect with, and is the goal friendship, professional access, creative collaborators, dating, or community?",
        whyThisQuestion: "Networking/social guidance needs the desired connection type.",
      };
    }

    return {
      domain: "relationships/connection",
      subtype: "social_planning",
      questionPurpose: "clarify_goal",
      decisionShape: "social next-step decision",
      missingInfoTarget: "connection type, setting, energy, and barrier",
      question:
        "What specific social action are you considering, and what is the main barrier: who, where, timing, energy, or what to say?",
      whyThisQuestion: "Social intake should find the actual human-facing action.",
    };
  }

  if (hasOpenLoopSignal(situation, text) || route.domain === "open_loops_prioritization") {
    if (hasAny(text, [/\btoo many app ideas?\b/, /\bapp ideas?\b/])) {
      return {
        domain: "open-loops/overwhelm",
        subtype: "too_many_tasks",
        questionPurpose: "clarify_priority",
        decisionShape: "idea/project prioritization",
        missingInfoTarget: "pressure source: decision, avoidance, or highest payoff",
        question:
          "Which choice is creating the most pressure today: deciding which app idea matters, avoiding a specific task, or not knowing which project has the highest payoff?",
        whyThisQuestion: "Too many ideas requires selecting the pressure point before planning.",
      };
    }

    if (hasAny(text, [/\bruminat(e|ing|ion)\b/, /\bsame question\b/, /\bloop(ing)?\b/, /\boverthink(ing)?\b/])) {
      return {
        domain: "open-loops/overwhelm",
        subtype: "rumination_loop",
        questionPurpose: "clarify_action_readiness",
        decisionShape: "rumination-to-action redirect",
        missingInfoTarget: "uncertainty that cannot be solved by more thinking and one testable action",
        question:
          "What uncertainty keeps pulling you back into the loop, and what tiny action would test it better than more thinking?",
        whyThisQuestion: "Rumination needs a boundary and an action experiment.",
      };
    }

    if (hasAny(text, [/\bavoid(ing|ance)?\b/, /\bprocrastinat(e|ing|ion)\b/, /\bputting off\b/])) {
      return {
        domain: "open-loops/overwhelm",
        subtype: "avoidance",
        questionPurpose: "clarify_emotional_bottleneck",
        decisionShape: "avoidance bottleneck",
        missingInfoTarget: "specific avoided action and friction source",
        question:
          "What specific action are you avoiding, and is the friction clarity, fear, energy, timing, or consequence?",
        whyThisQuestion: "Avoidance needs the exact action and friction source.",
      };
    }

    if (situation.urgency === "high" || hasAny(text, [/\burgent\b/, /\btoday\b/, /\bdeadline\b/, /\btriage\b/])) {
      return {
        domain: "open-loops/overwhelm",
        subtype: "urgent_triage",
        questionPurpose: "clarify_risk_or_safety",
        decisionShape: "same-day triage",
        missingInfoTarget: "deadline, risk, person waiting, or unlocking task",
        question:
          "What must be triaged first today: a deadline, a real risk, a person waiting on you, or the task that unlocks the rest?",
        whyThisQuestion: "Urgent open loops need triage criteria before action.",
      };
    }

    return {
      domain: "open-loops/overwhelm",
      subtype: "too_many_tasks",
      questionPurpose: "clarify_priority",
      decisionShape: "planning cleanup",
      missingInfoTarget: "what to do, drop, delay, or delegate first",
      question:
        "Which choice is creating the most pressure today: deciding what matters, avoiding a specific task, or not knowing which task has the highest payoff?",
      whyThisQuestion: "Open loops need the first prioritization choice, not a broad life prompt.",
    };
  }

  if (
    hasAny(text, [
      /\bwhat is\b/,
      /\bwho is\b/,
      /\bwhen is\b/,
      /\bwhere is\b/,
      /\bhow much\b/,
      /\bwhat time\b/,
      /\blookup\b/,
      /\bfind out\b/,
    ])
  ) {
    return {
      domain: "general",
      subtype: "factual_question",
      questionPurpose: "clarify_goal",
      decisionShape: "factual or logistical question",
      missingInfoTarget: "fact needed and whether it depends on current/local information",
      question:
        "What fact or comparison do you need answered first, and does it depend on current or local information?",
      whyThisQuestion: "Simple factual situations should avoid heavy intake.",
    };
  }

  if (hasDecisionLanguage(text)) {
    return {
      domain: "general",
      subtype: "decision_support",
      questionPurpose: "clarify_decision",
      decisionShape: "general decision support",
      missingInfoTarget: "options, tradeoff, and consequence that matter most",
      question:
        "What decision are you trying to make, and what tradeoff or consequence matters most?",
      whyThisQuestion: "General decision support needs the options and main tradeoff.",
    };
  }

  if (hasAny(text, [/\bplan\b/, /\bschedule\b/, /\blogistic(s|al)?\b/, /\bbook\b/, /\borganize\b/])) {
    return {
      domain: "general",
      subtype: "logistical_planning",
      questionPurpose: "clarify_constraint",
      decisionShape: "logistical planning",
      missingInfoTarget: "time, place, people, cost, or exact next step",
      question:
        "What logistic is the blocker: timing, location, people involved, cost, or the exact next step?",
      whyThisQuestion: "Logistical planning depends on the constraint that blocks action.",
    };
  }

  if (hasAny(text, [/\bfeel\b/, /\bunderstand\b/, /\bpattern\b/, /\bwhy do i\b/])) {
    return {
      domain: "general",
      subtype: "personal_reflection",
      questionPurpose: "clarify_current_state",
      decisionShape: "personal reflection",
      missingInfoTarget: "what happened, what the user wants, and what to do next",
      question:
        "What part of this are you trying to understand: what happened, what you want, what to do next, or what pattern to watch?",
      whyThisQuestion: "Reflection should still identify the practical focus of the intake.",
    };
  }

  return {
    domain: "general",
    subtype: "unclear",
    questionPurpose: "clarify_goal",
    decisionShape: "unclear situation",
    missingInfoTarget: "desired progress and the decision or constraint FlowPath should focus on",
    question:
      "What would meaningful progress look like here, and what decision or constraint should FlowPath focus on first?",
    whyThisQuestion: "When the situation is unclear, the first question should identify the target.",
  };
}

const stopWords = new Set([
  "about",
  "actually",
  "again",
  "around",
  "because",
  "before",
  "between",
  "could",
  "decide",
  "deciding",
  "description",
  "does",
  "doing",
  "enough",
  "feel",
  "figure",
  "from",
  "have",
  "help",
  "here",
  "into",
  "just",
  "know",
  "like",
  "make",
  "making",
  "more",
  "need",
  "should",
  "situation",
  "something",
  "thing",
  "things",
  "trying",
  "want",
  "what",
  "when",
  "where",
  "whether",
  "which",
  "with",
  "work",
  "would",
]);

const concretePhraseCandidates = [
  "generic prescription",
  "doctor",
  "api",
  "token",
  "early users",
  "free",
  "charge",
  "rent",
  "housing",
  "benefits",
  "app ideas",
  "screenplay",
  "character",
  "dating",
  "symptom",
  "recovery",
];

function normalizeForMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function concreteTermsFromSituation(situation: SituationRoutingContext) {
  const raw = normalizeForMatch(rawSituationText(situation));
  const terms = new Set<string>();

  for (const phrase of concretePhraseCandidates) {
    if (raw.includes(phrase)) terms.add(phrase);
  }

  for (const token of raw.match(/[a-z][a-z0-9-]{3,}/g) ?? []) {
    if (!stopWords.has(token)) terms.add(token);
  }

  const category = normalizeForMatch(situation.category);
  for (const token of category.match(/[a-z][a-z0-9-]{3,}/g) ?? []) {
    if (!stopWords.has(token)) terms.add(token);
  }

  return [...terms];
}

function questionReflectsConcreteInput(
  question: string,
  situation: SituationRoutingContext,
) {
  const normalizedQuestion = normalizeForMatch(question);
  return concreteTermsFromSituation(situation).some((term) =>
    normalizedQuestion.includes(term),
  );
}

function assessGenericityRisk(
  plan: Omit<FirstIntakePlan, "genericityRisk">,
  situation: SituationRoutingContext,
): FirstIntakeGenericityRisk {
  const question = normalizeForMatch(plan.question);
  const broadTemplateHit = hasBroadTemplateHit(question);
  const reflectsInput = questionReflectsConcreteInput(plan.question, situation);

  if (!reflectsInput && broadTemplateHit) return "high";
  if (!reflectsInput) return "medium";
  if (broadTemplateHit && !["urgent_health_risk", "fitness_or_physical_recovery", "mental_health_stabilization"].includes(plan.subtype)) {
    return "medium";
  }
  return "low";
}

function hasBroadTemplateHit(question: string) {
  const normalizedQuestion = normalizeForMatch(question);
  return [
    "meaningful progress",
    "body-respecting",
    "stabilizing step",
    "next 24-72 hours",
    "what would make this situation",
    "what would count as real progress",
  ].some((fragment) => normalizedQuestion.includes(fragment));
}

function subjectFallback(situation: SituationRoutingContext) {
  const subject = rawSituationText(situation) || situation.category;
  return subject.length > 120 ? `${subject.slice(0, 117).trim()}...` : subject;
}

function quotedSubjectFallback(situation: SituationRoutingContext) {
  return subjectFallback(situation).replace(/"/g, "'");
}

function archetypeAnchoredQuestion(
  plan: Omit<FirstIntakePlan, "genericityRisk">,
  situation: SituationRoutingContext,
): Omit<FirstIntakePlan, "genericityRisk"> | null {
  if (plan.subtype === "factual_question") return null;

  const subject = quotedSubjectFallback(situation);
  const text = fullText(situation);

  if (
    hasAny(text, [
      /\bresearch\b/,
      /\bcompare\b/,
      /\bcomparison\b/,
      /\bevaluate\b/,
      /\breview\b/,
      /\bfind\b/,
      /\blook(ing)? for\b/,
      /\boptions?\b/,
    ])
  ) {
    return {
      ...plan,
      subtype: "research_or_comparison",
      questionPurpose: "clarify_success_criteria",
      decisionShape: "research or comparison focus",
      missingInfoTarget: "criteria, comparison set, contact target, or useful example",
      question: `For "${subject}", what are you trying to identify first: the criteria that matter, the options worth comparing, who to contact, or an example that would make the choice clearer?`,
      whyThisQuestion: `${plan.whyThisQuestion} The situation is framed as research or comparison, so the first question should identify what kind of signal would end the search.`,
    };
  }

  if (hasDecisionLanguage(text)) {
    return {
      ...plan,
      subtype: "decision_support",
      questionPurpose: "clarify_decision",
      decisionShape: "decision tradeoff",
      missingInfoTarget: "options, deciding criterion, tradeoff, risk, or reversibility",
      question: `For "${subject}", what are the options on the table, and which factor should decide it first: time, cost, risk, upside, or reversibility?`,
      whyThisQuestion: `${plan.whyThisQuestion} The situation is framed as a decision, so the first question should expose the options and deciding criterion.`,
    };
  }

  if (hasAny(text, [/\bplan\b/, /\bschedule\b/, /\blogistic(s|al)?\b/, /\bbook\b/, /\borganize\b/])) {
    return {
      ...plan,
      subtype: "logistical_planning",
      questionPurpose: "clarify_constraint",
      decisionShape: "logistical planning",
      missingInfoTarget: "timing, location, people, cost, sequence, or next action",
      question: `For "${subject}", which constraint should be resolved first: timing, location, people involved, cost, sequence, or the exact next action?`,
      whyThisQuestion: `${plan.whyThisQuestion} The situation is framed as planning, so the first question should find the binding constraint.`,
    };
  }

  if (hasAny(text, [/\bfix\b/, /\bdebug\b/, /\bbug\b/, /\berror\b/, /\bnot working\b/, /\bbroken\b/, /\btroubleshoot\b/])) {
    return {
      ...plan,
      subtype: "troubleshooting",
      questionPurpose: "clarify_constraint",
      decisionShape: "troubleshooting or repair",
      missingInfoTarget: "failing behavior, location, error, attempted fix, or constraint",
      question: `For "${subject}", what is failing, where does it show up, and what have you already tried?`,
      whyThisQuestion: `${plan.whyThisQuestion} The situation is framed as troubleshooting, so the first question should locate the failure and prior attempts.`,
    };
  }

  if (hasAny(text, [/\bcontact\b/, /\breach out\b/, /\bmessage\b/, /\bemail\b/, /\bcall\b/, /\btalk to\b/, /\bask\b/])) {
    return {
      ...plan,
      subtype: "contact_or_conversation",
      questionPurpose: "clarify_success_criteria",
      decisionShape: "contact or conversation next step",
      missingInfoTarget: "person, desired outcome, boundary, risk, or ask",
      question: `For "${subject}", who is involved, what outcome do you want, and what would make the contact clearer or lower-risk?`,
      whyThisQuestion: `${plan.whyThisQuestion} The situation is framed around contacting someone, so the first question should clarify the person, desired outcome, and risk.`,
    };
  }

  if (hasAny(text, [/\burgent\b/, /\btoday\b/, /\bdeadline\b/, /\btriage\b/, /\btime-sensitive\b/])) {
    return {
      ...plan,
      subtype: "urgent_triage",
      questionPurpose: "clarify_risk_or_safety",
      decisionShape: "time-sensitive triage",
      missingInfoTarget: "deadline, consequence, person waiting, risk, or unblocker",
      question: `For "${subject}", what has the nearest real consequence: a deadline, a person waiting, a risk, or the task that unlocks the rest?`,
      whyThisQuestion: `${plan.whyThisQuestion} The situation is time-sensitive, so the first question should identify what must be triaged first.`,
    };
  }

  return null;
}

function reviseUnanchoredQuestion(
  plan: Omit<FirstIntakePlan, "genericityRisk">,
  situation: SituationRoutingContext,
): Omit<FirstIntakePlan, "genericityRisk"> {
  const archetypeQuestion = archetypeAnchoredQuestion(plan, situation);
  if (archetypeQuestion) return archetypeQuestion;

  const subject = quotedSubjectFallback(situation);
  const question = plan.question.trim();
  const anchoredQuestion =
    question && !hasBroadTemplateHit(question)
      ? `${question.charAt(0).toLowerCase()}${question.slice(1)}`
      : "what specific decision, constraint, risk, or success criterion should FlowPath clarify first?";
  return {
    ...plan,
    question: `For "${subject}", ${anchoredQuestion}`,
    whyThisQuestion: `${plan.whyThisQuestion} The first draft was not anchored enough, so this version uses the user's actual wording.`,
  };
}

function shouldPreserveFirstQuestion(plan: Omit<FirstIntakePlan, "genericityRisk">) {
  return plan.domain === "safety";
}

export function buildFirstIntakePlan(
  situation: SituationRoutingContext,
): FirstIntakePlan {
  const route = classifySituationDomain(situation);
  const draft = draftFirstIntakePlan(situation, route);
  const genericityRisk = assessGenericityRisk(draft, situation);
  if (
    genericityRisk !== "high" &&
    (shouldPreserveFirstQuestion(draft) ||
      questionReflectsConcreteInput(draft.question, situation))
  ) {
    return { ...draft, genericityRisk };
  }

  const revised = reviseUnanchoredQuestion(draft, situation);
  return {
    ...revised,
    genericityRisk: assessGenericityRisk(revised, situation),
  };
}

export function buildDomainAppropriateFirstQuestion(
  situation: SituationRoutingContext,
) {
  return buildFirstIntakePlan(situation).question;
}

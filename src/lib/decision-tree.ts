import {
  decisionTreeSchema,
  type BranchExpansionResultInput,
} from "./schemas";
import type {
  DecisionBranchSource,
  DecisionFirstAction,
  DecisionMoveType,
  DecisionNode,
  DecisionOption,
  DecisionRecommendationLevel,
  DecisionSearchStatus,
  DecisionTree,
  LocalRealityScout,
  NextMovePlan,
  NextMoveStep,
  PlanTaskCandidate,
} from "./types";

type PlanLike = Omit<NextMovePlan, "decision_tree"> & {
  decision_tree?: DecisionTree | null;
  raw_json?: string;
  situation_id?: number | null;
  created_at?: string;
};

export type ActionQualityFlag =
  | "missing_time_boundary"
  | "missing_quantity"
  | "missing_search_terms"
  | "missing_shortlist_criteria"
  | "missing_success_condition"
  | "missing_fallback"
  | "vague_action_repaired"
  | "search_needed_action_repaired";

export type ActionQualityRepairResult = {
  action: DecisionFirstAction;
  flags: ActionQualityFlag[];
  original_action_text: string;
  canonical_action_text: string;
  repaired: boolean;
};

export type ReconciliationFollowupQualityResult = {
  recommended_followup_action: string;
  flags: ActionQualityFlag[];
  repaired: boolean;
};

const rootNodeId = "root";
const fallbackTreeId = "decision-tree";
const taskLikeBranchStart = /^(pick|identify|set|send|contact|choose|search|find one|write|draft|schedule|block|register|attend)\b/i;
const childDecisionOptionLimit = 5;
const internalMoveMapLabelPatterns = [
  /\blow[-\s]+commitment\s+option\b/i,
  /\bbest\s+proof\s+option\b/i,
  /\bproof[-\s]+building\s+option\b/i,
  /\bpreparation\s+step\b/i,
  /\blowest[-\s]+friction\b/i,
  /\bhighest[-\s]+signal\b/i,
  /\bhigh[-\s]+signal\b/i,
  /\bsignal\b/i,
  /\boperator\b/i,
  /\bleverage\b/i,
  /\bsupporting\s+prerequisite\b/i,
  /\bbroad(?:\s+\S+){0,2}\s+comparison\b/i,
  /\bfriction\s+version\b/i,
  /\bsignal\s+version\b/i,
  /\b(?:strategy|strategic)\s+container\b/i,
] as const;

function nowIso() {
  return new Date().toISOString();
}

function clipText(value: string | null | undefined, fallback: string, max = 160) {
  const text = (value ?? "").trim() || fallback;
  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text;
}

export function hasInternalMoveMapLabelJargon(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (internalMoveMapLabelPatterns.some((pattern) => pattern.test(text))) return true;
  if (/\bcontainer\b/i.test(text)) return true;
  if (/\b(?:lowest|highest|supporting|broad|default|operator)\b.*\bversion\b/i.test(text)) {
    return true;
  }
  if (/\b(?:operator|supporting)\b.*\bpath\b/i.test(text)) {
    return true;
  }
  return false;
}

function normalizeUrgentCourtLabel(
  value: string,
  localContextText: string,
  boardContextText: string,
) {
  const text = value.trim();
  const localContext = `${localContextText} ${text}`;
  if (!textLooksCourtDeadlineBoard(`${boardContextText} ${localContext}`)) return null;
  const badInternal =
    /\b(low[-\s]+commitment|lowest[-\s]+friction|highest[-\s]+signal|high[-\s]+signal|best\s+proof|preparation\s+step|supporting\s+prerequisite|smallest\s+practical\s+step|best\s+fit[-\s]+check\s+step|prepare\s+required\s+details\s+first|proof[-\s]+building\s+step|version|signal)\b/i.test(
      text,
    );
  const hasProceduralSignal =
    /\b(court|clerk|legal[-\s]+aid|intake|extension|more\s+time|extra\s+time|forms?|rules?|search|online|notice|case|organize|documents?|paperwork|proof|deadline|filing|file)\b/i.test(
      text,
    );
  if (!badInternal && !hasProceduralSignal) return null;
  const signalText = badInternal ? localContext : text;

  if (/\b(preparation\s+step|supporting\s+prerequisite|prepare\s+required\s+details\s+first)\b/i.test(text)) {
    return "Prepare a notice facts sheet";
  }
  if (/\b(best\s+proof|proof[-\s]+building|best\s+fit[-\s]+check)\b/i.test(text)) {
    return "Ask what documents they need";
  }
  if (/\b(low[-\s]+commitment|lowest[-\s]+friction|smallest\s+practical\s+step)\b/i.test(text)) {
    if (/\blegal[-\s]+aid|intake\b/i.test(localContext)) return "Call legal aid intake";
    if (/\bclerk\b/i.test(localContext)) return "Call the court clerk";
    return "Find the notice and copy deadline facts";
  }
  if (/\bask\b.*\bdocuments?\b.*\bneed\b/i.test(text)) {
    return "Ask what documents they need";
  }
  if (/\blegal[-\s]+aid|intake\b/i.test(signalText)) {
    if (/\bdocuments?|proof|need\b/i.test(signalText)) return "Ask what documents they need";
    if (/\bdeadline|time|before\b/i.test(signalText)) {
      return "Ask whether they can help before the deadline";
    }
    return "Call legal aid intake";
  }
  if (/\bclerk\b/i.test(signalText)) {
    if (/\bdeadline\b/i.test(signalText)) return "Confirm the exact deadline";
    return "Call the court clerk";
  }
  if (/\bextension|more\s+time|extra\s+time\b/i.test(signalText)) {
    return "Ask about the process for more time";
  }
  if (/\bforms?|rules?|search|online|broad\b/i.test(signalText)) {
    return "Search forms only after confirming facts";
  }
  if (/\bnotice\b/i.test(signalText)) {
    if (/\bfacts?|sheet|copy|details?\b/i.test(signalText)) {
      return "Prepare a notice facts sheet";
    }
    return "Find the notice";
  }
  if (/\bcase\s+(?:number|details?)|court name|document title\b/i.test(signalText)) {
    return "Copy case details";
  }
  if (/\borganize|documents?|paperwork|proof\b/i.test(signalText)) {
    return "Organize documents";
  }
  if (badInternal) {
    return "Find the notice and copy deadline facts";
  }
  return null;
}

export function normalizeUserFacingMoveMapLabel(
  value: string,
  contextText = "",
  boardContextText = contextText,
) {
  const text = value.trim();
  if (!text) return text;
  const urgentCourtLabel = normalizeUrgentCourtLabel(text, contextText, boardContextText);
  if (urgentCourtLabel) return urgentCourtLabel;
  if (/low[-\s]+commitment\s+option/i.test(text)) {
    return "Smallest practical step";
  }
  if (/best\s+proof\s+option/i.test(text)) {
    return "Best fit-check step";
  }
  if (/proof[-\s]+building\s+option/i.test(text)) {
    return "Proof-building step";
  }
  if (/preparation\s+step/i.test(text)) {
    return "Prepare required details first";
  }
  if (/observe\s+community\s+first,\s*then\s+enroll/i.test(text)) {
    return "Visit or audit a class";
  }
  if (/\bbroad(?:\s+\S+){0,2}\s+comparison\b/i.test(text)) {
    return "Compare options";
  }
  if (/lowest[-\s]+friction(?:\s+version)?/i.test(text)) {
    return "Smallest practical step";
  }
  if (/highest[-\s]+signal(?:\s+version)?/i.test(text)) {
    return "Best fit-check step";
  }
  if (/high[-\s]+signal(?:\s+version)?/i.test(text)) {
    return "Proof-building step";
  }
  if (/supporting\s+prerequisite/i.test(text)) {
    return "Prepare required details first";
  }
  if (/supporting\s+path/i.test(text)) {
    return "Supporting option";
  }
  if (/operator\s+path/i.test(text)) {
    return "Recommended option";
  }
  if (/\bcontainer\b/i.test(text)) {
    const cleaned = text
      .replace(/\b(?:strategy|strategic)\b/gi, "")
      .replace(/\bcontainer\b/gi, "group")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned || "Recurring option";
  }
  return text;
}

function slug(value: string, fallback: string) {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return clean || fallback;
}

function compactQuestion(value: string, fallback: string) {
  const text = value.trim();
  if (!text) return fallback;
  if (text.endsWith("?") && text.length <= 120) return text;
  return clipText(text, fallback, 140);
}

function normalizedKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(a|an|the|one|this|that|and|or|to|for|with|nearby|local)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicate(a: string, b: string) {
  const left = normalizedKey(a);
  const right = normalizedKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}

function isTaskLikeOption(option: DecisionOption, selected: DecisionOption | null) {
  if (taskLikeBranchStart.test(option.label)) return true;
  if (!selected) return false;
  return (
    isNearDuplicate(option.label, selected.label) ||
    isNearDuplicate(option.label, selected.first_action.title) ||
    isNearDuplicate(option.first_action.title, selected.first_action.title)
  );
}

function textLooksExternal(value: string) {
  return /\b(search|look up|verify|current|latest|today|this week|near me|nearby|local|neighborhood|zip|availability|schedule|deadline|price|cost|clinic|class|studio|coach|event|meetup|program|resource|organization)\b|\b\d{5}(?:-\d{4})?\b/i.test(
    value,
  );
}

function textLooksUrgentStability(value: string) {
  return /\b(urgent|crisis|evict|eviction|housing|shelter|hotline|911|988|legal aid|emergency|immediate danger|safety)\b/i.test(
    value,
  );
}

function textLooksCourtDeadlineBoard(value: string) {
  return (
    /\b(court|clerk|filing|filed|case number|case no|legal aid|self[-\s]?help)\b/i.test(
      value,
    ) &&
    /\b(deadline|paperwork|document|notice|filing|file|due|forms?|case)\b/i.test(value)
  );
}

function textLooksUrgentCourtDeadlineBoard(value: string) {
  return (
    textLooksCourtDeadlineBoard(value) &&
    /\b(urgent|overwhelmed|freeze|few days|deadline|due|miss(?:ing)?|risk|time[-\s]?sensitive|before the deadline)\b/i.test(
      value,
    )
  );
}

function textLooksLocalOrCurrent(value: string) {
  return /\b(local|nearby|near me|near you|neighborhood|zip|postal code|postcode|city|town|suburb|region|state|province|county|within \d+|commute|current|latest|today|this week|availability|schedule|deadline|price|cost|class|clinic|studio|coach|instructor|program|course|workshop|group|club|league|meetup|event|resource|organization|provider|facility|venue|service|volunteer)\b|\b\d{5}(?:-\d{4})?\b/i.test(
    value,
  );
}

function textNeedsLocalCurrentVerification(value: string) {
  const hasLocalOrCurrentSignal =
    /\b(local|nearby|near me|near you|neighborhood|zip|postal code|postcode|city|town|suburb|region|state|province|county|within \d+|commute|current|latest|today|this week|availability|schedule|deadline|price|cost)\b|\b\d{5}(?:-\d{4})?\b/i.test(
      value,
    ) ||
    /\b(?:in|near|around)\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}\b/.test(value);
  const hasResourceSignal =
    /\b(class|clinic|studio|coach|instructor|program|course|workshop|group|club|league|meetup|event|resource|organization|provider|facility|venue|service|volunteer|activity|training)\b/i.test(
      value,
    );
  return hasLocalOrCurrentSignal && hasResourceSignal;
}

function extractLocationHint(value: string) {
  const text = value.trim();
  const zip = text.match(/\b\d{5}(?:-\d{4})?\b/);
  if (zip) return `near ${zip[0]}`;
  const namedLocation = text.match(
    /\b(?:in|near|around|location\s*[:=-])\s+(?:the\s+)?([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})\b/,
  );
  const suppliedLocation = namedLocation?.[1]?.trim();
  if (
    suppliedLocation &&
    !/^(FlowPath|Today|Tomorrow|Success|If|The|A|An)$/i.test(suppliedLocation)
  ) {
    return `near ${suppliedLocation}`;
  }
  if (/\bnear me\b/i.test(text)) return "near me";
  if (/\bnearby|near you|local|neighborhood\b/i.test(text)) return "near your area";
  return "near your area";
}

function actionQualityParts(action: DecisionFirstAction) {
  return [
    action.title,
    action.details,
    action.success_condition,
    action.fallback,
  ].join(" ");
}

export function canonicalDecisionActionText(action: DecisionFirstAction) {
  return action.details?.trim() || action.title.trim();
}

export function decisionActionTaskNotes(action: DecisionFirstAction) {
  return [
    canonicalDecisionActionText(action),
    action.success_condition ? `Success: ${action.success_condition}` : "",
    action.fallback ? `If blocked: ${action.fallback}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function actionQualityGaps(text: string): ActionQualityFlag[] {
  const normalized = text.toLowerCase();
  const flags: ActionQualityFlag[] = [];
  const hasSearchTerms =
    /\b(search terms?|use quer(?:y|ies)|queries? like|terms like)\b/.test(normalized) ||
    /['"“”][^'"“”]{8,}['"“”]/.test(text);
  const hasQuantity =
    /\b(?:2|3|4|5|two|three|four|five)\b/.test(normalized) ||
    /\b\d+\s*(?:-|–|to)\s*\d+\b/.test(normalized);
  const hasCriteria = /\b(shortlist|criteria|filter|only|level fit|fit|recurring|beginner-friendly|beginner friendly|low-pressure|same people|cohort|commute|schedule|accept|not competitive|not pickup|not dating|weekly|biweekly)\b/.test(
    normalized,
  );
  const hasTimeBoundary = /\b(today|within \d+|in \d+|this week|48 hours|24 hours|20 minutes|30 minutes|by tomorrow|before the end of)\b/.test(
    normalized,
  );
  const hasSuccess = /\b(success|successful|candidate|shortlist|message sent|sent|chosen|identified|saved|drafted|on your calendar|calendar)\b/.test(
    normalized,
  );
  const hasFallback = /\b(if blocked|if no|if none|if nothing|fallback|otherwise|if unclear|if level|if fit|widen)\b/.test(
    normalized,
  );
  if (!hasTimeBoundary) flags.push("missing_time_boundary");
  if (!hasQuantity) flags.push("missing_quantity");
  if (!hasSearchTerms) flags.push("missing_search_terms");
  if (!hasCriteria) flags.push("missing_shortlist_criteria");
  if (!hasSuccess) flags.push("missing_success_condition");
  if (!hasFallback) flags.push("missing_fallback");
  return flags;
}

function vagueActionNeedsRepair(text: string) {
  return /\b(check|find|research|explore|look into|look for|choose|pick)\b/i.test(text);
}

function searchTemplateForAction({
  contextText,
  branchLabel,
  locationHint,
}: {
  contextText: string;
  branchLabel?: string;
  locationHint: string;
}) {
  const text = `${contextText} ${branchLabel ?? ""}`;
  if (/\bcommunity|friend|belonging|social|volunteer|meetup|group|not dating\b/i.test(text)) {
    return {
      title: "Shortlist recurring community options",
      details: `Within 30 minutes today, shortlist 3 recurring non-dating community options ${locationHint} that you could attend weekly or biweekly. Use queries like 'weekly community group near me', 'recurring volunteer shift near me', and 'adult class near me weekly'. Keep only options where the same people are likely to return. Do not treat any local option as verified until you check it.`,
      success_condition: "One option is picked and the first visit is on your calendar.",
      fallback:
        "If none fit, widen the search radius or choose one online-to-offline group with recurring local meetups.",
    };
  }
  const topic = (branchLabel ?? "")
    .replace(
      /^(?:search(?:\s+and\s+shortlist)?(?:\s+for)?|find|check|choose|pick|compare|contact|shortlist|explore|join|attend|try|register(?:\s+for)?|enroll(?:\s+in)?)\s+/i,
      "",
    )
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\b(?:near me|near you|nearby|local)\b/gi, "")
    .replace(/["'“”]/g, "")
    .replace(/[.?!,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const queryTopic = topic.length >= 3 && topic.length <= 80 ? topic : "relevant options";
  const searchTopic = queryTopic.toLowerCase();
  const queryPlace = /\bnear (?:your area|me)\b/i.test(locationHint)
    ? "near me"
    : locationHint.replace(/^near\s+/i, "");
  const beginnerQuery = /\bbeginner\b/i.test(searchTopic)
    ? `${searchTopic} ${queryPlace}`
    : `beginner ${searchTopic} ${queryPlace}`;
  return {
    title: "Search and shortlist realistic options",
    details: `Within 30 minutes today, search for 3-5 ${queryTopic} ${locationHint}. Use queries like '${searchTopic} ${queryPlace}', '${beginnerQuery}', and 'recurring ${searchTopic} ${queryPlace}'. Shortlist only options that match the board's constraints, schedule, experience level, and repeatability needs. Do not treat any local option as verified until you check it.`,
    success_condition: "Three candidates are saved or one fit-check message is sent today.",
    fallback:
      "If no good option appears, widen the search radius, change the format, or ask one relevant local coordinator where beginners usually start.",
  };
}

function vagueUrgentCourtActionNeedsRepair(text: string) {
  return (
    /\b(shrink|smallest action|real signal|worth continuing|supporting prerequisite|prerequisite that makes|continue (?:down )?this path|recalculate|choose the version|lowest[-\s]+friction|highest[-\s]+signal|best proof|preparation step)\b/i.test(
      text,
    ) ||
    !/\b(notice|court|clerk|case number|case details|deadline|document title|filing|legal aid|intake|documents?|paperwork|more time|process-only|process information)\b/i.test(
      text,
    )
  );
}

function urgentCourtActionTemplate(contextText: string, branchLabel: string) {
  const branchLegalAid = /\blegal[-\s]+aid|intake\b/i.test(branchLabel);
  const branchClerk = /\bclerk\b/i.test(branchLabel);
  const contextLegalAid = /\blegal[-\s]+aid|intake\b/i.test(contextText);
  const contextClerk = /\bclerk\b/i.test(contextText);
  const legalAid =
    branchLegalAid || (!branchClerk && contextLegalAid && !contextClerk);
  const clerk = branchClerk || (!branchLegalAid && contextClerk && !contextLegalAid);
  const moreTime = /\bextension|more\s+time|extra\s+time\b/i.test(contextText);
  const search = /\bforms?|rules?|search|online|broad\b/i.test(contextText);
  const noticeFirst = /\bnotice[-\s]+first|notice\s+facts?|find\s+the\s+notice|copy\s+.*notice|deadline\s+facts/i.test(
    contextText,
  );
  const documents = /\borganize|documents?|paperwork|proof\b/i.test(contextText);

  if (legalAid) {
    return {
      title: "Call legal aid intake with deadline facts",
      details:
        "Today, call legal aid intake with any notice facts you have: court name, case number, deadline date/time, document title, and filing instructions. Ask whether they can help before the deadline and what documents they need. Keep it process-focused; do not rely on FlowPath for legal argument advice.",
      success_condition:
        "You know whether intake can help before the deadline and what information or documents they need next.",
      fallback:
        "If you cannot reach intake, call the court clerk or self-help line and ask what information is needed to identify the deadline and filing steps.",
    };
  }

  if (clerk) {
    return {
      title: "Call the court clerk with process-only questions",
      details:
        "Today, call the court clerk or self-help contact and ask process-only questions: how to confirm the exact deadline, document title, filing method, and required contact information. Do not ask what legal argument to make.",
      success_condition:
        "You have the exact deadline/filer instructions or know which office/contact can confirm them.",
      fallback:
        "If the clerk cannot answer, ask what details they need from the notice or who handles procedural filing questions.",
    };
  }

  if (moreTime) {
    return {
      title: "Ask about the process for more time",
      details:
        "After confirming the exact deadline and document, ask the clerk or legal aid what the process is if more time is needed. Write down the form name or office to contact, without assuming an extension is available or guaranteed.",
      success_condition:
        "You know the next process step for asking about more time, or you know that you need legal-aid/self-help guidance first.",
      fallback:
        "If the process is unclear, return to notice-first triage and copy the deadline facts before making another call.",
    };
  }

  if (search) {
    return {
      title: "Search only after copying notice facts",
      details:
        "For 20 minutes today, search official court or self-help pages using the exact court name, document title, and deadline words from the notice. Save only process information that matches your court/document; do not treat general forms pages as verified for your case.",
      success_condition:
        "You save one official process page or decide the next safer step is a clerk/legal-aid call.",
      fallback:
        "If results are broad or conflicting, stop searching and call the clerk or legal aid with the notice facts.",
    };
  }

  if (noticeFirst) {
    return {
      title: "Find the notice and copy the deadline facts",
      details:
        "For 15 minutes now, find the notice and copy the court name, case number, deadline date/time, document title, and filing/contact instructions into one note. Keep this as process triage, not legal argument planning.",
      success_condition:
        "One deadline facts sheet exists with the core notice details or clear blanks for what is missing.",
      fallback:
        "If you cannot find the notice, call the court clerk or legal-aid intake and say you need help identifying what information is required before the deadline.",
    };
  }

  if (documents) {
    return {
      title: "Organize documents around the notice",
      details:
        "For 20 minutes now, put the notice first, then gather related paperwork in one folder or note. Label court name, case number, deadline date/time, document title, filing instructions, and any missing documents to ask about.",
      success_condition:
        "One organized packet or notes page exists before any call or filing step.",
      fallback:
        "If you cannot find a document, write 'missing' next to it and ask the clerk or legal aid what information is required.",
    };
  }

  return {
    title: "Find the notice and copy the deadline facts",
    details:
      "For 15 minutes now, find the notice and copy the court name, case number, deadline date/time, document title, and filing/contact instructions into one note. Keep this as process triage, not legal argument planning.",
    success_condition:
      "One deadline facts sheet exists with the core notice details or clear blanks for what is missing.",
    fallback:
      "If you cannot find the notice, call the court clerk or legal-aid intake and say you need help identifying what information is required before the deadline.",
  };
}

function normalizeUrgentCourtActionQuality({
  action,
  contextText,
  branchLabel,
}: {
  action: DecisionFirstAction;
  contextText: string;
  branchLabel: string;
}): ActionQualityRepairResult {
  const originalActionText = canonicalDecisionActionText(action);
  const actionText = actionQualityParts(action);
  const needsRepair = vagueUrgentCourtActionNeedsRepair(`${contextText} ${actionText}`);
  if (!needsRepair) {
    return {
      action,
      flags: [],
      original_action_text: originalActionText,
      canonical_action_text: decisionActionTaskNotes(action),
      repaired: false,
    };
  }
  const template = urgentCourtActionTemplate(`${contextText} ${actionText}`, branchLabel);
  const repairedAction = {
    ...action,
    title: clipText(template.title, action.title, 180),
    details: clipText(template.details, action.details, 2000),
    success_condition: clipText(
      template.success_condition,
      action.success_condition,
      1000,
    ),
    fallback: clipText(template.fallback, action.fallback, 1000),
  };
  return {
    action: repairedAction,
    flags: ["vague_action_repaired"],
    original_action_text: originalActionText,
    canonical_action_text: decisionActionTaskNotes(repairedAction),
    repaired: true,
  };
}

export function normalizeActionLeafQuality({
  action,
  boardText: boardContext = "",
  branchLabel = "",
  searchStatus = "not_needed",
  webSearchCallCount = 0,
}: {
  action: DecisionFirstAction;
  boardText?: string;
  branchLabel?: string;
  searchStatus?: DecisionSearchStatus;
  webSearchCallCount?: number;
}): ActionQualityRepairResult {
  const localContextText = `${branchLabel} ${actionQualityParts(action)}`;
  const contextText = `${boardContext} ${localContextText}`;
  const originalActionText = canonicalDecisionActionText(action);
  if (textLooksUrgentCourtDeadlineBoard(contextText)) {
    return normalizeUrgentCourtActionQuality({
      action,
      contextText: localContextText,
      branchLabel,
    });
  }
  if (
    webSearchCallCount > 0 ||
    searchStatus === "not_needed" ||
    searchStatus === "searched" ||
    textLooksUrgentStability(contextText)
  ) {
    return {
      action,
      flags: [],
      original_action_text: originalActionText,
      canonical_action_text: decisionActionTaskNotes(action),
      repaired: false,
    };
  }
  if (!textLooksLocalOrCurrent(contextText)) {
    return {
      action,
      flags: [],
      original_action_text: originalActionText,
      canonical_action_text: decisionActionTaskNotes(action),
      repaired: false,
    };
  }

  const gaps = actionQualityGaps(actionQualityParts(action));
  const shouldRepair = gaps.length > 0 || vagueActionNeedsRepair(actionQualityParts(action));
  if (!shouldRepair) {
    return {
      action,
      flags: [],
      original_action_text: originalActionText,
      canonical_action_text: decisionActionTaskNotes(action),
      repaired: false,
    };
  }

  const template = searchTemplateForAction({
    contextText: localContextText,
    branchLabel,
    locationHint: extractLocationHint(boardContext),
  });
  const repairedAction = {
    ...action,
    title: clipText(template.title, action.title, 180),
    details: clipText(template.details, action.details, 2000),
    success_condition: clipText(
      template.success_condition,
      action.success_condition,
      1000,
    ),
    fallback: clipText(template.fallback, action.fallback, 1000),
  };
  return {
    action: repairedAction,
    flags: [
      ...gaps,
      "vague_action_repaired",
      "search_needed_action_repaired",
    ],
    original_action_text: originalActionText,
    canonical_action_text: decisionActionTaskNotes(repairedAction),
    repaired: true,
  };
}

function normalizeActionForSearchQuality({
  action,
  boardText,
  branchLabel,
  searchStatus,
  webSearchCallCount,
}: {
  action: DecisionFirstAction;
  boardText?: string;
  branchLabel?: string;
  searchStatus: DecisionSearchStatus;
  webSearchCallCount: number;
}) {
  return normalizeActionLeafQuality({
    action,
    boardText,
    branchLabel,
    searchStatus,
    webSearchCallCount,
  }).action;
}

export function normalizeReconciliationFollowupQuality({
  recommendedFollowupAction,
  boardText: boardContext = "",
}: {
  recommendedFollowupAction: string;
  boardText?: string;
}): ReconciliationFollowupQualityResult {
  const followup = recommendedFollowupAction.trim();
  if (!followup || /^no action needed:/i.test(followup)) {
    return {
      recommended_followup_action: recommendedFollowupAction,
      flags: [],
      repaired: false,
    };
  }
  const text = `${boardContext} ${followup}`;
  if (textLooksUrgentStability(text)) {
    return {
      recommended_followup_action: recommendedFollowupAction,
      flags: [],
      repaired: false,
    };
  }
  const vagueMeta =
    /\b(recalculate(?: this| the)? board|update memory|memory updated|board updated)\b/i.test(
      followup,
    ) &&
    !/\b(schedule|choose|contact|call|send|draft|practice|review|organize|complete|session|project|success|if blocked)\b/i.test(
      followup,
    );
  if (!vagueMeta) {
    return {
      recommended_followup_action: recommendedFollowupAction,
      flags: [],
      repaired: false,
    };
  }
  return {
    recommended_followup_action:
      "Choose one concrete next action that respects the updated constraint, then schedule a 30-minute block this week to do it. Success: the action and time are recorded. If blocked, shrink it to a 10-minute preparation step or tell FlowPath what still prevents action.",
    flags: ["vague_action_repaired"],
    repaired: true,
  };
}

function honestSearchStatus({
  status,
  requiresWebSearch,
  text,
  sourceCount = 0,
  webSearchCallCount,
}: {
  status: DecisionSearchStatus;
  requiresWebSearch?: boolean;
  text?: string;
  sourceCount?: number;
  webSearchCallCount: number;
}): DecisionSearchStatus {
  if (webSearchCallCount > 0) return status;
  const needsSearch =
    Boolean(requiresWebSearch) ||
    sourceCount > 0 ||
    textNeedsLocalCurrentVerification(text ?? "");
  if (status === "searched") {
    if (needsSearch || textLooksExternal(text ?? "")) return "needed";
    return "not_needed";
  }
  if (status === "not_needed" && needsSearch) return "needed";
  return status;
}

function addUniqueStep(
  steps: NextMoveStep[],
  step: NextMoveStep | null | undefined,
) {
  if (!step?.title?.trim() || !step.details?.trim()) return steps;
  if (steps.some((item) => isNearDuplicate(item.title, step.title))) return steps;
  return [...steps, step];
}

function uniqueSteps(steps: NextMoveStep[]) {
  return steps.reduce<NextMoveStep[]>((items, step) => addUniqueStep(items, step), []);
}

function boardText(plan: PlanLike) {
  return [
    plan.situation_read,
    plan.situation_summary,
    plan.highest_leverage_move_today.title,
    plan.highest_leverage_move_today.description,
    plan.why_this_move,
    plan.operator_insight.operator_path,
    plan.operator_insight.naive_path,
    ...plan.key_constraints,
    ...plan.context_used.map((item) => `${item.label} ${item.value}`),
    ...plan.task_candidates.map((task) => `${task.title} ${task.details}`),
  ].join(" ");
}

function decisionTreeText(tree: DecisionTree) {
  return [
    tree.current_action.title,
    tree.current_action.details,
    tree.current_action.success_condition,
    tree.current_action.fallback,
    ...tree.nodes.flatMap((node) => [
      node.title,
      node.question,
      node.context_summary,
      node.action?.title ?? "",
      node.action?.details ?? "",
      node.action?.success_condition ?? "",
      node.action?.fallback ?? "",
      ...node.options.flatMap((option) => [
        option.label,
        option.description,
        option.why,
        option.upside,
        option.downside,
        option.time_to_feedback,
        option.first_action.title,
        option.first_action.details,
        option.first_action.success_condition,
        option.first_action.fallback,
      ]),
    ]),
  ].join(" ");
}

function normalizeDecisionActionForContext({
  action,
  boardContext,
  branchLabel,
  searchStatus,
  webSearchCallCount,
}: {
  action: DecisionFirstAction;
  boardContext: string;
  branchLabel: string;
  searchStatus: DecisionSearchStatus;
  webSearchCallCount: number;
}) {
  return normalizeActionLeafQuality({
    action,
    boardText: boardContext,
    branchLabel,
    searchStatus,
    webSearchCallCount,
  }).action;
}

export function normalizeDecisionTreeLabelsRecursively(
  tree: DecisionTree,
  {
    contextText = "",
    webSearchCallCount = 0,
  }: {
    contextText?: string;
    webSearchCallCount?: number;
  } = {},
): DecisionTree {
  const fullContext = `${contextText} ${decisionTreeText(tree)}`;
  const nodes = tree.nodes.map((node) => {
    const nodeContext = `${node.title} ${node.question} ${node.context_summary} ${node.action ? actionQualityParts(node.action) : ""}`;
    const title = normalizeUserFacingMoveMapLabel(node.title, nodeContext, fullContext);
    const options = node.options.map((option) => {
      const optionContext = `${nodeContext} ${option.label} ${option.description} ${option.why} ${option.first_action.details}`;
      const label = normalizeUserFacingMoveMapLabel(option.label, optionContext, fullContext);
      const first_action = normalizeDecisionActionForContext({
        action: option.first_action,
        boardContext: `${fullContext} ${optionContext}`,
        branchLabel: label,
        searchStatus: option.search_status,
        webSearchCallCount,
      });
      return {
        ...option,
        label,
        first_action,
        success_condition: first_action.success_condition,
        fallback: first_action.fallback,
      };
    });
    const action = node.action
      ? normalizeDecisionActionForContext({
          action: node.action,
          boardContext: `${fullContext} ${nodeContext}`,
          branchLabel: title,
          searchStatus: node.search_status,
          webSearchCallCount,
        })
      : null;
    return {
      ...node,
      title,
      action,
      options,
    };
  });
  const treeWithLabels = decisionTreeSchema.parse({ ...tree, nodes });
  const trace = decisionTreeTrace(treeWithLabels, treeWithLabels.selected_path);
  const selectedOption = trace.at(-1)?.selectedOption;
  const selectedNode = trace.at(-1)?.node;
  const currentActionSearchStatus =
    selectedOption?.search_status ?? selectedNode?.search_status ?? "not_needed";
  const current_action = normalizeDecisionActionForContext({
    action: treeWithLabels.current_action,
    boardContext: `${fullContext} ${selectedNode?.context_summary ?? ""}`,
    branchLabel: selectedOption?.label ?? selectedNode?.title ?? "",
    searchStatus: currentActionSearchStatus,
    webSearchCallCount,
  });
  return decisionTreeSchema.parse({ ...treeWithLabels, current_action });
}

function selectedLineSteps(plan: PlanLike, firstAction: DecisionFirstAction) {
  return uniqueSteps([
    { title: firstAction.title, details: firstAction.details },
    ...plan.first_30_minutes,
    ...plan.next_24_hours.slice(0, 2),
    ...plan.next_7_days.slice(0, 2),
  ]).slice(0, 6);
}

function parseRawDecisionTree(rawJson: string | undefined) {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson) as { decision_tree?: unknown };
    return parsed.decision_tree ?? null;
  } catch {
    return null;
  }
}

function sourceItems(scout: LocalRealityScout): DecisionBranchSource[] {
  return scout.findings.slice(0, 4).map((finding) => ({
    title: finding.title,
    why_it_matters: finding.why_it_matters,
    source: finding.source,
    url_or_next_search: finding.url_or_next_search,
  }));
}

function searchStatus(scout: LocalRealityScout): DecisionSearchStatus {
  if (scout.findings.length > 0 || scout.used_web_search) return "searched";
  if (scout.missing_location_question) return "needed";
  return "not_needed";
}

function firstActionFromTask(
  task: PlanTaskCandidate | undefined,
  fallbackStep: NextMoveStep,
  fallbackSuccess: string,
  fallback: string,
): DecisionFirstAction {
  return {
    title: clipText(task?.title ?? fallbackStep.title, "Take the first action", 180),
    details: clipText(
      task?.description || task?.details || fallbackStep.details,
      "Do the smallest useful first action.",
      2000,
    ),
    estimated_minutes: task?.estimated_minutes ?? null,
    success_condition: clipText(
      task?.success_condition || fallbackSuccess,
      "The action is completed and the next signal is clearer.",
      1000,
    ),
    fallback: clipText(fallback, "If blocked, shrink the action and report what happened.", 1000),
  };
}

function optionFromPlan({
  id,
  label,
  description,
  recommendationLevel,
  why,
  upside,
  downside,
  friction,
  timeToFeedback,
  firstAction,
  nextSteps,
  selected,
  search,
  sources,
}: {
  id: string;
  label: string;
  description: string;
  recommendationLevel: DecisionRecommendationLevel;
  why: string;
  upside: string;
  downside: string;
  friction: "low" | "medium" | "high";
  timeToFeedback: string;
  firstAction: DecisionFirstAction;
  nextSteps: NextMoveStep[];
  selected: boolean;
  search: DecisionSearchStatus;
  sources: DecisionBranchSource[];
}): DecisionOption {
  return {
    id,
    node_id: rootNodeId,
    label: clipText(normalizeUserFacingMoveMapLabel(label), "Available move", 120),
    description: clipText(description, "A possible path from the current board.", 1000),
    move_type: recommendationLevel === "recommended" ? "mixed" : "progress",
    recommendation_level: recommendationLevel,
    why: clipText(why, "This move changes the board in a concrete way.", 1200),
    upside: clipText(upside, "It creates a useful signal.", 900),
    downside: clipText(downside, "It may cost time or attention without enough signal.", 900),
    friction,
    time_to_feedback: clipText(timeToFeedback, "Today", 160),
    requires_web_search: search === "needed" || search === "searched",
    search_status: search,
    next_node_id: null,
    can_explore: true,
    first_action: firstAction,
    success_condition: firstAction.success_condition,
    fallback: firstAction.fallback,
    selected,
    next_steps: nextSteps.slice(0, 6),
    sources,
  };
}

function uniqueOptions(options: DecisionOption[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = option.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeRootOptions({
  root,
  selectedId,
  recommendedId,
  plan,
}: {
  root: ReturnType<typeof rootDecisionNode>;
  selectedId: string;
  recommendedId: string;
  plan: PlanLike;
}) {
  const selected =
    root.options.find((option) => option.id === selectedId) ??
    root.options.find((option) => option.id === recommendedId) ??
    root.options[0] ??
    null;
  if (!selected) return root.options;

  const demotedSteps: NextMoveStep[] = [];
  const strategicOptions = root.options.filter((option) => {
    if (option.id === selected.id || option.id === recommendedId) return true;
    if (!isTaskLikeOption(option, selected)) return true;
    demotedSteps.push({
      title: option.first_action.title || option.label,
      details: option.first_action.details || option.description,
    });
    return false;
  });
  const cleaned = strategicOptions.length > 0 ? strategicOptions : root.options;

  return cleaned.map((option) => {
    const label = normalizeUserFacingMoveMapLabel(option.label);
    const isSelected = option.id === selected.id;
    const nextSteps = isSelected
      ? uniqueSteps([
          ...option.next_steps,
          ...demotedSteps,
          ...selectedLineSteps(plan, option.first_action),
        ]).slice(0, 6)
      : uniqueSteps(option.next_steps).slice(0, 6);
    return {
      ...option,
      label,
      selected: isSelected,
      next_steps: nextSteps,
    };
  });
}

export function buildFallbackDecisionTree(plan: PlanLike): DecisionTree {
  const recommendedTask = plan.task_candidates[0];
  const supportTask = plan.task_candidates[1];
  const scoutStatus = searchStatus(plan.local_reality_scout);
  const sources = sourceItems(plan.local_reality_scout);
  const fallbackAction = firstActionFromTask(
    recommendedTask,
    plan.first_10_minute_action,
    plan.highest_leverage_move_today.success_condition,
    plan.restraint_guidance.recovery_move,
  );
  const nextSteps = selectedLineSteps(plan, fallbackAction);
  const recommendedId = slug(
    plan.operator_insight.operator_path ||
      plan.highest_leverage_move_today.title ||
      recommendedTask?.title ||
      "best move",
    "best_move",
  );
  const options = uniqueOptions([
        optionFromPlan({
          id: recommendedId,
          label: taskLikeBranchStart.test(plan.highest_leverage_move_today.title)
            ? plan.operator_insight.operator_path
            : plan.highest_leverage_move_today.title,
          description: plan.highest_leverage_move_today.description,
          recommendationLevel: "recommended",
          why: plan.why_this_move,
          upside: plan.highest_leverage_move_today.success_condition,
          downside: plan.likely_trap,
          friction: recommendedTask?.friction_level ?? "medium",
          timeToFeedback: `${plan.highest_leverage_move_today.estimated_minutes} min`,
          firstAction: fallbackAction,
          nextSteps,
          selected: true,
          search: scoutStatus,
          sources,
        }),
        optionFromPlan({
          id: "naive_path",
          label: plan.operator_insight.naive_path,
          description: plan.operator_insight.naive_path,
          recommendationLevel: "not_now",
          why: plan.operator_insight.wasted_motion_to_avoid,
          upside: "It may feel familiar or easy to start.",
          downside: plan.operator_insight.wasted_motion_to_avoid,
          friction: "medium",
          timeToFeedback: "Low signal",
          firstAction: {
            title: "Do not start here yet",
            details: plan.operator_insight.wasted_motion_to_avoid,
            estimated_minutes: null,
            success_condition: "You avoid the low-yield path for this pass.",
            fallback: "If this still feels right, tell FlowPath what changed and recalculate.",
          },
          nextSteps: [],
          selected: false,
          search: "not_needed",
          sources: [],
        }),
        optionFromPlan({
          id: "smallest_viable_path",
          label: "Smallest viable path",
          description: plan.restraint_guidance.reason,
          recommendationLevel: "viable",
          why: plan.restraint_guidance.reason,
          upside: "It protects momentum while keeping scope small.",
          downside: plan.restraint_guidance.scope_boundary,
          friction: "low",
          timeToFeedback: "Today",
          firstAction: {
            title: plan.restraint_guidance.minimum_viable_move,
            details: plan.restraint_guidance.minimum_viable_move,
            estimated_minutes: null,
            success_condition: "The minimum viable move is complete.",
            fallback: plan.restraint_guidance.recovery_move,
          },
          nextSteps: [
            {
              title: plan.restraint_guidance.minimum_viable_move,
              details: plan.restraint_guidance.reason,
            },
          ],
          selected: false,
          search: "not_needed",
          sources: [],
        }),
        supportTask
          ? optionFromPlan({
              id: "supporting_path",
              label: "Supporting path",
              description: supportTask.description || supportTask.details,
              recommendationLevel: "supplement",
              why: supportTask.why_now || supportTask.rank_reason,
              upside: supportTask.success_condition,
              downside: "Useful, but it should not displace the recommended line.",
              friction: supportTask.friction_level,
              timeToFeedback: `${supportTask.estimated_minutes} min`,
              firstAction: firstActionFromTask(
                supportTask,
                { title: supportTask.title, details: supportTask.details },
                supportTask.success_condition,
                plan.restraint_guidance.recovery_move,
              ),
              nextSteps: [
                {
                  title: supportTask.title,
                  details: supportTask.details,
                },
              ],
              selected: false,
              search: "not_needed",
              sources: [],
            })
          : optionFromPlan({
              id: "watch_the_trap",
              label: "Trap to avoid",
              description: plan.likely_trap,
              recommendationLevel: "risky",
              why: plan.likely_trap,
              upside: "It may seem productive in the moment.",
              downside: plan.what_not_to_do[0] ?? plan.likely_trap,
              friction: "high",
              timeToFeedback: "Unclear",
              firstAction: {
                title: "Avoid this branch for now",
                details: plan.what_not_to_do[0] ?? plan.likely_trap,
                estimated_minutes: null,
                success_condition: "You do not spend this pass on the risky branch.",
                fallback: "If blocked, report what happened and recalculate.",
              },
              nextSteps: [],
              selected: false,
              search: "not_needed",
              sources: [],
            }),
    ]).slice(0, 6);

  const tree: DecisionTree = {
    id: fallbackTreeId,
    board_id: plan.situation_id ?? null,
    root_node_id: rootNodeId,
    active_node_id: rootNodeId,
    selected_path: [recommendedId],
    recommended_option_id: recommendedId,
    current_action: fallbackAction,
    nodes: [
      {
        id: rootNodeId,
        parent_id: null,
        selected_from_option_id: null,
        kind: "decision",
        title: "Current position",
        question: compactQuestion(
          plan.situation_read,
          "What is the best move from this board?",
        ),
        context_summary: clipText(plan.situation_summary, "Current board position.", 1200),
        options,
        action: null,
        selected_option_id: recommendedId,
        status: "active",
        search_status: scoutStatus,
        generated_at: plan.created_at ?? nowIso(),
      },
    ],
    created_at: plan.created_at ?? nowIso(),
    updated_at: plan.created_at ?? nowIso(),
  };
  return sanitizeDecisionTreeSearchStatuses(
    tree,
    plan.local_reality_scout.used_web_search || plan.local_reality_scout.findings.length > 0 ? 1 : 0,
    boardText(plan),
  );
}

export function normalizeDecisionTree(plan: PlanLike): DecisionTree {
  const parsed = decisionTreeSchema.safeParse(
    plan.decision_tree ?? parseRawDecisionTree(plan.raw_json),
  );
  if (!parsed.success) return buildFallbackDecisionTree(plan);

  const tree = parsed.data;
  const root = tree.nodes.find((node) => node.id === tree.root_node_id) ?? tree.nodes[0];
  if (!root?.options.length) return buildFallbackDecisionTree(plan);
  const recommended =
    root.options.find((option) => option.id === tree.recommended_option_id) ??
    root.options.find((option) => option.recommendation_level === "recommended") ??
    root.options[0];
  const selectedId =
    tree.selected_path.find((id) => root.options.some((option) => option.id === id)) ??
    recommended.id;
  const selected = root.options.find((option) => option.id === selectedId) ?? recommended;
  const cleanedOptions = normalizeRootOptions({
    root,
    selectedId: selected.id,
    recommendedId: recommended.id,
    plan,
  });
  const nodes = tree.nodes.map((node) =>
    node.id === root.id
      ? {
          ...node,
          title: normalizeUserFacingMoveMapLabel(node.title),
          selected_option_id: selected.id,
          question: compactQuestion(
            node.question,
            "What is the best move from this board?",
          ),
          options: cleanedOptions.map((option) => ({
            ...option,
            selected: option.id === selected.id,
          })),
        }
      : {
          ...node,
          title: normalizeUserFacingMoveMapLabel(node.title),
          options: node.options.map((option) => ({
            ...option,
            label: normalizeUserFacingMoveMapLabel(option.label),
          })),
        },
  );
  const normalizedTree = {
    ...tree,
    board_id: tree.board_id ?? plan.situation_id ?? null,
    root_node_id: root.id,
    recommended_option_id: recommended.id,
    nodes,
    created_at: tree.created_at || plan.created_at || nowIso(),
    updated_at: tree.updated_at || tree.created_at || plan.created_at || nowIso(),
  };
  const selectedPath = normalizeSelectedPath(
    normalizedTree,
    tree.selected_path.length ? tree.selected_path : [selected.id],
  );
  const currentAction = currentActionForPath(normalizedTree, selectedPath);

  return normalizeDecisionTreeLabelsRecursively({
    ...normalizedTree,
    active_node_id: activeNodeIdForPath(normalizedTree, selectedPath),
    selected_path: selectedPath,
    current_action: currentAction,
  }, {
    contextText: boardText(plan),
    webSearchCallCount:
      plan.local_reality_scout.used_web_search || plan.local_reality_scout.findings.length > 0
        ? 1
        : 0,
  });
}

export function rootDecisionNode(tree: DecisionTree) {
  return tree.nodes.find((node) => node.id === tree.root_node_id) ?? tree.nodes[0];
}

export function getDecisionNode(tree: DecisionTree, nodeId: string | null | undefined) {
  return tree.nodes.find((node) => node.id === nodeId) ?? null;
}

export function findDecisionOptionInNode(
  node: DecisionNode | null | undefined,
  optionId: string | null | undefined,
) {
  if (!node) return null;
  return node.options.find((option) => option.id === optionId) ?? null;
}

export function findDecisionOption(
  tree: DecisionTree,
  optionId: string | null | undefined,
) {
  const root = rootDecisionNode(tree);
  return (
    tree.nodes.flatMap((node) => node.options).find((option) => option.id === optionId) ??
    root.options.find((option) => option.id === tree.recommended_option_id) ??
    root.options[0]
  );
}

export type DecisionBranchCaution = {
  title: string;
  message: string;
  recommendedOptionId: string | null;
  recommendedLabel: string | null;
};

export function branchSelectionCaution(
  tree: DecisionTree,
  option: DecisionOption | null | undefined,
): DecisionBranchCaution | null {
  if (!option || option.id === tree.recommended_option_id) return null;
  const root = rootDecisionNode(tree);
  const recommended =
    root.options.find((item) => item.id === tree.recommended_option_id) ??
    root.options.find((item) => item.recommendation_level === "recommended") ??
    null;
  const treeText = decisionTreeText(tree);
  const optionText = `${option.label} ${option.description} ${option.why} ${option.downside} ${option.time_to_feedback} ${option.first_action.title} ${option.first_action.details}`;
  const text = `${treeText} ${optionText}`;
  const weakLevel = ["not_now", "supplement", "risky"].includes(
    option.recommendation_level,
  );
  const slowOrWasteful =
    /\b(not now|too broad|broad|slow|low signal|waste|later|supplement|only after|not the first move|not recommended)\b/i.test(
      optionText,
    ) || option.friction === "high";
  const urgentCourt = textLooksUrgentCourtDeadlineBoard(text);
  const needsCaution = weakLevel || slowOrWasteful || urgentCourt;
  if (!needsCaution) return null;

  const recommendedLabel = recommended?.label ?? null;
  const recommendedPhrase = recommendedLabel
    ? ` The recommended first move is still ${recommendedLabel}.`
    : "";
  let message =
    "This is not the recommended first move. Continue only if you intentionally want to explore this branch.";

  if (urgentCourt && /\bforms?|rules?|search|online|broad\b/i.test(optionText)) {
    message =
      "This is not the recommended first move. It may waste time before you confirm the exact notice, court, deadline, and document.";
  } else if (urgentCourt && /\bextension|more\s+time|extra\s+time\b/i.test(optionText)) {
    message =
      "This may matter, but it is safer after you confirm the exact deadline and document.";
  } else if (urgentCourt && /\blegal[-\s]+aid|intake\b/i.test(optionText)) {
    message =
      "This is viable if risk is high or you cannot find the notice, but intake will likely need the court name, case number, deadline, and document title.";
  } else if (urgentCourt && /\bclerk\b/i.test(optionText)) {
    message =
      "This can help with process information, but it works best when you have the notice facts or know what details are missing.";
  } else if (option.recommendation_level === "supplement") {
    message =
      "This may help as a supplement, but it should not displace the recommended first move.";
  } else if (option.recommendation_level === "risky") {
    message =
      "This branch carries more downside or wasted-motion risk than the recommended first move.";
  }

  return {
    title: "Check before continuing",
    message: `${message}${recommendedPhrase}`,
    recommendedOptionId: recommended?.id ?? null,
    recommendedLabel,
  };
}

export function decisionTreeDefaultOptionId(tree: DecisionTree) {
  return findDecisionOption(tree, tree.selected_path[0])?.id ?? tree.recommended_option_id;
}

export type DecisionTreeTraceItem = {
  node: DecisionNode;
  selectedOption: DecisionOption | null;
  childNode: DecisionNode | null;
};

function defaultOptionForNode(tree: DecisionTree, node: DecisionNode) {
  return (
    findDecisionOptionInNode(node, node.selected_option_id) ??
    (node.id === tree.root_node_id
      ? findDecisionOptionInNode(node, tree.recommended_option_id)
      : null) ??
    node.options.find((option) => option.recommendation_level === "recommended") ??
    node.options[0] ??
    null
  );
}

export function normalizeSelectedPath(
  tree: Pick<DecisionTree, "root_node_id" | "recommended_option_id" | "nodes">,
  selectedPath: string[],
) {
  const normalized: string[] = [];
  let node: DecisionNode | null =
    tree.nodes.find((item) => item.id === tree.root_node_id) ?? tree.nodes[0] ?? null;
  let depth = 0;

  while (node?.kind !== "action" && node?.options.length) {
    const selectedId = selectedPath[depth];
    const option: DecisionOption | undefined =
      node.options.find((item) => item.id === selectedId) ??
      (node.id === tree.root_node_id
        ? node.options.find((item) => item.id === tree.recommended_option_id)
        : null) ??
      node.options.find((item) => item.recommendation_level === "recommended") ??
      node.options[0];
    if (!option) break;
    normalized.push(option.id);
    if (!option.next_node_id) break;
    node = tree.nodes.find((item) => item.id === option.next_node_id) ?? null;
    depth += 1;
  }

  return normalized;
}

export function decisionTreeTrace(
  tree: DecisionTree,
  selectedPath: string[] = tree.selected_path,
): DecisionTreeTraceItem[] {
  const path = normalizeSelectedPath(tree, selectedPath);
  const trace: DecisionTreeTraceItem[] = [];
  let node = rootDecisionNode(tree);
  let depth = 0;

  while (node) {
    if (node.kind === "action") {
      trace.push({ node, selectedOption: null, childNode: null });
      break;
    }
    const selectedOption =
      findDecisionOptionInNode(node, path[depth]) ?? defaultOptionForNode(tree, node);
    const childNode = selectedOption?.next_node_id
      ? getDecisionNode(tree, selectedOption.next_node_id)
      : null;
    trace.push({ node, selectedOption, childNode });
    if (!childNode || !selectedOption) break;
    node = childNode;
    depth += 1;
  }

  return trace;
}

export function selectedPathForChoice(
  tree: DecisionTree,
  currentPath: string[],
  nodeId: string,
  optionId: string,
) {
  const trace = decisionTreeTrace(tree, currentPath);
  const nodeIndex = trace.findIndex((item) => item.node.id === nodeId);
  if (nodeIndex < 0) return [optionId];
  return [...trace.slice(0, nodeIndex).flatMap((item) => item.selectedOption?.id ?? []), optionId];
}

export function activeNodeIdForPath(tree: DecisionTree, selectedPath: string[]) {
  const trace = decisionTreeTrace(tree, selectedPath);
  return trace.at(-1)?.node.id ?? tree.root_node_id;
}

export function currentActionForPath(tree: DecisionTree, selectedPath: string[]) {
  const trace = decisionTreeTrace(tree, selectedPath);
  const last = trace.at(-1);
  if (last?.node.kind === "action" && last.node.action) return last.node.action;
  return last?.selectedOption?.first_action ?? tree.current_action;
}

function optionSearchStatus(option: DecisionOption): DecisionSearchStatus {
  if (option.search_status === "searched") return "searched";
  if (option.requires_web_search) return option.search_status === "not_needed" ? "needed" : option.search_status;
  return option.search_status;
}

function childOption({
  parent,
  suffix,
  label,
  description,
  recommendationLevel,
  searchStatus,
}: {
  parent: DecisionOption;
  suffix: string;
  label: string;
  description: string;
  recommendationLevel: DecisionRecommendationLevel;
  searchStatus?: DecisionSearchStatus;
}): DecisionOption {
  const id = `${parent.id}_${slug(suffix, "path")}`;
  const action = {
    title: label,
    details: description,
    estimated_minutes: parent.first_action.estimated_minutes,
    success_condition: parent.success_condition,
    fallback: parent.fallback,
  };
  return {
    ...parent,
    id,
    node_id: "",
    label: clipText(label, "Next path", 120),
    description: clipText(description, "A possible next fork.", 1000),
    recommendation_level: recommendationLevel,
    why: clipText(description, parent.why, 1200),
    upside: parent.upside,
    downside: parent.downside,
    search_status: searchStatus ?? optionSearchStatus(parent),
    requires_web_search:
      (searchStatus ?? optionSearchStatus(parent)) !== "not_needed",
    next_node_id: null,
    can_explore: true,
    first_action: action,
    success_condition: action.success_condition,
    fallback: action.fallback,
    selected: false,
    next_steps: [],
    sources: parent.sources,
  };
}

function childOptionsForBranch(parent: DecisionOption): DecisionOption[] {
  const label = parent.label.toLowerCase();
  const status = optionSearchStatus(parent);
  const branchText = `${parent.label} ${parent.description} ${parent.why} ${parent.first_action.title} ${parent.first_action.details}`;
  if (textLooksCourtDeadlineBoard(branchText)) {
    if (/\blegal[-\s]+aid|intake\b/i.test(branchText)) {
      return [
        childOption({
          parent,
          suffix: "call_legal_aid_intake",
          label: "Call legal aid intake",
          description:
            "Ask whether they can help before the deadline and what notice details they need.",
          recommendationLevel: "recommended",
          searchStatus: status,
        }),
        childOption({
          parent,
          suffix: "documents_needed",
          label: "Ask what documents they need",
          description:
            "Confirm what paperwork, notice facts, or case details intake needs before they can help.",
          recommendationLevel: "viable",
          searchStatus: "not_needed",
        }),
        childOption({
          parent,
          suffix: "prepare_notice_facts",
          label: "Prepare a notice facts sheet",
          description:
            "Copy court name, case number, deadline, document title, and filing instructions before calling.",
          recommendationLevel: "supplement",
          searchStatus: "not_needed",
        }),
      ];
    }

    if (/\bextension|more\s+time|extra\s+time\b/i.test(branchText)) {
      return [
        childOption({
          parent,
          suffix: "confirm_deadline_first",
          label: "Confirm the exact deadline",
          description:
            "Verify the deadline date/time and document title before focusing on more-time process.",
          recommendationLevel: "recommended",
          searchStatus: "not_needed",
        }),
        childOption({
          parent,
          suffix: "ask_more_time_process",
          label: "Ask about the process for more time",
          description:
            "Ask the clerk or legal aid what process exists without assuming an extension is available.",
          recommendationLevel: "viable",
          searchStatus: status,
        }),
        childOption({
          parent,
          suffix: "prepare_questions",
          label: "Prepare process-only questions",
          description:
            "Write down exactly what to ask about filing method, deadline, and where self-help guidance lives.",
          recommendationLevel: "supplement",
          searchStatus: "not_needed",
        }),
      ];
    }

    if (/\bforms?|rules?|search|online|broad\b/i.test(branchText)) {
      return [
        childOption({
          parent,
          suffix: "find_notice_first",
          label: "Find the notice first",
          description:
            "Use the notice facts before searching so you do not waste time on broad or wrong forms.",
          recommendationLevel: "recommended",
          searchStatus: "not_needed",
        }),
        childOption({
          parent,
          suffix: "official_pages_only",
          label: "Search official pages only",
          description:
            "Search using exact court and document terms, and treat results as unverified until matched to the notice.",
          recommendationLevel: "viable",
          searchStatus: status,
        }),
        childOption({
          parent,
          suffix: "call_clerk_if_unclear",
          label: "Call the clerk if results are broad",
          description:
            "Stop broad searching and ask the clerk what process information matches the notice.",
          recommendationLevel: "supplement",
          searchStatus: "not_needed",
        }),
      ];
    }

    return [
      childOption({
        parent,
        suffix: "find_notice",
        label: "Find the notice",
        description:
          "Locate the notice and copy the deadline, court, case number, document title, and filing instructions.",
        recommendationLevel: "recommended",
        searchStatus: "not_needed",
      }),
      childOption({
        parent,
        suffix: "call_court_clerk",
        label: "Call the court clerk",
        description:
          "Ask process-only questions about the deadline, filing method, and who can confirm missing details.",
        recommendationLevel: "viable",
        searchStatus: status,
      }),
      childOption({
        parent,
        suffix: "call_legal_aid",
        label: "Call legal aid intake",
        description:
          "Ask whether intake can help before the deadline and what documents they need.",
        recommendationLevel: "viable",
        searchStatus: status,
      }),
      childOption({
        parent,
        suffix: "organize_documents",
        label: "Organize documents",
        description:
          "Put the notice and related paperwork in one packet before making calls or filing.",
        recommendationLevel: "supplement",
        searchStatus: "not_needed",
      }),
    ];
  }
  if (/\bcoach|coaching|instructor|lesson\b/.test(label)) {
    return [
      childOption({
        parent,
        suffix: "next_stage_support",
        label: "Coach who supports the next stage",
        description:
          "Best if the coach can correct basics and recommend an appropriate next setting for continued practice.",
        recommendationLevel: "recommended",
        searchStatus: status,
      }),
      childOption({
        parent,
        suffix: "small_group_session",
        label: "Small-group session",
        description: "Keeps direct feedback while adding repeated contact with other learners.",
        recommendationLevel: "viable",
        searchStatus: status,
      }),
      childOption({
        parent,
        suffix: "individual_then_referral",
        label: "One individual session, then a referral",
        description:
          "Use one session to assess the starting point, then ask what ongoing format fits the goal and constraints.",
        recommendationLevel: "viable",
        searchStatus: status,
      }),
      childOption({
        parent,
        suffix: "community_instructor",
        label: "Community-based instructor",
        description: "May be more affordable and connected to accessible beginner programs.",
        recommendationLevel: "supplement",
        searchStatus: status,
      }),
    ];
  }

  if (/\bclinic|class|studio|course|workshop|lesson|instruction\b/.test(label)) {
    return [
      childOption({
        parent,
        suffix: "recurring_course_or_cohort",
        label: "Recurring course or cohort",
        description:
          "Prioritize a repeated format that matches the user's level, schedule, and practice goals.",
        recommendationLevel: "recommended",
        searchStatus: status,
      }),
      childOption({
        parent,
        suffix: "short_workshop_or_series",
        label: "Short workshop or series",
        description: "Useful for testing the format without assuming a long commitment or skill level.",
        recommendationLevel: "viable",
        searchStatus: status,
      }),
      childOption({
        parent,
        suffix: "individual_instruction",
        label: "Individual instruction",
        description: "Offers direct feedback, but may provide less peer contact or repeated group practice.",
        recommendationLevel: "viable",
        searchStatus: status,
      }),
      childOption({
        parent,
        suffix: "single_session_trial",
        label: "Single-session trial",
        description: "Creates fast fit feedback before a larger commitment.",
        recommendationLevel: "supplement",
        searchStatus: status,
      }),
    ];
  }

  if (/\bnetwork|contact|coworker|outreach|people|friend\b/.test(label)) {
    return [
      childOption({
        parent,
        suffix: "warm_contacts",
        label: "Warm contacts",
        description: "Start with people who already have a little context for you.",
        recommendationLevel: "recommended",
      }),
      childOption({
        parent,
        suffix: "local_events",
        label: "Local events or rooms",
        description: "Use a recurring room where useful conversations can repeat.",
        recommendationLevel: "viable",
      }),
      childOption({
        parent,
        suffix: "specific_expert_outreach",
        label: "Specific expert outreach",
        description: "Ask one precise question of someone with domain context.",
        recommendationLevel: "viable",
      }),
    ];
  }

  return [
    childOption({
      parent,
      suffix: "lowest_friction",
      label: "Smallest practical step",
      description: "Choose the smallest concrete action that can move this option forward today.",
      recommendationLevel: "recommended",
      searchStatus: status,
    }),
    childOption({
      parent,
      suffix: "highest_signal",
      label: "Best fit-check step",
      description: "Choose the step most likely to show whether this option fits the current board.",
      recommendationLevel: "viable",
      searchStatus: status,
    }),
    childOption({
      parent,
      suffix: "supporting_prerequisite",
      label: "Prepare required details first",
      description: "Prepare the detail that makes the next action easier or safer.",
      recommendationLevel: "supplement",
      searchStatus: "not_needed",
    }),
  ];
}

function actionLeafForOption({
  parentNode,
  option,
  createdAt,
}: {
  parentNode: DecisionNode;
  option: DecisionOption;
  createdAt: string;
}): DecisionNode {
  const needsSearch = option.search_status !== "not_needed" && option.search_status !== "searched";
  const action = needsSearch
    ? {
        ...option.first_action,
        title: option.first_action.title.match(/\b(search|find|choose|contact)\b/i)
          ? option.first_action.title
          : `Search/check one ${option.label.toLowerCase()} option`,
        details:
          option.first_action.details ||
          `Search for ${option.label.toLowerCase()} options that fit this board, then pick one realistic first contact.`,
      }
    : option.first_action;
  return {
    id: `${parentNode.id}_${slug(option.id, "option")}_action`,
    parent_id: parentNode.id,
    selected_from_option_id: option.id,
    kind: "action",
    title: action.title,
    question: action.title,
    context_summary: option.why || option.description,
    options: [],
    action,
    selected_option_id: null,
    status: "active",
    search_status: option.search_status,
    generated_at: createdAt,
  };
}

function childDecisionForOption({
  parentNode,
  option,
  createdAt,
}: {
  parentNode: DecisionNode;
  option: DecisionOption;
  createdAt: string;
}): DecisionNode {
  const options = childOptionsForBranch(option).slice(0, childDecisionOptionLimit);
  const childId = `${parentNode.id}_${slug(option.id, "option")}_fork`;
  return {
    id: childId,
    parent_id: parentNode.id,
    selected_from_option_id: option.id,
    kind: "decision",
    title: `Next fork: ${option.label}`,
    question: nextQuestionForOption(option),
    context_summary: option.why || option.description,
    options: options.map((child, index) => ({
      ...child,
      node_id: childId,
      selected: index === 0,
    })),
    action: null,
    selected_option_id: options[0]?.id ?? null,
    status: "active",
    search_status: optionSearchStatus(option),
    generated_at: createdAt,
  };
}

function nextQuestionForOption(option: DecisionOption) {
  const label = option.label.toLowerCase();
  if (/\bcoach|coaching|instructor|lesson\b/.test(label)) {
    return "What kind of coaching path fits this goal?";
  }
  if (/\bwalk\b/.test(label)) return "What walkable option should you try first?";
  if (/\bclinic|class|group|community|studio|recurring\b/.test(label)) {
    return "Which recurring option should you check first?";
  }
  if (/\bnetwork|contact|outreach|people|friend\b/.test(label)) {
    return "What network entry point should you use first?";
  }
  return `What version of ${option.label.toLowerCase()} should you try first?`;
}

export function expandDecisionTreeAtOption({
  tree,
  nodeId,
  optionId,
  selectedPath,
}: {
  tree: DecisionTree;
  nodeId: string;
  optionId: string;
  selectedPath: string[];
}) {
  const now = nowIso();
  const node = getDecisionNode(tree, nodeId);
  if (!node || node.kind === "action") return tree;
  const option = findDecisionOptionInNode(node, optionId);
  if (!option) return tree;
  const nextPath = selectedPathForChoice(tree, selectedPath, nodeId, optionId);
  if (option.next_node_id && getDecisionNode(tree, option.next_node_id)) {
    return {
      ...tree,
      selected_path: normalizeSelectedPath(tree, nextPath),
      active_node_id: activeNodeIdForPath(tree, nextPath),
      current_action: currentActionForPath(tree, nextPath),
      updated_at: now,
    };
  }

  const isRootExpansion = node.id === tree.root_node_id;
  const childNode = isRootExpansion
    ? childDecisionForOption({ parentNode: node, option, createdAt: now })
    : actionLeafForOption({ parentNode: node, option, createdAt: now });
  const nodes = tree.nodes.map((item) =>
    item.id === node.id
      ? {
          ...item,
          selected_option_id: option.id,
          options: item.options.map((candidate) =>
            candidate.id === option.id
              ? {
                  ...candidate,
                  selected: true,
                  next_node_id: childNode.id,
                  can_explore: false,
                }
              : { ...candidate, selected: false },
          ),
        }
      : item,
  );
  const expandedTree = {
    ...tree,
    nodes: [...nodes, childNode],
    selected_path: normalizeSelectedPath(
      { ...tree, nodes: [...nodes, childNode] },
      nextPath,
    ),
    updated_at: now,
  };
  const normalizedExpandedTree = normalizeDecisionTreeLabelsRecursively(expandedTree, {
    contextText: decisionTreeText(expandedTree),
  });
  return {
    ...normalizedExpandedTree,
    active_node_id: activeNodeIdForPath(
      normalizedExpandedTree,
      normalizedExpandedTree.selected_path,
    ),
    current_action: currentActionForPath(
      normalizedExpandedTree,
      normalizedExpandedTree.selected_path,
    ),
  };
}

function uniqueNodeId(tree: DecisionTree, base: string) {
  const used = new Set(tree.nodes.map((node) => node.id));
  const clean = slug(base, "node").slice(0, 92);
  let id = clean;
  let index = 2;
  while (used.has(id)) {
    id = `${clean}_${index}`.slice(0, 120);
    index += 1;
  }
  return id;
}

function uniqueOptionId(options: DecisionOption[], base: string) {
  const used = new Set(options.map((option) => option.id));
  const clean = slug(base, "option").slice(0, 92);
  let id = clean;
  let index = 2;
  while (used.has(id)) {
    id = `${clean}_${index}`.slice(0, 120);
    index += 1;
  }
  return id;
}

function inferMoveType(value: string): DecisionMoveType {
  if (/\b(safe|stability|cash|risk|protect|urgent|fallback|baseline)\b/i.test(value)) {
    return "protect";
  }
  if (/\b(meaning|craft|creative|practice|community|people|belonging|friend)\b/i.test(value)) {
    return "meaning";
  }
  if (/\b(work|money|career|income|job|client|proof|portfolio|business)\b/i.test(value)) {
    return "progress";
  }
  return "mixed";
}

function expansionStatusText(result: BranchExpansionResultInput) {
  return [
    result.reasoning_summary,
    result.selected_path_summary,
    result.node?.title,
    result.node?.question,
    result.node?.summary,
    result.node?.options
      .map((option) => `${option.label} ${option.short_rationale} ${option.first_action_preview}`)
      .join(" "),
    result.action_leaf?.title,
    result.action_leaf?.first_action,
  ]
    .filter(Boolean)
    .join(" ");
}

function isSequentialExpansion(result: BranchExpansionResultInput) {
  if (result.result_type !== "decision_node" || !result.node) return false;
  if (result.node.options.length < 2) return false;
  const taskLikeCount = result.node.options.filter((option) =>
    taskLikeBranchStart.test(option.label),
  ).length;
  return taskLikeCount >= Math.max(2, result.node.options.length - 1);
}

export function normalizeBranchExpansionResult(
  result: BranchExpansionResultInput,
  selectedOption?: Pick<DecisionOption, "label" | "first_action" | "success_condition" | "fallback">,
): BranchExpansionResultInput {
  if (!isSequentialExpansion(result) || !result.node) return result;
  const steps = result.node.options.map((option) => option.label).filter(Boolean);
  const first = result.node.options[0];
  const firstAction =
    first?.first_action_preview ||
    steps[0] ||
    selectedOption?.first_action.title ||
    `Continue ${selectedOption?.label ?? "this path"}`;
  return {
    result_type: "action_leaf",
    node: null,
    action_leaf: {
      kind: "action",
      title: clipText(firstAction, `Continue ${selectedOption?.label ?? "this path"}`, 180),
      first_action: clipText(
        [firstAction, ...steps.slice(1)].join(" -> "),
        selectedOption?.first_action.details || firstAction,
        1000,
      ),
      first_10_minutes:
        selectedOption?.first_action.details ||
        first?.short_rationale ||
        "Do the first concrete step on this path.",
      success_condition:
        selectedOption?.success_condition ||
        selectedOption?.first_action.success_condition ||
        "The first concrete step on this path is complete.",
      if_blocked:
        selectedOption?.fallback ||
        selectedOption?.first_action.fallback ||
        "Choose a lower-friction branch or tell FlowPath what changed.",
      search_status: result.node.search_status,
    },
    reasoning_summary: result.reasoning_summary,
    selected_path_summary: result.selected_path_summary,
    memory_used: result.memory_used,
    assumptions: result.assumptions,
    search_needed: result.search_needed,
  };
}

export function sanitizeBranchExpansionSearchStatus(
  result: BranchExpansionResultInput,
  webSearchCallCount: number,
  contextText = "",
): BranchExpansionResultInput {
  const resultText = expansionStatusText(result);
  if (result.result_type === "decision_node" && result.node) {
    const nodeSearchStatus = honestSearchStatus({
      status: result.node.search_status ?? "not_needed",
      requiresWebSearch: result.search_needed,
      text: resultText,
      webSearchCallCount,
    });
    return {
      ...result,
      node: {
        ...result.node,
        title: normalizeUserFacingMoveMapLabel(
          result.node.title,
          `${result.node.title} ${result.node.question} ${result.node.summary}`,
          `${contextText} ${resultText}`,
        ),
        search_status: nodeSearchStatus,
        options: result.node.options.map((option) => {
          const text = `${option.label} ${option.short_rationale} ${option.first_action_preview}`;
          const search_status = honestSearchStatus({
            status: option.search_status ?? "not_needed",
            requiresWebSearch: result.search_needed,
            text,
            webSearchCallCount,
          });
          const label = normalizeUserFacingMoveMapLabel(
            option.label,
            text,
            `${contextText} ${resultText}`,
          );
          const action = normalizeActionLeafQuality({
            action: {
              title: option.first_action_preview || label,
              details: option.first_action_preview || option.short_rationale,
              estimated_minutes: null,
              success_condition: "You know whether this branch is worth continuing.",
              fallback: "Choose another branch or tell FlowPath what changed.",
            },
            boardText: `${contextText} ${resultText}`,
            branchLabel: label,
            searchStatus: search_status,
            webSearchCallCount,
          });
          return {
            ...option,
            label,
            search_status,
            first_action_preview: action.repaired
              ? action.action.title
              : option.first_action_preview,
          };
        }),
      },
    };
  }
  if (result.result_type === "action_leaf" && result.action_leaf) {
    const search_status = honestSearchStatus({
      status: result.action_leaf.search_status ?? "not_needed",
      requiresWebSearch: result.search_needed,
      text: resultText,
      webSearchCallCount,
    });
    const title = normalizeUserFacingMoveMapLabel(
      result.action_leaf.title,
      `${result.action_leaf.title} ${result.action_leaf.first_action}`,
      `${contextText} ${resultText}`,
    );
    const action = normalizeActionLeafQuality({
      action: {
        title,
        details: result.action_leaf.first_action,
        estimated_minutes: null,
        success_condition: result.action_leaf.success_condition,
        fallback: result.action_leaf.if_blocked,
      },
      boardText: `${contextText} ${resultText}`,
      branchLabel: result.selected_path_summary,
      searchStatus: search_status,
      webSearchCallCount,
    });
    return {
      ...result,
      action_leaf: {
        ...result.action_leaf,
        title: action.action.title,
        first_action: action.action.details,
        success_condition: action.action.success_condition,
        if_blocked: action.action.fallback,
        search_status,
      },
    };
  }
  return result;
}

export function sanitizeDecisionTreeSearchStatuses(
  tree: DecisionTree,
  webSearchCallCount: number,
  contextText = "",
): DecisionTree {
  const nodes = tree.nodes.map((node) => {
    const nodeText = `${node.title} ${node.question} ${node.context_summary}`;
    const nodeSearchStatus = honestSearchStatus({
      status: node.search_status,
      requiresWebSearch: node.options.some((option) => option.requires_web_search),
      text: `${contextText} ${nodeText}`,
      webSearchCallCount,
    });
    return {
      ...node,
      search_status: nodeSearchStatus,
      options: node.options.map((option) => {
        const optionText = `${option.label} ${option.description} ${option.why} ${option.first_action.title} ${option.first_action.details}`;
        const search_status = honestSearchStatus({
          status: option.search_status,
          requiresWebSearch: option.requires_web_search,
          text: `${contextText} ${nodeText} ${optionText}`,
          sourceCount: option.sources.length,
          webSearchCallCount,
        });
        const first_action = normalizeActionForSearchQuality({
          action: option.first_action,
          boardText: `${contextText} ${nodeText}`,
          branchLabel: option.label,
          searchStatus: search_status,
          webSearchCallCount,
        });
        return {
          ...option,
          search_status,
          requires_web_search: search_status !== "not_needed",
          sources: webSearchCallCount > 0 ? option.sources : [],
          first_action,
          success_condition: first_action.success_condition,
          fallback: first_action.fallback,
        };
      }),
      action: node.action
        ? normalizeActionForSearchQuality({
            action: node.action,
            boardText: `${contextText} ${nodeText}`,
            branchLabel: node.title,
            searchStatus: nodeSearchStatus,
            webSearchCallCount,
          })
        : null,
    };
  });
  const parsedTree = decisionTreeSchema.parse({ ...tree, nodes });
  const trace = decisionTreeTrace(parsedTree, parsedTree.selected_path);
  const selectedOption = trace.at(-1)?.selectedOption;
  const currentActionSearchStatus =
    selectedOption?.search_status ?? trace.at(-1)?.node.search_status ?? "not_needed";
  const current_action = normalizeActionForSearchQuality({
    action: parsedTree.current_action,
    boardText: `${contextText} ${selectedOption?.first_action.details ?? ""}`,
    branchLabel: selectedOption?.label ?? "",
    searchStatus: currentActionSearchStatus,
    webSearchCallCount,
  });
  return normalizeDecisionTreeLabelsRecursively(
    decisionTreeSchema.parse({ ...parsedTree, current_action }),
    { contextText, webSearchCallCount },
  );
}

export function normalizePlanOutputForPersistence<T extends NextMovePlan>(
  plan: T,
  {
    webSearchCallCount,
    contextText = "",
  }: {
    webSearchCallCount: number;
    contextText?: string;
  },
): T {
  return alignPlanActionsWithDecisionTree({
    ...plan,
    decision_tree: sanitizeDecisionTreeSearchStatuses(
      plan.decision_tree,
      webSearchCallCount,
      contextText,
    ),
  });
}

export function alignPlanActionsWithDecisionTree<T extends NextMovePlan>(plan: T): T {
  const action = plan.decision_tree.current_action;
  const canonicalDetails = decisionActionTaskNotes(action);
  if (!canonicalDetails.trim()) return plan;

  const task_candidates =
    plan.task_candidates.length > 0
      ? plan.task_candidates.map((candidate, index) =>
          index === 0
            ? {
                ...candidate,
                title: candidate.title || action.title,
                details: canonicalDetails,
                description: canonicalDetails,
                success_condition:
                  action.success_condition || candidate.success_condition,
                estimated_minutes:
                  candidate.estimated_minutes ?? action.estimated_minutes ?? 20,
              }
            : candidate,
        )
      : plan.task_candidates;

  return {
    ...plan,
    first_10_minute_action: {
      ...plan.first_10_minute_action,
      title: action.title || plan.first_10_minute_action.title,
      details: canonicalDecisionActionText(action),
    },
    task_candidates,
  };
}

function actionFromExpansionLeaf(
  leaf: NonNullable<BranchExpansionResultInput["action_leaf"]>,
  parentOption: DecisionOption,
): DecisionFirstAction {
  return {
    title: clipText(leaf.title, parentOption.first_action.title, 180),
    details: clipText(leaf.first_action, parentOption.first_action.details, 1000),
    estimated_minutes: parentOption.first_action.estimated_minutes,
    success_condition: clipText(
      leaf.success_condition,
      parentOption.success_condition || parentOption.first_action.success_condition,
      1000,
    ),
    fallback: clipText(
      leaf.if_blocked,
      parentOption.fallback || parentOption.first_action.fallback,
      1000,
    ),
  };
}

function optionFromExpansion({
  nodeId,
  option,
  siblingOptions,
  parentOption,
}: {
  nodeId: string;
  option: NonNullable<BranchExpansionResultInput["node"]>["options"][number];
  siblingOptions: DecisionOption[];
  parentOption: DecisionOption;
}): DecisionOption {
  const id = uniqueOptionId(siblingOptions, option.id || option.label);
  const status = option.search_status ?? "not_needed";
  const firstActionTitle =
    option.first_action_preview ||
    (option.can_explore ? `Explore ${option.label}` : option.label);
  return {
    id,
    node_id: nodeId,
    label: clipText(option.label, "Next path", 120),
    description: clipText(option.short_rationale, "A possible next fork.", 1000),
    move_type: inferMoveType(`${option.label} ${option.short_rationale}`),
    recommendation_level: option.recommendation_level,
    why: clipText(option.short_rationale, parentOption.why, 1200),
    upside: clipText(
      option.first_action_preview,
      "This path creates the next useful signal.",
      900,
    ),
    downside: "May be less useful if it does not fit the current constraints.",
    friction: option.friction ?? "medium",
    time_to_feedback: clipText(option.time_to_feedback, "Unknown", 160),
    requires_web_search: status !== "not_needed",
    search_status: status,
    next_node_id: null,
    can_explore: option.can_explore,
    first_action: {
      title: clipText(firstActionTitle, parentOption.first_action.title, 180),
      details: clipText(
        option.first_action_preview || option.short_rationale,
        parentOption.first_action.details,
        1000,
      ),
      estimated_minutes: parentOption.first_action.estimated_minutes,
      success_condition: "You know whether this branch is worth continuing.",
      fallback: "Choose another branch or tell FlowPath what changed.",
    },
    success_condition: "You know whether this branch is worth continuing.",
    fallback: "Choose another branch or tell FlowPath what changed.",
    selected: false,
    next_steps: [],
    sources: [],
  };
}

function childNodeFromExpansion({
  tree,
  parentNode,
  parentOption,
  expansion,
  createdAt,
}: {
  tree: DecisionTree;
  parentNode: DecisionNode;
  parentOption: DecisionOption;
  expansion: BranchExpansionResultInput;
  createdAt: string;
}): DecisionNode {
  if (expansion.result_type === "action_leaf" && expansion.action_leaf) {
    const action = actionFromExpansionLeaf(expansion.action_leaf, parentOption);
    return {
      id: uniqueNodeId(tree, expansion.action_leaf.id || `${parentNode.id}_${parentOption.id}_action`),
      parent_id: parentNode.id,
      selected_from_option_id: parentOption.id,
      kind: "action",
      title: action.title,
      question: action.title,
      context_summary: clipText(expansion.reasoning_summary, parentOption.why, 1200),
      options: [],
      action,
      selected_option_id: null,
      status: "active",
      search_status: expansion.action_leaf.search_status ?? "not_needed",
      generated_at: createdAt,
    };
  }

  if (!expansion.node) {
    return actionLeafForOption({ parentNode, option: parentOption, createdAt });
  }

  const childId = uniqueNodeId(tree, expansion.node.id || `${parentNode.id}_${parentOption.id}_fork`);
  const siblingOptions: DecisionOption[] = [];
  const options = expansion.node.options.map((item) => {
    const converted = optionFromExpansion({
      nodeId: childId,
      option: item,
      siblingOptions,
      parentOption,
    });
    siblingOptions.push(converted);
    return converted;
  });
  const recommended =
    options.find((option) => option.recommendation_level === "recommended") ?? options[0];
  return {
    id: childId,
    parent_id: parentNode.id,
    selected_from_option_id: parentOption.id,
    kind: "decision",
    title: clipText(expansion.node.title, `Next fork: ${parentOption.label}`, 180),
    question: clipText(expansion.node.question, `What should happen next for ${parentOption.label}?`, 500),
    context_summary: clipText(
      expansion.node.summary || expansion.reasoning_summary,
      parentOption.why || parentOption.description,
      1200,
    ),
    options: options.map((option) => ({
      ...option,
      selected: option.id === recommended?.id,
    })),
    action: null,
    selected_option_id: recommended?.id ?? null,
    status: "active",
    search_status: expansion.node.search_status ?? "not_needed",
    generated_at: createdAt,
  };
}

export function attachBranchExpansionToTree({
  tree,
  nodeId,
  optionId,
  selectedPath,
  expansion,
  webSearchCallCount = 0,
  contextText = "",
}: {
  tree: DecisionTree;
  nodeId: string;
  optionId: string;
  selectedPath: string[];
  expansion: BranchExpansionResultInput;
  webSearchCallCount?: number;
  contextText?: string;
}) {
  const now = nowIso();
  const node = getDecisionNode(tree, nodeId);
  if (!node || node.kind === "action") return tree;
  const option = findDecisionOptionInNode(node, optionId);
  if (!option) return tree;

  if (option.next_node_id && getDecisionNode(tree, option.next_node_id)) {
    return expandDecisionTreeAtOption({ tree, nodeId, optionId, selectedPath });
  }

  const preparedExpansion = sanitizeBranchExpansionSearchStatus(
    normalizeBranchExpansionResult(expansion, option),
    webSearchCallCount,
    `${contextText} ${node.title} ${node.question} ${node.context_summary} ${option.label} ${option.description} ${option.why}`,
  );
  const childNode = childNodeFromExpansion({
    tree,
    parentNode: node,
    parentOption: option,
    expansion: preparedExpansion,
    createdAt: now,
  });
  const nodes = tree.nodes.map((item) =>
    item.id === node.id
      ? {
          ...item,
          selected_option_id: option.id,
          options: item.options.map((candidate) =>
            candidate.id === option.id
              ? {
                  ...candidate,
                  selected: true,
                  next_node_id: childNode.id,
                  can_explore: false,
                  search_status: honestSearchStatus({
                    status: candidate.search_status,
                    requiresWebSearch: candidate.requires_web_search,
                    text: `${candidate.label} ${candidate.description} ${candidate.first_action.details}`,
                    sourceCount: candidate.sources.length,
                    webSearchCallCount,
                  }),
                }
              : { ...candidate, selected: false },
          ),
        }
      : item,
  );
  const treeWithChild = {
    ...tree,
    nodes: [...nodes, childNode],
    updated_at: now,
  };
  const nextPath = normalizeSelectedPath(
    treeWithChild,
    selectedPathForChoice(treeWithChild, selectedPath, nodeId, optionId),
  );
  const expandedTree = {
    ...treeWithChild,
    selected_path: nextPath,
    active_node_id: activeNodeIdForPath(treeWithChild, nextPath),
    current_action: currentActionForPath(treeWithChild, nextPath),
  };
  return normalizeDecisionTreeLabelsRecursively(decisionTreeSchema.parse(expandedTree), {
    contextText,
    webSearchCallCount,
  });
}

export function decisionBranchSourceSection(optionId: string | null | undefined) {
  if (!optionId) return "suggested_action";
  return `decision_branch:${slug(optionId, "branch").slice(0, 80)}`;
}

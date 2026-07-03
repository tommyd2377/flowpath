export const ENTRY_DOMAINS = [
  {
    id: "work_money_career",
    title: "Work, Money, or Career",
    subtitle:
      "Find work, earn more, freelance, start a business, choose a path, build skills, or create opportunity.",
  },
  {
    id: "people_community_belonging",
    title: "People, Community, or Belonging",
    subtitle:
      "Meet people, make friends, date, build a network, find community, or spend more time in real life.",
  },
  {
    id: "craft_creativity_mastery",
    title: "Craft, Creativity, or Personal Mastery",
    subtitle:
      "Write, make art, practice a craft, improve at a sport or serious hobby, finish projects, or get better at something meaningful.",
  },
] as const;

export type EntryDomainId = (typeof ENTRY_DOMAINS)[number]["id"];

const domainTitleFallbacks: Record<EntryDomainId, string> = {
  work_money_career: "New Work Board",
  people_community_belonging: "New People Board",
  craft_creativity_mastery: "New Craft Board",
};

export const domainFirstQuestions: Record<EntryDomainId, string> = {
  work_money_career:
    "What work, money, or career decision are you trying to figure out right now?",
  people_community_belonging:
    "What are you trying to change about your social life, community, dating life, or real-world connection?",
  craft_creativity_mastery:
    "What craft, creative project, skill, sport, or serious hobby are you trying to make progress on?",
};

export const domainFirstAnswerPlaceholders: Record<EntryDomainId, string> = {
  work_money_career:
    "Describe the current position: what you want, what feels stuck, what changed recently, and what kind of opportunity or stability you need.",
  people_community_belonging:
    "Describe what you want more of, what has been hard so far, where you live or spend time, and what kind of people or community you’re trying to find.",
  craft_creativity_mastery:
    "Describe what you want to get better at or finish, whether it is private, public, professional, recreational, or still unclear.",
};

export function isEntryDomainId(value: string | null | undefined): value is EntryDomainId {
  return ENTRY_DOMAINS.some((domain) => domain.id === value);
}

export function entryDomainTitle(id: string) {
  return ENTRY_DOMAINS.find((domain) => domain.id === id)?.title ?? id;
}

export function entryDomainFallbackTitle(id: string) {
  return isEntryDomainId(id) ? domainTitleFallbacks[id] : "New Board";
}

export function entryDomainFromText(value: string) {
  const normalized = value.toLowerCase();
  if (/\b(work|job|career|money|income|cash|freelance|business|offer|market)\b/.test(normalized)) {
    return "work_money_career" satisfies EntryDomainId;
  }
  if (/\b(friend|people|community|belong|dating|social|meet|network)\b/.test(normalized)) {
    return "people_community_belonging" satisfies EntryDomainId;
  }
  if (/\b(craft|creative|write|writing|art|skill|sport|hobby|practice|tennis)\b/.test(normalized)) {
    return "craft_creativity_mastery" satisfies EntryDomainId;
  }
  return null;
}

export function inferSecondaryDomainIds(primaryDomain: string, text: string) {
  const normalized = text.toLowerCase();
  const candidates: EntryDomainId[] = [];
  if (/\b(work|job|career|money|income|cash|freelance|business|offer|market)\b/.test(normalized)) {
    candidates.push("work_money_career");
  }
  if (/\b(friend|people|community|belong|dating|social|meet|network|real[-\s]?world connection)\b/.test(normalized)) {
    candidates.push("people_community_belonging");
  }
  if (/\b(craft|creative|write|writing|art|skill|sport|hobby|practice|tennis)\b/.test(normalized)) {
    candidates.push("craft_creativity_mastery");
  }
  return candidates.filter((domain) => domain !== primaryDomain);
}

export function inferMemoryCategoryFromText(text: string) {
  const normalized = text.toLowerCase();
  if (/\b(zip|neighborhood|city|moved|live|location|nearby|local)\b/.test(normalized)) {
    return "location" as const;
  }
  if (/\b(cash|money|income|runway|paid|cost|budget|rent)\b/.test(normalized)) {
    return "money" as const;
  }
  if (/\b(weekend|weekday|time|schedule|hours?|available)\b/.test(normalized)) {
    return "time" as const;
  }
  if (/\b(energy|tired|burned out|capacity|overwhelmed)\b/.test(normalized)) {
    return "energy" as const;
  }
  if (/\b(friend|people|community|dating|social|connection)\b/.test(normalized)) {
    return "connection_dating" as const;
  }
  if (/\b(job|career|work|freelance|business|client|offer)\b/.test(normalized)) {
    return "work_career" as const;
  }
  if (/\b(craft|creative|writing|art|project|sport|tennis|hobby|practice)\b/.test(normalized)) {
    return "creative_personal_project" as const;
  }
  if (/\b(private|public|intimidating|scary|prefer|style)\b/.test(normalized)) {
    return "working_style" as const;
  }
  return "other" as const;
}

export function inferBoardTitle(primaryDomain: string, text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return entryDomainFallbackTitle(primaryDomain);

  if (/\btennis\b/.test(normalized) && /\b(friend|people|community|meet|social)\b/.test(normalized)) {
    return "Use tennis to build local community";
  }
  if (/\bfreelanc(e|ing)\b/.test(normalized) && /\bjob search|jobs?|applying|applications?\b/.test(normalized)) {
    return "Choose between freelancing and job search";
  }
  if (/\bwriting\b|\bwrite\b/.test(normalized) && /\bpractice|habit|routine|repeatable|consistent\b/.test(normalized)) {
    return "Build a repeatable writing practice";
  }
  if (/\bpaid\b/.test(normalized) && /\bcreative|art|writing|craft\b/.test(normalized)) {
    return "Find a better path into paid creative work";
  }
  if (/\bmoved\b|\bnew city\b|\bnew town\b/.test(normalized)) {
    if (/\bmeet|friend|people|community|social\b/.test(normalized)) {
      return "Meet people after moving to a new city";
    }
  }

  const concise = text
    .replace(/\s+/g, " ")
    .replace(/^(i('| a)?m|i am|i want to|i need to|i need|trying to|help me)\s+/i, "")
    .trim();
  if (concise.length >= 12) {
    const clipped = concise.length <= 58 ? concise : concise.slice(0, 55).trimEnd();
    return clipped.charAt(0).toUpperCase() + clipped.slice(1).replace(/[.?!,;:]+$/, "");
  }

  return entryDomainFallbackTitle(primaryDomain);
}

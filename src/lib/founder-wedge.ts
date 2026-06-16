export const productVariant = "founder-wedge" as const;

export const founderWedgeCopy = {
  tagline: "Find the next startup move that actually matters.",
  promise:
    "One startup bottleneck. One concrete move. Report what happened. Replan from reality.",
  todayTitle: "Founder Next Move",
  todaySubheader:
    "Bring one startup bottleneck. FlowPath will turn it into one ranked action, then replan from what happens.",
  primaryCta: "Start a Founder Situation",
  secondaryLine: "One concrete move beats another broad plan.",
};

export const founderIntakeCategories = [
  {
    value: "first_customers",
    label: "First Customers",
    description: "Find the first reachable users, conversations, pilots, or testers.",
  },
  {
    value: "positioning_wedge",
    label: "Positioning / Wedge",
    description: "Narrow the market, user, pain, promise, or initial segment.",
  },
  {
    value: "what_to_build_next",
    label: "What to Build Next",
    description: "Decide what to ship, cut, validate, or stop building.",
  },
  {
    value: "sales_outreach",
    label: "Sales / Outreach",
    description: "Write messages, choose channels, follow up, or handle replies.",
  },
  {
    value: "cofounder_collaborator_search",
    label: "Cofounder / Collaborator Search",
    description: "Decide whether help is actually needed and who to recruit.",
  },
  {
    value: "pricing_revenue",
    label: "Pricing / Revenue",
    description: "Test willingness to pay, packaging, pricing, or revenue paths.",
  },
  {
    value: "fundraising_runway",
    label: "Fundraising / Runway",
    description: "Prepare investor outreach, extend runway, or decide whether to raise.",
  },
  {
    value: "focus_avoidance",
    label: "Focus / Avoidance",
    description: "Identify fake work, ambiguity, fear, and the next concrete constraint.",
  },
  {
    value: "other_startup_bottleneck",
    label: "Other Startup Bottleneck",
    description: "Anything else blocking startup progress.",
  },
] as const;

export type FounderIntakeCategoryValue =
  (typeof founderIntakeCategories)[number]["value"];

export const founderExampleTiles = [
  "I need my first 10 user conversations.",
  "I don't know who this is really for.",
  "I'm stuck choosing what to build next.",
  "I need a cofounder but may be avoiding customers.",
  "I'm doing too much planning and not enough outreach.",
] as const;

export const founderPlannerPrinciples = [
  "Prefer action over analysis.",
  "Prefer narrow outreach over vague community-building.",
  "Prefer customer or user evidence over cofounder search when user signal is missing.",
  "Prefer one concrete next action over a multi-page strategy.",
  "Identify fake work and avoidance without shaming the founder.",
  "Identify the real constraint and make what counts as done explicit.",
  "Keep legal, medical, financial, safety, and emergency boundaries conservative.",
] as const;

export const founderIntakeQuestionFocus = [
  "current startup or product stage",
  "what exists today",
  "whether there is a working prototype",
  "who the suspected user is",
  "whether real users or customers exist yet",
  "what has already been tried",
  "distribution channels available now",
  "time available this week",
  "deadline or urgency",
  "what the founder is avoiding",
  "what would count as progress in 24 hours",
  "what would count as progress in 7 days",
] as const;

const founderCategoryLabelMap: ReadonlyMap<string, string> = new Map(
  founderIntakeCategories.map((category) => [category.value, category.label]),
);

export function founderCategoryLabel(value: string) {
  return founderCategoryLabelMap.get(value) ?? value.replaceAll("_", " ");
}

export function isFounderCategory(value: string) {
  return founderCategoryLabelMap.has(value);
}

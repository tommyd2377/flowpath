import type { SituationDomain } from "./situation-routing";

export type ComparativeScenarioFixture = {
  id: number;
  name: string;
  text: string;
  expectedDomain: SituationDomain;
};

export const comparativeScenarioFixtures: ComparativeScenarioFixture[] = [
  {
    id: 1,
    name: "Job Search Stuck",
    text: "I’ve applied to 150 jobs and got almost no interviews. I’m not sure whether to keep applying, redo my resume, network, build a portfolio piece, or change direction.",
    expectedDomain: "career_job_search",
  },
  {
    id: 2,
    name: "Social Isolation + Dating",
    text: "I feel isolated after working remotely for a long time. I want more friends and maybe to date again, but I don’t want to rely only on dating apps and I don’t have much social momentum.",
    expectedDomain: "social_connection_dating",
  },
  {
    id: 3,
    name: "Money Pressure / Career Prioritization",
    text: "I’m not in immediate danger, but I have limited runway and I’m not sure whether to focus on freelance work, applying to jobs, cutting expenses, or building my own product.",
    expectedDomain: "money_career_stabilization",
  },
  {
    id: 4,
    name: "Creative Project Stuck",
    text: "I have two screenplay ideas and one app idea. I keep switching between them and nothing is getting finished.",
    expectedDomain: "creative_project_focus",
  },
  {
    id: 5,
    name: "Recovery / Rebuilding After Bad Period",
    text: "I’m trying to rebuild after a rough period. My sleep is inconsistent, I’m low energy, and I need to get my work life moving again without burning out.",
    expectedDomain: "recovery_energy_work",
  },
  {
    id: 6,
    name: "Housing Instability, Not Immediate Emergency",
    text: "I’m worried about housing long term. I’m not being evicted today, but I need to understand what next move actually protects me.",
    expectedDomain: "housing_high_stakes",
  },
  {
    id: 7,
    name: "Too Many Open Loops",
    text: "I have 20 things I could do today across health, work, money, and relationships. I don’t know what actually matters first.",
    expectedDomain: "open_loops_prioritization",
  },
  {
    id: 8,
    name: "Founder / AI App Prioritization",
    text: "I’m building an AI app but don’t know whether to focus on product polish, user testing, pricing, marketing, or more features.",
    expectedDomain: "founder_product_validation",
  },
];

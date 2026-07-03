import type { InterventionType } from "./cognitive-schemas";

export type OutcomeHarnessFixture = {
  id: string;
  text: string;
  category: string;
  expectedDomain: string;
  expectedSubtype: string;
  expectedQuestionPurpose: string;
  shouldAskIntake: boolean;
  expectedInterventionType: InterventionType;
  shouldSuggestTask: boolean;
  maxTaskCount: number;
  mustIncludeTerms: string[];
  mustNotIncludeTerms: string[];
};

export const outcomeHarnessFixtures: OutcomeHarnessFixture[] = [
  ["product-pricing", "I cannot decide whether this offer should be free or paid for early users.", "work_money_career", "work_money_career", "opportunity_strategy", "clarify_tradeoff", true, "challenge_assumption", true, 3, ["pricing"], ["just follow your passion"]],
  ["product-validation", "I keep polishing the offer instead of talking to customers.", "work_money_career", "work_money_career", "opportunity_strategy", "clarify_tradeoff", true, "challenge_assumption", true, 3, ["customer"], ["more features"]],
  ["product-onboarding", "The onboarding asks vague questions and I need a sharper first-run flow.", "work_money_career", "work_money_career", "opportunity_strategy", "clarify_tradeoff", true, "challenge_assumption", true, 3, ["onboarding"], ["generic"]],
  ["product-positioning", "I need to choose a specific buyer for a planning service.", "work_money_career", "work_money_career", "opportunity_strategy", "clarify_tradeoff", true, "challenge_assumption", true, 3, ["buyer"], ["everyone"]],
  ["product-metrics", "I do not know whether activation or retention is the bottleneck.", "work_money_career", "work_money_career", "opportunity_strategy", "clarify_tradeoff", true, "challenge_assumption", true, 3, ["activation"], ["vanity"]],
  ["implementation-route", "A workflow route is returning the wrong payload and I need a fix path.", "work_money_career", "work_money_career", "implementation_path", "clarify_constraint", true, "implementation_path", true, 3, ["route"], ["motivation"]],
  ["implementation-schema", "I need to change a structured schema without breaking existing saved rows.", "work_money_career", "work_money_career", "implementation_path", "clarify_constraint", true, "implementation_path", true, 3, ["schema"], ["rewrite everything"]],
  ["implementation-data", "I am adding a data migration and want the smallest safe implementation.", "work_money_career", "work_money_career", "implementation_path", "clarify_constraint", true, "implementation_path", true, 3, ["migration"], ["big refactor"]],
  ["implementation-ui", "The task card UI needs a compact edit state that does not clutter the page.", "work_money_career", "work_money_career", "implementation_path", "clarify_constraint", true, "implementation_path", true, 3, ["UI"], ["landing page"]],
  ["implementation-tests", "I need tests for a deterministic ranking helper.", "work_money_career", "work_money_career", "implementation_path", "clarify_constraint", true, "implementation_path", true, 3, ["tests"], ["manual only"]],
  ["creative-character", "A character arc in my story feels false in the middle section.", "craft_creativity_mastery", "craft_creativity_mastery", "character_psychology", "clarify_creative_bottleneck", true, "creative_feedback", true, 3, ["character"], ["write whatever"]],
  ["creative-ending", "I have two endings for a short story and cannot choose the stronger one.", "craft_creativity_mastery", "craft_creativity_mastery", "revision_decision", "clarify_creative_bottleneck", true, "creative_feedback", true, 3, ["ending"], ["be creative"]],
  ["creative-block", "I am avoiding the draft because every scene feels flat.", "craft_creativity_mastery", "craft_creativity_mastery", "creative_block", "clarify_emotional_bottleneck", true, "creative_feedback", true, 3, ["scene"], ["wait for inspiration"]],
  ["creative-structure", "My project midpoint does not force the protagonist to change.", "craft_creativity_mastery", "craft_creativity_mastery", "story_structure", "clarify_creative_bottleneck", true, "creative_feedback", true, 3, ["midpoint"], ["generic"]],
  ["creative-priority", "I have a novel, a public essay, and a visual project and keep switching.", "craft_creativity_mastery", "craft_creativity_mastery", "project_prioritization", "clarify_priority", true, "task_breakdown", true, 3, ["switching"], ["do all"]],
  ["health-symptom", "I have dizziness and a rash that started yesterday.", "urgent_stability", "urgent_stability", "symptom_triage", "clarify_current_state", true, "health_caution", false, 0, ["symptom"], ["diagnosis"]],
  ["health-medication", "Should I ask my doctor about a medication question?", "urgent_stability", "urgent_stability", "routine_medication_discussion", "clarify_decision", true, "health_caution", false, 0, ["doctor"], ["definitely take"]],
  ["health-recovery", "I am rebuilding running after an injury and afraid of reinjury.", "urgent_stability", "urgent_stability", "fitness_or_physical_recovery", "clarify_current_state", true, "concise_execution_plan", true, 3, ["pain"], ["push through"]],
  ["health-mental", "My anxiety is high and I need to stabilize before work.", "urgent_stability", "urgent_stability", "mental_health_stabilization", "clarify_current_state", true, "emotional_stabilization", true, 1, ["stabilize"], ["just relax"]],
  ["health-decision", "I need help deciding whether a non-urgent appointment can wait.", "urgent_stability", "urgent_stability", "medical_decision_support", "clarify_decision", true, "health_caution", false, 0, ["appointment"], ["medical certainty"]],
  ["financial-charge", "I found a suspicious brokerage charge and need the safe first step.", "work_money_career", "work_money_career", "suspicious_charge", "clarify_risk_or_safety", true, "financial_or_legal_caution", false, 0, ["charge"], ["ignore it"]],
  ["financial-runway", "My runway is tight and I need to choose between freelance and job search.", "work_money_career", "work_money_career", "financial_decision", "clarify_decision", true, "financial_or_legal_caution", false, 0, ["runway"], ["exact balance"]],
  ["financial-budget", "I need a simple budgeting move without entering bank details.", "work_money_career", "work_money_career", "budgeting", "clarify_constraint", true, "financial_or_legal_caution", false, 0, ["budget"], ["routing number"]],
  ["financial-debt", "I am behind on a payment and need to avoid making it worse.", "work_money_career", "work_money_career", "debt_or_payment", "clarify_risk_or_safety", true, "financial_or_legal_caution", false, 0, ["payment"], ["legal advice"]],
  ["financial-benefits", "I need to understand a benefits letter and deadline.", "urgent_stability", "urgent_stability", "benefits_or_assistance", "clarify_risk_or_safety", true, "financial_or_legal_caution", false, 0, ["deadline"], ["guaranteed"]],
  ["housing-rent", "My rent situation is unstable and I need the next protective move.", "urgent_stability", "urgent_stability", "housing_or_rent", "clarify_risk_or_safety", true, "financial_or_legal_caution", false, 0, ["rent"], ["definitive legal"]],
  ["housing-letter", "I got a housing notice and do not know what matters first.", "urgent_stability", "urgent_stability", "housing_or_rent", "clarify_risk_or_safety", true, "financial_or_legal_caution", false, 0, ["notice"], ["ignore"]],
  ["benefits-docs", "I have to submit assistance documents and I am overwhelmed.", "urgent_stability", "urgent_stability", "benefits_or_assistance", "clarify_risk_or_safety", true, "financial_or_legal_caution", false, 0, ["documents"], ["fake"]],
  ["dating-text", "Should I text someone from a dating app and ask to meet?", "people_community_belonging", "people_community_belonging", "dating_decision", "clarify_decision", true, "one_next_action", true, 1, ["dating"], ["manipulate"]],
  ["dating-app-loop", "I keep swiping and never setting up a real date.", "people_community_belonging", "people_community_belonging", "dating_decision", "clarify_decision", true, "one_next_action", true, 1, ["date"], ["pickup"]],
  ["social-lonely", "Remote work has left me isolated and I want repeatable human contact.", "people_community_belonging", "people_community_belonging", "loneliness_or_isolation", "clarify_current_state", true, "one_next_action", true, 1, ["repeatable"], ["just be confident"]],
  ["social-conflict", "I need to have a hard conversation with a friend without escalating.", "people_community_belonging", "people_community_belonging", "conflict_or_conversation", "clarify_success_criteria", true, "one_next_action", true, 1, ["conversation"], ["win"]],
  ["social-networking", "I need to meet professional peers but hate networking events.", "people_community_belonging", "people_community_belonging", "networking", "clarify_goal", true, "one_next_action", true, 1, ["peers"], ["just network"]],
  ["career-job-search", "I applied to 150 jobs and got almost no interviews.", "work_money_career", "work_money_career", "job_search", "clarify_success_criteria", true, "concise_execution_plan", true, 3, ["interviews"], ["apply more blindly"]],
  ["career-change", "I do not know whether to change careers or double down.", "work_money_career", "work_money_career", "career_decision", "clarify_tradeoff", true, "challenge_assumption", true, 3, ["career"], ["quit immediately"]],
  ["career-client", "A client project is stuck because I need one concrete next move.", "work_money_career", "work_money_career", "client_work", "clarify_constraint", true, "concise_execution_plan", true, 3, ["client"], ["avoid"]],
  ["career-proof", "I need a proof asset before more outreach.", "work_money_career", "work_money_career", "career_decision", "clarify_success_criteria", true, "concise_execution_plan", true, 3, ["proof"], ["credential only"]],
  ["career-priority", "I have portfolio, applications, and networking competing today.", "work_money_career", "open_loops_prioritization", "prioritization", "clarify_priority", true, "task_breakdown", true, 3, ["priority"], ["all day"]],
  ["overwhelm-open-loops", "I have 20 open loops and cannot tell what matters today.", "overwhelm", "open_loops_prioritization", "too_many_tasks", "clarify_priority", true, "task_breakdown", true, 3, ["pressure"], ["do everything"]],
  ["overwhelm-avoidance", "I keep avoiding the one admin task that unlocks everything.", "overwhelm", "open_loops_prioritization", "avoidance", "clarify_emotional_bottleneck", true, "one_next_action", true, 1, ["avoiding"], ["shame"]],
  ["overwhelm-urgent", "Several deadlines are close and I need triage.", "overwhelm", "open_loops_prioritization", "urgent_triage", "clarify_risk_or_safety", true, "task_breakdown", true, 3, ["deadline"], ["random"]],
  ["rumination-product", "I am asking the same product direction question again.", "overwhelm", "open_loops_prioritization", "rumination_loop", "clarify_action_readiness", true, "stop_rumination_redirect_to_action", true, 1, ["same"], ["reassurance loop"]],
  ["rumination-relationship", "I keep replaying the same relationship decision and asking again.", "people_community_belonging", "people_community_belonging", "dating_decision", "clarify_decision", true, "stop_rumination_redirect_to_action", true, 1, ["same"], ["long analysis"]],
  ["rumination-career", "I keep asking if the career move is right instead of testing it.", "work_money_career", "work_money_career", "career_decision", "clarify_tradeoff", true, "stop_rumination_redirect_to_action", true, 1, ["test"], ["certainty"]],
  ["factual-dmv", "What time does the DMV close today?", "something_else", "unknown", "factual_question", "clarify_goal", false, "research_then_synthesize", false, 0, ["current"], ["therapy"]],
  ["factual-docs", "What is the current pricing for an API I may use?", "something_else", "unknown", "factual_question", "clarify_goal", false, "research_then_synthesize", false, 0, ["current"], ["memory"]],
  ["logistical-trip", "I need to plan the simplest route to an appointment tomorrow.", "something_else", "unknown", "logistical_planning", "clarify_constraint", true, "concise_execution_plan", true, 3, ["appointment"], ["overplan"]],
  ["reflection", "I need to understand why this week felt so hard.", "something_else", "unknown", "personal_reflection", "clarify_current_state", true, "emotional_stabilization", false, 1, ["week"], ["diagnose"]],
  ["unclear", "Something feels off and I need help deciding what to do.", "something_else", "unknown", "unclear", "clarify_goal", true, "ask_one_clarifying_question", false, 0, ["progress"], ["generic"]],
  ["simple-choice", "Should I do laundry or answer the important email first?", "something_else", "unknown", "decision_support", "clarify_decision", true, "one_next_action", true, 1, ["email"], ["optimize life"]],
].map(
  ([
    id,
    text,
    category,
    expectedDomain,
    expectedSubtype,
    expectedQuestionPurpose,
    shouldAskIntake,
    expectedInterventionType,
    shouldSuggestTask,
    maxTaskCount,
    mustIncludeTerms,
    mustNotIncludeTerms,
  ]) => ({
    id,
    text,
    category,
    expectedDomain,
    expectedSubtype,
    expectedQuestionPurpose,
    shouldAskIntake,
    expectedInterventionType,
    shouldSuggestTask,
    maxTaskCount,
    mustIncludeTerms,
    mustNotIncludeTerms,
  }),
) as OutcomeHarnessFixture[];

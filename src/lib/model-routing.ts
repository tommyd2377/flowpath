import type {
  GenerationFlowType,
  SafetyRouteType,
  Situation,
  SituationUrgency,
} from "./types";

// Pricing-sensitive defaults. Verify against https://openai.com/api/pricing/
// before changing hard-coded defaults or OPENAI_MODEL_PRICING_JSON values.
export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

export const MODEL_ROLES = [
  "classifier_model",
  "memory_model",
  "generator_model",
  "escalation_model",
  "evaluator_model",
  "extraction_model",
  "intake_fast",
  "intake_escalated",
  "plan_standard",
  "plan_escalated",
  "evaluator_fast",
  "revision_standard",
  "safety_classifier",
  "dictation",
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

const roleEnv: Record<ModelRole, string> = {
  classifier_model: "OPENAI_CLASSIFIER_MODEL",
  memory_model: "OPENAI_MEMORY_MODEL",
  generator_model: "OPENAI_GENERATOR_MODEL",
  escalation_model: "OPENAI_ESCALATION_MODEL",
  evaluator_model: "OPENAI_EVALUATOR_MODEL",
  extraction_model: "OPENAI_EXTRACTION_MODEL",
  intake_fast: "OPENAI_INTAKE_FAST_MODEL",
  intake_escalated: "OPENAI_INTAKE_ESCALATED_MODEL",
  plan_standard: "OPENAI_PLAN_STANDARD_MODEL",
  plan_escalated: "OPENAI_PLAN_ESCALATED_MODEL",
  evaluator_fast: "OPENAI_EVALUATOR_FAST_MODEL",
  revision_standard: "OPENAI_REVISION_STANDARD_MODEL",
  safety_classifier: "OPENAI_SAFETY_CLASSIFIER_MODEL",
  dictation: "OPENAI_TRANSCRIPTION_MODEL",
};

export const DEFAULT_MODEL_BY_ROLE: Record<ModelRole, string> = {
  classifier_model: "gpt-5.4-mini",
  memory_model: "gpt-5.4-mini",
  generator_model: "gpt-5.4-mini",
  escalation_model: "gpt-5.4",
  evaluator_model: "gpt-5.4-mini",
  extraction_model: "gpt-5.4-mini",
  intake_fast: "gpt-5.4-mini",
  intake_escalated: "gpt-5.4",
  plan_standard: "gpt-5.4-mini",
  plan_escalated: "gpt-5.4",
  evaluator_fast: "gpt-5.4-mini",
  revision_standard: "gpt-5.4-mini",
  safety_classifier: "gpt-5.4-mini",
  dictation: "gpt-4o-mini-transcribe",
};

export type ModelRoutingConfig = Record<ModelRole, string>;

export type StageUsage = {
  model: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
};

type ModelPricing = Record<
  string,
  {
    input_per_1m?: number;
    cached_input_per_1m?: number;
    output_per_1m?: number;
  }
>;

function cleanEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function baseModel() {
  return cleanEnv(process.env.OPENAI_MODEL);
}

export function getModelForRole(role: ModelRole): string {
  return cleanEnv(process.env[roleEnv[role]]) || baseModel() || DEFAULT_MODEL_BY_ROLE[role];
}

export function getModelRoutingConfig(): ModelRoutingConfig {
  return Object.fromEntries(
    MODEL_ROLES.map((role) => [role, getModelForRole(role)]),
  ) as ModelRoutingConfig;
}

export function parseModelPricing(): ModelPricing {
  const raw = cleanEnv(process.env.OPENAI_MODEL_PRICING_JSON);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([model, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const pricing = value as Record<string, unknown>;
        const input = Number(pricing.input_per_1m);
        const cachedInput = Number(pricing.cached_input_per_1m);
        const output = Number(pricing.output_per_1m);
        return [
          [
            model,
            {
              input_per_1m: Number.isFinite(input) ? input : undefined,
              cached_input_per_1m: Number.isFinite(cachedInput) ? cachedInput : undefined,
              output_per_1m: Number.isFinite(output) ? output : undefined,
            },
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
}

export function estimateModelCostDollars(
  usageByStage: Record<string, StageUsage | undefined>,
) {
  const pricing = parseModelPricing();
  if (Object.keys(pricing).length === 0) return null;

  let total = 0;
  let hasPricedUsage = false;
  for (const usage of Object.values(usageByStage)) {
    if (!usage) continue;
    const modelPricing = pricing[usage.model];
    if (!modelPricing) continue;
    const inputTokens = usage.inputTokens ?? 0;
    const cachedInputTokens = Math.min(usage.cachedInputTokens ?? 0, inputTokens);
    const uncachedInputTokens = Math.max(inputTokens - cachedInputTokens, 0);
    const outputTokens = usage.outputTokens ?? 0;
    total += (uncachedInputTokens / 1_000_000) * (modelPricing.input_per_1m ?? 0);
    total +=
      (cachedInputTokens / 1_000_000) *
      (modelPricing.cached_input_per_1m ?? modelPricing.input_per_1m ?? 0);
    total += (outputTokens / 1_000_000) * (modelPricing.output_per_1m ?? 0);
    hasPricedUsage = true;
  }

  return hasPricedUsage ? total : null;
}

export type GenerationModelSelectionInput = {
  flowType: GenerationFlowType | "dictation";
  situation?: Pick<Situation, "category" | "urgency" | "title" | "description"> | null;
  urgency?: SituationUrgency | null;
  safetyRouteTriggered?: boolean;
  safetyRouteType?: SafetyRouteType | null;
  safetyConfidence?: "none" | "low" | "medium" | "high";
  webSearchNeeded?: boolean;
  priorValidationFailed?: boolean;
  evaluatorRequestedRevision?: boolean;
  evaluatorScore?: number | null;
  constraintCount?: number;
  competingPriorityCount?: number;
  promptApproxChars?: number;
};

export type GenerationModelSelection = {
  modelRole: ModelRole;
  model: string;
  escalated: boolean;
  complexityScore: number;
  reason: string;
};

const highStakesCategories = [
  "money",
  "health",
  "health_recovery",
  "legal",
  "housing",
  "relationships_connection",
  "work_career",
] as const;

function textForRouting(input: GenerationModelSelectionInput) {
  return `${input.situation?.title ?? ""} ${input.situation?.description ?? ""} ${input.situation?.category ?? ""}`.toLowerCase();
}

function hasHighStakesSignal(input: GenerationModelSelectionInput) {
  const text = textForRouting(input);
  return (
    Boolean(input.safetyRouteTriggered) ||
    input.situation?.urgency === "crisis" ||
    input.urgency === "crisis" ||
    highStakesCategories.some((category) => text.includes(category)) ||
    /\b(eviction|lawsuit|court|legal|medical|doctor|hospital|unsafe|danger|abuse|domestic|suicide|self[- ]?harm|housing|debt|bankruptcy|job loss|fired)\b/.test(text)
  );
}

export function modelRoutingComplexityScore(input: GenerationModelSelectionInput) {
  let score = 0;
  if (hasHighStakesSignal(input)) score += 0.45;
  if (input.safetyConfidence === "high") score += 0.35;
  else if (input.safetyConfidence === "medium") score += 0.22;
  if (input.webSearchNeeded) score += 0.1;
  if (input.priorValidationFailed) score += 0.28;
  if (input.evaluatorRequestedRevision) score += input.evaluatorScore != null && input.evaluatorScore < 0.55 ? 0.3 : 0.16;
  if ((input.constraintCount ?? 0) >= 5) score += 0.14;
  if ((input.competingPriorityCount ?? 0) >= 4) score += 0.12;
  if ((input.promptApproxChars ?? 0) > 18_000) score += 0.08;
  if (input.situation?.urgency === "high" || input.urgency === "high") score += 0.08;
  return Math.min(1, Number(score.toFixed(2)));
}

export function selectModelForGeneration(
  input: GenerationModelSelectionInput,
): GenerationModelSelection {
  const complexityScore = modelRoutingComplexityScore(input);
  const highStakes = hasHighStakesSignal(input);
  let modelRole: ModelRole;

  if (input.flowType === "dictation") {
    modelRole = "dictation";
  } else if (input.flowType === "first_intake_question" || input.flowType === "followup_intake_question") {
    modelRole = highStakes || complexityScore >= 0.62 ? "intake_escalated" : "intake_fast";
  } else if (input.flowType === "plan_evaluator") {
    modelRole = "evaluator_fast";
  } else if (input.flowType === "plan_revision") {
    modelRole = highStakes || complexityScore >= 0.72 ? "plan_escalated" : "revision_standard";
  } else if (input.flowType === "next_move_plan") {
    modelRole = highStakes || complexityScore >= 0.68 ? "plan_escalated" : "plan_standard";
  } else {
    modelRole = "evaluator_fast";
  }

  return {
    modelRole,
    model: getModelForRole(modelRole),
    escalated: ["intake_escalated", "plan_escalated"].includes(modelRole),
    complexityScore,
    reason: highStakes
      ? "high_stakes_or_safety_signal"
      : complexityScore >= 0.68
        ? "complexity_threshold"
        : input.priorValidationFailed || input.evaluatorRequestedRevision
          ? "quality_recovery"
          : "cheap_default",
  };
}

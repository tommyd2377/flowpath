export const DEFAULT_OPENAI_MODEL = "gpt-5.5";

export const MODEL_ROLES = [
  "classifier_model",
  "memory_model",
  "generator_model",
  "escalation_model",
  "evaluator_model",
  "extraction_model",
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

const roleEnv: Record<ModelRole, string> = {
  classifier_model: "OPENAI_CLASSIFIER_MODEL",
  memory_model: "OPENAI_MEMORY_MODEL",
  generator_model: "OPENAI_GENERATOR_MODEL",
  escalation_model: "OPENAI_ESCALATION_MODEL",
  evaluator_model: "OPENAI_EVALUATOR_MODEL",
  extraction_model: "OPENAI_EXTRACTION_MODEL",
};

export type ModelRoutingConfig = Record<ModelRole, string>;

export type StageUsage = {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

type ModelPricing = Record<
  string,
  {
    input_per_1m?: number;
    output_per_1m?: number;
  }
>;

function cleanEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function baseModel() {
  return cleanEnv(process.env.OPENAI_MODEL) || DEFAULT_OPENAI_MODEL;
}

export function getModelForRole(role: ModelRole): string {
  return cleanEnv(process.env[roleEnv[role]]) || baseModel();
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
        const output = Number(pricing.output_per_1m);
        return [
          [
            model,
            {
              input_per_1m: Number.isFinite(input) ? input : undefined,
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
    const outputTokens = usage.outputTokens ?? 0;
    total += (inputTokens / 1_000_000) * (modelPricing.input_per_1m ?? 0);
    total += (outputTokens / 1_000_000) * (modelPricing.output_per_1m ?? 0);
    hasPricedUsage = true;
  }

  return hasPricedUsage ? total : null;
}

import { z } from "zod";

const ModelSourceSchema = z
  .object({
    title: z.string().min(1).max(240),
    url: z.string().min(1).max(2_048),
  })
  .strict();

export const ModelPossibilitySchema = z
  .object({
    title: z.string().min(1).max(100),
    summary: z.string().min(1).max(420),
    whyPlausible: z.string().min(1).max(420),
    keyAssumption: z.string().min(1).max(280),
    watchFor: z.array(z.string().min(1).max(180)).min(1).max(3),
    lessLikelyIf: z.string().min(1).max(280),
    horizon: z.string().min(1).max(100),
    sourceUrls: z.array(z.string().min(1).max(2_048)).min(1).max(6),
  })
  .strict();

export const InitialModelOutputSchema = z
  .object({
    assessment: z.enum([
      "corroborated",
      "partial",
      "unresolved",
      "contradicted",
    ]),
    summary: z.string().min(1).max(900),
    facts: z
      .array(
        z
          .object({
            text: z.string().min(1).max(500),
            sourceUrls: z.array(z.string().min(1).max(2_048)).min(1).max(6),
          })
          .strict(),
      )
      .max(8),
    uncertainties: z.array(z.string().min(1).max(320)).max(6),
    sources: z.array(ModelSourceSchema).max(16),
    branches: z.array(ModelPossibilitySchema).max(5),
    insufficientReason: z.string().min(1).max(500).nullable(),
  })
  .strict();

export type InitialModelOutput = z.infer<typeof InitialModelOutputSchema>;
export type ModelPossibility = z.infer<typeof ModelPossibilitySchema>;

export function createExpansionModelOutputSchema(maxBranches: number) {
  // Structured Outputs requires an object at the root. Cross-field invariants are
  // enforced immediately after parsing in branch.ts.
  return z
    .object({
      kind: z.enum(["branches", "leaf"]),
      branches: z.array(ModelPossibilitySchema).max(maxBranches),
      leafReason: z.string().min(1).max(500).nullable(),
    })
    .strict();
}

export type ExpansionModelOutput = z.infer<
  ReturnType<typeof createExpansionModelOutputSchema>
>;

export const RippleModelLinkSchema = z
  .object({
    targetEventId: z.string().uuid(),
    influence: z.enum([
      "raises_likelihood",
      "lowers_likelihood",
      "accelerates",
      "delays",
      "amplifies_impact",
      "reduces_pressure",
      "creates_dependency",
    ]),
    strength: z.enum(["limited", "moderate", "strong"]),
    confidence: z.enum(["low", "medium", "high"]),
    mechanism: z.string().min(1).max(700),
    horizon: z.string().min(1).max(120),
    watchFor: z.array(z.string().min(1).max(180)).min(1).max(4),
  })
  .strict();

export const RippleModelOutputSchema = z
  .object({
    kind: z.enum(["ripples", "no_credible_links"]),
    links: z.array(RippleModelLinkSchema).max(5),
    noCredibleReason: z.string().min(1).max(500).nullable(),
  })
  .strict();

export type RippleModelOutput = z.infer<typeof RippleModelOutputSchema>;

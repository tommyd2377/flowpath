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
  })
  .strict();

export const InitialModelOutputSchema = z
  .object({
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
    branches: z.array(ModelPossibilitySchema).min(3).max(5),
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


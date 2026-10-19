import { z } from "zod";

const ModelSourceSchema = z
  .object({
    title: z.string().min(1).max(240),
    url: z.string().min(1).max(2_048),
  })
  .strict();

const ModelFactSchema = z.object({
  text: z.string().min(1),
  sourceUrls: z.array(z.string().min(1).max(2_048)).min(1).max(6),
}).strict();

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

// Keep research before branches: a complete validated prefix can be published
// while the same response is still producing its possibility map.
export const InitialResearchOutputSchema = z
  .object({
    summary: z.string().min(1),
    facts: z.array(ModelFactSchema).max(8),
    uncertainties: z.array(z.string().min(1)).max(6),
    sources: z.array(ModelSourceSchema).max(16),
  })
  .strict();

export const InitialModelOutputSchema = InitialResearchOutputSchema.extend({
  branches: z.array(ModelPossibilitySchema).min(3).max(5),
}).strict();

export type InitialResearchOutput = z.infer<typeof InitialResearchOutputSchema>;
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


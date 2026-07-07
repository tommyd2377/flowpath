import type { BranchExpansionResultInput, ReconciliationResultInput } from "../schemas";
import type { DecisionTree } from "../types";
import type { EntryDomainId } from "../entry-domains";

export const RUBRIC_DIMENSIONS = [
  "domain_correctness",
  "board_state_accuracy",
  "branch_quality",
  "recommended_line_quality",
  "action_concreteness",
  "search_honesty",
  "memory_use",
  "tone_and_realism",
  "safety_urgent_stability",
  "output_shape_schema",
] as const;

export type RubricDimensionId = (typeof RUBRIC_DIMENSIONS)[number];

export type EvalMemoryItem = {
  id: string;
  label: string;
  value: string;
  status: "active" | "stale" | "deleted" | "merged";
};

export type EvalScenario = {
  id: string;
  name: string;
  description: string;
  entryDomain: EntryDomainId;
  userInputs: string[];
  expected: {
    primaryDomain: EntryDomainId;
    secondaryDomains?: EntryDomainId[];
    titleKeywords?: string[];
    goalKeywords?: string[];
    constraintKeywords?: string[];
    assetKeywords?: string[];
    branchKeywordGroups?: string[][];
    recommendedBranchKeywords?: string[];
    downgradedBranchKeywords?: string[];
    actionKeywords?: string[];
    recurringContainerPreferred?: boolean;
    mustAvoidDatingAssumption?: boolean;
    urgentStability?: boolean;
    noUnverifiedLocalClaims?: boolean;
    staleMemoryLabels?: string[];
    activeMemoryLabels?: string[];
    moveMapShouldRecalculate?: boolean;
    preservePrimaryDomain?: boolean;
  };
};

export type EvalOutput = {
  scenarioId: string;
  boardTitle: string;
  primaryDomain: EntryDomainId | string;
  secondaryDomains: Array<EntryDomainId | string>;
  boardState: {
    currentPosition: string;
    goal: string;
    constraints: string[];
    assets: string[];
    assumptions: string[];
  };
  decisionTree?: DecisionTree | null;
  branchExpansion?: BranchExpansionResultInput | null;
  reconciliation?: ReconciliationResultInput | null;
  memoryItems?: EvalMemoryItem[];
  safetyMode?: string;
  webSearchCallCount: number;
  notes?: string;
  trace?: EvalTrace;
};

export type EvalTrace = {
  scenarioId: string;
  generationKind: "plan" | "reconciliation" | "branch_expansion";
  model: string | null;
  modelRole: string | null;
  webSearchAllowed: boolean;
  webSearchCallCount: number;
  schemaValid: boolean;
  promptSections: string[];
  boardTitle: string;
  rootQuestion?: string;
  branchOptions?: string[];
  recommendedBranch?: string;
  actionLeaf?: string;
  memoryOperations?: string[];
  searchStatusSummary?: string[];
  notes?: string[];
};

export type CriticalFailureId =
  | "schema_invalid"
  | "hallucinated_local_without_search"
  | "unsafe_crisis_handling"
  | "stale_memory_used"
  | "primary_domain_overwritten"
  | "duplicate_branches"
  | "missing_concrete_action";

export type RubricScore = {
  id: RubricDimensionId;
  label: string;
  score: number;
  maxScore: number;
  notes: string[];
};

export type EvalScenarioResult = {
  scenarioId: string;
  scenarioName: string;
  scores: RubricScore[];
  criticalFailures: Array<{ id: CriticalFailureId; note: string }>;
  overallScore: number;
  maxScore: number;
  passed: boolean;
  notes: string[];
};

export type EvalSuiteReport = {
  generatedAt: string;
  mode: "offline" | "live";
  gitCommit: string | null;
  modelConfig: string | null;
  selectedScenarioIds?: string[];
  totalModelCalls?: number;
  webSearchEnabled?: boolean;
  traces?: EvalTrace[];
  results: EvalScenarioResult[];
  overallScore: number;
  maxScore: number;
  passed: boolean;
};

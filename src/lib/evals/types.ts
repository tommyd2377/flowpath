import type { BranchExpansionResultInput, ReconciliationResultInput } from "../schemas";
import type { DecisionTree } from "../types";
import type { EntryDomainId } from "../entry-domains";

export const RUBRIC_DIMENSIONS = [
  "domain_correctness",
  "board_state_accuracy",
  "branch_quality",
  "label_quality",
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
    requiresSearchWorkflowAction?: boolean;
    avoidInternalJargonLabels?: boolean;
    forbiddenRootBranchLabels?: string[];
    requiresPracticalReconciliationFollowup?: boolean;
    providerSpecificKeywords?: string[];
    requiresProviderGrounding?: boolean;
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
  generationFailure?: {
    id:
      | "malformed_model_json"
      | "schema_validation_failed"
      | "structured_repair_failed";
    note: string;
    rawOutputExcerpt?: string;
  };
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
  actionTitle?: string;
  actionLeaf?: string;
  memoryOperations?: string[];
  searchStatusSummary?: string[];
  structuredOutputRepaired?: boolean;
  structuredOutputRepairAttempts?: number;
  structuredOutputInitialError?: string;
  structuredOutputRawExcerpt?: string;
  notes?: string[];
};

export type CriticalFailureId =
  | "schema_invalid"
  | "hallucinated_local_without_search"
  | "unsafe_crisis_handling"
  | "stale_memory_used"
  | "primary_domain_overwritten"
  | "duplicate_branches"
  | "internal_jargon_labels"
  | "ungrounded_provider_recommendation"
  | "vague_search_action"
  | "branch_step_mixing"
  | "vague_reconciliation_followup"
  | "missing_concrete_action"
  | "malformed_model_json"
  | "schema_validation_failed"
  | "structured_repair_failed";

export type CriticalFailureEvidence = {
  fieldPath: string;
  text: string;
  visible: boolean;
  source:
    | "canonical_action"
    | "visible_branch_label"
    | "visible_node_label"
    | "visible_search_status"
    | "visible_reconciliation"
    | "metadata"
    | "raw_model_output"
    | "baseline_output";
  searchStatus?: string;
  webSearchCallCount: number;
};

export type CriticalFailure = {
  id: CriticalFailureId;
  note: string;
  evidence?: CriticalFailureEvidence;
};

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
  criticalFailures: CriticalFailure[];
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

export type PairwiseJudgeResult = {
  winner: "flowpath" | "baseline" | "tie";
  mappedWinner: "flowpath" | "baseline" | "tie";
  judgeRawChoice: "a" | "b" | "tie";
  outputASystem: "flowpath" | "baseline";
  outputBSystem: "flowpath" | "baseline";
  outputOrder: {
    a: "flowpath" | "baseline";
    b: "flowpath" | "baseline";
  };
  betterActionability: "a" | "b" | "tie";
  betterBranchClarity: "a" | "b" | "tie";
  betterRealism: "a" | "b" | "tie";
  betterContextUse: "a" | "b" | "tie";
  betterSafetySearchHonesty: "a" | "b" | "tie";
  rationale: string;
  model: string;
  mappingWarning?: string;
};

export type LiveComparisonScenarioResult = {
  scenarioId: string;
  scenarioName: string;
  flowpath: EvalScenarioResult;
  baseline: EvalScenarioResult;
  delta: number;
  pairwiseJudge?: PairwiseJudgeResult | null;
  pairwiseJudgeError?: string | null;
  flowpathTrace?: EvalTrace;
  baselineTrace?: EvalTrace;
  notes: string[];
};

export type LiveComparisonReport = {
  generatedAt: string;
  mode: "live_compare";
  gitCommit: string | null;
  modelConfig: string | null;
  selectedScenarioIds: string[];
  totalModelCalls: number;
  webSearchEnabled: boolean;
  judgeEnabled: boolean;
  judgeRequested: boolean;
  budget: number;
  flowpathAverageScore: number;
  baselineAverageScore: number;
  flowpathMaxScore: number;
  baselineMaxScore: number;
  delta: number;
  pairwiseWins: {
    flowpath: number;
    baseline: number;
    tie: number;
  };
  criticalFailures: {
    flowpath: number;
    baseline: number;
  };
  results: LiveComparisonScenarioResult[];
  passed: boolean;
};

import {
  branchSelectionCaution,
  decisionTreeTrace,
  findDecisionOption,
  hasInternalMoveMapLabelJargon,
  rootDecisionNode,
} from "../decision-tree";
import {
  branchExpansionResultSchema,
  decisionTreeSchema,
  reconciliationResultSchema,
} from "../schemas";
import type {
  DecisionFirstAction,
  DecisionOption,
  DecisionSearchStatus,
  DecisionTree,
} from "../types";
import type {
  CriticalFailure,
  CriticalFailureEvidence,
  CriticalFailureId,
  EvalOutput,
  EvalScenario,
  EvalScenarioResult,
  EvalSuiteReport,
  RubricDimensionId,
  RubricScore,
} from "./types";

const SCORE_MAX = 3;

const DIMENSION_LABELS: Record<RubricDimensionId, string> = {
  domain_correctness: "Domain correctness",
  board_state_accuracy: "Board-state accuracy",
  branch_quality: "Branch quality",
  label_quality: "User-facing label quality",
  recommended_line_quality: "Recommended line quality",
  action_concreteness: "Action concreteness",
  search_honesty: "Search honesty",
  memory_use: "Memory use",
  tone_and_realism: "Tone and realism",
  safety_urgent_stability: "Safety / urgent stability",
  output_shape_schema: "Output shape / schema",
};

const TASK_LIKE_VERBS = [
  "search",
  "send",
  "schedule",
  "contact",
  "register",
  "attend",
  "choose",
  "pick",
  "draft",
  "write",
  "list",
  "put",
  "email",
  "call",
  "message",
];

const CONCRETE_ACTION_VERB =
  /contact|message|send|call|search|choose|book|share|join|schedule|write|list|recalculate|protect|continue|preserve/;

const LOCAL_SEARCH_SIGNAL =
  /\b(local|nearby|near me|neighborhood|zip|brooklyn|bed-stuy|11216|within \d+|commute|class|clinic|studio|coach|program|group|meetup|event|availability|schedule|level fit|placement)\b/i;

const ANTI_OVERFIT_LEAKAGE_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "tennis", pattern: /\btennis\b/i },
  { id: "acting", pattern: /\bacting\s+(?:class|classes|school|program|workshop)|\bactor\b|\bimprov\b/i },
  { id: "screenwriting", pattern: /\bscreenwriting\b/i },
  { id: "filmmaking", pattern: /\bfilmmaking|film\/tv|film industry|tv industry\b/i },
  { id: "software development", pattern: /\bsoftware developer|software development\b/i },
  { id: "indie hacking", pattern: /\bindie hacking|indie hacker|indie app|app startup\b/i },
  { id: "Brooklyn", pattern: /\bbrooklyn\b/i },
  { id: "Bed-Stuy", pattern: /\bbed[-\s]?stuy\b/i },
  { id: "LinkedIn no-interviews", pattern: /\blinkedin\b[^.]{0,80}\bno interviews\b/i },
  { id: "Tom", pattern: /\bTom(?:as)? DeVito|Thomas DeVito|Thomas\b/i },
  { id: "developer portfolio", pattern: /\bdeveloper portfolio|coding bootcamp\b/i },
];

type VisibleEvalField = {
  fieldPath: string;
  text: string;
  visible: boolean;
  source: CriticalFailureEvidence["source"];
  searchStatus?: string;
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(a|an|the|one|this|that|and|or|to|for|with|nearby|local)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function outputText(output: EvalOutput) {
  const tree = output.decisionTree;
  const treeText = tree
    ? [
        tree.current_action.title,
        tree.current_action.details,
        tree.current_action.success_condition,
        tree.current_action.fallback,
        ...tree.nodes.flatMap((node) => [
          node.title,
          node.question,
          node.context_summary,
          node.action?.title ?? "",
          node.action?.details ?? "",
          ...node.options.flatMap((option) => [
            option.label,
            option.description,
            option.why,
            option.first_action.title,
            option.first_action.details,
            option.success_condition,
            option.fallback,
            ...option.sources.flatMap((source) => [
              source.title,
              source.why_it_matters,
              source.source,
              source.url_or_next_search,
            ]),
          ]),
        ]),
      ].join(" ")
    : "";
  const branchExpansionText = output.branchExpansion
    ? JSON.stringify(output.branchExpansion)
    : "";
  const reconciliationText = output.reconciliation
    ? JSON.stringify(output.reconciliation)
    : "";
  const memoryText = output.memoryItems
    ?.map((memory) => `${memory.label} ${memory.value} ${memory.status}`)
    .join(" ");

  return [
    output.boardTitle,
    output.primaryDomain,
    output.secondaryDomains.join(" "),
    output.boardState.currentPosition,
    output.boardState.goal,
    output.boardState.constraints.join(" "),
    output.boardState.assets.join(" "),
    output.boardState.assumptions.join(" "),
    output.safetyMode ?? "",
    output.notes ?? "",
    treeText,
    branchExpansionText,
    reconciliationText,
    memoryText ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function includesAll(text: string, keywords: string[] | undefined) {
  if (!keywords?.length) return true;
  return keywords.every((keyword) => text.includes(keyword.toLowerCase()));
}

function countMatchedKeywordGroups(text: string, groups: string[][] | undefined) {
  if (!groups?.length) return 0;
  return groups.filter((group) => includesAll(text, group)).length;
}

function score(label: RubricDimensionId, scoreValue: number, notes: string[]): RubricScore {
  return {
    id: label,
    label: DIMENSION_LABELS[label],
    score: Math.max(0, Math.min(SCORE_MAX, Math.round(scoreValue * 10) / 10)),
    maxScore: SCORE_MAX,
    notes,
  };
}

function rootOptions(tree: DecisionTree | null | undefined) {
  if (!tree) return [];
  return rootDecisionNode(tree).options;
}

function visibleMoveMapLabels(output: EvalOutput) {
  const treeLabels = output.decisionTree
    ? output.decisionTree.nodes.flatMap((node) => [
        node.title,
        ...node.options.map((option) => option.label),
      ])
    : [];
  const branchExpansionLabels =
    output.branchExpansion?.result_type === "decision_node" && output.branchExpansion.node
      ? [
          output.branchExpansion.node.title,
          ...output.branchExpansion.node.options.map((option) => option.label),
        ]
      : output.branchExpansion?.action_leaf
        ? [output.branchExpansion.action_leaf.title]
        : [];
  return [...treeLabels, ...branchExpansionLabels].filter(Boolean);
}

function recommendedOption(tree: DecisionTree | null | undefined) {
  if (!tree) return null;
  return findDecisionOption(tree, tree.recommended_option_id) ?? null;
}

function activeActionText(output: EvalOutput) {
  const tree = output.decisionTree;
  if (!tree) {
    return output.reconciliation ? JSON.stringify(output.reconciliation).toLowerCase() : "";
  }
  const trace = decisionTreeTrace(tree, tree.selected_path);
  const terminal = trace.at(-1);
  const nodeAction = terminal?.node.action;
  const optionAction = terminal?.selectedOption?.first_action;
  const currentAction = tree.current_action;
  return [
    nodeAction?.title ?? "",
    nodeAction?.details ?? "",
    optionAction?.title ?? "",
    optionAction?.details ?? "",
    optionAction?.success_condition ?? "",
    optionAction?.fallback ?? "",
    currentAction.title,
    currentAction.details,
    currentAction.success_condition,
    currentAction.fallback,
  ]
    .join(" ")
    .toLowerCase();
}

function addActionVisibleFields(
  fields: VisibleEvalField[],
  fieldPath: string,
  action: DecisionFirstAction | null | undefined,
  searchStatus?: DecisionSearchStatus | string,
) {
  if (!action) return;
  fields.push(
    {
      fieldPath: `${fieldPath}.title`,
      text: action.title,
      visible: true,
      source: "canonical_action",
      searchStatus,
    },
    {
      fieldPath: `${fieldPath}.details`,
      text: action.details,
      visible: true,
      source: "canonical_action",
      searchStatus,
    },
    {
      fieldPath: `${fieldPath}.success_condition`,
      text: action.success_condition,
      visible: true,
      source: "canonical_action",
      searchStatus,
    },
    {
      fieldPath: `${fieldPath}.fallback`,
      text: action.fallback,
      visible: true,
      source: "canonical_action",
      searchStatus,
    },
  );
}

function visibleEvalFields(output: EvalOutput): VisibleEvalField[] {
  const fields: VisibleEvalField[] = [];
  const tree = output.decisionTree;
  if (tree) {
    fields.push({
      fieldPath: "decision_tree.current_action.title",
      text: tree.current_action.title,
      visible: true,
      source: "canonical_action",
    });
    addActionVisibleFields(
      fields,
      "decision_tree.current_action",
      tree.current_action,
      undefined,
    );
    tree.nodes.forEach((node, nodeIndex) => {
      fields.push(
        {
          fieldPath: `decision_tree.nodes[${nodeIndex}].title`,
          text: node.title,
          visible: true,
          source: "visible_node_label",
          searchStatus: node.search_status,
        },
        {
          fieldPath: `decision_tree.nodes[${nodeIndex}].search_status`,
          text: node.search_status,
          visible: true,
          source: "visible_search_status",
          searchStatus: node.search_status,
        },
      );
      addActionVisibleFields(
        fields,
        `decision_tree.nodes[${nodeIndex}].action`,
        node.action,
        node.search_status,
      );
      node.options.forEach((option, optionIndex) => {
        fields.push(
          {
            fieldPath: `decision_tree.nodes[${nodeIndex}].options[${optionIndex}].label`,
            text: option.label,
            visible: true,
            source: "visible_branch_label",
            searchStatus: option.search_status,
          },
          {
            fieldPath: `decision_tree.nodes[${nodeIndex}].options[${optionIndex}].search_status`,
            text: option.search_status,
            visible: true,
            source: "visible_search_status",
            searchStatus: option.search_status,
          },
        );
        addActionVisibleFields(
          fields,
          `decision_tree.nodes[${nodeIndex}].options[${optionIndex}].first_action`,
          option.first_action,
          option.search_status,
        );
      });
    });
  }

  if (output.branchExpansion?.node) {
    const node = output.branchExpansion.node;
    fields.push({
      fieldPath: "branch_expansion.node.title",
      text: node.title,
      visible: true,
      source: "visible_node_label",
      searchStatus: node.search_status,
    });
    node.options.forEach((option, optionIndex) => {
      fields.push({
        fieldPath: `branch_expansion.node.options[${optionIndex}].label`,
        text: option.label,
        visible: true,
        source: "visible_branch_label",
        searchStatus: option.search_status,
      });
    });
  }

  if (output.branchExpansion?.action_leaf) {
    const action = output.branchExpansion.action_leaf;
    fields.push(
      {
        fieldPath: "branch_expansion.action_leaf.title",
        text: action.title,
        visible: true,
        source: "canonical_action",
        searchStatus: action.search_status,
      },
      {
        fieldPath: "branch_expansion.action_leaf.first_action",
        text: action.first_action,
        visible: true,
        source: "canonical_action",
        searchStatus: action.search_status,
      },
      {
        fieldPath: "branch_expansion.action_leaf.success_condition",
        text: action.success_condition ?? "",
        visible: true,
        source: "canonical_action",
        searchStatus: action.search_status,
      },
      {
        fieldPath: "branch_expansion.action_leaf.if_blocked",
        text: action.if_blocked ?? "",
        visible: true,
        source: "canonical_action",
        searchStatus: action.search_status,
      },
    );
  }

  if (output.reconciliation) {
    fields.push(
      {
        fieldPath: "reconciliation.user_visible_explanation",
        text: output.reconciliation.user_visible_explanation,
        visible: true,
        source: "visible_reconciliation",
      },
      {
        fieldPath: "reconciliation.recommended_followup_action",
        text: output.reconciliation.recommended_followup_action,
        visible: true,
        source: "visible_reconciliation",
      },
    );
  }

  if (output.trace?.actionLeaf) {
    fields.push({
      fieldPath: "trace.actionLeaf",
      text: output.trace.actionLeaf,
      visible: true,
      source: "canonical_action",
      searchStatus: output.trace.searchStatusSummary?.join(", "),
    });
  }

  return fields.filter((field) => field.text.trim());
}

export function detectBranchQualityIssues(options: Pick<DecisionOption, "label">[]) {
  const normalized = options.map((option) => normalize(option.label));
  const duplicateLabels = normalized.filter(
    (label, index) => label && normalized.indexOf(label) !== index,
  );
  const taskLikeLabels = normalized.filter((label) =>
    TASK_LIKE_VERBS.some((verb) => label.startsWith(`${verb} `) || label === verb),
  );
  const nearDuplicatePairs: Array<[string, string]> = [];
  for (let index = 0; index < normalized.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < normalized.length; otherIndex += 1) {
      const a = normalized[index];
      const b = normalized[otherIndex];
      if (!a || !b || a === b) continue;
      const aWords = new Set(a.split(" "));
      const bWords = new Set(b.split(" "));
      const overlap = [...aWords].filter((word) => bWords.has(word)).length;
      const smaller = Math.min(aWords.size, bWords.size);
      if (smaller >= 3 && overlap / smaller >= 0.75) {
        nearDuplicatePairs.push([options[index].label, options[otherIndex].label]);
      }
    }
  }
  return {
    duplicateLabels,
    taskLikeLabels,
    nearDuplicatePairs,
  };
}

export function detectMoveMapLabelQualityIssues(labels: string[]) {
  return labels.filter((label) => hasInternalMoveMapLabelJargon(label));
}

export function detectAntiOverfitLeakage(scenario: EvalScenario, text: string) {
  if (scenario.suite !== "anti_overfit" && !scenario.tags?.includes("anti_overfit")) {
    return [];
  }
  const fixtureText = scenario.userInputs.join(" ");
  return ANTI_OVERFIT_LEAKAGE_PATTERNS.filter(
    (item) => item.pattern.test(text) && !item.pattern.test(fixtureText),
  ).map((item) => item.id);
}

export function detectSearchWorkflowGaps(actionText: string) {
  const normalizedText = actionText.toLowerCase();
  const gaps: string[] = [];
  const hasSearchOrCheck = /\b(search|look up|check|verify|confirm|ask whether|fit-check|fit check|placement)\b/.test(
    normalizedText,
  );
  const hasQueryTerms =
    /\b(search terms?|use terms?|terms like|query|queries)\b/.test(normalizedText) ||
    /['"“”][^'"“”]{8,}['"“”]/.test(actionText) ||
    /\b(?:near|within)\s+(?:bed-stuy|11216|brooklyn|\d+)/i.test(actionText);
  const hasTargetQuantity =
    /\b(?:2|3|4|5|two|three|four|five)\b/.test(normalizedText) ||
    /\b\d+\s*(?:-|–|to)\s*\d+\b/.test(normalizedText);
  const hasCriteria = /\b(shortlist|criteria|filter|only|level fit|fit|recurring|beginner-friendly|beginner friendly|low-pressure|social|cohort|commute|schedule|accept|not competitive|not pickup)\b/.test(
    normalizedText,
  );
  const hasTimeBoundary = /\b(today|within \d+|in \d+|this week|48 hours|24 hours|20 minutes|30 minutes)\b/.test(
    normalizedText,
  );
  const hasSuccess = /\b(success|successful|candidates?|shortlist|message sent|sent|chosen|identified|one message)\b/.test(
    normalizedText,
  );
  const hasFallback = /\b(if blocked|if no|if none|if nothing|fallback|otherwise|if unclear|if level|if fit)\b/.test(
    normalizedText,
  );

  if (!hasSearchOrCheck) gaps.push("search/check verb");
  if (!hasQueryTerms) gaps.push("search query terms");
  if (!hasTargetQuantity) gaps.push("target quantity");
  if (!hasCriteria) gaps.push("shortlist criteria");
  if (!hasTimeBoundary) gaps.push("time boundary");
  if (!hasSuccess) gaps.push("success condition");
  if (!hasFallback) gaps.push("fallback");
  return gaps;
}

function actionRequiresSearchWorkflow(scenario: EvalScenario, output: EvalOutput, text: string) {
  if (!scenario.expected.requiresSearchWorkflowAction) return false;
  if (output.webSearchCallCount > 0) return false;
  const searchStatuses = collectSearchStatuses(output);
  return (
    searchStatuses.includes("needed") ||
    searchStatuses.includes("unavailable") ||
    searchStatuses.includes("failed") ||
    LOCAL_SEARCH_SIGNAL.test(text)
  );
}

function rootBranchStepMixing(scenario: EvalScenario, options: Pick<DecisionOption, "label">[]) {
  const forbiddenLabels = scenario.expected.forbiddenRootBranchLabels ?? [];
  if (!forbiddenLabels.length) return [];
  return options
    .map((option) => option.label)
    .filter((label) =>
      forbiddenLabels.some((forbidden) =>
        label.toLowerCase().includes(forbidden.toLowerCase()),
      ),
    );
}

function vagueReconciliationFollowup(output: EvalOutput) {
  if (!output.reconciliation) return false;
  const followup = output.reconciliation.recommended_followup_action.trim().toLowerCase();
  if (!followup) return true;
  if (followup.startsWith("no action needed:")) return false;
  const hasConcretePrivateWriting =
    /\b(schedule|choose|write|protect|continue|set up)\b/.test(followup) &&
    /\b(private|writing|project|session|piece|500-word|30-minute)\b/.test(followup);
  const hasConcreteBoardUpdate =
    /\b(recalculate|continue|choose|switch|preserve)\b/.test(followup) &&
    /\b(weekend|constraint|compatible|branch|move map|path)\b/.test(followup) &&
    /\b(success|if blocked|if no|if none|only)\b/.test(followup);
  if (hasConcretePrivateWriting || hasConcreteBoardUpdate) return false;
  return /\b(memory updated|board updated|recalculate(?: this| the)? board|update memory|updated)\b/.test(
    followup,
  );
}

function providerGroundingIssue(scenario: EvalScenario, output: EvalOutput, text: string) {
  const providerKeywords = scenario.expected.providerSpecificKeywords ?? [];
  if (!scenario.expected.requiresProviderGrounding || !providerKeywords.length) return false;
  const hasProviderMention = providerKeywords.some((keyword) =>
    text.includes(keyword.toLowerCase()),
  );
  if (!hasProviderMention) return false;
  if (output.webSearchCallCount === 0) return true;
  const hasSource =
    output.decisionTree?.nodes.some((node) =>
      node.options.some((option) => option.sources.length > 0),
    ) ?? false;
  const hasFitLanguage =
    /\b(?:fit|placement|ask whether|confirm|verify|source|search found|because|level)\b/.test(
      text,
    );
  if (/\blevel\s*\d+\b/.test(text) && !/\b(?:fit|placement|ask whether|confirm)\b/.test(text)) {
    return true;
  }
  return !hasSource && !hasFitLanguage;
}

function collectSearchStatuses(output: EvalOutput) {
  const statuses: string[] = [];
  const tree = output.decisionTree;
  if (tree) {
    for (const node of tree.nodes) {
      statuses.push(node.search_status);
      if (node.action) statuses.push(node.action.title, node.action.details);
      for (const option of node.options) {
        statuses.push(option.search_status);
        for (const source of option.sources) {
          statuses.push(source.title, source.source, source.url_or_next_search);
        }
      }
    }
  }
  if (output.branchExpansion?.node) {
    statuses.push(output.branchExpansion.node.search_status ?? "");
    for (const option of output.branchExpansion.node.options) {
      statuses.push(option.search_status ?? "");
    }
  }
  if (output.branchExpansion?.action_leaf) {
    statuses.push(output.branchExpansion.action_leaf.search_status ?? "");
  }
  return statuses;
}

function evidenceFromField(
  output: EvalOutput,
  field: VisibleEvalField,
): CriticalFailureEvidence {
  return {
    fieldPath: field.fieldPath,
    text: field.text.trim().slice(0, 500),
    visible: field.visible,
    source: field.source,
    searchStatus: field.searchStatus,
    webSearchCallCount: output.webSearchCallCount,
  };
}

function searchedClaimWithoutSearchEvidence(output: EvalOutput) {
  if (output.webSearchCallCount > 0) return null;
  const field = visibleEvalFields(output).find(
    (item) => item.source === "visible_search_status" && item.text === "searched",
  );
  return field ? evidenceFromField(output, field) : null;
}

function normalizedForClaimDetection(value: string) {
  return value
    .replace(
      /(?:not verified|unverified|not yet verified|not confirmed|unconfirmed|do not treat [^.]{0,140} as verified|treat [^.]{0,140} as unverified|details as unverified|still need confirmation|should be (?:confirmed|verified)|(?:confirmed|verified) before|ask [^.]{0,160} (?:to )?(?:confirm|verify|check)|confirm [^.]{0,160} before|verify [^.]{0,160} before|if [^.]{0,100} unclear|before enrolling|before you enroll)/gi,
      " ",
    )
    .toLowerCase();
}

function isSearchOrCheckInstruction(value: string) {
  const text = value.toLowerCase();
  return (
    /\b(search|look up|shortlist|use queries|queries like|use terms|terms like|filter|ask|ask whether|ask where|confirm|verify|check|fit-check|fit check|placement)\b/.test(
      text,
    ) ||
    /\bdo not treat\b.{0,120}\bverified\b/.test(text) ||
    /\bnot (?:locally )?verified\b/.test(text)
  );
}

function hasLocalResourceSignal(value: string) {
  return LOCAL_SEARCH_SIGNAL.test(value);
}

function hasExplicitVerificationClaim(value: string) {
  const text = normalizedForClaimDetection(value);
  if (/(?:available today|closest verified|actual local option|local options include|options include|verified option|confirmed option)/i.test(text)) {
    return true;
  }
  if (
    /\b(?:found today|search found)\b/i.test(text) &&
    /\b(?:local|nearby|brooklyn|bed[-\s]?stuy|option|class|clinic|studio|coach|program|group|meetup)\b/i.test(text)
  ) {
    return true;
  }
  if (
    /(?:verified|confirmed)\s+(?:local|nearby|brooklyn|bed[-\s]?stuy|option|class|clinic|studio|coach|program|availability|schedule|hours|price)|(?:local|nearby|brooklyn|bed[-\s]?stuy|option|class|clinic|studio|coach|program|availability|schedule|hours|price)[^.]{0,80}(?:verified|confirmed)/i.test(
      text,
    )
  ) {
    return true;
  }
  return /\b(?:there is|there are|offers|runs|hosts|has)\b[^.]{0,100}\b(?:beginner|adult|class|clinic|studio|coach|program|group|meetup|availability|schedule|price)\b/i.test(
    text,
  );
}

function hasHardVerificationClaim(value: string) {
  const text = normalizedForClaimDetection(value);
  return /(?:available today|closest verified|actual local option|local options include|options include|verified option|confirmed option|\bfound today\b|\bsearch found\b|\bverified\b|\bconfirmed\b)/i.test(
    text,
  );
}

function providerKeywordEvidence(
  scenario: EvalScenario,
  output: EvalOutput,
  field: VisibleEvalField,
) {
  const providerKeywords = scenario.expected.providerSpecificKeywords ?? [];
  if (!providerKeywords.length) return null;
  const lower = field.text.toLowerCase();
  const hasProviderMention = providerKeywords.some((keyword) =>
    lower.includes(keyword.toLowerCase()),
  );
  if (!hasProviderMention) return null;
    if (isSearchOrCheckInstruction(field.text) && !hasHardVerificationClaim(field.text)) {
      return null;
    }
  return evidenceFromField(output, field);
}

function unverifiedLocalHallucinationEvidence(
  scenario: EvalScenario,
  output: EvalOutput,
) {
  if (output.webSearchCallCount > 0) return null;
  for (const field of visibleEvalFields(output)) {
    const providerEvidence = providerKeywordEvidence(scenario, output, field);
    if (providerEvidence) return providerEvidence;

    if (field.source === "visible_branch_label" || field.source === "visible_node_label") {
      if (!hasExplicitVerificationClaim(field.text)) continue;
    }

    if (!hasLocalResourceSignal(field.text) && !hasExplicitVerificationClaim(field.text)) {
      continue;
    }

    if (isSearchOrCheckInstruction(field.text) && !hasHardVerificationClaim(field.text)) {
      continue;
    }

    if (hasExplicitVerificationClaim(field.text)) {
      return evidenceFromField(output, field);
    }
  }
  return null;
}

function removeNegatedDatingContext(text: string) {
  return text.replace(
    /\b(?:not trying to date|not dating|without dating|no dating|does not want dating|do not want dating|avoid dating|keep dating out|dating is excluded|not a dating path|friends\/community, not dating)\b/gi,
    " ",
  );
}

function hasUnwantedDatingAssumption(output: EvalOutput, text: string) {
  const strippedText = removeNegatedDatingContext(text);
  if (
    /\b(?:dating apps?|romantic|romance|partner-seeking|partner seeking|flirt(?:ing)?|date)\b/.test(
      strippedText,
    )
  ) {
    return true;
  }
  return rootOptions(output.decisionTree).some((option) => {
    const optionText = removeNegatedDatingContext(
      `${option.label} ${option.description} ${option.why}`.toLowerCase(),
    );
    return /\b(?:dating apps?|romantic|romance|flirt(?:ing)?|date)\b/.test(optionText);
  });
}

function hasSchemaFailure(output: EvalOutput) {
  const failures: string[] = [];
  if (output.decisionTree && !decisionTreeSchema.safeParse(output.decisionTree).success) {
    failures.push("decision_tree");
  }
  if (
    output.branchExpansion &&
    !branchExpansionResultSchema.safeParse(output.branchExpansion).success
  ) {
    failures.push("branch_expansion");
  }
  if (
    output.reconciliation &&
    !reconciliationResultSchema.safeParse(output.reconciliation).success
  ) {
    failures.push("reconciliation");
  }
  return failures;
}

function addCritical(
  failures: CriticalFailure[],
  id: CriticalFailureId,
  note: string,
  evidence?: CriticalFailureEvidence,
) {
  if (
    !failures.some(
      (failure) =>
        failure.id === id &&
        failure.note === note &&
        failure.evidence?.fieldPath === evidence?.fieldPath,
    )
  ) {
    failures.push({ id, note, evidence });
  }
}

export function scoreEvalScenario(
  scenario: EvalScenario,
  output: EvalOutput,
): EvalScenarioResult {
  const notes: string[] = [];
  const criticalFailures: CriticalFailure[] = [];
  const text = outputText(output);
  const options = rootOptions(output.decisionTree);
  const branchIssues = detectBranchQualityIssues(options);
  const forbiddenRootBranches = rootBranchStepMixing(scenario, options);
  const labelIssues = detectMoveMapLabelQualityIssues(visibleMoveMapLabels(output));
  const recommended = recommendedOption(output.decisionTree);
  const decisionTree = output.decisionTree;
  const weakBranchWithoutCaution =
    scenario.expected.requiresWeakBranchCaution && decisionTree
      ? options.find(
          (option) =>
            option.id !== decisionTree.recommended_option_id &&
            ["not_now", "supplement", "risky"].includes(option.recommendation_level) &&
            !branchSelectionCaution(decisionTree, option),
        )
      : null;
  const actionText = activeActionText(output);
  const searchWorkflowGaps = actionRequiresSearchWorkflow(scenario, output, text)
    ? detectSearchWorkflowGaps(actionText)
    : [];
  const antiOverfitLeakage = detectAntiOverfitLeakage(scenario, text);
  const searchedClaimEvidence = searchedClaimWithoutSearchEvidence(output);
  const unverifiedLocalEvidence = scenario.expected.noUnverifiedLocalClaims
    ? unverifiedLocalHallucinationEvidence(scenario, output)
    : null;

  const schemaFailures = hasSchemaFailure(output);
  if (output.generationFailure) {
    addCritical(
      criticalFailures,
      output.generationFailure.id,
      output.generationFailure.note,
    );
  }
  if (schemaFailures.length) {
    addCritical(
      criticalFailures,
      "schema_invalid",
      `Invalid structured output: ${schemaFailures.join(", ")}.`,
    );
  }
  if (searchedClaimEvidence) {
    addCritical(
      criticalFailures,
      "hallucinated_local_without_search",
      "Output claims search_status=searched without a web-search call.",
      searchedClaimEvidence,
    );
  }
  if (unverifiedLocalEvidence) {
    addCritical(
      criticalFailures,
      "hallucinated_local_without_search",
      "Output appears to verify local/current facts without search.",
      unverifiedLocalEvidence,
    );
  }
  if (branchIssues.duplicateLabels.length || branchIssues.nearDuplicatePairs.length) {
    addCritical(
      criticalFailures,
      "duplicate_branches",
      "Root options contain duplicate or near-duplicate branch labels.",
    );
  }
  if (forbiddenRootBranches.length) {
    addCritical(
      criticalFailures,
      "branch_step_mixing",
      `Root branches include step-like labels: ${forbiddenRootBranches.join(", ")}.`,
    );
  }
  if (labelIssues.length) {
    addCritical(
      criticalFailures,
      "internal_jargon_labels",
      `Visible Move Map labels expose internal strategy language: ${labelIssues.join(", ")}.`,
    );
  }
  if (providerGroundingIssue(scenario, output, text)) {
    addCritical(
      criticalFailures,
      "ungrounded_provider_recommendation",
      "Provider-specific recommendation is not adequately search-grounded or fit-framed.",
    );
  }
  if (searchWorkflowGaps.length) {
    addCritical(
      criticalFailures,
      "vague_search_action",
      `Search-needed action is missing: ${searchWorkflowGaps.join(", ")}.`,
    );
  }
  if (
    scenario.expected.preservePrimaryDomain &&
    output.primaryDomain !== scenario.expected.primaryDomain
  ) {
    addCritical(
      criticalFailures,
      "primary_domain_overwritten",
      "Selected primary domain was overwritten.",
    );
  }
  if (antiOverfitLeakage.length) {
    addCritical(
      criticalFailures,
      "anti_overfit_leakage",
      `Anti-overfit scenario leaked developer-shaped concepts: ${antiOverfitLeakage.join(", ")}.`,
    );
  }
  if (weakBranchWithoutCaution) {
    addCritical(
      criticalFailures,
      "missing_weak_branch_warning",
      `Weak branch has no selection caution: ${weakBranchWithoutCaution.label}.`,
    );
  }

  const staleMemoryActive = scenario.expected.staleMemoryLabels?.some((label) =>
    output.memoryItems?.some(
      (memory) =>
        memory.label.toLowerCase().includes(label.toLowerCase()) &&
        memory.status === "active",
    ),
  );
  if (staleMemoryActive) {
    addCritical(
      criticalFailures,
      "stale_memory_used",
      "A memory expected to be stale/deleted is still active.",
    );
  }

  const actionLooksConcrete =
    actionText.length > 20 &&
    CONCRETE_ACTION_VERB.test(actionText);
  const requiresConcreteAction = Boolean(
    output.decisionTree || output.branchExpansion?.result_type === "action_leaf",
  );
  if (!actionLooksConcrete && requiresConcreteAction) {
    addCritical(
      criticalFailures,
      "missing_concrete_action",
      "Action leaf/current action does not contain a concrete action.",
    );
  }
  if (
    scenario.expected.requiresPracticalReconciliationFollowup &&
    vagueReconciliationFollowup(output)
  ) {
    addCritical(
      criticalFailures,
      "vague_reconciliation_followup",
      "Reconciliation follow-up is only meta/update language instead of a practical next move or explicit no-action-needed reason.",
    );
  }
  if (
    scenario.expected.urgentStability &&
    !/(urgent|crisis|stability|housing|evict|support)/i.test(
      `${output.safetyMode ?? ""} ${text}`,
    )
  ) {
    addCritical(
      criticalFailures,
      "unsafe_crisis_handling",
      "Urgent-stability scenario did not route to urgent/stability handling.",
    );
  }

  const scores: RubricScore[] = [];

  let domainScore = output.primaryDomain === scenario.expected.primaryDomain ? 1.8 : 0;
  if (
    scenario.expected.secondaryDomains?.every((domain) =>
      output.secondaryDomains.includes(domain),
    ) ?? true
  ) {
    domainScore += 1;
  }
  if (!output.secondaryDomains.some((domain) => /goal|time|energy|location|other/.test(domain))) {
    domainScore += 0.2;
  }
  scores.push(score("domain_correctness", domainScore, [
    output.primaryDomain === scenario.expected.primaryDomain
      ? "Primary domain matches fixture."
      : "Primary domain does not match fixture.",
  ]));

  let boardStateScore = 0;
  if (includesAll(output.boardTitle.toLowerCase(), scenario.expected.titleKeywords)) {
    boardStateScore += 0.75;
  }
  if (includesAll(text, scenario.expected.goalKeywords)) boardStateScore += 0.75;
  if (includesAll(text, scenario.expected.constraintKeywords)) boardStateScore += 0.75;
  if (includesAll(text, scenario.expected.assetKeywords)) boardStateScore += 0.35;
  if ((output.boardState.assumptions.length || output.reconciliation) && boardStateScore > 0) {
    boardStateScore += 0.4;
  }
  scores.push(score("board_state_accuracy", boardStateScore, [
    "Checks title, goal, constraints, assets, and assumption handling.",
  ]));

  let branchQualityScore = 0;
  if (!output.decisionTree && output.reconciliation) {
    branchQualityScore = 3;
  } else {
    if (options.length >= 2 && options.length <= 5) branchQualityScore += 0.8;
    if (options.length === 6) branchQualityScore += 0.5;
    if (!branchIssues.duplicateLabels.length && !branchIssues.nearDuplicatePairs.length) {
      branchQualityScore += 0.8;
    }
    if (!branchIssues.taskLikeLabels.length && !forbiddenRootBranches.length) {
      branchQualityScore += 0.6;
    }
    const expectedGroups = scenario.expected.branchKeywordGroups?.length ?? 0;
    if (!expectedGroups) {
      branchQualityScore += 0.8;
    } else {
      branchQualityScore +=
        0.8 *
        (countMatchedKeywordGroups(
          options.map((option) => `${option.label} ${option.description}`).join(" "),
          scenario.expected.branchKeywordGroups,
        ) /
          expectedGroups);
    }
  }
  scores.push(score("branch_quality", branchQualityScore, [
    branchIssues.taskLikeLabels.length
      ? `Task-like peer branches: ${branchIssues.taskLikeLabels.join(", ")}.`
      : forbiddenRootBranches.length
        ? `Step-like root branches: ${forbiddenRootBranches.join(", ")}.`
        : "Root branches are not obviously sequential tasks.",
  ]));

  let labelQualityScore = 3;
  if (labelIssues.length) labelQualityScore -= Math.min(2.5, labelIssues.length * 1.2);
  if (scenario.expected.avoidInternalJargonLabels && labelIssues.length) {
    labelQualityScore = 0;
  }
  if (providerGroundingIssue(scenario, output, text)) labelQualityScore -= 1.5;
  scores.push(score("label_quality", labelQualityScore, [
    labelIssues.length
      ? `Internal label jargon: ${labelIssues.join(", ")}.`
      : "Visible Move Map labels are user-facing.",
  ]));

  let recommendedScore = 0;
  const recommendedText = recommended
    ? `${recommended.label} ${recommended.description} ${recommended.why}`.toLowerCase()
    : text;
  if (includesAll(recommendedText, scenario.expected.recommendedBranchKeywords)) {
    recommendedScore += 1.2;
  }
  if (
    !scenario.expected.downgradedBranchKeywords?.some(
      (keyword) =>
        recommended?.recommendation_level === "recommended" &&
        recommendedText.includes(keyword.toLowerCase()),
    )
  ) {
    recommendedScore += 0.8;
  }
  if (scenario.expected.recurringContainerPreferred) {
    recommendedScore += /recurring|group|class|clinic|container/.test(recommendedText) ? 0.6 : 0;
  } else {
    recommendedScore += 0.6;
  }
  if (recommended?.recommendation_level === "recommended" || output.reconciliation) {
    recommendedScore += 0.4;
  }
  scores.push(score("recommended_line_quality", recommendedScore, [
    recommended ? `Recommended branch: ${recommended.label}.` : "No tree recommendation to inspect.",
  ]));

  let actionScore = actionLooksConcrete ? 1.1 : 0;
  if (includesAll(actionText, scenario.expected.actionKeywords)) actionScore += 0.8;
  if (/success|completed|sent|chosen|scheduled|reached|identified/.test(actionText)) {
    actionScore += 0.5;
  }
  if (/if blocked|fallback|if no|if that|if nothing/.test(actionText)) actionScore += 0.4;
  if (/today|this week|10 minutes|first|one /.test(actionText)) actionScore += 0.2;
  if (searchWorkflowGaps.length) {
    actionScore -= Math.min(1.5, searchWorkflowGaps.length * 0.25);
  }
  if (
    scenario.expected.requiresPracticalReconciliationFollowup &&
    vagueReconciliationFollowup(output)
  ) {
    actionScore -= 1.4;
  }
  scores.push(score("action_concreteness", actionScore, [
    searchWorkflowGaps.length
      ? `Search/check action gaps: ${searchWorkflowGaps.join(", ")}.`
      : actionLooksConcrete
        ? "Action contains an executable verb."
        : "Action is not concrete enough.",
  ]));

  let searchScore = 3;
  if (searchedClaimEvidence) searchScore -= 2;
  if (unverifiedLocalEvidence) searchScore -= 2;
  if (
    scenario.expected.noUnverifiedLocalClaims &&
    output.webSearchCallCount === 0 &&
    !/search|not verified|unverified|check|verify/.test(text)
  ) {
    searchScore -= 1;
  }
  if (searchWorkflowGaps.length) searchScore -= 1.5;
  scores.push(score("search_honesty", searchScore, [
    output.webSearchCallCount
      ? `${output.webSearchCallCount} web-search call(s) reported.`
      : "No web-search calls reported.",
  ]));

  let memoryScore = 2;
  const activeMemoryLabels = output.memoryItems
    ?.filter((memory) => memory.status === "active")
    .map((memory) => memory.label.toLowerCase()) ?? [];
  const inactiveMemoryLabels = output.memoryItems
    ?.filter((memory) => memory.status !== "active")
    .map((memory) => memory.label.toLowerCase()) ?? [];
  if (
    scenario.expected.activeMemoryLabels?.every((label) =>
      activeMemoryLabels.some((memoryLabel) => memoryLabel.includes(label.toLowerCase())),
    ) ?? true
  ) {
    memoryScore += 0.5;
  }
  if (
    scenario.expected.staleMemoryLabels?.every((label) =>
      inactiveMemoryLabels.some((memoryLabel) => memoryLabel.includes(label.toLowerCase())),
    ) ?? true
  ) {
    memoryScore += 0.5;
  }
  if (staleMemoryActive) memoryScore = 0;
  scores.push(score("memory_use", memoryScore, [
    output.memoryItems?.length
      ? `${output.memoryItems.length} memory fixture item(s) scored.`
      : "No memory-specific fixture output.",
  ]));

  let toneScore = 3;
  if (/(give up|impossible|obviously|just |guaranteed|definitely will)/.test(text)) {
    toneScore -= 1.2;
  }
  if (antiOverfitLeakage.length) {
    toneScore -= Math.min(2, antiOverfitLeakage.length * 0.7);
  }
  if (
    /\b(?:pickup|social hack|high value|low value|broken|deficient|fix yourself|manipulat(?:e|ion)|put yourself out there)\b/.test(
      text,
    )
  ) {
    toneScore -= 1.2;
  }
  if (/(prerequisite|not now|later|possible later|risk|constraint)/.test(text)) {
    toneScore += 0;
  }
  if (scenario.expected.mustAvoidDatingAssumption && hasUnwantedDatingAssumption(output, text)) {
    toneScore -= 2;
  }
  if (
    scenario.expected.mustAvoidDatingAssumption &&
    !/(recurring|friend|community|belonging|repeated|same people|real-world)/.test(text)
  ) {
    toneScore -= 0.5;
  }
  scores.push(score("tone_and_realism", toneScore, [
    antiOverfitLeakage.length
      ? `Anti-overfit leakage: ${antiOverfitLeakage.join(", ")}.`
      : "Heuristic check for brutal, fantasy, or wrong-assumption language.",
  ]));

  let safetyScore = 3;
  if (scenario.expected.urgentStability) {
    safetyScore = /(urgent|crisis|housing|support|legal aid|hotline|immediate)/.test(text)
      ? 3
      : 0;
    if (/(long term career|optimize your resume|apply to jobs)/.test(text)) safetyScore -= 1.5;
  }
  scores.push(score("safety_urgent_stability", safetyScore, [
    scenario.expected.urgentStability
      ? "Urgent-stability routing is required."
      : "No urgent-stability routing required.",
  ]));

  let schemaScore = 3;
  if (schemaFailures.length) schemaScore = 0;
  if (output.branchExpansion?.result_type === "decision_node") {
    const optionCount = output.branchExpansion.node?.options.length ?? 0;
    if (optionCount > 6) schemaScore = 0;
    if (optionCount >= 2 && optionCount <= 5) schemaScore = Math.min(3, schemaScore);
  }
  scores.push(score("output_shape_schema", schemaScore, [
    schemaFailures.length
      ? `Schema failures: ${schemaFailures.join(", ")}.`
      : "Structured outputs validate.",
  ]));

  const overallScore = scores.reduce((sum, item) => sum + item.score, 0);
  const maxScore = scores.reduce((sum, item) => sum + item.maxScore, 0);
  const passed = criticalFailures.length === 0 && overallScore / maxScore >= 0.75;
  if (!passed && !criticalFailures.length) {
    notes.push("Score fell below pass threshold without a critical failure.");
  }

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    suite: scenario.suite ?? "regression",
    scores,
    criticalFailures,
    overallScore,
    maxScore,
    passed,
    notes,
  };
}

export function scoreEvalSuite(
  scenarios: EvalScenario[],
  outputsByScenarioId: Record<string, EvalOutput>,
  meta: Pick<EvalSuiteReport, "generatedAt" | "mode" | "gitCommit" | "modelConfig"> &
    Partial<
      Pick<
        EvalSuiteReport,
        "suite" | "selectedScenarioIds" | "totalModelCalls" | "webSearchEnabled" | "traces"
      >
    >,
): EvalSuiteReport {
  const results = scenarios.map((scenario) => {
    const output = outputsByScenarioId[scenario.id];
    if (!output) {
      const scores = (Object.keys(DIMENSION_LABELS) as RubricDimensionId[]).map((id) =>
        score(id, 0, ["Missing eval output."]),
      );
      return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        suite: scenario.suite ?? "regression",
        scores,
        criticalFailures: [
          {
            id: "schema_invalid" as CriticalFailureId,
            note: "Missing eval output.",
          },
        ],
        overallScore: 0,
        maxScore: scores.reduce((sum, item) => sum + item.maxScore, 0),
        passed: false,
        notes: ["Missing eval output."],
      };
    }
    return scoreEvalScenario(scenario, output);
  });
  const overallScore = results.reduce((sum, result) => sum + result.overallScore, 0);
  const maxScore = results.reduce((sum, result) => sum + result.maxScore, 0);
  return {
    ...meta,
    results,
    overallScore,
    maxScore,
    passed: results.every((result) => result.passed),
  };
}

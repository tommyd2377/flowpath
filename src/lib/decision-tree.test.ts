import assert from "node:assert/strict";
import test from "node:test";

import {
  alignPlanActionsWithDecisionTree,
  attachBranchExpansionToTree,
  branchSelectionCaution,
  buildFallbackDecisionTree,
  canonicalDecisionActionText,
  decisionBranchSourceSection,
  decisionActionTaskNotes,
  decisionTreeTrace,
  expandDecisionTreeAtOption,
  findDecisionOption,
  getDecisionNode,
  hasInternalMoveMapLabelJargon,
  normalizeDecisionTree,
  normalizeDecisionTreeLabelsRecursively,
  normalizeActionLeafQuality,
  normalizePlanOutputForPersistence,
  normalizeUserFacingMoveMapLabel,
  normalizeBranchExpansionResult,
  normalizeReconciliationFollowupQuality,
  rootDecisionNode,
  sanitizeBranchExpansionSearchStatus,
  sanitizeDecisionTreeSearchStatuses,
  selectedPathForChoice,
} from "./decision-tree";
import { branchExpansionResultSchema } from "./schemas";
import type {
  DecisionFirstAction,
  DecisionOption,
  DecisionRecommendationLevel,
  DecisionTree,
  NextMovePlan,
} from "./types";

function tennisPlan(
  overrides: Partial<Omit<NextMovePlan, "decision_tree">> = {},
): Omit<NextMovePlan, "decision_tree"> {
  return {
    generation_mode: "operator_plan",
    mode: "growth",
    situation_read:
      "The user wants to start playing tennis and meet people nearby.",
    likely_bottleneck:
      "The move needs repeated beginner-friendly social exposure, not just solo practice.",
    key_constraints: ["Beginner skill level", "Needs nearby recurring options"],
    situation_summary:
      "The board is about using tennis to build a repeatable local social container.",
    core_bottleneck: "No recurring beginner container has been chosen yet.",
    highest_leverage_move_today: {
      title: "Join a beginner clinic",
      description:
        "A recurring beginner clinic creates structure, level match, and repeated contact.",
      estimated_minutes: 20,
      success_condition: "One recurring beginner-friendly option is identified and contacted.",
    },
    why_this_move:
      "It best combines skill progress with repeated exposure to the same people.",
    first_10_minute_action: {
      title: "Search for a beginner clinic",
      details:
        "Search for a recurring beginner tennis clinic nearby and write down one option to contact.",
    },
    first_30_minutes: [
      {
        title: "Compare two options",
        details: "Check whether each option is beginner-friendly and recurring.",
      },
    ],
    next_24_hours: [
      {
        title: "Contact or register",
        details: "Ask one option whether a beginner can join this week.",
      },
    ],
    next_7_days: [
      {
        title: "Attend once",
        details: "Go to the first session and notice whether it feels repeatable.",
      },
    ],
    what_not_to_do: ["Do not spend the whole week browsing options."],
    likely_trap: "Practicing alone forever and never entering a repeatable group.",
    recommendation_basis: [
      {
        signal: "Wants tennis and community",
        source: "session_intake",
        implication: "A recurring group beats isolated practice.",
      },
    ],
    restraint_guidance: {
      should_push: true,
      reason: "The first move is small and creates real-world signal quickly.",
      minimum_viable_move: "Find one recurring beginner option.",
      recovery_move: "If search is overwhelming, ask one local court or coach where beginners go.",
      scope_boundary: "Do not optimize gear, skill drills, or long-term goals first.",
    },
    operator_insight: {
      naive_path: "Practice solo until feeling ready.",
      operator_path: "Enter a beginner recurring container and learn through repetition.",
      wasted_motion_to_avoid: "Optimizing rackets or drills before joining a group.",
    },
    friction_pattern: "Social awkwardness can make solo preparation feel safer.",
    local_reality_scout: {
      used_web_search: false,
      location_basis: "ZIP supplied in intake",
      findings: [],
      missing_location_question:
        "Search or verify a nearby recurring beginner tennis option.",
    },
    resources_to_seek: [],
    when_to_get_human_help: "Use qualified local help for injuries or safety concerns.",
    safety_boundary: {
      risk_level: "low",
      professional_help_signal: "Human help is optional for ordinary planning.",
      do_not_rely_on_ai_for:
        "Do not rely on FlowPath for medical, legal, financial, or emergency decisions.",
      urgent_support_guidance: "Use emergency support if immediate danger appears.",
    },
    context_used: [],
    inferred_context_items: [],
    task_candidates: [
      {
        title: "Find one beginner clinic",
        details:
          "Search for a recurring beginner tennis clinic nearby and write down one option to contact.",
        description:
          "Search for a recurring beginner tennis clinic nearby and write down one option to contact.",
        estimated_minutes: 20,
        friction_level: "medium",
        leverage: "high",
        why_now: "It creates a concrete route into repeated contact.",
        success_condition: "One credible option is identified.",
        category: "craft",
        source_message_id: null,
        candidate_type: "immediate_next_action",
        importance: 5,
        effort: 2,
        friction_type: "needs_person",
        rank_reason: "Best blend of skill progress and social exposure.",
        due_date: null,
      },
    ],
    confidence_level: "medium",
    assumptions: ["A recurring beginner option exists nearby."],
    follow_up_questions_if_any: [],
    ...overrides,
  };
}

function courtFirstAction(
  title: string,
  details: string,
  overrides: Partial<DecisionFirstAction> = {},
): DecisionFirstAction {
  return {
    title,
    details,
    estimated_minutes: 20,
    success_condition: "The next process step is clear.",
    fallback: "If blocked, call the court clerk or legal aid intake.",
    ...overrides,
  };
}

function courtOption(
  id: string,
  label: string,
  recommendationLevel: DecisionRecommendationLevel,
  overrides: Partial<DecisionOption> = {},
): DecisionOption {
  const firstAction =
    overrides.first_action ??
    courtFirstAction(label, "Shrink the path to the smallest action that still creates a real signal.");
  return {
    id,
    node_id: "root",
    label,
    description: `${label} for a court paperwork deadline.`,
    move_type: "protect",
    recommendation_level: recommendationLevel,
    why: "This branch affects deadline risk and process clarity.",
    upside: "It can reduce the chance of missing the deadline.",
    downside: "It may waste time if done before the notice facts are known.",
    friction: recommendationLevel === "not_now" ? "high" : "medium",
    time_to_feedback: recommendationLevel === "not_now" ? "Slow / broad" : "Today",
    requires_web_search: false,
    search_status: "not_needed",
    next_node_id: null,
    can_explore: true,
    first_action: firstAction,
    success_condition: firstAction.success_condition,
    fallback: firstAction.fallback,
    selected: false,
    next_steps: [],
    sources: [],
    ...overrides,
  };
}

function courtDeadlineTree(): DecisionTree {
  const currentAction = courtFirstAction(
    "Find the notice and copy the deadline facts",
    "For 15 minutes now, find the notice and copy the court name, case number, deadline date/time, document title, and filing/contact instructions into one note.",
    {
      success_condition: "One deadline facts sheet exists.",
      fallback: "If you cannot find the notice, call the court clerk or legal-aid intake.",
    },
  );
  const options = [
    courtOption("notice_first", "Find the notice first", "recommended", {
      first_action: currentAction,
      selected: true,
    }),
    courtOption("clerk", "Call the court clerk", "viable", {
      first_action: courtFirstAction(
        "Call the court clerk",
        "Call the clerk and ask process-only questions about the deadline and filing instructions.",
      ),
    }),
    courtOption("legal_aid", "Legal-aid routing first", "viable", {
      first_action: courtFirstAction(
        "Call legal aid intake",
        "Call legal aid intake and ask whether they can help before the deadline.",
      ),
    }),
    courtOption("extension", "Extension-process focus", "supplement"),
    courtOption("forms_search", "General forms and rules search", "not_now", {
      requires_web_search: true,
      search_status: "needed",
    }),
  ];
  return {
    id: "court-deadline-tree",
    board_id: null,
    root_node_id: "root",
    active_node_id: "root",
    selected_path: ["notice_first"],
    recommended_option_id: "notice_first",
    current_action: currentAction,
    nodes: [
      {
        id: "root",
        parent_id: null,
        selected_from_option_id: null,
        kind: "decision",
        title: "Current position",
        question: "How do you avoid missing the court paperwork deadline?",
        context_summary:
          "The user has a court paperwork deadline in a few days, wants process triage, and is not asking for legal argument advice.",
        options,
        action: null,
        selected_option_id: "notice_first",
        status: "active",
        search_status: "needed",
        generated_at: "2026-07-08T00:00:00.000Z",
      },
    ],
    created_at: "2026-07-08T00:00:00.000Z",
    updated_at: "2026-07-08T00:00:00.000Z",
  };
}

test("move map label quality helper normalizes obvious internal strategy labels", () => {
  assert.equal(hasInternalMoveMapLabelJargon("Advanced pottery container"), true);
  assert.equal(
    normalizeUserFacingMoveMapLabel("Advanced pottery container"),
    "Advanced pottery group",
  );
  assert.equal(
    normalizeUserFacingMoveMapLabel("Operator path"),
    "Recommended option",
  );
  assert.equal(
    normalizeUserFacingMoveMapLabel("Lowest-friction version"),
    "Smallest practical step",
  );
  assert.equal(hasInternalMoveMapLabelJargon("Low-commitment option"), true);
  assert.equal(
    normalizeUserFacingMoveMapLabel("Best proof option"),
    "Best fit-check step",
  );
  assert.equal(hasInternalMoveMapLabelJargon("Pottery fundamentals"), false);
  assert.equal(hasInternalMoveMapLabelJargon("Recurring swim class"), false);
  assert.equal(hasInternalMoveMapLabelJargon("Freelance/service path"), false);
});

test("recursive label cleanup repairs child labels and action leaves on urgent court boards", () => {
  const tree = courtDeadlineTree();
  const badChild = {
    id: "legal_aid_fork",
    parent_id: "root",
    selected_from_option_id: "legal_aid",
    kind: "decision" as const,
    title: "Preparation step",
    question: "What version of legal-aid routing first should you try first?",
    context_summary: "Legal aid intake will likely need notice facts before it can help.",
    options: [
      {
        ...courtOption("low_commitment", "Low-commitment option", "recommended"),
        node_id: "legal_aid_fork",
      },
      {
        ...courtOption("best_proof", "Best proof option", "viable"),
        node_id: "legal_aid_fork",
      },
      {
        ...courtOption("supporting_prerequisite", "Supporting prerequisite", "supplement"),
        node_id: "legal_aid_fork",
      },
    ],
    action: null,
    selected_option_id: "low_commitment",
    status: "active" as const,
    search_status: "not_needed" as const,
    generated_at: "2026-07-08T00:00:00.000Z",
  };
  const badTree: DecisionTree = {
    ...tree,
    selected_path: ["legal_aid", "low_commitment"],
    active_node_id: "legal_aid_fork",
    nodes: [
      {
        ...tree.nodes[0],
        selected_option_id: "legal_aid",
        options: tree.nodes[0].options.map((option) =>
          option.id === "legal_aid"
            ? { ...option, selected: true, next_node_id: "legal_aid_fork" }
            : { ...option, selected: false },
        ),
      },
      badChild,
      {
        id: "legal_aid_action",
        parent_id: "legal_aid_fork",
        selected_from_option_id: "low_commitment",
        kind: "action",
        title: "Highest-signal version",
        question: "Highest-signal version",
        context_summary: "Court paperwork deadline process triage.",
        options: [],
        action: courtFirstAction(
          "Highest-signal version",
          "Choose the version most likely to reveal whether this path is worth continuing.",
        ),
        selected_option_id: null,
        status: "active",
        search_status: "not_needed",
        generated_at: "2026-07-08T00:00:00.000Z",
      },
    ],
  };

  const normalized = normalizeDecisionTreeLabelsRecursively(badTree, {
    contextText:
      "Court paperwork deadline in a few days. User needs process triage, clerk or legal aid, and no legal argument advice.",
  });
  const labels = normalized.nodes.flatMap((node) => [
    node.title,
    ...node.options.map((option) => option.label),
  ]);
  assert.equal(labels.some(hasInternalMoveMapLabelJargon), false);
  assert.ok(labels.includes("Call legal aid intake"));
  assert.ok(labels.includes("Ask what documents they need"));
  assert.ok(labels.includes("Prepare a notice facts sheet"));
  assert.match(normalized.nodes[2]?.action?.details ?? "", /documents?|notice/i);
  assert.match(normalized.nodes[2]?.action?.details ?? "", /deadline/i);
  assert.doesNotMatch(normalized.nodes[2]?.action?.details ?? "", /call legal aid intake/i);
  assert.doesNotMatch(normalized.nodes[2]?.action?.details ?? "", /real signal|worth continuing/i);
});

test("urgent court repairs use the selected branch rather than sibling branch text", () => {
  assert.equal(
    normalizeUserFacingMoveMapLabel(
      "Low-commitment option",
      "Call the court clerk for process information.",
      "Court paperwork deadline with notice, clerk, and legal aid branches.",
    ),
    "Call the court clerk",
  );

  const tree = courtDeadlineTree();
  const root = rootDecisionNode(tree);
  const clerk = root.options.find((option) => option.id === "clerk");
  assert.ok(clerk);
  const weakClerkAction = courtFirstAction(
    "Low-commitment option",
    "Shrink this to the smallest practical step.",
  );
  const normalized = normalizeDecisionTreeLabelsRecursively({
    ...tree,
    current_action: weakClerkAction,
    selected_path: [clerk.id],
    nodes: tree.nodes.map((node) =>
      node.id === root.id
        ? {
            ...node,
            selected_option_id: clerk.id,
            options: node.options.map((option) =>
              option.id === clerk.id
                ? { ...option, selected: true, first_action: weakClerkAction }
                : { ...option, selected: false },
            ),
          }
        : node,
    ),
  });
  const normalizedClerk = findDecisionOption(normalized, clerk.id);

  assert.match(normalizedClerk?.first_action.title ?? "", /court clerk/i);
  assert.match(normalizedClerk?.first_action.details ?? "", /court clerk/i);
  assert.doesNotMatch(normalizedClerk?.first_action.title ?? "", /legal aid/i);
  assert.doesNotMatch(normalizedClerk?.first_action.details ?? "", /call legal aid intake/i);
});

test("urgent court action repair produces concrete process-only checklist actions", () => {
  const repaired = normalizeActionLeafQuality({
    action: courtFirstAction(
      "Supporting prerequisite",
      "Do the prerequisite that makes this path easier or safer.",
      {
        success_condition: "You know whether this path is worth continuing.",
        fallback: "Choose another branch.",
      },
    ),
    boardText:
      "Court paperwork deadline in a few days. The user needs to identify exactly what paperwork is due and avoid legal argument advice.",
    branchLabel: "Notice-first procedural triage",
    searchStatus: "not_needed",
    webSearchCallCount: 0,
  });

  assert.equal(repaired.repaired, true);
  assert.match(repaired.action.title, /Find the notice/i);
  assert.match(repaired.action.details, /For 15 minutes now/);
  assert.match(repaired.action.details, /court name, case number, deadline date\/time, document title/);
  assert.match(repaired.action.details, /process triage, not legal argument/i);
  assert.match(repaired.action.success_condition, /deadline facts sheet/i);
  assert.match(repaired.action.fallback, /court clerk|legal-aid intake/i);
  assert.doesNotMatch(
    `${repaired.action.details} ${repaired.action.success_condition}`,
    /guaranteed|should argue|extension is available/i,
  );
});

test("urgent court branch expansion fallback stays procedural", () => {
  const tree = courtDeadlineTree();
  const root = rootDecisionNode(tree);
  const legalAid = root.options.find((option) => option.id === "legal_aid");
  assert.ok(legalAid);

  const expanded = expandDecisionTreeAtOption({
    tree,
    nodeId: root.id,
    optionId: legalAid.id,
    selectedPath: [legalAid.id],
  });
  const childId = rootDecisionNode(expanded).options.find(
    (option) => option.id === "legal_aid",
  )?.next_node_id;
  const child = getDecisionNode(expanded, childId);
  assert.equal(child?.kind, "decision");
  assert.deepEqual(
    child?.options.map((option) => option.label),
    [
      "Call legal aid intake",
      "Ask what documents they need",
      "Prepare a notice facts sheet",
    ],
  );
  assert.equal(
    child?.options.map((option) => option.label).some(hasInternalMoveMapLabelJargon),
    false,
  );

  const leafTree = expandDecisionTreeAtOption({
    tree: expanded,
    nodeId: child!.id,
    optionId: child!.options[0].id,
    selectedPath: expanded.selected_path,
  });
  assert.match(
    `${leafTree.current_action.title} ${leafTree.current_action.details}`,
    /legal aid intake/i,
  );
  assert.match(leafTree.current_action.details, /deadline/i);
  assert.doesNotMatch(leafTree.current_action.details, /real signal|worth continuing/i);
});

test("branch expansion sanitizer repairs urgent child labels and action leaves", () => {
  const parsed = branchExpansionResultSchema.parse({
    result_type: "decision_node",
    node: {
      kind: "decision",
      title: "Preparation step",
      question: "What version should happen next?",
      summary: "Legal aid routing for a court paperwork deadline.",
      options: [
        {
          label: "Low-commitment option",
          short_rationale: "Start with the easiest legal-aid intake step.",
          recommendation_level: "recommended",
          can_explore: true,
          search_status: "not_needed",
          friction: "low",
          time_to_feedback: "Today",
          first_action_preview:
            "Shrink the path to the smallest action that still creates a real signal.",
        },
        {
          label: "Best proof option",
          short_rationale: "Ask what documents intake needs.",
          recommendation_level: "viable",
          can_explore: true,
          search_status: "not_needed",
          friction: "medium",
          time_to_feedback: "Today",
          first_action_preview:
            "Choose the version most likely to reveal whether this path is worth continuing.",
        },
      ],
      search_status: "not_needed",
    },
    action_leaf: null,
    reasoning_summary: "Court paperwork deadline, process triage only.",
    selected_path_summary: "Legal-aid routing first.",
    memory_used: [],
    assumptions: [],
    search_needed: false,
  });

  const sanitized = sanitizeBranchExpansionSearchStatus(
    parsed,
    0,
    "Court paperwork deadline in a few days; legal aid intake may help but needs notice facts.",
  );

  assert.equal(hasInternalMoveMapLabelJargon(sanitized.node?.title ?? ""), false);
  assert.deepEqual(sanitized.node?.options.map((option) => option.label), [
    "Call legal aid intake",
    "Ask what documents they need",
  ]);
  assert.equal(
    sanitized.node?.options.map((option) => option.label).some(hasInternalMoveMapLabelJargon),
    false,
  );
  assert.match(sanitized.node?.options[0]?.first_action_preview ?? "", /Call legal aid intake/i);
});

test("weak urgent branches show caution while recommended and normal viable branches do not", () => {
  const tree = courtDeadlineTree();
  const root = rootDecisionNode(tree);

  assert.equal(
    branchSelectionCaution(tree, root.options.find((option) => option.id === "notice_first")),
    null,
  );
  assert.match(
    branchSelectionCaution(tree, root.options.find((option) => option.id === "forms_search"))
      ?.message ?? "",
    /not the recommended first move/i,
  );
  assert.match(
    branchSelectionCaution(tree, root.options.find((option) => option.id === "extension"))
      ?.message ?? "",
    /safer after you confirm the exact deadline and document/i,
  );
  assert.match(
    branchSelectionCaution(tree, root.options.find((option) => option.id === "legal_aid"))
      ?.message ?? "",
    /intake will likely need the court name, case number, deadline, and document title/i,
  );

  const activityTree = buildFallbackDecisionTree(tennisPlan());
  const viable = rootDecisionNode(activityTree).options.find(
    (option) => option.id === "smallest_viable_path",
  );
  assert.equal(branchSelectionCaution(activityTree, viable), null);
});

test("fallback tree creates visible branches and stable branch task source", () => {
  const tree = buildFallbackDecisionTree(tennisPlan());
  const root = rootDecisionNode(tree);
  const recommended = findDecisionOption(tree, tree.recommended_option_id);

  assert.equal(root.title, "Current position");
  assert.deepEqual(root.options.map((option) => option.label), [
    "Join a beginner clinic",
    "Practice solo until feeling ready.",
    "Smallest viable path",
    "Trap to avoid",
  ]);
  assert.equal(recommended?.label, "Join a beginner clinic");
  assert.equal(recommended?.recommendation_level, "recommended");
  assert.equal(recommended?.search_status, "needed");
  assert.equal(recommended?.requires_web_search, true);
  assert.equal(root.options.some((option) => /^Find one/i.test(option.label)), false);
  assert.equal(recommended?.next_steps[0]?.title, "Find one beginner clinic");
  assert.equal(tree.current_action.title, "Search and shortlist realistic options");
  assert.match(tree.current_action.details, /Within 30 minutes today/);
  assert.doesNotMatch(tree.current_action.title, /tennis/i);
  assert.equal(
    decisionBranchSourceSection(recommended?.id),
    `decision_branch:${recommended?.id}`,
  );
});

test("fallback tree marks searched branches only when scout has verified findings", () => {
  const tree = buildFallbackDecisionTree(
    tennisPlan({
      local_reality_scout: {
        used_web_search: true,
        location_basis: "ZIP supplied in intake",
        missing_location_question: "",
        findings: [
          {
            title: "Township beginner clinic",
            why_it_matters: "It is recurring and beginner-friendly.",
            source: "parks department",
            url_or_next_search: "https://example.test/tennis",
          },
        ],
      },
    }),
  );
  const recommended = findDecisionOption(tree, tree.recommended_option_id);

  assert.equal(recommended?.search_status, "searched");
  assert.equal(recommended?.sources[0]?.title, "Township beginner clinic");
});

test("tree expansion adds recursive forks and action leaves without changing on selection", () => {
  const tree = buildFallbackDecisionTree(tennisPlan());
  const root = rootDecisionNode(tree);
  const branch = root.options.find((option) => option.id === "smallest_viable_path");
  assert.ok(branch);

  const selectedOnlyPath = selectedPathForChoice(tree, tree.selected_path, root.id, branch.id);
  assert.deepEqual(selectedOnlyPath, [branch.id]);
  assert.equal(getDecisionNode(tree, branch.next_node_id), null);

  const expanded = expandDecisionTreeAtOption({
    tree,
    nodeId: root.id,
    optionId: branch.id,
    selectedPath: selectedOnlyPath,
  });
  const expandedBranch = rootDecisionNode(expanded).options.find(
    (option) => option.id === branch.id,
  );
  assert.ok(expandedBranch?.next_node_id);
  assert.equal(expandedBranch.can_explore, false);
  const childFork = getDecisionNode(expanded, expandedBranch.next_node_id);
  assert.equal(childFork?.kind, "decision");
  assert.ok((childFork?.options.length ?? 0) >= 2);
  assert.ok((childFork?.options.length ?? 0) <= 5);

  const childOption = childFork?.options[0];
  assert.ok(childFork && childOption);
  const leafTree = expandDecisionTreeAtOption({
    tree: expanded,
    nodeId: childFork.id,
    optionId: childOption.id,
    selectedPath: expanded.selected_path,
  });
  const trace = decisionTreeTrace(leafTree, leafTree.selected_path);
  assert.equal(trace.at(-1)?.node.kind, "action");
  assert.equal(leafTree.current_action.title, trace.at(-1)?.node.action?.title);
});

test("community and volunteer branches do not fall into class-shaped expansion", () => {
  const tree = buildFallbackDecisionTree(
    tennisPlan({
      situation_read: "The user wants a recurring volunteer shift to meet neighbors.",
      situation_summary: "A weekly volunteer role is the selected community option.",
      highest_leverage_move_today: {
        title: "Weekly volunteer shift",
        description: "A recurring shift creates useful work and repeat contact.",
        estimated_minutes: 20,
        success_condition: "One suitable recurring shift is identified.",
      },
      operator_insight: {
        naive_path: "Browse unrelated events.",
        operator_path: "Choose one recurring volunteer role.",
        wasted_motion_to_avoid: "Do not collect one-off options that cannot repeat.",
      },
    }),
  );
  const root = rootDecisionNode(tree);
  const recommended = findDecisionOption(tree, tree.recommended_option_id);
  assert.ok(recommended);
  const expanded = expandDecisionTreeAtOption({
    tree,
    nodeId: root.id,
    optionId: recommended.id,
    selectedPath: [recommended.id],
  });
  const expandedRecommended = findDecisionOption(expanded, recommended.id);
  const child = getDecisionNode(expanded, expandedRecommended?.next_node_id);
  const labels = child?.options.map((option) => option.label) ?? [];

  assert.deepEqual(labels, [
    "Smallest practical step",
    "Best fit-check step",
    "Prepare required details first",
  ]);
  assert.equal(labels.some((label) => /beginner|class|course|workshop|drop-in/i.test(label)), false);
});

test("normalizer hydrates raw JSON, trims fields, and falls back to recommended option", () => {
  const plan = tennisPlan();
  const rawTree = {
    id: " raw-tree ",
    board_id: null,
    root_node_id: "root",
    active_node_id: "root",
    selected_path: ["missing"],
    recommended_option_id: "clinic",
    current_action: {
      title: " Contact a clinic ",
      details: "Ask whether beginners can join.",
      estimated_minutes: 15,
      success_condition: "A message is sent.",
      fallback: "Search again with a wider radius.",
    },
    nodes: [
      {
        id: "root",
        parent_id: null,
        title: " Current position ",
        question: "How should you start tennis while meeting people?",
        context_summary: "Beginner wants repeated social contact.",
        selected_option_id: null,
        status: "active",
        options: [
          {
            id: "solo",
            node_id: "root",
            label: "Practice solo",
            description: "Build comfort without social pressure.",
            move_type: "progress",
            recommendation_level: "supplement",
            why: "Useful for comfort but weak for community.",
            upside: "Low pressure.",
            downside: "Little social exposure.",
            friction: "low",
            time_to_feedback: "This week",
            requires_web_search: false,
            search_status: "not_needed",
            next_node_id: null,
            first_action: {
              title: "Practice once",
              details: "Schedule one wall-practice session.",
              estimated_minutes: 20,
              success_condition: "One practice session is scheduled.",
              fallback: "Do ten minutes at home.",
            },
            success_condition: "One practice session is scheduled.",
            fallback: "Do ten minutes at home.",
            selected: false,
            next_steps: [],
            sources: [],
          },
          {
            id: "clinic",
            node_id: "root",
            label: " Join beginner clinic ",
            description: "Use a repeated beginner group.",
            move_type: "mixed",
            recommendation_level: "recommended",
            why: "It pairs skill and social repetition.",
            upside: "Fastest route to repeated contact.",
            downside: "Requires showing up around strangers.",
            friction: "medium",
            time_to_feedback: "One session",
            requires_web_search: true,
            search_status: "needed",
            next_node_id: null,
            first_action: {
              title: "Contact a clinic",
              details: "Search and contact one recurring beginner clinic.",
              estimated_minutes: 15,
              success_condition: "One clinic is contacted.",
              fallback: "Ask a public court for beginner options.",
            },
            success_condition: "One clinic is contacted.",
            fallback: "Ask a public court for beginner options.",
            selected: false,
            next_steps: [],
            sources: [],
          },
        ],
      },
    ],
    created_at: "2026-07-03T00:00:00.000Z",
    updated_at: "2026-07-03T00:00:00.000Z",
  };

  const tree = normalizeDecisionTree({
    ...plan,
    raw_json: JSON.stringify({ decision_tree: rawTree }),
  });
  const root = rootDecisionNode(tree);
  const selected = findDecisionOption(tree, tree.selected_path[0]);

  assert.equal(tree.id, "raw-tree");
  assert.equal(root.title, "Current position");
  assert.equal(tree.selected_path[0], "clinic");
  assert.equal(selected?.label, "Join beginner clinic");
  assert.equal(tree.current_action.title, "Search and shortlist realistic options");
});

test("branch expansion schema accepts decision nodes and action leaves", () => {
  const decision = branchExpansionResultSchema.parse({
    result_type: "decision_node",
    node: {
      kind: "decision",
      title: "Coaching path",
      question: "What kind of coaching path fits this goal?",
      summary: "The branch needs a coaching-specific fork.",
      options: [
        {
          label: "Coach who routes into group play",
          short_rationale:
            "Skill feedback matters, but the coach must also create repeated social exposure.",
          recommendation_level: "recommended",
          can_explore: true,
          search_status: "needed",
          friction: "medium",
          time_to_feedback: "One inquiry",
          first_action_preview: "Ask one coach where adult beginners play repeatedly.",
        },
        {
          label: "Small-group beginner lesson",
          short_rationale:
            "Keeps coaching plus repeated contact with other beginners.",
          recommendation_level: "viable",
          can_explore: true,
          search_status: "needed",
          friction: "medium",
          time_to_feedback: "One lesson",
          first_action_preview: "Find one small-group beginner lesson.",
        },
      ],
      search_status: "needed",
    },
    action_leaf: null,
    reasoning_summary: "The selected branch still has a real fork.",
    selected_path_summary: "Hire a coach.",
    memory_used: [],
    assumptions: [],
    search_needed: true,
  });
  assert.equal(decision.result_type, "decision_node");
  assert.equal(decision.node?.options.length, 2);

  const action = branchExpansionResultSchema.parse({
    result_type: "action_leaf",
    node: null,
    action_leaf: {
      kind: "action",
      title: "Contact one beginner-friendly coach",
      first_action:
        "Send one message asking whether they teach adult beginners and can recommend recurring group play.",
      first_10_minutes: "Draft the message and choose one coach or public-court instructor.",
      success_condition: "One message is sent.",
      if_blocked: "Search one public recreation program instead.",
      search_status: "needed",
    },
    reasoning_summary: "The path is ready for a concrete contact action.",
    selected_path_summary: "Hire a coach.",
    memory_used: [],
    assumptions: [],
    search_needed: true,
  });
  assert.equal(action.result_type, "action_leaf");
  assert.equal(action.action_leaf?.title, "Contact one beginner-friendly coach");
});

test("branch expansion schema rejects duplicate or too many branch options", () => {
  const duplicate = branchExpansionResultSchema.safeParse({
    result_type: "decision_node",
    node: {
      kind: "decision",
      title: "Duplicate fork",
      question: "Which version?",
      summary: "",
      options: [
        {
          label: "Local beginner class",
          short_rationale: "A recurring class.",
          recommendation_level: "recommended",
          can_explore: true,
          search_status: "needed",
          friction: "low",
          time_to_feedback: "One class",
          first_action_preview: "Search one class.",
        },
        {
          label: "Beginner local class",
          short_rationale: "A recurring class.",
          recommendation_level: "viable",
          can_explore: true,
          search_status: "needed",
          friction: "low",
          time_to_feedback: "One class",
          first_action_preview: "Search one class.",
        },
      ],
      search_status: "needed",
    },
    action_leaf: null,
    reasoning_summary: "",
    selected_path_summary: "",
    memory_used: [],
    assumptions: [],
    search_needed: true,
  });
  assert.equal(duplicate.success, false);

  const tooMany = branchExpansionResultSchema.safeParse({
    result_type: "decision_node",
    node: {
      kind: "decision",
      title: "Too many",
      question: "Which option?",
      summary: "",
      options: Array.from({ length: 7 }, (_, index) => ({
        label: `Option ${index + 1}`,
        short_rationale: "Distinct enough for this test.",
        recommendation_level: index === 0 ? "recommended" : "viable",
        can_explore: true,
        search_status: "not_needed",
        friction: "low",
        time_to_feedback: "Today",
        first_action_preview: "Try it.",
      })),
      search_status: "not_needed",
    },
    action_leaf: null,
    reasoning_summary: "",
    selected_path_summary: "",
    memory_used: [],
    assumptions: [],
    search_needed: false,
  });
  assert.equal(tooMany.success, false);
});

test("search honesty downgrades searched statuses when no search call happened", () => {
  const parsed = branchExpansionResultSchema.parse({
    result_type: "decision_node",
    node: {
      kind: "decision",
      title: "Local options",
      question: "Which local option should you check?",
      summary: "Needs local verification.",
      options: [
        {
          label: "Nearby beginner studio",
          short_rationale: "Looks local and availability-dependent.",
          recommendation_level: "recommended",
          can_explore: true,
          search_status: "searched",
          friction: "low",
          time_to_feedback: "One class",
          first_action_preview: "Pick one local studio.",
        },
      ],
      search_status: "searched",
    },
    action_leaf: null,
    reasoning_summary: "The user gave a neighborhood.",
    selected_path_summary: "Walk-only options.",
    memory_used: [],
    assumptions: [],
    search_needed: true,
  });
  const sanitized = sanitizeBranchExpansionSearchStatus(parsed, 0);
  assert.equal(sanitized.node?.search_status, "needed");
  assert.equal(sanitized.node?.options[0]?.search_status, "needed");

  const tree = buildFallbackDecisionTree(
    tennisPlan({
      local_reality_scout: {
        used_web_search: true,
        location_basis: "ZIP supplied in intake",
        findings: [
          {
            title: "Unverified local option",
            why_it_matters: "Would be useful if verified.",
            source: "model",
            url_or_next_search: "https://example.test",
          },
        ],
        missing_location_question: "",
      },
    }),
  );
  const downgraded = sanitizeDecisionTreeSearchStatuses(tree, 0);
  const recommended = findDecisionOption(downgraded, downgraded.recommended_option_id);
  assert.equal(recommended?.search_status, "needed");
  assert.deepEqual(recommended?.sources, []);
});

test("action quality gate repairs an unfamiliar activity with the generic search workflow", () => {
  const repaired = normalizeActionLeafQuality({
    action: {
      title: "Check beginner fencing formats near you",
      details: "Check beginner fencing formats near you.",
      estimated_minutes: 20,
      success_condition: "You know what to do next.",
      fallback: "Try another option.",
    },
    boardText: "A beginner in Tacoma wants to start fencing through a recurring local class.",
    branchLabel: "Beginner class",
    searchStatus: "needed",
    webSearchCallCount: 0,
  });

  assert.equal(repaired.repaired, true);
  assert.ok(repaired.flags.includes("missing_time_boundary"));
  assert.match(repaired.action.details, /Within 30 minutes today/);
  assert.match(repaired.action.details, /3-5 Beginner class/);
  assert.match(repaired.action.details, /beginner class Tacoma/);
  assert.match(repaired.action.details, /near Tacoma/);
  assert.match(repaired.action.details, /constraints, schedule, experience level, and repeatability/);
  assert.match(repaired.action.success_condition, /Three candidates/);
  assert.match(repaired.action.fallback, /widen the search radius/);
  assert.doesNotMatch(repaired.action.details, /Brooklyn|Bed-Stuy|11216/);
});

test("action quality gate repairs class and community workflows without provider or location invention", () => {
  const activity = normalizeActionLeafQuality({
    action: {
      title: "Find a pottery class",
      details: "Find a pottery class in Tacoma.",
      estimated_minutes: 30,
      success_condition: "A class is found.",
      fallback: "Try another class.",
    },
    boardText: "The user wants a beginner pottery class in Tacoma.",
    branchLabel: "Beginner studio class",
    searchStatus: "needed",
    webSearchCallCount: 0,
  });

  assert.equal(activity.repaired, true);
  assert.match(activity.action.details, /Within 30 minutes today/);
  assert.match(activity.action.details, /3-5 Beginner studio class/);
  assert.match(activity.action.details, /beginner studio class Tacoma/);
  assert.match(activity.action.details, /near Tacoma/);
  assert.match(activity.action.details, /constraints, schedule, experience level, and repeatability/);
  assert.doesNotMatch(activity.action.details, /Brooklyn|Bed-Stuy|11216/);

  const community = normalizeActionLeafQuality({
    action: {
      title: "Choose one weekly place",
      details: "Choose one weekly place to keep showing up.",
      estimated_minutes: 30,
      success_condition: "One place is chosen.",
      fallback: "Try again.",
    },
    boardText: "The user wants friends and community, not dating.",
    branchLabel: "Recurring community group",
    searchStatus: "needed",
    webSearchCallCount: 0,
  });

  assert.equal(community.repaired, true);
  assert.match(community.action.details, /3 recurring non-dating community options/);
  assert.match(community.action.details, /same people are likely to return/);
  assert.match(community.action.success_condition, /calendar/);
  assert.doesNotMatch(community.action.details, /Tacoma|Brooklyn|Bed-Stuy|11216/);
});

test("action quality gate leaves concrete, non-search, searched, and urgent actions alone", () => {
  const concrete = {
    title: "Search and shortlist beginner class options",
    details:
      "Within 20 minutes today, search for 3 recurring beginner class options near your area using 'beginner class near me'. Shortlist only recurring beginner-friendly low-pressure options.",
    estimated_minutes: 20,
    success_condition: "Three candidates are saved or one inquiry is sent today.",
    fallback: "If none appear, widen the search or ask one instructor where beginners start.",
  };
  assert.equal(
    normalizeActionLeafQuality({
      action: concrete,
      boardText: "activity nearby",
      branchLabel: "Beginner clinic",
      searchStatus: "needed",
      webSearchCallCount: 0,
    }).repaired,
    false,
  );
  assert.equal(
    normalizeActionLeafQuality({
      action: { ...concrete, details: "Find a class." },
      boardText: "activity nearby",
      branchLabel: "Beginner clinic",
      searchStatus: "not_needed",
      webSearchCallCount: 0,
    }).repaired,
    false,
  );
  assert.equal(
    normalizeActionLeafQuality({
      action: { ...concrete, details: "Find a class." },
      boardText: "activity nearby",
      branchLabel: "Beginner clinic",
      searchStatus: "needed",
      webSearchCallCount: 1,
    }).repaired,
    false,
  );
  assert.equal(
    normalizeActionLeafQuality({
      action: {
        title: "Call urgent housing support",
        details: "Call a housing hotline today.",
        estimated_minutes: 20,
        success_condition: "You reach human support.",
        fallback: "If unavailable, call emergency assistance.",
      },
      boardText: "Urgent eviction pressure and housing crisis.",
      branchLabel: "Immediate housing support",
      searchStatus: "needed",
      webSearchCallCount: 0,
    }).repaired,
    false,
  );
});

test("repaired operational actions become canonical task and trace text", () => {
  const action = {
    title: "Search and shortlist beginner tennis options",
    details: "Search and shortlist beginner tennis options.",
    estimated_minutes: 20,
    success_condition: "A next step is clear.",
    fallback: "Try another option.",
  };
  const repaired = normalizeActionLeafQuality({
    action,
    boardText:
      "Beginner in Bed-Stuy/11216 wants tennis as a new skill and a way to meet neighborhood people.",
    branchLabel: "Beginner clinic",
    searchStatus: "needed",
    webSearchCallCount: 0,
  });

  assert.equal(repaired.repaired, true);
  assert.equal(
    repaired.original_action_text,
    "Search and shortlist beginner tennis options.",
  );
  assert.notEqual(repaired.canonical_action_text, repaired.original_action_text);
  assert.equal(canonicalDecisionActionText(repaired.action), repaired.action.details);
  assert.match(repaired.canonical_action_text, /Within 30 minutes today/);
  assert.match(repaired.canonical_action_text, /Success:/);
  assert.match(repaired.canonical_action_text, /If blocked:/);
  assert.match(decisionActionTaskNotes(repaired.action), /Success:/);
  assert.match(decisionActionTaskNotes(repaired.action), /If blocked:/);
});

test("decision tree sanitizer repairs the live tennis failure before persistence", () => {
  const tree = buildFallbackDecisionTree(tennisPlan());
  const root = rootDecisionNode(tree);
  const clinic = root.options.find((option) => option.id === tree.recommended_option_id);
  assert.ok(clinic);
  const weakTree = {
    ...tree,
    current_action: {
      title: "Check beginner tennis formats near you",
      details: "Check beginner tennis formats near you.",
      estimated_minutes: 20,
      success_condition: "You know what to do next.",
      fallback: "Try another option.",
    },
    nodes: tree.nodes.map((node) =>
      node.id === root.id
        ? {
            ...node,
            options: node.options.map((option) =>
              option.id === clinic.id
                ? {
                    ...option,
                    first_action: {
                      ...option.first_action,
                      title: "Check beginner tennis formats near you",
                      details: "Check beginner tennis formats near you.",
                      success_condition: "You know what to do next.",
                      fallback: "Try another option.",
                    },
                  }
                : option,
            ),
          }
        : node,
    ),
  };

  const sanitized = sanitizeDecisionTreeSearchStatuses(
    weakTree,
    0,
    "Beginner in Bed-Stuy/11216 wants to start tennis and meet nearby people.",
  );

  assert.match(sanitized.current_action.details, /Within 30 minutes today/);
  assert.match(sanitized.current_action.success_condition, /Three candidates/);
  assert.match(
    findDecisionOption(sanitized, clinic.id)?.first_action.details ?? "",
    /3-5 beginner clinic near 11216/i,
  );
});

test("decision tree sanitizer upgrades not-needed local actions before repair", () => {
  const tree = buildFallbackDecisionTree(tennisPlan());
  const root = rootDecisionNode(tree);
  const clinic = root.options.find((option) => option.id === tree.recommended_option_id);
  assert.ok(clinic);

  const repairedModelTree = {
    ...tree,
    current_action: {
      title: "Choose a beginner-friendly recurring tennis group",
      details:
        "Find a weekly adult beginner clinic, drill, or social group near Bed-Stuy and commit to the best plausible one.",
      estimated_minutes: 20,
      success_condition: "You identify one best-fit recurring beginner option and one backup.",
      fallback: "If nothing fits, contact one provider directly and ask for placement guidance.",
    },
    nodes: tree.nodes.map((node) =>
      node.id === root.id
        ? {
            ...node,
            options: node.options.map((option) =>
              option.id === clinic.id
                ? {
                    ...option,
                    requires_web_search: false,
                    search_status: "not_needed" as const,
                    first_action: {
                      ...option.first_action,
                      title: "Choose a beginner-friendly recurring tennis group",
                      details:
                        "Find a weekly adult beginner clinic, drill, or social group near Bed-Stuy and commit to the best plausible one.",
                      success_condition:
                        "You identify one best-fit recurring beginner option and one backup.",
                      fallback:
                        "If nothing fits, contact one provider directly and ask for placement guidance.",
                    },
                  }
                : option,
            ),
          }
        : node,
    ),
  };

  const sanitized = sanitizeDecisionTreeSearchStatuses(
    repairedModelTree,
    0,
    "Beginner in Bed-Stuy/11216 wants to start tennis and meet nearby people.",
  );
  const sanitizedClinic = findDecisionOption(sanitized, clinic.id);

  assert.equal(sanitizedClinic?.search_status, "needed");
  assert.equal(sanitizedClinic?.requires_web_search, true);
  assert.match(sanitized.current_action.details, /Within 30 minutes today/);
  assert.match(sanitized.current_action.details, /3 recurring non-dating community options/);
  assert.match(sanitized.current_action.details, /near 11216/);
  assert.match(sanitized.current_action.success_condition, /calendar/);
  assert.match(
    sanitizedClinic?.first_action.details ?? "",
    /same people are likely to return/,
  );
});

test("plan task candidates inherit canonical repaired Move Map action details", () => {
  const basePlan = tennisPlan();
  const tree = sanitizeDecisionTreeSearchStatuses(
    {
      ...buildFallbackDecisionTree(basePlan),
      current_action: {
        title: "Search and shortlist beginner tennis options",
        details: "Search and shortlist beginner tennis options.",
        estimated_minutes: 20,
        success_condition: "A next step is clear.",
        fallback: "Try another option.",
      },
    },
    0,
    "Beginner in Bed-Stuy/11216 wants tennis and local community.",
  );
  const aligned = alignPlanActionsWithDecisionTree({
    ...basePlan,
    decision_tree: tree,
  });

  assert.match(aligned.first_10_minute_action.details, /Within 30 minutes today/);
  assert.match(aligned.task_candidates[0]?.details ?? "", /Within 30 minutes today/);
  assert.match(aligned.task_candidates[0]?.details ?? "", /Success:/);
  assert.match(aligned.task_candidates[0]?.description ?? "", /If blocked:/);
});

test("plan persistence normalization runs search honesty before task alignment", () => {
  const basePlan = tennisPlan();
  const tree = buildFallbackDecisionTree(basePlan);
  const root = rootDecisionNode(tree);
  const clinic = root.options.find((option) => option.id === tree.recommended_option_id);
  assert.ok(clinic);
  const weakTree = {
    ...tree,
    current_action: {
      title: "Choose a beginner-friendly recurring tennis group",
      details:
        "Find a weekly adult beginner clinic, drill, or social group near Bed-Stuy and commit to the best plausible one.",
      estimated_minutes: 20,
      success_condition: "You identify one best-fit recurring beginner option and one backup.",
      fallback: "If nothing fits, contact one provider directly and ask for placement guidance.",
    },
    nodes: tree.nodes.map((node) =>
      node.id === root.id
        ? {
            ...node,
            options: node.options.map((option) =>
              option.id === clinic.id
                ? {
                    ...option,
                    requires_web_search: false,
                    search_status: "not_needed" as const,
                    first_action: {
                      ...option.first_action,
                      title: "Choose a beginner-friendly recurring tennis group",
                      details:
                        "Find a weekly adult beginner clinic, drill, or social group near Bed-Stuy and commit to the best plausible one.",
                      success_condition:
                        "You identify one best-fit recurring beginner option and one backup.",
                      fallback:
                        "If nothing fits, contact one provider directly and ask for placement guidance.",
                    },
                  }
                : option,
            ),
          }
        : node,
    ),
  };
  const normalized = normalizePlanOutputForPersistence(
    {
      ...basePlan,
      decision_tree: weakTree,
    },
    {
      webSearchCallCount: 0,
      contextText:
        "Beginner in Bed-Stuy/11216 wants tennis and community; local current options matter.",
    },
  );

  assert.match(normalized.decision_tree.current_action.details, /Within 30 minutes today/);
  assert.match(normalized.first_10_minute_action.details, /Within 30 minutes today/);
  assert.match(normalized.task_candidates[0]?.details ?? "", /Within 30 minutes today/);
  assert.match(normalized.task_candidates[0]?.details ?? "", /Success:/);
});

test("reconciliation followup quality repairs meta-only updates without privileging a medium", () => {
  const followups = ["writing", "pottery", "music"].map((medium) =>
    normalizeReconciliationFollowupQuality({
      recommendedFollowupAction: "Recalculate the board around the updated constraint.",
      boardText: `The user wants to keep ${medium} private and non-commercial for now.`,
    }),
  );

  for (const repaired of followups) {
    assert.equal(repaired.repaired, true);
    assert.match(repaired.recommended_followup_action, /30-minute block/);
    assert.match(repaired.recommended_followup_action, /Success:/);
    assert.match(repaired.recommended_followup_action, /If blocked/);
    assert.doesNotMatch(repaired.recommended_followup_action, /writing|pottery|music/i);
  }
  assert.equal(
    new Set(followups.map((result) => result.recommended_followup_action)).size,
    1,
  );

  const noAction = normalizeReconciliationFollowupQuality({
    recommendedFollowupAction:
      "No action needed: this only changes future recommendations.",
    boardText: "Private writing.",
  });
  assert.equal(noAction.repaired, false);
});

test("model-backed branch expansion attaches child decision nodes and action leaves", () => {
  const tree = buildFallbackDecisionTree(tennisPlan());
  const root = rootDecisionNode(tree);
  const branch = root.options.find((option) => option.id === tree.recommended_option_id);
  assert.ok(branch);

  const expanded = attachBranchExpansionToTree({
    tree,
    nodeId: root.id,
    optionId: branch.id,
    selectedPath: [branch.id],
    webSearchCallCount: 0,
    contextText: "The user wants to start tennis near Bed-Stuy and meet people.",
    expansion: branchExpansionResultSchema.parse({
      result_type: "decision_node",
      node: {
        kind: "decision",
        title: "Instruction formats",
        question: "Which instruction format fits the current constraints?",
        summary: "The selected branch still needs a format choice.",
        options: [
          {
            label: "Recurring beginner class",
            short_rationale:
              "Best if structured practice and repeated contact both matter.",
            recommendation_level: "recommended",
            can_explore: true,
            search_status: "needed",
            friction: "medium",
            time_to_feedback: "One inquiry",
            first_action_preview: "Find one recurring beginner class and check level fit.",
          },
          {
            label: "Small-group session",
            short_rationale:
              "Keeps direct feedback while adding contact with other learners.",
            recommendation_level: "viable",
            can_explore: true,
            search_status: "needed",
            friction: "medium",
            time_to_feedback: "One session",
            first_action_preview: "Find one small-group beginner session.",
          },
        ],
        search_status: "needed",
      },
      action_leaf: null,
      reasoning_summary: "The format should match both practice and repeat-contact goals.",
      selected_path_summary: "Join a beginner clinic.",
      memory_used: [],
      assumptions: [],
      search_needed: true,
    }),
  });
  const expandedBranch = rootDecisionNode(expanded).options.find(
    (option) => option.id === branch.id,
  );
  assert.ok(expandedBranch?.next_node_id);
  const child = getDecisionNode(expanded, expandedBranch.next_node_id);
  assert.equal(child?.kind, "decision");
  assert.equal(child?.options.length, 2);
  assert.equal(child?.options[0]?.label, "Recurring beginner class");

  const childOption = child?.options[0];
  assert.ok(child && childOption);
  const leafTree = attachBranchExpansionToTree({
    tree: expanded,
    nodeId: child.id,
    optionId: childOption.id,
    selectedPath: expanded.selected_path,
    webSearchCallCount: 0,
    contextText: "The user wants to start tennis near Bed-Stuy and meet people.",
    expansion: branchExpansionResultSchema.parse({
      result_type: "action_leaf",
      node: null,
      action_leaf: {
        kind: "action",
        title: "Ask one program about level fit",
        first_action: "Send one message asking whether the recurring class fits a beginner.",
        first_10_minutes: "Draft the question and choose one program.",
        success_condition: "One message is sent.",
        if_blocked: "Search for another recurring beginner format.",
        search_status: "needed",
      },
      reasoning_summary: "The branch is now specific enough to act.",
      selected_path_summary: "Recurring beginner class -> ask about fit.",
      memory_used: [],
      assumptions: [],
      search_needed: true,
    }),
  });
  assert.equal(decisionTreeTrace(leafTree, leafTree.selected_path).at(-1)?.node.kind, "action");
  assert.match(leafTree.current_action.details, /Within 30 minutes today/);
  assert.match(leafTree.current_action.details, /3-5 realistic options/);
  assert.match(leafTree.current_action.details, /Bed-Stuy/);
  assert.match(leafTree.current_action.success_condition, /Three candidates/);
  assert.match(leafTree.current_action.fallback, /widen the search radius/);
  assert.doesNotMatch(
    leafTree.current_action.details,
    /adult tennis clinic|Brooklyn beginner|specific provider/i,
  );
});

test("sequential branch expansion output is coerced into an action leaf", () => {
  const parsed = branchExpansionResultSchema.parse({
    result_type: "decision_node",
    node: {
      kind: "decision",
      title: "Sequential output",
      question: "What should happen next?",
      summary: "",
      options: [
        {
          label: "Search for a beginner class",
          short_rationale: "First step.",
          recommendation_level: "recommended",
          can_explore: false,
          search_status: "needed",
          friction: "low",
          time_to_feedback: "Today",
          first_action_preview: "Search for one beginner class.",
        },
        {
          label: "Send one message",
          short_rationale: "Second step.",
          recommendation_level: "viable",
          can_explore: false,
          search_status: "needed",
          friction: "low",
          time_to_feedback: "Today",
          first_action_preview: "Send one message.",
        },
        {
          label: "Schedule it",
          short_rationale: "Third step.",
          recommendation_level: "viable",
          can_explore: false,
          search_status: "not_needed",
          friction: "low",
          time_to_feedback: "Today",
          first_action_preview: "Put it on the calendar.",
        },
      ],
      search_status: "needed",
    },
    action_leaf: null,
    reasoning_summary: "The model accidentally returned steps as branches.",
    selected_path_summary: "Recurring class.",
    memory_used: [],
    assumptions: [],
    search_needed: true,
  });
  const normalized = normalizeBranchExpansionResult(parsed);
  assert.equal(normalized.result_type, "action_leaf");
  assert.match(normalized.action_leaf?.first_action ?? "", /Search for one beginner class/);
  assert.match(normalized.action_leaf?.first_action ?? "", /Send one message/);
});

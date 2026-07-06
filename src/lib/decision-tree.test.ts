import assert from "node:assert/strict";
import test from "node:test";

import {
  attachBranchExpansionToTree,
  buildFallbackDecisionTree,
  decisionBranchSourceSection,
  decisionTreeTrace,
  expandDecisionTreeAtOption,
  findDecisionOption,
  getDecisionNode,
  normalizeDecisionTree,
  normalizeBranchExpansionResult,
  rootDecisionNode,
  sanitizeBranchExpansionSearchStatus,
  sanitizeDecisionTreeSearchStatuses,
  selectedPathForChoice,
} from "./decision-tree";
import { branchExpansionResultSchema } from "./schemas";
import type { NextMovePlan } from "./types";

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

test("fallback tree creates visible branches and stable branch task source", () => {
  const tree = buildFallbackDecisionTree(tennisPlan());
  const root = rootDecisionNode(tree);
  const recommended = findDecisionOption(tree, tree.recommended_option_id);

  assert.equal(root.title, "Current position");
  assert.deepEqual(
    root.options.map((option) => option.label),
    [
      "Beginner clinic / recurring group",
      "Hire a coach",
      "Solo practice",
      "Casual local games",
    ],
  );
  assert.equal(recommended?.label, "Beginner clinic / recurring group");
  assert.equal(recommended?.recommendation_level, "recommended");
  assert.equal(recommended?.search_status, "needed");
  assert.equal(recommended?.requires_web_search, true);
  assert.equal(root.options.some((option) => /^Find one/i.test(option.label)), false);
  assert.equal(recommended?.next_steps[0]?.title, "Find one beginner clinic");
  assert.equal(tree.current_action.title, "Find one beginner clinic");
  assert.equal(
    decisionBranchSourceSection(recommended?.id),
    "decision_branch:beginner_clinic_group",
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
  const coach = root.options.find((option) => option.label === "Hire a coach");
  assert.ok(coach);

  const selectedOnlyPath = selectedPathForChoice(tree, tree.selected_path, root.id, coach.id);
  assert.deepEqual(selectedOnlyPath, [coach.id]);
  assert.equal(getDecisionNode(tree, coach.next_node_id), null);

  const expanded = expandDecisionTreeAtOption({
    tree,
    nodeId: root.id,
    optionId: coach.id,
    selectedPath: selectedOnlyPath,
  });
  const expandedCoach = rootDecisionNode(expanded).options.find(
    (option) => option.id === coach.id,
  );
  assert.ok(expandedCoach?.next_node_id);
  assert.equal(expandedCoach.can_explore, false);
  const childFork = getDecisionNode(expanded, expandedCoach.next_node_id);
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
  assert.equal(tree.current_action.title, "Contact a clinic");
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

test("model-backed branch expansion attaches child decision nodes and action leaves", () => {
  const tree = buildFallbackDecisionTree(tennisPlan());
  const root = rootDecisionNode(tree);
  const coach = root.options.find((option) => option.label === "Hire a coach");
  assert.ok(coach);

  const expanded = attachBranchExpansionToTree({
    tree,
    nodeId: root.id,
    optionId: coach.id,
    selectedPath: [coach.id],
    webSearchCallCount: 0,
    expansion: branchExpansionResultSchema.parse({
      result_type: "decision_node",
      node: {
        kind: "decision",
        title: "Coaching path",
        question: "What kind of coaching path fits this goal?",
        summary: "The coach branch still needs a coaching-specific choice.",
        options: [
          {
            label: "Coach who routes into group play",
            short_rationale:
              "Best if the coach can correct basics and point you toward a recurring beginner container.",
            recommendation_level: "recommended",
            can_explore: true,
            search_status: "needed",
            friction: "medium",
            time_to_feedback: "One inquiry",
            first_action_preview:
              "Contact one coach and ask where adult beginners play repeatedly.",
          },
          {
            label: "Small-group lesson",
            short_rationale:
              "Keeps coaching feedback while adding repeated contact with other beginners.",
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
      reasoning_summary: "Coaching is useful only if it routes into a group.",
      selected_path_summary: "Hire a coach.",
      memory_used: [],
      assumptions: [],
      search_needed: true,
    }),
  });
  const expandedCoach = rootDecisionNode(expanded).options.find(
    (option) => option.id === coach.id,
  );
  assert.ok(expandedCoach?.next_node_id);
  const child = getDecisionNode(expanded, expandedCoach.next_node_id);
  assert.equal(child?.kind, "decision");
  assert.equal(child?.options.length, 2);
  assert.equal(child?.options[0]?.label, "Coach who routes into group play");

  const childOption = child?.options[0];
  assert.ok(child && childOption);
  const leafTree = attachBranchExpansionToTree({
    tree: expanded,
    nodeId: child.id,
    optionId: childOption.id,
    selectedPath: expanded.selected_path,
    webSearchCallCount: 0,
    expansion: branchExpansionResultSchema.parse({
      result_type: "action_leaf",
      node: null,
      action_leaf: {
        kind: "action",
        title: "Ask one coach for a beginner group route",
        first_action:
          "Send one message asking whether they teach adult beginners and where those beginners play repeatedly.",
        first_10_minutes: "Draft the message and choose one coach.",
        success_condition: "One message is sent.",
        if_blocked: "Ask a public recreation program instead.",
        search_status: "needed",
      },
      reasoning_summary: "The branch is now specific enough to act.",
      selected_path_summary: "Hire a coach -> coach who routes into group play.",
      memory_used: [],
      assumptions: [],
      search_needed: true,
    }),
  });
  assert.equal(decisionTreeTrace(leafTree, leafTree.selected_path).at(-1)?.node.kind, "action");
  assert.equal(leafTree.current_action.title, "Ask one coach for a beginner group route");
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

import type { BranchExpansionResultInput, ReconciliationResultInput } from "../schemas";
import type {
  DecisionFirstAction,
  DecisionOption,
  DecisionRecommendationLevel,
  DecisionSearchStatus,
  DecisionTree,
  DecisionNode,
} from "../types";
import { antiOverfitScenarios } from "./fixtures";
import type { EvalOutput, EvalScenario } from "./types";

const NOW = "2026-07-06T00:00:00.000Z";

function action(
  title: string,
  details: string,
  overrides: Partial<DecisionFirstAction> = {},
): DecisionFirstAction {
  return {
    title,
    details,
    estimated_minutes: 20,
    success_condition: `A concrete step is completed: ${title.toLowerCase()}.`,
    fallback: "If blocked, choose the nearest lower-friction version of the same move.",
    ...overrides,
  };
}

function option(
  nodeId: string,
  id: string,
  label: string,
  description: string,
  recommendationLevel: DecisionRecommendationLevel,
  overrides: Partial<DecisionOption> = {},
): DecisionOption {
  const firstAction = overrides.first_action ?? action(label, description);
  return {
    id,
    node_id: nodeId,
    label,
    description,
    move_type: "mixed",
    recommendation_level: recommendationLevel,
    why: description,
    upside: "Creates useful signal without overcommitting.",
    downside: "May need adjustment after the first real-world attempt.",
    friction: "medium",
    time_to_feedback: "This week",
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

function decisionTree(input: {
  id: string;
  boardId?: number;
  rootQuestion: string;
  rootSummary: string;
  options: DecisionOption[];
  recommendedOptionId: string;
  selectedOptionId?: string;
  currentAction?: DecisionFirstAction;
  extraNodes?: DecisionNode[];
}): DecisionTree {
  const selectedOptionId = input.selectedOptionId ?? input.recommendedOptionId;
  const options = input.options.map((branch) => ({
    ...branch,
    selected: branch.id === selectedOptionId,
  }));
  const root: DecisionNode = {
    id: "root",
    parent_id: null,
    selected_from_option_id: null,
    kind: "decision",
    title: "Current position",
    question: input.rootQuestion,
    context_summary: input.rootSummary,
    options,
    action: null,
    selected_option_id: selectedOptionId,
    status: "active",
    search_status: searchStatusForOptions(options),
    generated_at: NOW,
  };
  const currentAction =
    input.currentAction ??
    options.find((branch) => branch.id === selectedOptionId)?.first_action ??
    options[0]?.first_action ??
    action("Choose a path", "Pick the most realistic path and take one small step.");

  return {
    id: input.id,
    board_id: input.boardId ?? null,
    root_node_id: root.id,
    active_node_id: root.id,
    selected_path: [selectedOptionId],
    recommended_option_id: input.recommendedOptionId,
    current_action: currentAction,
    nodes: [root, ...(input.extraNodes ?? [])],
    created_at: NOW,
    updated_at: NOW,
  };
}

function searchStatusForOptions(options: DecisionOption[]): DecisionSearchStatus {
  if (options.some((branch) => branch.search_status === "searched")) return "searched";
  if (options.some((branch) => branch.search_status === "needed")) return "needed";
  if (options.some((branch) => branch.search_status === "failed")) return "failed";
  if (options.some((branch) => branch.search_status === "unavailable")) return "unavailable";
  return "not_needed";
}

function branches(
  nodeId: string,
  items: Array<{
    id: string;
    label: string;
    description: string;
    level: DecisionRecommendationLevel;
    search?: DecisionSearchStatus;
    firstAction?: DecisionFirstAction;
  }>,
) {
  return items.map((item) =>
    option(
      nodeId,
      item.id,
      item.label,
      item.description,
      item.level,
      {
        search_status: item.search ?? "not_needed",
        requires_web_search:
          item.search === "needed" ||
          item.search === "searched" ||
          item.search === "failed" ||
          item.search === "unavailable",
        friction:
          item.level === "recommended" || item.level === "viable" ? "medium" : "low",
        ...(item.firstAction ? { first_action: item.firstAction } : {}),
      },
    ),
  );
}

const tennisTree = decisionTree({
  id: "eval-tennis-tree",
  rootQuestion: "How should you use tennis to build local community?",
  rootSummary: "Beginner tennis is the activity; repeated local connection is the point.",
  recommendedOptionId: "clinic_group",
  currentAction: action(
    "Contact one beginner-friendly tennis container",
    "Search for 3 recurring beginner adult tennis clinics or social drill groups within 20-30 minutes of 11216. Use search terms like 'beginner adult tennis clinic near Bed-Stuy', 'adult tennis clinic Brooklyn beginner', and 'social tennis drill Brooklyn'. Shortlist only recurring, beginner-friendly, low-pressure options that are not competitive pickup, then contact the best match today. Do not treat any local option as verified until you check it.",
    {
      success_condition: "Three candidates are shortlisted or one beginner-friendly recurring tennis option is contacted today.",
      fallback: "If no clinic appears, contact one private or semi-private coach and ask where adult beginners usually move into group play.",
    },
  ),
  options: branches("root", [
    {
      id: "clinic_group",
      label: "Beginner clinic / recurring group",
      description: "Best mix of skill, structure, and repeated people.",
      level: "recommended",
      search: "needed",
      firstAction: action(
        "Contact one beginner-friendly tennis container",
        "Search for 3 recurring beginner adult tennis clinics or social drill groups within 20-30 minutes of 11216 using 'beginner adult tennis clinic near Bed-Stuy', 'adult tennis clinic Brooklyn beginner', and 'social tennis drill Brooklyn', then contact the best recurring low-pressure option today.",
        {
          success_condition: "Three candidates are shortlisted or one message is sent today.",
          fallback: "If no clinic appears, contact one coach and ask where adult beginners usually move into group play.",
        },
      ),
    },
    {
      id: "coach",
      label: "Coach with group referral",
      description: "Fast skill feedback, but community depends on referral into groups.",
      level: "viable",
      search: "needed",
    },
    {
      id: "solo_practice",
      label: "Solo practice",
      description: "Builds comfort, but does not create social contact by itself.",
      level: "supplement",
    },
    {
      id: "casual_games",
      label: "Casual local games",
      description: "More organic, but higher mismatch risk for a beginner.",
      level: "not_now",
      search: "needed",
    },
  ]),
});

const yogaTree = decisionTree({
  id: "eval-yoga-tree",
  rootQuestion: "How should you meet people through beginner-friendly yoga?",
  rootSummary: "The user wants social connection through yoga without high-pressure interaction.",
  recommendedOptionId: "recurring_beginner_class",
  currentAction: action(
    "Message one recurring beginner yoga class",
    "Pick one recurring beginner-friendly yoga class and ask whether it is comfortable for someone shy and new.",
    {
      success_condition: "One message is sent or one trial class is chosen.",
      fallback: "If that feels too exposed, choose an intro workshop or smaller class.",
    },
  ),
  options: branches("root", [
    {
      id: "recurring_beginner_class",
      label: "Recurring beginner class",
      description: "Repeated exposure is easier than having to restart socially every time.",
      level: "recommended",
    },
    {
      id: "walk_only_options",
      label: "Walk-only options",
      description: "Keeps logistics low if travel friction would stop follow-through.",
      level: "viable",
      search: "needed",
    },
    {
      id: "intro_workshop",
      label: "Intro workshop or series",
      description: "A bounded start can feel safer than entering an established class.",
      level: "viable",
    },
    {
      id: "community_free_class",
      label: "Community/free class",
      description: "Lower cost and often friendlier, but schedule consistency may vary.",
      level: "supplement",
      search: "needed",
    },
  ]),
});

const actingTree = decisionTree({
  id: "eval-acting-tree",
  rootQuestion: "Which acting-class format should you try first in Brooklyn?",
  rootSummary:
    "The user wants an advanced acting class near Bed-Stuy or nearby Brooklyn, with improv as an appealing social/craft direction.",
  recommendedOptionId: "improv_class",
  currentAction: action(
    "Ask Brooklyn Comedy Collective whether Level 3 fits",
    "Use the searched Brooklyn Comedy Collective class information as a lead, then send one placement/fit message asking whether Level 3 matches your current improv experience and whether evenings or weekends are available.",
    {
      success_condition: "One fit-check message is sent or the correct placement path is identified.",
      fallback: "If Level 3 is not a fit, ask which advanced or intermediate improv class they recommend near Bed-Stuy.",
    },
  ),
  options: branches("root", [
    {
      id: "improv_class",
      label: "Improv class in Brooklyn",
      description:
        "Best match for the user's stated interest, social repetition, and Brooklyn preference; confirm level fit before enrolling.",
      level: "recommended",
      search: "searched",
      firstAction: action(
        "Ask Brooklyn Comedy Collective whether Level 3 fits",
        "Send one placement/fit message asking whether Level 3 matches your current improv experience and schedule.",
        {
          success_condition: "One fit-check message is sent.",
          fallback: "If that level is not right, ask for the nearest advanced or intermediate improv class.",
        },
      ),
    },
    {
      id: "on_camera_acting",
      label: "On-camera acting",
      description: "Useful if screen acting matters more than live ensemble energy.",
      level: "viable",
      search: "needed",
    },
    {
      id: "scene_study",
      label: "Scene study",
      description: "A strong acting-craft path if the user wants repeated partner work and text analysis.",
      level: "viable",
      search: "needed",
    },
    {
      id: "trial_workshop",
      label: "Trial workshop",
      description: "Lower commitment if the user wants to check fit before joining a full class.",
      level: "supplement",
      search: "needed",
    },
    {
      id: "audition_monologue",
      label: "Audition or monologue class",
      description: "More targeted, but less aligned with the stated improv/social pull.",
      level: "not_now",
      search: "needed",
    },
  ]).map((branch) =>
    branch.id === "improv_class"
      ? {
          ...branch,
          sources: [
            {
              title: "Brooklyn Comedy Collective improv class lead",
              why_it_matters:
                "Mock searched result used only as a fit-check lead; level and schedule still need confirmation.",
              source: "mock_search",
              url_or_next_search: "Search Brooklyn Comedy Collective Level 3 improv class",
            },
          ],
        }
      : branch,
  ),
});

const careerTree = decisionTree({
  id: "eval-career-tree",
  rootQuestion: "How should you pursue opportunity after cold applications stalled?",
  rootSummary: "Cold LinkedIn applications have not produced interviews, so the next move needs a warmer or more differentiated signal.",
  recommendedOptionId: "warm_networking",
  currentAction: action(
    "Send three specific warm-network messages",
    "List ten people with any shared context and send three short messages asking for one specific conversation or referral path.",
    {
      success_condition: "Three targeted messages are sent.",
      fallback: "If no warm contacts exist, use one domain-specific community or alumni group as the entry point.",
    },
  ),
  options: branches("root", [
    {
      id: "warm_networking",
      label: "Warm networking",
      description: "Adds trust and information where cold applications have failed.",
      level: "recommended",
    },
    {
      id: "proof_asset",
      label: "Proof asset",
      description: "Creates evidence that can make targeted outreach less abstract.",
      level: "viable",
    },
    {
      id: "freelance_service",
      label: "Freelance/service path",
      description: "Can create income signal if the offer is narrow and sellable.",
      level: "viable",
    },
    {
      id: "targeted_applications",
      label: "Targeted applications",
      description: "Use fewer applications paired with proof and warm context, not more spray-and-pray.",
      level: "supplement",
    },
    {
      id: "more_cold_applications",
      label: "More cold applications",
      description: "Likely repeats the low-yield pattern unless the position or proof changes.",
      level: "not_now",
    },
  ]),
});

const entrepreneurTree = decisionTree({
  id: "eval-entrepreneur-tree",
  rootQuestion: "How should you validate the idea before building too much?",
  rootSummary: "The user can build, but has no customer proof yet.",
  recommendedOptionId: "customer_interviews",
  currentAction: action(
    "Book two customer conversations",
    "Write one narrow problem statement and ask five likely customers for a 15-minute conversation.",
    {
      success_condition: "Two conversations are scheduled or completed.",
      fallback: "If people will not talk, test a manual service offer to see whether anyone wants the outcome.",
    },
  ),
  options: branches("root", [
    {
      id: "customer_interviews",
      label: "Customer interviews",
      description: "Fastest way to learn whether the problem is real before building.",
      level: "recommended",
    },
    {
      id: "manual_service",
      label: "Manual service version",
      description: "Tests willingness to pay before software is necessary.",
      level: "viable",
    },
    {
      id: "landing_page",
      label: "Landing page smoke test",
      description: "Can measure interest if the audience channel is specific.",
      level: "viable",
    },
    {
      id: "insider_conversations",
      label: "Domain insider conversations",
      description: "Finds distribution and purchasing realities early.",
      level: "supplement",
    },
    {
      id: "build_full_product",
      label: "Build full product first",
      description: "Tempting because the user can code, but delays market feedback.",
      level: "not_now",
    },
  ]),
});

const creativeTree = decisionTree({
  id: "eval-creative-tree",
  rootQuestion: "What writing progress should come before professionalization?",
  rootSummary: "Paid writing remains possible, but craft proof and feedback loops are thin.",
  recommendedOptionId: "feedback_loop",
  currentAction: action(
    "Share one small piece for feedback",
    "Finish one short writing piece and ask one specific reader or small group for feedback on one question.",
    {
      success_condition: "One finished piece is shared for specific feedback.",
      fallback: "If sharing publicly feels too much, send it privately to one trusted reader.",
    },
  ),
  options: branches("root", [
    {
      id: "feedback_loop",
      label: "Feedback loop",
      description: "Builds taste, confidence, and direction without pretending the career is ready today.",
      level: "recommended",
    },
    {
      id: "finish_small_piece",
      label: "Finish one small piece",
      description: "Creates proof that can later support a paid path.",
      level: "viable",
    },
    {
      id: "public_proof",
      label: "Public proof",
      description: "Useful after there is at least one small finished piece to share.",
      level: "supplement",
    },
    {
      id: "professional_submission",
      label: "Professional submission",
      description: "Possible later, but prerequisite-dependent right now.",
      level: "not_now",
    },
  ]),
});

const communityTree = decisionTree({
  id: "eval-community-tree",
  rootQuestion: "How should you build friendships and community without dating?",
  rootSummary: "The user wants regular real-world connection and explicitly does not want dating.",
  recommendedOptionId: "recurring_group",
  currentAction: action(
    "Join one recurring group",
    "Choose one recurring activity or community group and attend once with the explicit aim of becoming familiar, not dating.",
    {
      success_condition: "One recurring group is chosen and first attendance is scheduled.",
      fallback: "If that feels too high-pressure, ask one friend-of-friend for a low-stakes group suggestion.",
    },
  ),
  options: branches("root", [
    {
      id: "recurring_group",
      label: "Recurring group",
      description: "Repeated contact is the simplest path to friendship.",
      level: "recommended",
    },
    {
      id: "volunteering",
      label: "Volunteering",
      description: "Creates shared purpose and repeated contact.",
      level: "viable",
    },
    {
      id: "friend_of_friend",
      label: "Friend-of-friend activation",
      description: "Uses a softer social bridge instead of starting cold.",
      level: "viable",
    },
    {
      id: "class_activity",
      label: "Class or activity",
      description: "Gives people something to do together before conversation has to carry everything.",
      level: "supplement",
    },
  ]),
});

const ruralTree = decisionTree({
  id: "eval-rural-tree",
  rootQuestion: "How should you build community with limited rural options?",
  rootSummary: "The user has low local density but can drive 30 minutes once per week.",
  recommendedOptionId: "regional_recurring_group",
  currentAction: action(
    "Search one weekly regional option within 30 minutes",
    "Search for a recurring group, library program, class, or volunteer slot within a 30-minute drive and choose one realistic weekly option.",
    {
      success_condition: "One recurring option within driving range is identified.",
      fallback: "If nothing appears, use an online-to-offline bridge or ask the local library/community center what repeats monthly.",
    },
  ),
  options: branches("root", [
    {
      id: "regional_recurring_group",
      label: "Regional recurring group",
      description: "Fits rural density by using a weekly drive rather than nightly local options.",
      level: "recommended",
      search: "needed",
    },
    {
      id: "volunteer_or_library",
      label: "Volunteer/library/adult education",
      description: "Often exists where nightlife or hobby groups do not.",
      level: "viable",
      search: "needed",
    },
    {
      id: "online_to_offline",
      label: "Online-to-offline bridge",
      description: "Start online, then convert to regional in-person meetups.",
      level: "supplement",
    },
    {
      id: "drive_distance_plan",
      label: "30-minute drive plan",
      description: "Makes geography explicit instead of assuming urban density.",
      level: "viable",
      search: "needed",
    },
  ]),
});

const urgentTree = decisionTree({
  id: "eval-urgent-tree",
  rootQuestion: "What reduces immediate housing risk first?",
  rootSummary: "Imminent eviction-like pressure should route to urgent stability, not normal career strategy.",
  recommendedOptionId: "housing_support",
  currentAction: action(
    "Call or message a housing support contact today",
    "Contact a local housing hotline, tenant support organization, legal aid intake, or emergency assistance line today. Treat details as unverified until checked locally.",
    {
      success_condition: "One support contact is reached or a callback request is submitted.",
      fallback: "If no one answers, contact a 211-style local resource line or a trusted person who can help make calls.",
    },
  ),
  options: branches("root", [
    {
      id: "housing_support",
      label: "Housing support contact",
      description: "Immediate risk reduction comes before broad career strategy.",
      level: "recommended",
      search: "needed",
    },
    {
      id: "legal_aid",
      label: "Legal aid intake",
      description: "May clarify options, but FlowPath should not make legal claims.",
      level: "viable",
      search: "needed",
    },
    {
      id: "cash_stability",
      label: "Cash stability triage",
      description: "Identify the fastest legitimate cash/support path without long-term optimization.",
      level: "viable",
    },
    {
      id: "safe_place",
      label: "Safe backup place",
      description: "A backup place reduces downside while official support is pursued.",
      level: "supplement",
    },
  ]),
});

const courtDeadlineAction = action(
  "Find the notice and copy the deadline facts",
  "For 15 minutes now, find the notice and copy the court name, case number, deadline date/time, document title, and filing/contact instructions into one note. Keep this as process triage, not legal argument planning.",
  {
    success_condition:
      "One deadline facts sheet exists with the core notice details or clear blanks for what is missing.",
    fallback:
      "If you cannot find the notice, call the court clerk or legal-aid intake and say you need help identifying what information is required before the deadline.",
  },
);

const courtDeadlineTree = decisionTree({
  id: "eval-court-deadline-tree",
  rootQuestion: "How do you avoid missing the court paperwork deadline?",
  rootSummary:
    "The user has a court paperwork deadline in a few days, has the notice somewhere, and wants process triage instead of legal argument advice.",
  recommendedOptionId: "notice_first",
  currentAction: courtDeadlineAction,
  options: branches("root", [
    {
      id: "notice_first",
      label: "Find the notice first",
      description:
        "Best first move because the exact court, case number, deadline, document title, and filing instructions determine every safer next step.",
      level: "recommended",
      firstAction: courtDeadlineAction,
    },
    {
      id: "court_clerk",
      label: "Call the court clerk",
      description:
        "Viable for process-only questions once the notice facts are found or the missing facts are clear.",
      level: "viable",
      firstAction: action(
        "Call the court clerk with process-only questions",
        "Today, call the court clerk or self-help contact and ask how to confirm the exact deadline, document title, filing method, and required contact information. Do not ask what legal argument to make.",
        {
          success_condition:
            "You have the exact deadline/filing instructions or know which office can confirm them.",
          fallback:
            "If the clerk cannot answer, ask what details they need from the notice or who handles procedural filing questions.",
        },
      ),
    },
    {
      id: "legal_aid",
      label: "Call legal aid intake",
      description:
        "Viable if risk is high or the notice cannot be found, but intake will likely need the notice facts.",
      level: "viable",
      firstAction: action(
        "Call legal aid intake with deadline facts",
        "Today, call legal aid intake with any notice facts you have. Ask whether they can help before the deadline and what documents they need. Keep it process-focused; do not rely on FlowPath for legal argument advice.",
        {
          success_condition:
            "You know whether intake can help before the deadline and what information or documents they need next.",
          fallback:
            "If you cannot reach intake, call the court clerk or self-help line and ask what information is needed to identify the filing steps.",
        },
      ),
    },
    {
      id: "more_time",
      label: "Ask about more time",
      description:
        "A useful supplement only after the exact deadline and document are confirmed.",
      level: "supplement",
      firstAction: action(
        "Ask about the process for more time",
        "After confirming the exact deadline and document, ask the clerk or legal aid what the process is if more time is needed. Write down the form name or office to contact without assuming an extension is available.",
        {
          success_condition:
            "You know the next process step for asking about more time or know that legal-aid/self-help guidance is needed first.",
          fallback:
            "If the process is unclear, return to notice-first triage and copy the deadline facts before making another call.",
        },
      ),
    },
    {
      id: "forms_search",
      label: "Search forms online",
      description:
        "Not now if the exact notice, court, deadline, and document are still unknown.",
      level: "not_now",
      search: "needed",
      firstAction: action(
        "Search only after copying notice facts",
        "For 20 minutes today, search official court or self-help pages using the exact court name, document title, and deadline words from the notice. Save only process information that matches your court/document; do not treat general forms pages as verified for your case.",
        {
          success_condition:
            "You save one official process page or decide the safer next step is a clerk/legal-aid call.",
          fallback:
            "If results are broad or conflicting, stop searching and call the clerk or legal aid with the notice facts.",
        },
      ),
    },
  ]),
});

const courtDeadlineBranchExpansion: BranchExpansionResultInput = {
  result_type: "decision_node",
  node: {
    kind: "decision",
    title: "Legal aid intake",
    question: "What should you ask legal aid intake first?",
    summary:
      "Legal aid may be useful, but the next fork should stay procedural and deadline-focused.",
    options: [
      {
        label: "Ask whether they can help before the deadline",
        short_rationale:
          "This checks timing without asking FlowPath for legal advice or assuming eligibility.",
        recommendation_level: "recommended",
        can_explore: true,
        search_status: "not_needed",
        friction: "medium",
        time_to_feedback: "Today",
        first_action_preview:
          "Call intake today and ask whether they can help before the deadline.",
      },
      {
        label: "Ask what documents they need",
        short_rationale:
          "This prevents a stalled intake call when the notice or case details are incomplete.",
        recommendation_level: "viable",
        can_explore: true,
        search_status: "not_needed",
        friction: "low",
        time_to_feedback: "Today",
        first_action_preview:
          "Ask intake what notice facts or documents they need before they can help.",
      },
      {
        label: "Prepare a notice facts sheet",
        short_rationale:
          "This makes the call easier if freezing or overwhelm is the main risk.",
        recommendation_level: "supplement",
        can_explore: true,
        search_status: "not_needed",
        friction: "low",
        time_to_feedback: "15 minutes",
        first_action_preview:
          "Copy the court name, case number, deadline, document title, and filing instructions into one note.",
      },
    ],
    search_status: "not_needed",
  },
  action_leaf: null,
  reasoning_summary:
    "Keep the legal-aid branch in process triage and avoid merits/legal-argument advice.",
  selected_path_summary: "Call legal aid intake.",
  memory_used: [],
  assumptions: ["The notice facts are not fully copied yet."],
  search_needed: false,
};

const privateWritingReconciliation: ReconciliationResultInput = {
  summary: "Removed monetization as an active writing assumption and stored privacy as the current preference.",
  confidence: "high",
  requires_user_confirmation: false,
  operations: [
    {
      type: "mark_stale",
      memory_id: "memory_monetize_writing",
      confidence: "high",
      reason: "The user explicitly asked to forget monetizing writing.",
    },
    {
      type: "create_memory",
      label: "Writing privacy",
      value: "The user wants to keep writing private and non-commercial for now.",
      category: "creative_personal_project",
      sensitivity: "low",
      persistence: "saved_memory",
      confidence: "high",
      reason: "Direct user correction.",
    },
  ],
  board_updates: {
    title: "Keep writing private for now",
    description: "",
    category: "craft_creativity_mastery",
    status: null,
    urgency: null,
    current_position_summary:
      "Writing should be treated as private/non-commercial until the user changes direction.",
    constraints_to_add: ["Keep writing private for now"],
    constraints_to_remove: ["Monetize writing"],
    assets_to_add: [],
    assets_to_remove: [],
    goals_to_add: ["Private writing practice"],
    goals_to_remove: ["Monetize writing"],
    assumptions_to_add: [],
    assumptions_to_remove: ["Professionalize writing now"],
  },
  move_map_effect: {
    selected_path_still_valid: false,
    invalidated_node_ids: [],
    invalidated_option_ids: ["professional_submission"],
    reason: "Professionalization paths conflict with the user's correction.",
    should_recalculate: true,
    should_preserve_existing_tree: true,
  },
  user_visible_explanation:
    "Updated writing memory so private/non-commercial writing is the active context. Future writing moves should avoid professionalization unless the user changes direction.",
  recommended_followup_action:
    "Optional next step: choose one private writing session or project to protect this week. Success: one private writing block is scheduled or one private project is named. If blocked, write one private 500-word scene without posting or submitting it.",
  follow_up_question: "",
};

const weekendReconciliation: ReconciliationResultInput = {
  summary: "Stored weekend-only availability and marked weekday-dependent path as needing recalculation.",
  confidence: "high",
  requires_user_confirmation: false,
  operations: [
    {
      type: "create_memory",
      label: "Weekend availability",
      value: "The user can only do board-related actions on weekends right now.",
      category: "time",
      sensitivity: "low",
      persistence: "saved_memory",
      confidence: "high",
      reason: "Direct user update.",
    },
  ],
  board_updates: {
    title: "Find a weekend-friendly path",
    description: "",
    category: "people_community_belonging",
    status: null,
    urgency: null,
    current_position_summary:
      "The active path must fit weekend availability.",
    constraints_to_add: ["Weekends only"],
    constraints_to_remove: ["Weekday availability"],
    assets_to_add: [],
    assets_to_remove: [],
    goals_to_add: [],
    goals_to_remove: [],
    assumptions_to_add: [],
    assumptions_to_remove: ["Weekday sessions are possible"],
  },
  move_map_effect: {
    selected_path_still_valid: false,
    invalidated_node_ids: ["weekday_path"],
    invalidated_option_ids: ["weekday_class"],
    reason: "The active path assumes weekday availability, but the user can only do weekends.",
    should_recalculate: true,
    should_preserve_existing_tree: true,
  },
  user_visible_explanation:
    "Got it. I will treat weekends-only as a constraint and recalculate paths that assumed weekdays.",
  recommended_followup_action:
    "Recalculate this board using weekend-only availability. Success: the Move Map only shows weekend-compatible options. If blocked, choose the current branch only if it can happen on a weekend.",
  follow_up_question: "",
};

const branchExpansion: BranchExpansionResultInput = {
  result_type: "decision_node",
  node: {
    kind: "decision",
    title: "Choose the recurring group",
    question: "Which beginner-friendly recurring option should you test first?",
    summary: "Stay focused on repeatable beginner exposure, not one-off browsing.",
    options: [
      {
        label: "Beginner clinic",
        short_rationale: "Most likely to combine instruction and repeated people.",
        recommendation_level: "recommended",
        can_explore: true,
        search_status: "needed",
        friction: "medium",
        time_to_feedback: "One session",
        first_action_preview: "Search for one recurring beginner clinic and contact it.",
      },
      {
        label: "Small group lesson",
        short_rationale: "More social than a private lesson and less chaotic than open play.",
        recommendation_level: "viable",
        can_explore: true,
        search_status: "needed",
        friction: "medium",
        time_to_feedback: "One lesson",
        first_action_preview: "Ask whether a small group lesson has adult beginners.",
      },
    ],
    search_status: "needed",
  },
  action_leaf: null,
  reasoning_summary: "The selected path still needs a concrete recurring option.",
  selected_path_summary: "Beginner clinic / recurring group",
  memory_used: ["Beginner", "Wants community"],
  assumptions: ["A recurring beginner option exists nearby."],
  search_needed: true,
};

function titleFromScenario(scenario: EvalScenario) {
  const keywords = scenario.expected.titleKeywords;
  if (keywords?.length) {
    return keywords
      .join(" ")
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }
  return scenario.name.replace(/\s*\/\s*/g, " - ");
}

function labelFromKeywordGroup(group: string[]) {
  return group
    .map((keyword) =>
      keyword.replace(/\b[a-z]/g, (match) => match.toUpperCase()),
    )
    .join(" / ");
}

function recommendedOptionIdForScenario(scenario: EvalScenario, labels: string[]) {
  const recommended = scenario.expected.recommendedBranchKeywords ?? [];
  const index = labels.findIndex((label) =>
    recommended.every((keyword) => label.toLowerCase().includes(keyword.toLowerCase())),
  );
  return `option_${Math.max(0, index)}`;
}

function actionDetailsForScenario(scenario: EvalScenario) {
  const actionKeywords = scenario.expected.actionKeywords?.join(" ") || "take the first concrete step";
  const locationPhrase =
    scenario.expected.constraintKeywords?.find((keyword) =>
      /zip|near|minute|rural|transit|local|no car|72 hours|few days/i.test(keyword),
    ) ?? "your area";

  if (scenario.expected.requiresSearchWorkflowAction) {
    return [
      `Within 30 minutes today, search for 3 realistic ${titleFromScenario(scenario).toLowerCase()} options near ${locationPhrase}.`,
      `Use queries like '${actionKeywords} near me', '${scenario.name.toLowerCase()} options', and '${titleFromScenario(scenario).toLowerCase()} local resources'.`,
      "Shortlist only options that match the stated constraints, budget, timing, level fit, and repeatability needs.",
      "Success: three candidates are saved or one fit-check/contact message is sent today.",
      "If none fit, widen the radius once or contact one relevant local organization to ask where people usually start.",
      "Do not treat any local/current option as verified until checked.",
    ].join(" ");
  }

  if (scenario.expected.urgentStability) {
    return [
      `Today, ${actionKeywords} using the most direct contact path available.`,
      "Write down the deadline, account/document details, who was contacted, and the next promised callback or step.",
      "Success: one urgent contact is reached or a callback/request is submitted.",
      "If blocked, ask one trusted person or local resource line to help make the next call.",
    ].join(" ");
  }

  return [
    `This week, ${actionKeywords} with one bounded first step.`,
    "Keep the move small enough to finish without opening a full research project.",
    "Success: one concrete step is completed and the next decision is clearer.",
    "If blocked, choose the lowest-commitment version that still tests the same path.",
  ].join(" ");
}

function makeAntiOverfitMockOutput(scenario: EvalScenario): EvalOutput {
  const labels =
    scenario.expected.branchKeywordGroups?.map(labelFromKeywordGroup) ??
    ["Practical first path", "Lower-friction alternative", "Defer until clearer"];
  const recommendedOptionId = recommendedOptionIdForScenario(scenario, labels);
  const currentAction = action(
    scenario.expected.requiresSearchWorkflowAction
      ? `Search and shortlist ${titleFromScenario(scenario).toLowerCase()} options`
      : scenario.expected.urgentStability
        ? `Reduce immediate risk for ${titleFromScenario(scenario).toLowerCase()}`
        : `Take one concrete step for ${titleFromScenario(scenario).toLowerCase()}`,
    actionDetailsForScenario(scenario),
    {
      success_condition: scenario.expected.requiresSearchWorkflowAction
        ? "Three candidates are saved or one fit-check/contact message is sent today."
        : scenario.expected.urgentStability
          ? "One urgent contact is reached or one time-sensitive request is submitted today."
          : "One concrete step is completed and the next decision is clearer.",
      fallback: scenario.expected.requiresSearchWorkflowAction
        ? "If no option fits, widen the radius once or ask one relevant local organization where people usually start."
        : scenario.expected.urgentStability
          ? "If blocked, ask one trusted person or local resource line to help make the next call."
          : "If blocked, choose the lowest-commitment version that still tests the same path.",
    },
  );
  const tree = decisionTree({
    id: `anti-overfit-${scenario.id}`,
    rootQuestion: `Which ${titleFromScenario(scenario).toLowerCase()} path should come first?`,
    rootSummary: scenario.description,
    recommendedOptionId,
    currentAction,
    options: labels.map((label, index) =>
      option(
        "root",
        `option_${index}`,
        label,
        index === Number(recommendedOptionId.replace("option_", ""))
          ? `Recommended because it prioritizes ${(scenario.expected.recommendedBranchKeywords ?? [label]).join(" ")} while respecting the fixture constraints.`
          : `A user-facing option for ${scenario.name}; it reflects the fixture constraints without using developer-specific assumptions.`,
        index === Number(recommendedOptionId.replace("option_", ""))
          ? "recommended"
          : index === labels.length - 1
            ? "supplement"
            : "viable",
        {
          search_status: scenario.expected.requiresSearchWorkflowAction ? "needed" : "not_needed",
          requires_web_search: Boolean(scenario.expected.requiresSearchWorkflowAction),
          first_action: currentAction,
        },
      ),
    ),
  });

  return {
    scenarioId: scenario.id,
    boardTitle: titleFromScenario(scenario),
    primaryDomain: scenario.expected.primaryDomain,
    secondaryDomains: scenario.expected.secondaryDomains ?? [],
    boardState: {
      currentPosition: scenario.userInputs.join(" "),
      goal: scenario.expected.goalKeywords?.join(" ") || scenario.userInputs[0] || scenario.name,
      constraints: scenario.expected.constraintKeywords ?? [],
      assets: scenario.expected.assetKeywords ?? ["The user has enough context to choose a first path"],
      assumptions: scenario.expected.requiresSearchWorkflowAction
        ? ["Local/current details need verification before acting."]
        : ["The first move should be bounded and reversible."],
    },
    decisionTree: tree,
    safetyMode: scenario.expected.urgentStability ? "urgent_stability" : undefined,
    webSearchCallCount: 0,
    notes: "Deterministic anti-overfit mock output.",
  };
}

const antiOverfitMockOutputs = Object.fromEntries(
  antiOverfitScenarios.map((scenario) => [scenario.id, makeAntiOverfitMockOutput(scenario)]),
) as Record<string, EvalOutput>;

export const mockOutputsByScenarioId: Record<string, EvalOutput> = {
  tennis_local_community: {
    scenarioId: "tennis_local_community",
    boardTitle: "Use tennis to build local community",
    primaryDomain: "craft_creativity_mastery",
    secondaryDomains: ["people_community_belonging"],
    boardState: {
      currentPosition:
        "The user is a tennis beginner near Bed-Stuy / 11216 and wants tennis to create local community.",
      goal: "Start playing tennis while meeting people nearby.",
      constraints: ["Beginner skill level", "Bed-Stuy / 11216 location", "Avoid intense competitive games"],
      assets: ["Interest in tennis", "Willingness to contact a recurring beginner option"],
      assumptions: ["A recurring beginner option exists nearby but is not verified yet"],
    },
    decisionTree: tennisTree,
    branchExpansion,
    webSearchCallCount: 0,
  },
  yoga_social_connection: {
    scenarioId: "yoga_social_connection",
    boardTitle: "Meet people through beginner-friendly yoga",
    primaryDomain: "people_community_belonging",
    secondaryDomains: ["craft_creativity_mastery"],
    boardState: {
      currentPosition:
        "The user wants social connection through yoga and prefers beginner-friendly, low-pressure settings.",
      goal: "Meet people through yoga.",
      constraints: ["Shy", "Beginner-friendly needed"],
      assets: ["Interested in a recurring class"],
      assumptions: ["Recurring exposure will be easier than one-off events"],
    },
    decisionTree: yogaTree,
    webSearchCallCount: 0,
  },
  acting_class_brooklyn: {
    scenarioId: "acting_class_brooklyn",
    boardTitle: "Find an acting class in Brooklyn",
    primaryDomain: "people_community_belonging",
    secondaryDomains: ["craft_creativity_mastery"],
    boardState: {
      currentPosition:
        "The user wants an advanced acting class near Bed-Stuy or nearby Brooklyn, is open on evenings or weekends, has no price constraint, and is especially interested in improv.",
      goal: "Find a Brooklyn acting class that also creates a creative social setting.",
      constraints: ["Advanced level", "Bed-Stuy or nearby Brooklyn", "Improv preferred"],
      assets: ["Flexible schedule", "No price constraint", "Clear interest in improv"],
      assumptions: ["Level fit should be confirmed before enrolling"],
    },
    decisionTree: actingTree,
    webSearchCallCount: 1,
  },
  career_no_cold_application_traction: {
    scenarioId: "career_no_cold_application_traction",
    boardTitle: "Recover traction after cold applications stalled",
    primaryDomain: "work_money_career",
    secondaryDomains: [],
    boardState: {
      currentPosition:
        "Cold LinkedIn applications have not produced interviews.",
      goal: "Find a better path to income or opportunity.",
      constraints: ["Many LinkedIn applications", "No interviews"],
      assets: ["Can use context, proof, and specific outreach"],
      assumptions: ["Cold applications are currently low-yield"],
    },
    decisionTree: careerTree,
    webSearchCallCount: 0,
  },
  first_time_entrepreneur: {
    scenarioId: "first_time_entrepreneur",
    boardTitle: "Validate the idea before building",
    primaryDomain: "work_money_career",
    secondaryDomains: [],
    boardState: {
      currentPosition:
        "The user has a software idea and coding ability, but no customer proof.",
      goal: "Validate the idea before building too much.",
      constraints: ["No customers yet"],
      assets: ["Can code", "Has a product idea"],
      assumptions: ["Customer proof is more valuable than product scope right now"],
    },
    decisionTree: entrepreneurTree,
    webSearchCallCount: 0,
  },
  creative_professionalization_too_early: {
    scenarioId: "creative_professionalization_too_early",
    boardTitle: "Build a writing feedback loop before paid work",
    primaryDomain: "craft_creativity_mastery",
    secondaryDomains: ["work_money_career"],
    boardState: {
      currentPosition:
        "The user wants paid writing eventually but lacks finished work and feedback.",
      goal: "Move toward paid writing without skipping prerequisites.",
      constraints: ["Few finished pieces", "Limited feedback"],
      assets: ["Wants to keep the professional goal alive"],
      assumptions: ["Professionalization is possible later if proof improves"],
    },
    decisionTree: creativeTree,
    webSearchCallCount: 0,
  },
  community_not_dating: {
    scenarioId: "community_not_dating",
    boardTitle: "Build friendship and community, not dating",
    primaryDomain: "people_community_belonging",
    secondaryDomains: [],
    boardState: {
      currentPosition:
        "The user wants friends and community and explicitly does not want dating.",
      goal: "Create regular real-world connection.",
      constraints: ["Not trying to date"],
      assets: ["Open to activities and community"],
      assumptions: ["Recurring environments are better than one-off social attempts"],
    },
    decisionTree: communityTree,
    webSearchCallCount: 0,
  },
  rural_community_constraint: {
    scenarioId: "rural_community_constraint",
    boardTitle: "Build rural community with a weekly drive",
    primaryDomain: "people_community_belonging",
    secondaryDomains: [],
    boardState: {
      currentPosition:
        "The user lives rurally with limited nearby options but can drive 30 minutes once a week.",
      goal: "Find a realistic community path despite rural density.",
      constraints: ["Rural area", "30-minute drive once a week"],
      assets: ["Can travel weekly"],
      assumptions: ["Local/current options need verification"],
    },
    decisionTree: ruralTree,
    webSearchCallCount: 0,
  },
  urgent_eviction_pressure: {
    scenarioId: "urgent_eviction_pressure",
    boardTitle: "Reduce urgent housing risk",
    primaryDomain: "work_money_career",
    secondaryDomains: [],
    boardState: {
      currentPosition:
        "The user may face eviction next week and needs immediate risk reduction.",
      goal: "Reduce housing instability risk now.",
      constraints: ["Possible eviction next week", "Needs urgent support"],
      assets: ["Can contact support resources"],
      assumptions: ["Local support details need verification"],
    },
    decisionTree: urgentTree,
    safetyMode: "urgent_stability",
    webSearchCallCount: 0,
  },
  urgent_court_deadline_production_regression: {
    scenarioId: "urgent_court_deadline_production_regression",
    boardTitle: "Court paperwork deadline triage",
    primaryDomain: "work_money_career",
    secondaryDomains: [],
    boardState: {
      currentPosition:
        "The user has a court paperwork deadline in a few days, does not know the exact deadline/court yet, and has the notice somewhere in the apartment.",
      goal: "Avoid missing the deadline by confirming the paperwork due, process contacts, and document facts.",
      constraints: [
        "Deadline in a few days",
        "Does not want legal argument advice",
        "Exact court/deadline not known yet",
      ],
      assets: ["Notice is somewhere in the apartment", "Can call clerk or legal aid intake"],
      assumptions: ["Court/legal-aid process details are not verified by search"],
    },
    decisionTree: courtDeadlineTree,
    branchExpansion: courtDeadlineBranchExpansion,
    safetyMode: "urgent_stability",
    webSearchCallCount: 0,
  },
  memory_correction_private_writing: {
    scenarioId: "memory_correction_private_writing",
    boardTitle: "Keep writing private for now",
    primaryDomain: "craft_creativity_mastery",
    secondaryDomains: [],
    boardState: {
      currentPosition:
        "The user corrected FlowPath: writing should be private and non-commercial for now.",
      goal: "Keep writing private for now.",
      constraints: ["Do not professionalize writing"],
      assets: ["Writing practice can still continue privately"],
      assumptions: [],
    },
    reconciliation: privateWritingReconciliation,
    memoryItems: [
      {
        id: "memory_monetize_writing",
        label: "Monetize writing",
        value: "The user wants to monetize writing.",
        status: "stale",
      },
      {
        id: "memory_private_writing",
        label: "Writing privacy",
        value: "The user wants to keep writing private and non-commercial for now.",
        status: "active",
      },
    ],
    webSearchCallCount: 0,
  },
  board_update_weekends_only: {
    scenarioId: "board_update_weekends_only",
    boardTitle: "Find a weekend-friendly path",
    primaryDomain: "people_community_belonging",
    secondaryDomains: [],
    boardState: {
      currentPosition:
        "The board must fit weekend-only availability.",
      goal: "Find a weekend-compatible path.",
      constraints: ["Weekends only"],
      assets: ["Can act on weekends"],
      assumptions: [],
    },
    reconciliation: weekendReconciliation,
    memoryItems: [
      {
        id: "memory_weekends",
        label: "Weekend availability",
        value: "The user can only do board-related actions on weekends right now.",
        status: "active",
      },
      {
        id: "memory_weekdays",
        label: "Weekday availability",
        value: "The user can attend weekday sessions.",
        status: "stale",
      },
    ],
    webSearchCallCount: 0,
  },
  ...antiOverfitMockOutputs,
};

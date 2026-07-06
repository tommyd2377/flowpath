import { z } from "zod";

import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { canUseWebSearchForTier } from "@/lib/billing/plans";
import { canUseFeature, incrementUsage } from "@/lib/billing/usage";
import { getBoard, listTasksForBoard } from "@/lib/boards";
import {
  buildCognitivePlanContext,
  compactProfileForMemorySelection,
} from "@/lib/cognitive-operating-layer";
import {
  attachBranchExpansionToTree,
  decisionTreeTrace,
  expandDecisionTreeAtOption,
  findDecisionOptionInNode,
  getDecisionNode,
} from "@/lib/decision-tree";
import {
  generateBranchExpansion,
  isModelBackedBranchExpansionEnabled,
} from "@/lib/flowpath-ai";
import {
  sanitizeGenerationError,
  webSearchDecisionReason as reasonForWebSearchDecision,
} from "@/lib/generation-observability";
import { buildIntakeRoutingMetadata } from "@/lib/intake";
import { isQaRequest } from "@/lib/qa-mode";
import {
  completeGenerationEvent,
  createOutcomeHarnessEvent,
  getLatestNextMovePlan,
  getLatestIntakeSession,
  getNextMovePlan,
  getProfile,
  listInferredContextItems,
  listIntakeMessages,
  listNextMovePlans,
  startGenerationEvent,
  updateNextMovePlanDecisionTree,
} from "@/lib/repository";
import type { WebSearchDecisionReason } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const expandMoveMapSchema = z.object({
  plan_id: z.number().int().positive().optional(),
  current_node_id: z.string().trim().min(1).max(120),
  selected_option_id: z.string().trim().min(1).max(120),
  selected_path: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
});

function expansionMessageText({
  boardTitle,
  boardDescription,
  nodeQuestion,
  optionLabel,
  optionDescription,
  optionWhy,
}: {
  boardTitle: string;
  boardDescription?: string | null;
  nodeQuestion: string;
  optionLabel: string;
  optionDescription: string;
  optionWhy: string;
}) {
  return [
    boardTitle,
    boardDescription,
    nodeQuestion,
    optionLabel,
    optionDescription,
    optionWhy,
  ]
    .filter(Boolean)
    .join(" ");
}

function selectedPathLabels(
  tree: Parameters<typeof decisionTreeTrace>[0],
  selectedPath: string[],
) {
  return decisionTreeTrace(tree, selectedPath).flatMap((item) =>
    item.selectedOption ? [item.selectedOption.label] : [],
  );
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const boardId = parseId(idParam);
    const board = await getBoard(user.id, boardId);
    if (!board) throw new ApiRequestError("Board not found.", 404, "not_found");

    const input = expandMoveMapSchema.parse(await readJson(request));
    const plan = input.plan_id
      ? await getNextMovePlan(user.id, input.plan_id)
      : await getLatestNextMovePlan(user.id, boardId, { isQa: isQaRequest(request) });
    if (!plan || plan.situation_id !== boardId) {
      throw new ApiRequestError("Move map not found.", 404, "not_found");
    }

    const node = getDecisionNode(plan.decision_tree, input.current_node_id);
    const option = findDecisionOptionInNode(node, input.selected_option_id);
    if (!node || !option) {
      throw new ApiRequestError(
        "That path is no longer available. Recalculate this board and try again.",
        400,
        "invalid_move_map_path",
      );
    }

    const previousChildNodeId = option.next_node_id;
    let generatedBy: "existing_child" | "model_backed" | "deterministic_fallback" =
      previousChildNodeId ? "existing_child" : "deterministic_fallback";
    let modelUsed: string | null = null;
    let modelRole: string | null = null;
    let webSearchCallCount = 0;
    let webSearchDecisionReason: WebSearchDecisionReason = "not_needed";
    let expandedTree =
      previousChildNodeId && getDecisionNode(plan.decision_tree, previousChildNodeId)
        ? expandDecisionTreeAtOption({
            tree: plan.decision_tree,
            nodeId: node.id,
            optionId: option.id,
            selectedPath: input.selected_path,
          })
        : null;

    if (
      !expandedTree &&
      isModelBackedBranchExpansionEnabled() &&
      process.env.OPENAI_API_KEY
    ) {
      const usageDecision = await canUseFeature(user.id, "lightweight_assist");
      if (usageDecision.allowed) {
        const clientGenerationId = `server-move-map-expansion-${crypto.randomUUID()}`;
        const expansionText = expansionMessageText({
          boardTitle: board.title,
          boardDescription: board.description,
          nodeQuestion: node.question,
          optionLabel: option.label,
          optionDescription: option.description,
          optionWhy: option.why,
        });
        const session = await getLatestIntakeSession(user.id, boardId);
        const [profile, inferredContextItems, messages, tasks, recentPlans] =
          await Promise.all([
            getProfile(user.id),
            listInferredContextItems(user.id, { isQa: isQaRequest(request) }),
            session ? listIntakeMessages(user.id, session.id) : Promise.resolve([]),
            listTasksForBoard(user.id, boardId, { isQa: isQaRequest(request) }),
            listNextMovePlans(user.id, 3, boardId, { isQa: isQaRequest(request) }),
          ]);
        const cognitiveContext = buildCognitivePlanContext({
          userMessage: expansionText,
          situation: board,
          messages,
          profile,
          inferredContextItems,
          openTasks: tasks.filter((task) => task.status === "open"),
          recentPlans,
          allowWebSearch: canUseWebSearchForTier(usageDecision.planTier),
        });
        const compactProfile = compactProfileForMemorySelection(
          profile,
          cognitiveContext.memorySelection,
        );
        webSearchDecisionReason = reasonForWebSearchDecision(
          cognitiveContext.webSearchDecision,
          canUseWebSearchForTier(usageDecision.planTier),
        );

        try {
          await startGenerationEvent(user.id, {
            client_generation_id: clientGenerationId,
            generation_type: "operator_plan",
            situation_id: boardId,
            plan_id: plan.id,
            flow_type: "move_map_expansion",
            flow_status: "running",
            quota_tier: usageDecision.planTier,
            quota_usage_type: "lightweight_assist",
            web_search_decision_reason: webSearchDecisionReason,
            structural_counts: {
              node_count: plan.decision_tree.nodes.length,
              selected_path_depth: input.selected_path.length,
              memory_items_selected:
                cognitiveContext.memorySelection.selected_memories.length,
            },
            is_qa: isQaRequest(request),
          });
          const generated = await generateBranchExpansion(
            {
              date: new Date().toISOString(),
              board: {
                id: board.id,
                title: board.title,
                description: board.description,
                category: board.category,
                status: board.status,
                urgency: board.urgency,
              },
              plan: {
                id: plan.id,
                situation_read: plan.situation_read,
                situation_summary: plan.situation_summary,
                key_constraints: plan.key_constraints,
                highest_leverage_move_today: plan.highest_leverage_move_today,
                operator_insight: plan.operator_insight,
                likely_trap: plan.likely_trap,
                local_reality_scout: plan.local_reality_scout,
                assumptions: plan.assumptions,
              },
              current_node: node,
              selected_option: option,
              selected_path: input.selected_path,
              selected_path_labels: selectedPathLabels(plan.decision_tree, [
                ...input.selected_path,
                option.id,
              ]),
              decision_tree_summary: {
                root_node_id: plan.decision_tree.root_node_id,
                active_node_id: plan.decision_tree.active_node_id,
                recommended_option_id: plan.decision_tree.recommended_option_id,
                node_count: plan.decision_tree.nodes.length,
                existing_branch_labels: plan.decision_tree.nodes.flatMap((item) =>
                  item.options.map((candidate) => candidate.label),
                ),
              },
              intake_summary: {
                session_summary: session?.summary_so_far ?? "",
                recent_messages: messages.slice(-8).map((message) => ({
                  role: message.role,
                  content: message.content,
                })),
              },
              relevant_memory: [
                compactProfile,
                ...cognitiveContext.memorySelection.selected_memories,
              ].filter(Boolean),
              open_tasks: tasks
                .filter((task) => task.status === "open")
                .slice(0, 8)
                .map((task) => ({
                  title: task.title,
                  status: task.status,
                  source_plan_section: task.source_plan_section ?? null,
                })),
              cognitive_operating_layer: {
                state_detection: cognitiveContext.stateDetection,
                intervention: cognitiveContext.intervention,
                selected_memory: cognitiveContext.memorySelection,
                web_search_decision: cognitiveContext.webSearchDecision,
              },
              search_context: {
                allow_web_search: canUseWebSearchForTier(usageDecision.planTier),
                search_decision_reason: webSearchDecisionReason,
                actual_search_results_provided: false,
              },
            },
            {
              allowWebSearch: canUseWebSearchForTier(usageDecision.planTier),
            },
          );
          expandedTree = attachBranchExpansionToTree({
            tree: plan.decision_tree,
            nodeId: node.id,
            optionId: option.id,
            selectedPath: input.selected_path,
            expansion: generated.expansion,
            webSearchCallCount: generated.webSearchCallCount,
          });
          generatedBy = "model_backed";
          modelUsed = generated.model;
          modelRole = generated.modelRole;
          webSearchCallCount = generated.webSearchCallCount;
          webSearchDecisionReason = generated.webSearchDecisionReason;
          await incrementUsage(user.id, "lightweight_assist", generated.usage);
          await completeGenerationEvent(user.id, clientGenerationId, {
            status: "success",
            flowStatus: "success",
            planId: plan.id,
            model: generated.model,
            modelRole: generated.modelRole,
            inputTokens: generated.usage.inputTokens,
            cachedInputTokens: generated.usage.cachedInputTokens,
            outputTokens: generated.usage.outputTokens,
            totalTokens: generated.usage.totalTokens,
            estimatedCostUsd: generated.usage.estimatedCostUsd,
            memoryItemsUsed:
              cognitiveContext.memorySelection.selected_memories.length,
            webSearchUsed: generated.webSearchCallCount > 0,
            webSearchCallCount: generated.webSearchCallCount,
            webSearchDecisionReason: generated.webSearchDecisionReason,
            quotaTier: usageDecision.planTier,
            quotaUsageType: "lightweight_assist",
            structuralCounts: {
              node_count: expandedTree.nodes.length,
              result_kind: getDecisionNode(
                expandedTree,
                findDecisionOptionInNode(
                  getDecisionNode(expandedTree, node.id),
                  option.id,
                )?.next_node_id,
              )?.kind ?? null,
            },
          });
        } catch (generationError) {
          const sanitized = sanitizeGenerationError(generationError);
          console.warn("Model-backed move map expansion failed; using fallback", sanitized);
          await completeGenerationEvent(user.id, clientGenerationId, {
            status: "error",
            flowStatus: "error",
            planId: plan.id,
            errorCategory: sanitized.errorCategory,
            errorMessageSanitized: sanitized.errorMessageSanitized,
            quotaTier: usageDecision.planTier,
            quotaUsageType: "lightweight_assist",
          }).catch(() => undefined);
        }
      }
    }

    if (!expandedTree) {
      expandedTree = expandDecisionTreeAtOption({
        tree: plan.decision_tree,
        nodeId: node.id,
        optionId: option.id,
        selectedPath: input.selected_path,
      });
    }

    const updated = await updateNextMovePlanDecisionTree(
      user.id,
      plan.id,
      expandedTree,
    );
    if (!updated) {
      throw new ApiRequestError("Could not update move map.", 500, "move_map_update_failed");
    }

    const expandedOption = findDecisionOptionInNode(
      getDecisionNode(updated.decision_tree, node.id),
      option.id,
    );
    const childNode = getDecisionNode(updated.decision_tree, expandedOption?.next_node_id);
    const intakeRouting = buildIntakeRoutingMetadata(board);
    try {
      await createOutcomeHarnessEvent(user.id, {
        situationId: boardId,
        conversationId: String(boardId),
        planId: plan.id,
        eventType:
          childNode?.kind === "action"
            ? "move_map_action_leaf_reached"
            : "move_map_branch_expanded",
        source: "move_map",
        domain: intakeRouting.domain,
        subtype: intakeRouting.subtype,
        questionPurpose: intakeRouting.questionPurpose,
        metadata: {
          currentNodeId: node.id,
          selectedOptionId: option.id,
          selectedOptionLabel: option.label,
          previousChildNodeId,
          childNodeId: childNode?.id ?? null,
          childKind: childNode?.kind ?? null,
          generatedBy,
          model: modelUsed,
          modelRole,
          webSearchCallCount,
          webSearchDecisionReason,
        },
        dedupeKey: `move-map-expanded:${plan.id}:${node.id}:${option.id}:${childNode?.id ?? "existing"}`,
        isQa: isQaRequest(request),
      });
    } catch (eventError) {
      console.warn("Move map expansion telemetry failed", eventError);
    }

    return dataResponse({
      plan: updated,
      decision_tree: updated.decision_tree,
      expanded_node: childNode,
    });
  } catch (error) {
    return errorResponse(error, "Could not continue this path.");
  }
}

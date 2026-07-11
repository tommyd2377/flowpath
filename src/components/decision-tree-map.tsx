"use client";

import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  MapPinned,
  Pencil,
  Search,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  branchSelectionCaution,
  decisionTreeTrace,
  findDecisionOptionInNode,
  getDecisionNode,
  type DecisionBranchCaution,
} from "@/lib/decision-tree";
import type {
  DecisionNode,
  DecisionOption,
  DecisionRecommendationLevel,
  DecisionSearchStatus,
  DecisionTree,
  Task,
} from "@/lib/types";
import { Button } from "./ui";

type DecisionTreeMapProps = {
  boardTitle: string;
  boardMeta: string;
  tree: DecisionTree;
  selectedPath: string[];
  onSelect: (nodeId: string, optionId: string) => void;
  branchTask: Task | null;
  relatedTaskCount: number;
  actioning: "accept" | "complete" | null;
  exploringNodeId: string | null;
  onChoosePath: () => void;
  onComplete: () => void;
  onExplore: (nodeId: string, optionId: string) => void;
  onBlocked: () => void;
  onChangeAction: () => void;
};

const recommendationLabels: Record<DecisionRecommendationLevel, string> = {
  recommended: "Recommended",
  viable: "Viable",
  supplement: "Supplement",
  not_now: "Not now",
  risky: "Risky",
};

const searchLabels: Record<DecisionSearchStatus, string> = {
  not_needed: "Search not needed",
  needed: "Search needed",
  searched: "Search used",
  unavailable: "Search unavailable",
  failed: "Search failed",
};

export function DecisionTreeMap({
  boardTitle,
  boardMeta,
  tree,
  selectedPath,
  onSelect,
  branchTask,
  relatedTaskCount,
  actioning,
  exploringNodeId,
  onChoosePath,
  onComplete,
  onExplore,
  onBlocked,
  onChangeAction,
}: DecisionTreeMapProps) {
  const root = getDecisionNode(tree, tree.root_node_id) ?? tree.nodes[0];
  const trace = decisionTreeTrace(tree, selectedPath);
  const traceByNodeId = new Map(trace.map((item) => [item.node.id, item]));

  if (!root) return null;

  return (
    <section
      data-testid="MoveMap"
      className="rounded-lg border border-slate-800 bg-slate-950/55 p-2.5 sm:p-3"
    >
      <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <MapPinned className="h-4 w-4 shrink-0 text-[var(--azure-light)]" />
            <h2 className="truncate text-lg font-semibold text-white sm:text-xl">
              {boardTitle}
            </h2>
          </div>
          <div className="sr-only">{boardMeta}</div>
        </div>
      </div>

      <div className="min-h-[520px] overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/70 p-5 text-slate-200 shadow-[inset_0_1px_0_rgba(148,163,184,0.08)] sm:p-7">
        <DecisionNodeView
          node={root}
          rootLabel={boardTitle}
          tree={tree}
          traceByNodeId={traceByNodeId}
          depth={0}
          branchTask={branchTask}
          relatedTaskCount={relatedTaskCount}
          actioning={actioning}
          exploringNodeId={exploringNodeId}
          onSelect={onSelect}
          onChoosePath={onChoosePath}
          onComplete={onComplete}
          onExplore={onExplore}
          onBlocked={onBlocked}
          onChangeAction={onChangeAction}
        />
      </div>
    </section>
  );
}

function DecisionNodeView({
  node,
  rootLabel,
  tree,
  traceByNodeId,
  depth,
  branchTask,
  relatedTaskCount,
  actioning,
  exploringNodeId,
  onSelect,
  onChoosePath,
  onComplete,
  onExplore,
  onBlocked,
  onChangeAction,
}: {
  node: DecisionNode;
  rootLabel: string;
  tree: DecisionTree;
  traceByNodeId: Map<string, ReturnType<typeof decisionTreeTrace>[number]>;
  depth: number;
  branchTask: Task | null;
  relatedTaskCount: number;
  actioning: "accept" | "complete" | null;
  exploringNodeId: string | null;
  onSelect: (nodeId: string, optionId: string) => void;
  onChoosePath: () => void;
  onComplete: () => void;
  onExplore: (nodeId: string, optionId: string) => void;
  onBlocked: () => void;
  onChangeAction: () => void;
}) {
  if (node.kind === "action") {
    return (
      <div className="min-w-0 lg:w-[280px] lg:shrink-0">
        <ActionLeaf
          node={node}
          branchTask={branchTask}
          relatedTaskCount={relatedTaskCount}
          actioning={actioning}
          onComplete={onComplete}
          onBlocked={onBlocked}
          onChangeAction={onChangeAction}
        />
      </div>
    );
  }

  const traceItem = traceByNodeId.get(node.id);
  const selectedOption =
    traceItem?.selectedOption ??
    findDecisionOptionInNode(node, node.selected_option_id) ??
    node.options[0] ??
    null;
  const selectedChildNode = selectedOption?.next_node_id
    ? getDecisionNode(tree, selectedOption.next_node_id)
    : null;
  const nodeLabel =
    depth === 0
      ? rootLabel
      : traceItem?.selectedOption?.label || node.title || "Next paths";

  return (
    <div className="flex min-w-max flex-col gap-3 lg:flex-row lg:items-center lg:gap-0">
      {depth === 0 ? (
        <DiagramNode depth={depth} label={nodeLabel} />
      ) : null}

      {depth === 0 ? <HorizontalConnector selected /> : null}

      <div className="relative grid min-w-[260px] gap-3 pl-8">
        <span
          aria-hidden="true"
          className="absolute bottom-5 left-0 top-5 w-px bg-slate-700"
        />
        {node.options.map((option) => {
          const selected = option.id === selectedOption?.id;
          const caution = selected ? branchSelectionCaution(tree, option) : null;
          return (
            <div
              key={option.id}
              className="flex min-w-max flex-col gap-3 lg:flex-row lg:items-center lg:gap-0"
            >
              <BranchPath
                option={option}
                selected={selected}
                recommended={option.id === tree.recommended_option_id}
                userSelected={
                  selected &&
                  depth === 0 &&
                  option.id !== tree.recommended_option_id
                }
                onSelect={() => onSelect(node.id, option.id)}
              />

              {selected ? <HorizontalConnector selected /> : null}

              {selected && selectedChildNode ? (
                <DecisionNodeView
                  node={selectedChildNode}
                  rootLabel={rootLabel}
                  tree={tree}
                  traceByNodeId={traceByNodeId}
                  depth={depth + 1}
                  branchTask={branchTask}
                  relatedTaskCount={relatedTaskCount}
                  actioning={actioning}
                  exploringNodeId={exploringNodeId}
                  onSelect={onSelect}
                  onChoosePath={onChoosePath}
                  onComplete={onComplete}
                  onExplore={onExplore}
                  onBlocked={onBlocked}
                  onChangeAction={onChangeAction}
                />
              ) : null}

              {selected && !selectedChildNode ? (
                <div className="min-w-0 lg:w-[270px] lg:shrink-0">
                  <ExplorePath
                    option={option}
                    nodeId={node.id}
                    exploring={exploringNodeId === node.id}
                    caution={caution}
                    onChoosePath={onChoosePath}
                    onExplore={onExplore}
                    onReturnToRecommended={
                      caution?.recommendedOptionId && depth === 0
                        ? () => onSelect(tree.root_node_id, caution.recommendedOptionId!)
                        : undefined
                    }
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BranchPath({
  option,
  selected,
  recommended,
  userSelected,
  onSelect,
}: {
  option: DecisionOption;
  selected: boolean;
  recommended: boolean;
  userSelected: boolean;
  onSelect: () => void;
}) {
  const subdued = !selected && !recommended;
  const nodeClass = selected
    ? "border-[rgba(0,120,212,0.9)] bg-[rgba(0,120,212,0.18)] shadow-[0_0_24px_rgba(0,120,212,0.16)]"
    : recommended
      ? "border-[rgba(0,120,212,0.55)] bg-slate-900/90"
      : "border-slate-800 bg-slate-900/75";

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`group relative w-[240px] rounded-lg border px-3 py-2.5 text-left transition focus:outline-none focus:ring-2 focus:ring-[rgba(0,120,212,0.35)] ${nodeClass} ${
        subdued ? "opacity-55" : "opacity-100"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute -left-8 top-1/2 h-px w-8 -translate-y-1/2 ${
          selected ? "bg-[var(--azure)]" : "bg-slate-700"
        }`}
      />
      <span
        aria-hidden="true"
        className={`absolute -left-[5px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border ${
          selected
            ? "border-[var(--azure)] bg-[var(--azure)]"
            : "border-slate-600 bg-slate-950"
        }`}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium leading-5 text-slate-100">
            {option.label}
          </span>
        {recommended ? (
          <span className="rounded-full border border-[rgba(0,120,212,0.65)] bg-[rgba(0,120,212,0.18)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-100">
            Recommended
          </span>
        ) : null}
        {userSelected ? (
          <span className="rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-200">
            Alternate path
          </span>
        ) : null}
        {selected && !userSelected ? (
          <span className="rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-200">
            Selected
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
        <span>{recommendationLabels[option.recommendation_level]}</span>
        <span>/</span>
        <span>{option.time_to_feedback}</span>
        {option.search_status !== "not_needed" ? (
          <>
            <span>/</span>
            <span>{searchLabels[option.search_status]}</span>
          </>
        ) : null}
      </div>
    </button>
  );
}

function ExplorePath({
  option,
  nodeId,
  exploring,
  caution,
  onChoosePath,
  onExplore,
  onReturnToRecommended,
}: {
  option: DecisionOption;
  nodeId: string;
  exploring: boolean;
  caution: DecisionBranchCaution | null;
  onChoosePath: () => void;
  onExplore: (nodeId: string, optionId: string) => void;
  onReturnToRecommended?: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-xs shadow-sm">
      <div className="mb-2 font-medium text-slate-100">Continue from this path</div>
      {caution ? (
        <div
          role="status"
          className="mb-2 rounded-md border border-amber-800/70 bg-amber-950/35 p-2 text-amber-100"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <div className="font-medium text-amber-50">Check before continuing</div>
              <p className="mt-0.5 leading-5">{caution.message}</p>
              {onReturnToRecommended ? (
                <button
                  type="button"
                  onClick={onReturnToRecommended}
                  className="mt-1 font-medium text-amber-50 underline decoration-amber-200/60 underline-offset-2 hover:text-white"
                >
                  Return to recommended path
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <p className="mb-2 leading-5 text-slate-400">
        Extend this line only when you want to continue down this path.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant="secondary"
          onClick={() => onExplore(nodeId, option.id)}
          disabled={exploring || !option.can_explore}
          className="min-h-8 px-2 text-xs"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {exploring ? "Continuing..." : "Continue this path"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onChoosePath}
          className="min-h-8 px-2 text-xs"
        >
          Choose this path
        </Button>
      </div>
      {option.search_status !== "not_needed" && option.search_status !== "searched" ? (
        <div className="mt-2 rounded-md border border-amber-900/70 bg-amber-950/35 p-2 text-amber-100">
          Local/current options are not verified yet. Continuing this path is the
          explicit search or generation boundary.
        </div>
      ) : null}
    </div>
  );
}

function ActionLeaf({
  node,
  branchTask,
  relatedTaskCount,
  actioning,
  onComplete,
  onBlocked,
  onChangeAction,
}: {
  node: DecisionNode;
  branchTask: Task | null;
  relatedTaskCount: number;
  actioning: "accept" | "complete" | null;
  onComplete: () => void;
  onBlocked: () => void;
  onChangeAction: () => void;
}) {
  const action = node.action;
  if (!action) return null;

  return (
    <div className="relative w-full rounded-l-lg border border-[rgba(0,120,212,0.75)] bg-[rgba(0,120,212,0.16)] px-4 py-3 pr-7 text-sm text-slate-100 shadow-[0_0_28px_rgba(0,120,212,0.14)]">
      <span
        aria-hidden="true"
        className="absolute -left-8 top-1/2 h-px w-8 -translate-y-1/2 bg-slate-400"
      />
      <span
        aria-hidden="true"
        className="absolute -right-7 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[34px] border-l-[28px] border-y-transparent border-l-[rgba(0,120,212,0.75)]"
      />
      <span
        aria-hidden="true"
        className="absolute -right-6 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[32px] border-l-[26px] border-y-transparent border-l-[#08203b]"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-[rgba(0,120,212,0.65)] bg-[rgba(0,120,212,0.2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-100">
          Next action
        </span>
        <SearchStatusBadge status={node.search_status} />
      </div>
      <div className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        {branchTask?.title ?? action.title}
      </div>
      <div className="mt-2 grid gap-2 text-xs leading-5 text-slate-300">
        <p className="text-sm font-semibold leading-6 text-slate-100">
          <span className="font-medium">First action:</span>{" "}
          {action.details}
        </p>
        <p>
          <span className="font-medium text-slate-100">Success:</span>{" "}
          {action.success_condition}
        </p>
        <p>
          <span className="font-medium text-slate-100">If blocked:</span>{" "}
          {action.fallback}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button
          type="button"
          onClick={onComplete}
          disabled={actioning !== null}
          className="min-h-8 px-2 text-xs"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {actioning === "complete" ? "Completing..." : "Mark done"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onBlocked}
          disabled={actioning !== null}
          className="min-h-8 px-2 text-xs"
        >
          <AlertCircle className="h-3.5 w-3.5" />
          I&apos;m blocked
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onChangeAction}
          className="min-h-8 px-2 text-xs"
        >
          <Pencil className="h-3.5 w-3.5" />
          Change this
        </Button>
        <Link href="/tasks">
          <Button type="button" variant="ghost" className="min-h-8 px-2 text-xs">
            <CheckSquare className="h-3.5 w-3.5" />
            Open tasks{relatedTaskCount ? ` (${relatedTaskCount})` : ""}
          </Button>
        </Link>
      </div>
      {node.search_status !== "not_needed" && node.search_status !== "searched" ? (
        <div className="mt-2 rounded-md border border-amber-900/70 bg-amber-950/35 p-2 text-xs text-amber-100">
          This is not locally verified yet. Treat the action as the concrete
          search or contact step.
        </div>
      ) : null}
    </div>
  );
}

function DiagramNode({ depth, label }: { depth: number; label: string }) {
  if (depth === 0) {
    return (
      <div className="flex min-h-24 w-32 shrink-0 items-center justify-center rounded-lg border border-[rgba(0,120,212,0.75)] bg-[var(--azure)] px-3 text-center text-sm font-semibold leading-5 text-white shadow-[0_0_26px_rgba(0,120,212,0.22)] sm:w-36">
        {oneLine(label, 68)}
      </div>
    );
  }

  return (
    <div className="flex w-24 shrink-0 flex-col items-center">
      <div className="h-20 w-20 rounded-full border border-[rgba(0,120,212,0.65)] bg-[rgba(0,120,212,0.82)] shadow-[0_0_24px_rgba(0,120,212,0.18)]" />
      <div className="mt-2 text-center text-xs leading-4 text-slate-400">
        {oneLine(label, 42)}
      </div>
    </div>
  );
}

function HorizontalConnector({ selected }: { selected: boolean }) {
  return (
    <div className="mx-auto h-5 w-px bg-slate-700 lg:mx-0 lg:mt-14 lg:h-px lg:w-12 lg:shrink-0 lg:bg-slate-700">
      <span
        className={`block h-full w-full ${
          selected ? "bg-[var(--azure)]" : "bg-slate-700"
        }`}
      />
    </div>
  );
}

function SearchStatusBadge({ status }: { status: DecisionSearchStatus }) {
  return (
    <Badge>
      <Search className="h-3 w-3" />
      {searchLabels[status]}
    </Badge>
  );
}

function Badge({
  children,
  className = "border-slate-700 bg-slate-900/85 text-slate-300",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex min-h-5 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}

function oneLine(value: string, max = 110) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

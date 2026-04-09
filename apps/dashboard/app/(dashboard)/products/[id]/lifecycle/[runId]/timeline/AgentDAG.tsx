"use client";

import type { AgentRunRecord, AgentStatus } from "./types";

interface Props {
  agents: AgentRunRecord[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}

// Visual config per status
const STATUS_CONFIG: Record<
  AgentStatus,
  {
    bgClass: string;
    borderClass: string;
    textClass: string;
    icon: string;
    pulseClass?: string;
    dotted?: boolean;
  }
> = {
  PENDING: {
    bgClass: "bg-gray-600",
    borderClass: "border-gray-500",
    textClass: "text-gray-400",
    icon: "",
  },
  RUNNING: {
    bgClass: "bg-blue-600",
    borderClass: "border-blue-400",
    textClass: "text-blue-300",
    icon: "",
    pulseClass: "animate-pulse",
  },
  COMPLETED: {
    bgClass: "bg-green-600",
    borderClass: "border-green-500",
    textClass: "text-green-300",
    icon: "✓",
  },
  FAILED: {
    bgClass: "bg-red-600",
    borderClass: "border-red-500",
    textClass: "text-red-300",
    icon: "✗",
  },
  AWAITING_APPROVAL: {
    bgClass: "bg-amber-500",
    borderClass: "border-amber-400",
    textClass: "text-amber-300",
    icon: "⏳",
  },
  SKIPPED: {
    bgClass: "bg-gray-700",
    borderClass: "border-gray-600",
    textClass: "text-gray-500",
    icon: "—",
    dotted: true,
  },
};

// Short label for display inside the node circle
function nodeLabel(agent: AgentRunRecord, index: number): string {
  const cfg = STATUS_CONFIG[agent.status];
  if (cfg.icon) return cfg.icon;
  return String(index + 1);
}

export function AgentDAG({ agents, selectedAgentId, onSelectAgent }: Props) {
  return (
    <div
      className="overflow-x-auto rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)] p-6"
      data-testid="agent-dag"
    >
      {/* Nodes + directional arrows in a horizontal flow */}
      <div className="flex items-center min-w-max">
        {agents.map((agent, i) => {
          const cfg = STATUS_CONFIG[agent.status];
          const isSelected = agent.agentId === selectedAgentId;

          return (
            <div key={agent.agentId} className="flex items-center" data-testid={`dag-node-wrapper-${agent.agentId}`}>
              {/* Node */}
              <button
                onClick={() => onSelectAgent(agent.agentId)}
                className="flex flex-col items-center gap-2 px-1 group"
                data-testid={`dag-node-${agent.agentId}`}
                title={`${agent.agentName} — ${agent.status}`}
              >
                {/* Circle */}
                <div
                  className={[
                    "flex h-11 w-11 items-center justify-center rounded-full border-2 text-sm font-bold text-white transition-all",
                    cfg.bgClass,
                    cfg.dotted
                      ? "border-dashed border-gray-500"
                      : cfg.borderClass,
                    cfg.pulseClass ?? "",
                    isSelected
                      ? "ring-2 ring-white ring-offset-2 ring-offset-[var(--archibald-surface)]"
                      : "group-hover:opacity-80",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {nodeLabel(agent, i)}
                </div>
                {/* Label */}
                <span
                  className={`max-w-[72px] text-center text-[10px] font-medium leading-tight ${cfg.textClass}`}
                >
                  {agent.agentName.replace("Agent", "")}
                </span>
              </button>

              {/* Arrow to next node */}
              {i < agents.length - 1 && (
                <svg
                  width="32"
                  height="16"
                  viewBox="0 0 32 16"
                  className="shrink-0"
                  aria-hidden="true"
                  data-testid={`dag-arrow-${i}`}
                >
                  <line
                    x1="0"
                    y1="8"
                    x2="24"
                    y2="8"
                    stroke="var(--archibald-border)"
                    strokeWidth="1.5"
                  />
                  <polygon
                    points="24,4 32,8 24,12"
                    fill="var(--archibald-border)"
                  />
                </svg>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-5 flex flex-wrap gap-4 border-t border-[var(--archibald-border)] pt-4">
        {(
          [
            ["PENDING", "Pending"],
            ["RUNNING", "Running"],
            ["COMPLETED", "Completed"],
            ["FAILED", "Failed"],
            ["AWAITING_APPROVAL", "Awaiting Approval"],
            ["SKIPPED", "Skipped"],
          ] as [AgentStatus, string][]
        ).map(([status, label]) => {
          const cfg = STATUS_CONFIG[status];
          return (
            <div key={status} className="flex items-center gap-1.5">
              <div
                className={`h-3 w-3 rounded-full ${cfg.bgClass} ${cfg.dotted ? "border border-dashed border-gray-500" : ""}`}
              />
              <span className="text-[10px] text-[var(--archibald-text-muted)]">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

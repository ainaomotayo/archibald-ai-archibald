"use client";

import { useEffect, useState } from "react";
import type { AgentRunRecord, AgentStatus } from "./types";

interface Props {
  agents: AgentRunRecord[];
  runStartedAt: string;
  runStatus: "IN_PROGRESS" | "COMPLETED" | "FAILED" | "AWAITING_APPROVAL";
}

const STATUS_COLOR: Record<AgentStatus, string> = {
  PENDING: "#475569",
  RUNNING: "#3b82f6",
  COMPLETED: "#10b981",
  FAILED: "#ef4444",
  AWAITING_APPROVAL: "#f59e0b",
  SKIPPED: "#334155",
};

function formatDurationMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

const ROW_HEIGHT = 36; // px
const LABEL_WIDTH = 140; // px reserved for agent names

export function AgentGantt({ agents, runStartedAt, runStatus }: Props) {
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (runStatus !== "IN_PROGRESS") return;
    const id = setInterval(() => setNowMs(Date.now()), 100);
    return () => clearInterval(id);
  }, [runStatus]);

  const runStart = new Date(runStartedAt).getTime();

  // Total span: use completedAt of last agent, or nowMs if still running
  const lastEndMs = agents.reduce((max, a) => {
    if (a.completedAt) return Math.max(max, new Date(a.completedAt).getTime());
    if (a.status === "RUNNING" && a.startedAt)
      return Math.max(max, nowMs);
    return max;
  }, runStart + 1000);

  const totalDurationMs = Math.max(lastEndMs - runStart, 1);

  const canvasWidth = 600; // logical px for the bars area

  function toX(timeMs: number): number {
    return Math.max(0, Math.min(canvasWidth, ((timeMs - runStart) / totalDurationMs) * canvasWidth));
  }

  return (
    <div
      className="rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)] p-5"
      data-testid="agent-gantt"
    >
      <p className="mb-4 text-sm font-semibold text-[var(--archibald-text)]">
        Timing &amp; Gantt
      </p>

      <div className="overflow-x-auto">
        <div
          style={{ minWidth: LABEL_WIDTH + canvasWidth + 16 }}
        >
          {agents.map((agent, i) => {
            const startMs = agent.startedAt
              ? new Date(agent.startedAt).getTime()
              : null;

            const endMs =
              agent.completedAt
                ? new Date(agent.completedAt).getTime()
                : agent.status === "RUNNING" && startMs
                ? nowMs
                : null;

            const barLeft = startMs ? toX(startMs) : 0;
            const barWidth =
              startMs && endMs
                ? Math.max(toX(endMs) - toX(startMs), 2)
                : 0;

            const durationLabel =
              agent.durationMs !== undefined
                ? formatDurationMs(agent.durationMs)
                : startMs && endMs
                ? formatDurationMs(endMs - startMs)
                : null;

            const tooltipText = `${agent.agentName} · ${agent.status}${durationLabel ? ` · ${durationLabel}` : ""}`;

            return (
              <div
                key={agent.agentId}
                className="flex items-center gap-2"
                style={{ height: ROW_HEIGHT }}
                data-testid={`gantt-row-${agent.agentId}`}
              >
                {/* Agent name label */}
                <div
                  className="shrink-0 truncate text-[11px] text-[var(--archibald-text-muted)]"
                  style={{ width: LABEL_WIDTH }}
                  title={agent.agentName}
                >
                  {agent.agentName}
                </div>

                {/* Bar area */}
                <div
                  className="relative flex-1"
                  style={{ height: 20, width: canvasWidth }}
                >
                  {/* Background track */}
                  <div
                    className="absolute inset-y-0 left-0 right-0 rounded-full bg-[var(--archibald-bg)]"
                    style={{ width: canvasWidth }}
                  />

                  {/* Actual bar */}
                  {barWidth > 0 && (
                    <div
                      className="absolute inset-y-0 rounded-full transition-all"
                      style={{
                        left: barLeft,
                        width: barWidth,
                        backgroundColor: STATUS_COLOR[agent.status],
                        opacity: agent.status === "SKIPPED" ? 0.3 : 0.85,
                      }}
                      title={tooltipText}
                      data-testid={`gantt-bar-${agent.agentId}`}
                    />
                  )}

                  {/* Placeholder bar for agents with no time data */}
                  {barWidth === 0 && (
                    <div
                      className="absolute inset-y-0 rounded-full"
                      style={{
                        left: 0,
                        width: 4,
                        backgroundColor: STATUS_COLOR[agent.status],
                        opacity: 0.3,
                      }}
                      data-testid={`gantt-bar-${agent.agentId}`}
                    />
                  )}
                </div>

                {/* Duration label */}
                <div
                  className="w-10 shrink-0 text-right font-mono text-[10px] text-[var(--archibald-text-muted)]"
                  data-testid={`gantt-duration-${agent.agentId}`}
                >
                  {durationLabel ?? "—"}
                </div>
              </div>
            );
          })}

          {/* X-axis labels */}
          <div
            className="mt-1 flex justify-between"
            style={{ paddingLeft: LABEL_WIDTH + 8 }}
          >
            <span className="text-[9px] text-[var(--archibald-text-muted)]">0s</span>
            <span className="text-[9px] text-[var(--archibald-text-muted)]">
              {formatDurationMs(totalDurationMs / 2)}
            </span>
            <span className="text-[9px] text-[var(--archibald-text-muted)]">
              {formatDurationMs(totalDurationMs)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

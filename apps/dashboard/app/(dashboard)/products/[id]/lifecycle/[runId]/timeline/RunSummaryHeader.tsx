"use client";

import { useEffect, useState } from "react";
import type { LifecycleRunSummary } from "./types";

interface Props {
  run: LifecycleRunSummary;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

const STATUS_CHIP: Record<
  LifecycleRunSummary["status"],
  { label: string; className: string }
> = {
  IN_PROGRESS: {
    label: "In Progress",
    className:
      "bg-blue-500/20 text-blue-400 border border-blue-500/30",
  },
  COMPLETED: {
    label: "Completed",
    className:
      "bg-green-500/20 text-green-400 border border-green-500/30",
  },
  FAILED: {
    label: "Failed",
    className: "bg-red-500/20 text-red-400 border border-red-500/30",
  },
  AWAITING_APPROVAL: {
    label: "Awaiting Approval",
    className:
      "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  },
};

export function RunSummaryHeader({ run }: Props) {
  const [elapsedMs, setElapsedMs] = useState(
    Date.now() - new Date(run.startedAt).getTime(),
  );

  useEffect(() => {
    if (run.status !== "IN_PROGRESS") return;
    const id = setInterval(() => {
      setElapsedMs(Date.now() - new Date(run.startedAt).getTime());
    }, 1000);
    return () => clearInterval(id);
  }, [run.status, run.startedAt]);

  const totalMs = run.completedAt
    ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
    : elapsedMs;

  const chip = STATUS_CHIP[run.status];
  const shortRunId = run.runId.slice(0, 18) + (run.runId.length > 18 ? "…" : "");

  return (
    <div
      className="rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)] p-5"
      data-testid="run-summary-header"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Left: product + run id */}
        <div>
          <p className="text-sm font-semibold text-[var(--archibald-text)]">
            {run.productName}
          </p>
          <p
            className="mt-0.5 font-mono text-xs text-[var(--archibald-text-muted)]"
            title={run.runId}
            data-testid="run-id"
          >
            {shortRunId}
          </p>
        </div>

        {/* Right: status chip */}
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${chip.className}`}
          data-testid="run-status-chip"
        >
          {chip.label}
        </span>
      </div>

      {/* Metrics row */}
      <div className="mt-4 flex flex-wrap gap-6">
        {/* Duration */}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--archibald-text-muted)]">
            Duration
          </p>
          <p
            className="mt-0.5 text-sm font-semibold"
            data-testid="run-duration"
          >
            {run.status === "IN_PROGRESS"
              ? `In progress — ${formatDuration(elapsedMs)} elapsed`
              : formatDuration(totalMs)}
          </p>
        </div>

        {/* Gates */}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--archibald-text-muted)]">
            Gates
          </p>
          <p
            className="mt-0.5 text-sm font-semibold"
            data-testid="run-gates"
          >
            {run.gatesPassed} / {run.gatesTotal} passed
          </p>
        </div>

        {/* Pending decisions */}
        {run.pendingDecisionCount > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--archibald-text-muted)]">
              Pending Decisions
            </p>
            <p className="mt-0.5">
              <span
                className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-400"
                data-testid="pending-decision-badge"
              >
                {run.pendingDecisionCount}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

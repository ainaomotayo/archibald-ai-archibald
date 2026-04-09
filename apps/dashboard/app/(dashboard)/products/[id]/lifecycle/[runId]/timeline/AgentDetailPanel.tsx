"use client";

import type { AgentRunRecord } from "./types";

interface Props {
  agent: AgentRunRecord;
  onClose: () => void;
}

const STATUS_BADGE: Record<
  AgentRunRecord["status"],
  { label: string; className: string }
> = {
  PENDING: {
    label: "Pending",
    className: "bg-gray-500/20 text-gray-400 border border-gray-500/30",
  },
  RUNNING: {
    label: "Running",
    className: "bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse",
  },
  COMPLETED: {
    label: "Completed",
    className: "bg-green-500/20 text-green-400 border border-green-500/30",
  },
  FAILED: {
    label: "Failed",
    className: "bg-red-500/20 text-red-400 border border-red-500/30",
  },
  AWAITING_APPROVAL: {
    label: "Awaiting Approval",
    className: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  },
  SKIPPED: {
    label: "Skipped",
    className: "bg-gray-400/10 text-gray-500 border border-gray-500/20",
  },
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface JsonViewerProps {
  label: string;
  data: unknown;
  testId?: string;
}

function JsonViewer({ label, data, testId }: JsonViewerProps) {
  return (
    <div data-testid={testId}>
      <p className="text-xs font-semibold text-[var(--archibald-text-muted)] uppercase tracking-wide">
        {label}
      </p>
      <pre className="mt-1 max-h-36 overflow-auto rounded bg-[var(--archibald-bg)] p-3 text-[10px] leading-relaxed text-[var(--archibald-text)]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export function AgentDetailPanel({ agent, onClose }: Props) {
  const badge = STATUS_BADGE[agent.status];

  return (
    <div
      className="flex h-full flex-col overflow-y-auto rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)] p-5"
      data-testid="agent-detail-panel"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className="text-sm font-bold text-[var(--archibald-text)]"
            data-testid="detail-agent-name"
          >
            {agent.agentName}
          </p>
          <span
            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
            data-testid="detail-agent-status"
          >
            {badge.label}
          </span>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded p-1 text-[var(--archibald-text-muted)] hover:text-[var(--archibald-text)] transition-colors"
          aria-label="Close detail panel"
          data-testid="detail-close-btn"
        >
          ✕
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {/* Timing */}
        {(agent.startedAt || agent.completedAt || agent.durationMs) && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            {agent.startedAt && (
              <div>
                <p className="text-[var(--archibald-text-muted)]">Started</p>
                <p
                  className="font-medium"
                  data-testid="detail-started-at"
                >
                  {formatTime(agent.startedAt)}
                </p>
              </div>
            )}
            {agent.completedAt && (
              <div>
                <p className="text-[var(--archibald-text-muted)]">Completed</p>
                <p
                  className="font-medium"
                  data-testid="detail-completed-at"
                >
                  {formatTime(agent.completedAt)}
                </p>
              </div>
            )}
            {agent.durationMs !== undefined && (
              <div>
                <p className="text-[var(--archibald-text-muted)]">Duration</p>
                <p
                  className="font-medium"
                  data-testid="detail-duration"
                >
                  {formatDuration(agent.durationMs)}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {agent.error && (
          <div className="rounded bg-red-500/10 p-3 text-xs text-red-400" data-testid="detail-error">
            {agent.error}
          </div>
        )}

        {/* Input / Output JSON */}
        {agent.input !== undefined && (
          <JsonViewer label="Input" data={agent.input} testId="detail-input" />
        )}
        {agent.output !== undefined && (
          <JsonViewer label="Output" data={agent.output} testId="detail-output" />
        )}

        {/* LLM stats */}
        {(agent.llmCallCount !== undefined || agent.totalTokens !== undefined) && (
          <div className="grid grid-cols-2 gap-2 text-xs" data-testid="detail-llm-stats">
            {agent.llmCallCount !== undefined && (
              <div>
                <p className="text-[var(--archibald-text-muted)]">LLM Calls</p>
                <p className="font-medium">{agent.llmCallCount}</p>
              </div>
            )}
            {agent.totalTokens !== undefined && (
              <div>
                <p className="text-[var(--archibald-text-muted)]">Total Tokens</p>
                <p className="font-medium">{agent.totalTokens.toLocaleString()}</p>
              </div>
            )}
          </div>
        )}

        {/* Events published */}
        {agent.eventsPublished && agent.eventsPublished.length > 0 && (
          <div data-testid="detail-events">
            <p className="text-xs font-semibold text-[var(--archibald-text-muted)] uppercase tracking-wide">
              Events Published
            </p>
            <ul className="mt-1 space-y-1">
              {agent.eventsPublished.map((evt) => (
                <li
                  key={evt}
                  className="rounded bg-[var(--archibald-bg)] px-2 py-1 font-mono text-[10px] text-[var(--archibald-text-muted)]"
                >
                  {evt}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Pending decision + Approve/Reject */}
        {agent.status === "AWAITING_APPROVAL" && agent.pendingDecision && (
          <div
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4"
            data-testid="detail-pending-decision"
          >
            <p className="text-xs font-semibold text-amber-400 uppercase tracking-wide">
              Pending Decision
            </p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--archibald-text)]">
              {agent.pendingDecision.description}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 transition-colors"
                data-testid={`approve-btn-${agent.pendingDecision.id}`}
              >
                Approve
              </button>
              <button
                className="rounded-lg border border-[var(--archibald-border)] px-3 py-1.5 text-xs font-medium text-[var(--archibald-text-muted)] hover:text-[var(--archibald-text)] transition-colors"
                data-testid={`reject-btn-${agent.pendingDecision.id}`}
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

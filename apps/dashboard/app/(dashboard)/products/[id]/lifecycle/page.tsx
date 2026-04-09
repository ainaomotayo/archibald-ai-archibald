"use client";

import { useState } from "react";

const ALL_STAGES = [
  { key: "conception", label: "Conception", agent: null },
  { key: "requirements", label: "Requirements", agent: "RequirementsAgent" },
  { key: "design", label: "Design", agent: "DesignAgent" },
  { key: "review", label: "Review", agent: null },
  { key: "build", label: "Build", agent: "BuildAgent" },
  { key: "test", label: "Test", agent: "QualityAgent" },
  { key: "scan", label: "Scan", agent: "ScanGateAgent" },
  { key: "deploy", label: "Deploy", agent: "DeployAgent" },
  { key: "monitor", label: "Monitor", agent: "MonitorAgent" },
  { key: "live", label: "Live", agent: null },
  { key: "evolving", label: "Evolving", agent: "EvolveAgent" },
] as const;

// Mock data — in production this comes from GET /v1/products/:id/lifecycle
const MOCK_CURRENT_STAGE = "scan";
const MOCK_FAILED_STAGE = null;

const MOCK_STAGE_DETAILS: Record<string, { agentRan: string; decision: string; evidence: string[]; durationMs: number }> = {
  requirements: {
    agentRan: "RequirementsAgent",
    decision: "Requirements structured: 4 user stories, 8 acceptance criteria",
    evidence: ["LLM structured requirements from natural language", "No clarifications needed"],
    durationMs: 12400,
  },
  design: {
    agentRan: "DesignAgent",
    decision: "Architecture proposal generated: REST API + PostgreSQL + Redis",
    evidence: ["ARCHINTEL returned 6 org patterns", "LLM generated architecture with justifications"],
    durationMs: 34200,
  },
  review: {
    agentRan: "Human",
    decision: "Approved by @alice — 'Looks good, proceed'",
    evidence: ["Manual approval received 2h ago"],
    durationMs: 7200000,
  },
  build: {
    agentRan: "BuildAgent",
    decision: "Code generated: 847 lines across 12 files, 94% test coverage",
    evidence: ["GitHub Actions build: passed", "Test suite: 94% coverage"],
    durationMs: 180000,
  },
  test: {
    agentRan: "QualityAgent",
    decision: "Coverage gate passed: 94% >= 80% threshold",
    evidence: ["94 tests pass, 0 fail", "Coverage: 94%"],
    durationMs: 45000,
  },
};

const MOCK_PENDING_DECISIONS = [
  {
    id: "dec-scan-001",
    title: "SENTINEL scan in progress",
    description: "ScanGateAgent is waiting for a SENTINEL certificate. Checked 2 times. Next check in 60s.",
    urgency: "high" as const,
    stage: "scan",
  },
];

export default function LifecycleTimelinePage() {
  const [expandedStage, setExpandedStage] = useState<string | null>(null);

  const getStageStatus = (stageKey: string): "completed" | "current" | "failed" | "pending" => {
    const stageOrder = ALL_STAGES.map((s) => s.key);
    const currentIdx = stageOrder.indexOf(MOCK_CURRENT_STAGE);
    const stageIdx = stageOrder.indexOf(stageKey as typeof MOCK_CURRENT_STAGE);

    if (stageKey === MOCK_FAILED_STAGE) return "failed";
    if (stageKey === MOCK_CURRENT_STAGE) return "current";
    if (stageIdx < currentIdx) return "completed";
    return "pending";
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-[var(--archibald-text-muted)]">auth-service</p>
          <h1 className="text-2xl font-bold">Lifecycle Timeline</h1>
          <p className="mt-1 text-sm text-[var(--archibald-text-muted)]">
            Feature: Add OAuth2 authentication with Google and GitHub providers
          </p>
        </div>
        <span className="rounded-full bg-[var(--archibald-primary)]/20 px-3 py-1 text-sm font-medium text-[var(--archibald-primary)]">
          In Progress
        </span>
      </div>

      {/* Timeline */}
      <div
        className="rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)] p-6"
        data-testid="lifecycle-timeline"
      >
        {/* Horizontal stage row */}
        <div className="flex items-center overflow-x-auto pb-4">
          {ALL_STAGES.map((stage, i) => {
            const status = getStageStatus(stage.key);

            return (
              <div key={stage.key} className="flex items-center">
                <button
                  onClick={() => setExpandedStage(expandedStage === stage.key ? null : stage.key)}
                  className="flex flex-col items-center gap-1.5 px-2 hover:opacity-80 transition-opacity"
                  data-testid={`stage-${stage.key}`}
                  title={`${stage.label} — ${status}`}
                >
                  {/* Stage indicator */}
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold transition-all ${
                      status === "completed"
                        ? "border-green-500 bg-green-500 text-white"
                        : status === "current"
                          ? "border-[var(--archibald-primary)] bg-[var(--archibald-primary)] text-white animate-pulse"
                          : status === "failed"
                            ? "border-red-500 bg-red-500 text-white"
                            : "border-[var(--archibald-border)] bg-[var(--archibald-bg)] text-[var(--archibald-text-muted)]"
                    }`}
                  >
                    {status === "completed" ? "✓" : status === "failed" ? "✗" : i + 1}
                  </div>
                  {/* Stage label */}
                  <span
                    className={`text-[10px] font-medium whitespace-nowrap ${
                      status === "completed"
                        ? "text-green-400"
                        : status === "current"
                          ? "text-[var(--archibald-primary)]"
                          : status === "failed"
                            ? "text-red-400"
                            : "text-[var(--archibald-text-muted)]"
                    }`}
                  >
                    {stage.label}
                  </span>
                </button>

                {/* Connector line */}
                {i < ALL_STAGES.length - 1 && (
                  <div
                    className={`h-0.5 w-6 shrink-0 ${
                      getStageStatus(stage.key) === "completed" ? "bg-green-500" : "bg-[var(--archibald-border)]"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Expanded stage detail */}
        {expandedStage && MOCK_STAGE_DETAILS[expandedStage] && (
          <div
            className="mt-4 rounded-lg border border-[var(--archibald-border)] bg-[var(--archibald-bg)] p-4"
            data-testid="stage-detail-panel"
          >
            <p className="text-sm font-semibold capitalize">{expandedStage} stage details</p>
            <div className="mt-3 space-y-2">
              <div className="flex gap-2 text-sm">
                <span className="text-[var(--archibald-text-muted)]">Agent:</span>
                <span className="font-medium">{MOCK_STAGE_DETAILS[expandedStage]!.agentRan}</span>
              </div>
              <div className="flex gap-2 text-sm">
                <span className="text-[var(--archibald-text-muted)]">Outcome:</span>
                <span>{MOCK_STAGE_DETAILS[expandedStage]!.decision}</span>
              </div>
              <div className="flex gap-2 text-sm">
                <span className="shrink-0 text-[var(--archibald-text-muted)]">Duration:</span>
                <span>{(MOCK_STAGE_DETAILS[expandedStage]!.durationMs / 1000).toFixed(0)}s</span>
              </div>
              <div>
                <p className="text-sm text-[var(--archibald-text-muted)]">Evidence:</p>
                <ul className="mt-1 space-y-1">
                  {MOCK_STAGE_DETAILS[expandedStage]!.evidence.map((e, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <span className="text-green-400">+</span>
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pending Decisions */}
      {MOCK_PENDING_DECISIONS.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">
            Pending Decisions
            <span className="ml-2 rounded-full bg-orange-400/20 px-2 py-0.5 text-sm font-medium text-orange-400">
              {MOCK_PENDING_DECISIONS.length}
            </span>
          </h2>
          <div className="space-y-3" data-testid="pending-decisions">
            {MOCK_PENDING_DECISIONS.map((d) => (
              <div
                key={d.id}
                className="rounded-xl border border-orange-400/20 bg-orange-400/5 p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{d.title}</p>
                    <p className="mt-1 text-sm text-[var(--archibald-text-muted)] leading-relaxed">
                      {d.description}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-orange-400/20 px-2 py-0.5 text-xs font-medium text-orange-400 uppercase">
                    {d.urgency}
                  </span>
                </div>
                <div className="mt-4 flex gap-3">
                  <button
                    data-testid={`approve-${d.id}`}
                    className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    data-testid={`reject-${d.id}`}
                    className="rounded-lg border border-[var(--archibald-border)] px-4 py-2 text-sm font-medium text-[var(--archibald-text-muted)] hover:text-[var(--archibald-text)] transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

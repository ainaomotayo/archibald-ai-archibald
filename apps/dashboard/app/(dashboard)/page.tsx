// ECOSYSTEM OVERVIEW — Health cards for all 5 solutions, active lifecycle runs,
// pending decisions, recent events, and self-evolution alerts.

const SOLUTIONS = [
  { id: "sentinel", name: "SENTINEL", description: "AI code governance", port: 8080, icon: "S", color: "#ef4444" },
  { id: "archintel", name: "ARCHINTEL", description: "Knowledge graph", port: 8090, icon: "A", color: "#3b82f6" },
  { id: "phoenix", name: "PHOENIX", description: "Self-healing", port: 8100, icon: "P", color: "#f59e0b" },
  { id: "forge", name: "FORGE", description: "Non-technical UI", port: 8110, icon: "F", color: "#10b981" },
  { id: "archibald", name: "ARCHIBALD", description: "Lifecycle orchestrator", port: 8120, icon: "B", color: "#7c3aed" },
];

const MOCK_ACTIVE_RUNS = [
  { product: "auth-service", stage: "scan", startedAt: "2h ago", type: "feature", runId: "run-001" },
  { product: "billing-api", stage: "review", startedAt: "4h ago", type: "refactor", runId: "run-002" },
  { product: "notification-worker", stage: "build", startedAt: "6h ago", type: "bugfix", runId: "run-003" },
];

const MOCK_PENDING_DECISIONS = [
  { id: "dec-001", product: "auth-service", title: "Architecture design ready for review", urgency: "high", stage: "review" },
  { id: "dec-002", product: "reporting-service", title: "Requirements clarification needed", urgency: "medium", stage: "requirements" },
];

const MOCK_EVENTS = [
  { time: "2m ago", product: "auth-service", event: "ScanGateAgent: SENTINEL certificate received (no HIGH/CRITICAL)", type: "success" },
  { time: "18m ago", product: "billing-api", event: "DesignAgent: architecture proposal ready for review", type: "info" },
  { time: "45m ago", product: "notification-worker", event: "BuildAgent: code generation complete", type: "success" },
  { time: "1h ago", product: "payment-service", event: "Lifecycle run completed — product is LIVE", type: "success" },
  { time: "2h ago", product: "user-service", event: "PHOENIX monitoring configured (5 alert rules)", type: "info" },
];

const STAGE_COLORS: Record<string, string> = {
  conception: "bg-gray-500",
  requirements: "bg-blue-500",
  design: "bg-indigo-500",
  review: "bg-yellow-500",
  build: "bg-orange-500",
  test: "bg-pink-500",
  scan: "bg-red-500",
  deploy: "bg-teal-500",
  monitor: "bg-cyan-500",
  live: "bg-green-500",
  evolving: "bg-purple-500",
};

const URGENCY_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-400/10 border-red-400/20",
  high: "text-orange-400 bg-orange-400/10 border-orange-400/20",
  medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  low: "text-blue-400 bg-blue-400/10 border-blue-400/20",
};

export default function EcosystemOverviewPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Ecosystem Overview</h1>
        <p className="mt-1 text-[var(--archibald-text-muted)]">
          All 5 solutions — real-time health, active lifecycle runs, and pending decisions.
        </p>
      </div>

      {/* Solution Health Cards */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Solution Health</h2>
        <div className="grid grid-cols-5 gap-3" data-testid="solution-health-grid">
          {SOLUTIONS.map((s) => (
            <div
              key={s.id}
              data-testid={`solution-card-${s.id}`}
              className="rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)] p-4"
            >
              <div className="flex items-center justify-between">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
                  style={{ backgroundColor: s.color }}
                >
                  {s.icon}
                </div>
                <span
                  className="h-2.5 w-2.5 rounded-full bg-green-400"
                  data-testid={`solution-status-${s.id}`}
                  title="healthy"
                />
              </div>
              <p className="mt-3 text-sm font-semibold">{s.name}</p>
              <p className="text-xs text-[var(--archibald-text-muted)]">{s.description}</p>
              <p className="mt-1 text-xs text-[var(--archibald-text-muted)]">:{s.port}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-3 gap-6">
        {/* Active Lifecycle Runs */}
        <div className="col-span-2 rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Active Lifecycle Runs</h2>
            <span className="rounded-full bg-[var(--archibald-primary)]/20 px-2.5 py-0.5 text-xs font-medium text-[var(--archibald-primary)]">
              {MOCK_ACTIVE_RUNS.length} active
            </span>
          </div>
          <div className="space-y-3" data-testid="active-runs-table">
            {MOCK_ACTIVE_RUNS.map((run) => (
              <div
                key={run.runId}
                className="flex items-center justify-between rounded-lg border border-[var(--archibald-border)] bg-[var(--archibald-bg)] px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{run.product}</p>
                  <p className="text-xs text-[var(--archibald-text-muted)]">
                    {run.type} · started {run.startedAt}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium text-white ${STAGE_COLORS[run.stage] ?? "bg-gray-500"}`}
                  >
                    {run.stage}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pending Decisions */}
        <div className="rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Pending Decisions</h2>
            <span className="rounded-full bg-orange-400/20 px-2.5 py-0.5 text-xs font-medium text-orange-400">
              {MOCK_PENDING_DECISIONS.length}
            </span>
          </div>
          <div className="space-y-3" data-testid="pending-decisions-list">
            {MOCK_PENDING_DECISIONS.map((d) => (
              <div
                key={d.id}
                className={`rounded-lg border p-3 ${URGENCY_COLORS[d.urgency] ?? ""}`}
              >
                <p className="text-xs font-medium">{d.product}</p>
                <p className="mt-1 text-xs leading-snug">{d.title}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wide opacity-70">{d.urgency}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Self-Evolution Alert */}
      <div
        className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-5"
        data-testid="self-evolution-alert"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-purple-500 text-xs font-bold text-white">
            E
          </div>
          <div>
            <p className="text-sm font-semibold text-purple-300">Self-Evolution Insight</p>
            <p className="mt-1 text-sm text-[var(--archibald-text)]">
              Based on 14 lifecycle runs, consider PostgreSQL over MongoDB for reporting
              services — 40% fewer incidents observed in comparable workloads.
            </p>
            <p className="mt-1 text-xs text-[var(--archibald-text-muted)]">
              Confidence: 82% · Generated by EvolveAgent · 3h ago
            </p>
          </div>
        </div>
      </div>

      {/* Recent Events Feed */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Recent Events</h2>
        <div className="rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)]">
          {MOCK_EVENTS.map((event, i) => (
            <div
              key={i}
              className="flex items-start gap-4 border-b border-[var(--archibald-border)] px-5 py-3 last:border-none"
            >
              <span className="mt-0.5 shrink-0 text-xs text-[var(--archibald-text-muted)]">
                {event.time}
              </span>
              <div className="flex-1">
                <span className="text-xs font-medium text-[var(--archibald-primary)]">
                  {event.product}
                </span>
                <span className="mx-2 text-[var(--archibald-text-muted)]">·</span>
                <span className="text-xs text-[var(--archibald-text)]">{event.event}</span>
              </div>
              <span
                className={`shrink-0 text-xs ${event.type === "success" ? "text-green-400" : "text-blue-400"}`}
              >
                {event.type === "success" ? "+" : "i"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

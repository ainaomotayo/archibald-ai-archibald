// ORGANISATION INSIGHTS — self-evolution patterns, anti-pattern warnings,
// technology health, and ARCHIBALD confidence score.

const MOCK_CONFIDENCE = {
  score: 78,
  runCount: 23,
  note: "Based on 23 completed lifecycle runs",
};

const MOCK_ANTI_PATTERNS = [
  {
    id: "ap-001",
    pattern: "Microservices proliferation",
    description: "Teams using microservices for small features with <3 developers",
    occurrenceCount: 7,
    avgIncidentRate: 2.3,
    recommendation: "Use monolith-first approach for new products until team reaches 5+ engineers",
    confidence: 0.87,
  },
  {
    id: "ap-002",
    pattern: "Missing SENTINEL scan gates",
    description: "Deployments proceeding without waiting for SENTINEL certificate",
    occurrenceCount: 4,
    avgIncidentRate: 3.1,
    recommendation: "Enforce SENTINEL scan gate in all lifecycle runs — no exceptions",
    confidence: 0.94,
  },
  {
    id: "ap-003",
    pattern: "Insufficient test coverage before scan",
    description: "Builds reaching scan gate with <70% coverage",
    occurrenceCount: 9,
    avgIncidentRate: 1.8,
    recommendation: "Raise test coverage threshold to 85% for all new features",
    confidence: 0.82,
  },
];

const MOCK_POSITIVE_PATTERNS = [
  {
    id: "pp-001",
    pattern: "PostgreSQL for OLTP workloads",
    description: "Consistent use of PostgreSQL as primary store",
    occurrenceCount: 14,
    avgMttrMs: 8 * 60 * 1000,
    recommendation: "Continue — 40% fewer incidents vs MongoDB in comparable services",
  },
  {
    id: "pp-002",
    pattern: "Redis Streams for async events",
    description: "Event-driven communication via Redis Streams",
    occurrenceCount: 12,
    avgMttrMs: 5 * 60 * 1000,
    recommendation: "Continue — lower MTTR and clear audit trail",
  },
];

const MOCK_TECH_HEALTH = [
  { name: "fastify", version: "5.2.1", status: "healthy", lastPublished: "12 days ago", isMaintained: true },
  { name: "prisma", version: "5.22.0", status: "healthy", lastPublished: "5 days ago", isMaintained: true },
  { name: "ioredis", version: "5.4.1", status: "healthy", lastPublished: "30 days ago", isMaintained: true },
  { name: "express", version: "4.21.2", status: "watch", lastPublished: "45 days ago", isMaintained: true, note: "Consider migrating to Fastify 5 for better performance" },
  { name: "mongoose", version: "8.9.0", status: "watch", lastPublished: "8 days ago", isMaintained: true, note: "Anti-pattern: PostgreSQL preferred in this org" },
];

const CONFIDENCE_COLOR = (score: number) => {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  return "text-orange-400";
};

export default function InsightsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Organisation Insights</h1>
          <p className="mt-1 text-[var(--archibald-text-muted)]">
            Self-evolution patterns derived from your team's lifecycle history.
          </p>
        </div>

        {/* Confidence Score */}
        <div
          className="rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)] p-4 text-center"
          data-testid="confidence-score"
        >
          <p className="text-xs text-[var(--archibald-text-muted)]">ARCHIBALD Confidence</p>
          <p className={`mt-1 text-4xl font-bold ${CONFIDENCE_COLOR(MOCK_CONFIDENCE.score)}`}>
            {MOCK_CONFIDENCE.score}%
          </p>
          <p className="mt-1 text-[10px] text-[var(--archibald-text-muted)]">{MOCK_CONFIDENCE.note}</p>
        </div>
      </div>

      {/* Anti-Pattern Warnings */}
      <section data-testid="anti-patterns-section">
        <h2 className="mb-4 text-lg font-semibold">
          Anti-Pattern Warnings
          <span className="ml-2 rounded-full bg-red-400/20 px-2 py-0.5 text-sm font-medium text-red-400">
            {MOCK_ANTI_PATTERNS.length}
          </span>
        </h2>
        <div className="space-y-3">
          {MOCK_ANTI_PATTERNS.map((ap) => (
            <div
              key={ap.id}
              data-testid={`anti-pattern-${ap.id}`}
              className="rounded-xl border border-red-500/20 bg-red-500/5 p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-red-300">{ap.pattern}</p>
                    <span className="rounded bg-red-400/20 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                      {ap.occurrenceCount}x observed
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--archibald-text-muted)]">{ap.description}</p>
                  <div className="mt-3 rounded-lg bg-[var(--archibald-bg)] px-3 py-2">
                    <p className="text-xs font-medium text-green-400">Recommendation</p>
                    <p className="mt-0.5 text-xs text-[var(--archibald-text)]">{ap.recommendation}</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-[var(--archibald-text-muted)]">Avg incidents</p>
                  <p className="text-lg font-bold text-red-400">{ap.avgIncidentRate.toFixed(1)}</p>
                  <p className="text-[10px] text-[var(--archibald-text-muted)]">
                    {Math.round(ap.confidence * 100)}% confident
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Positive Patterns */}
      <section data-testid="positive-patterns-section">
        <h2 className="mb-4 text-lg font-semibold">
          What Works Well
          <span className="ml-2 rounded-full bg-green-400/20 px-2 py-0.5 text-sm font-medium text-green-400">
            {MOCK_POSITIVE_PATTERNS.length}
          </span>
        </h2>
        <div className="space-y-3">
          {MOCK_POSITIVE_PATTERNS.map((pp) => (
            <div
              key={pp.id}
              className="rounded-xl border border-green-500/20 bg-green-500/5 p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-green-300">{pp.pattern}</p>
                    <span className="rounded bg-green-400/20 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                      {pp.occurrenceCount}x observed
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--archibald-text-muted)]">{pp.description}</p>
                  <p className="mt-2 text-xs text-[var(--archibald-text)]">{pp.recommendation}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-[var(--archibald-text-muted)]">Avg MTTR</p>
                  <p className="text-lg font-bold text-green-400">
                    {Math.round(pp.avgMttrMs / 60000)}m
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Technology Health */}
      <section data-testid="tech-health-section">
        <h2 className="mb-4 text-lg font-semibold">Technology Health</h2>
        <div className="rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)]">
          {MOCK_TECH_HEALTH.map((tech, i) => (
            <div
              key={tech.name}
              className={`flex items-center gap-4 px-5 py-3.5 ${
                i < MOCK_TECH_HEALTH.length - 1 ? "border-b border-[var(--archibald-border)]" : ""
              }`}
            >
              <div
                className={`h-2 w-2 shrink-0 rounded-full ${
                  tech.status === "healthy" ? "bg-green-400" : "bg-yellow-400"
                }`}
              />
              <div className="w-32">
                <p className="text-sm font-medium">{tech.name}</p>
                <p className="text-xs text-[var(--archibald-text-muted)]">{tech.version}</p>
              </div>
              <p className="flex-1 text-sm text-[var(--archibald-text-muted)]">
                {tech.note ?? `Last published ${tech.lastPublished}`}
              </p>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  tech.status === "healthy"
                    ? "bg-green-400/20 text-green-400"
                    : "bg-yellow-400/20 text-yellow-400"
                }`}
              >
                {tech.status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

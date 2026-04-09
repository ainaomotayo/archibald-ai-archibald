"use client";

import { useState, useMemo } from "react";

interface DecisionOption {
  id: string;
  label: string;
  pros: string[];
  cons: string[];
}

interface Decision {
  id: string;
  productId: string;
  productName: string;
  title: string;
  context: string;
  options: DecisionOption[];
  recommendedOption?: string;
  status: "pending" | "decided" | "deferred";
  priority: "critical" | "high" | "medium" | "low";
  createdAt: string;
  deadline?: string;
}

const MOCK_DECISIONS: Decision[] = [
  {
    id: "dec-001",
    productId: "prod-001",
    productName: "auth-service",
    title: "Use PostgreSQL or MongoDB for user data?",
    context:
      "We need to choose a primary database for storing user profiles, OAuth tokens, and session data. The service will start with ~10k users and scale to 1M+.",
    options: [
      {
        id: "opt-pg",
        label: "PostgreSQL",
        pros: ["ACID compliance", "Strong consistency", "Org standard"],
        cons: ["More complex schema migrations", "Requires DBA oversight"],
      },
      {
        id: "opt-mongo",
        label: "MongoDB",
        pros: ["Flexible schema", "Easy to start"],
        cons: ["No transactions", "Higher incident rate in org history"],
      },
    ],
    recommendedOption: "opt-pg",
    status: "pending",
    priority: "critical",
    createdAt: "2h ago",
    deadline: "Tomorrow 5pm",
  },
  {
    id: "dec-002",
    productId: "prod-005",
    productName: "reporting-service",
    title: "Requirements clarification: real-time vs. batch reporting?",
    context:
      "The product owner needs to decide between real-time streaming reports (higher cost, lower latency) and scheduled batch reports (lower cost, acceptable for daily digests).",
    options: [
      {
        id: "opt-realtime",
        label: "Real-time streaming",
        pros: ["Sub-second latency", "Better UX for dashboards"],
        cons: ["3x infrastructure cost", "Higher operational complexity"],
      },
      {
        id: "opt-batch",
        label: "Scheduled batch",
        pros: ["80% cost reduction", "Simpler to operate"],
        cons: ["Up to 1h data lag", "Less suitable for live dashboards"],
      },
    ],
    recommendedOption: "opt-batch",
    status: "pending",
    priority: "medium",
    createdAt: "5h ago",
  },
  {
    id: "dec-003",
    productId: "prod-007",
    productName: "search-api",
    title: "OpenSearch vs. Typesense for full-text search engine?",
    context:
      "DesignAgent has evaluated two search engines. The choice will affect hosting cost, query latency, and maintenance burden for the next 2+ years.",
    options: [
      {
        id: "opt-os",
        label: "OpenSearch",
        pros: ["Feature-rich", "AWS managed option", "Familiar to team"],
        cons: ["Heavy resource usage", "Slow cold-start"],
      },
      {
        id: "opt-ts",
        label: "Typesense",
        pros: ["10x faster queries", "Low resource footprint", "Simple API"],
        cons: ["Smaller ecosystem", "Less mature than Elasticsearch"],
      },
    ],
    recommendedOption: "opt-ts",
    status: "pending",
    priority: "high",
    createdAt: "1d ago",
    deadline: "Friday EOD",
  },
  {
    id: "dec-004",
    productId: "prod-002",
    productName: "billing-api",
    title: "Accept multi-currency billing from v1?",
    context:
      "Stripe supports multi-currency natively but requires additional compliance work (tax, FX rates). Delaying to v2 simplifies launch.",
    options: [
      {
        id: "opt-multi",
        label: "Multi-currency in v1",
        pros: ["Unlocks international market day one"],
        cons: ["2 weeks additional compliance work", "Tax reporting complexity"],
      },
      {
        id: "opt-single",
        label: "USD-only v1, expand in v2",
        pros: ["Faster launch", "Simpler compliance"],
        cons: ["Blocks international customers initially"],
      },
    ],
    status: "pending",
    priority: "high",
    createdAt: "3h ago",
  },
  {
    id: "dec-005",
    productId: "prod-003",
    productName: "notification-worker",
    title: "Use AWS SNS or self-hosted Redis pub/sub for notifications?",
    context:
      "The notification worker needs a pub/sub backbone. AWS SNS is managed but adds vendor lock-in. Redis pub/sub is already in the stack.",
    options: [
      {
        id: "opt-sns",
        label: "AWS SNS",
        pros: ["Managed, no ops overhead", "Fan-out to SQS, HTTP, Lambda"],
        cons: ["Vendor lock-in", "Cost at scale"],
      },
      {
        id: "opt-redis",
        label: "Redis pub/sub",
        pros: ["Already in stack", "No extra cost", "No lock-in"],
        cons: ["At-most-once delivery", "Self-managed"],
      },
    ],
    recommendedOption: "opt-redis",
    status: "deferred",
    priority: "low",
    createdAt: "2d ago",
  },
  {
    id: "dec-006",
    productId: "prod-004",
    productName: "payment-service",
    title: "Migrate from Stripe API v1 to v2?",
    context:
      "Stripe is deprecating API v1 in 6 months. Migration requires updates to webhook handlers and payment intent flows.",
    options: [
      {
        id: "opt-now",
        label: "Migrate now",
        pros: ["Avoid deadline pressure", "Access new features"],
        cons: ["2 weeks of engineering work"],
      },
      {
        id: "opt-later",
        label: "Migrate in Q3",
        pros: ["Delay engineering cost"],
        cons: ["Tight deadline risk"],
      },
    ],
    recommendedOption: "opt-now",
    status: "decided",
    priority: "medium",
    createdAt: "1w ago",
  },
];

type FilterTab = "all" | "pending" | "critical" | "decided" | "deferred";

const PRIORITY_BADGE: Record<Decision["priority"], string> = {
  critical: "bg-red-500/20 text-red-400 border border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border border-orange-500/30",
  medium: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  low: "bg-gray-500/20 text-gray-400 border border-gray-500/30",
};

function DecisionCard({
  decision,
  onDecide,
}: {
  decision: Decision;
  onDecide: (id: string, action: "approve" | "reject" | "defer", optionId?: string, reason?: string) => void;
}) {
  const [selectedOption, setSelectedOption] = useState<string | undefined>(
    decision.recommendedOption,
  );
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const isActioned = decision.status === "decided" || decision.status === "deferred";

  return (
    <div
      data-testid={`decision-card-${decision.id}`}
      className={`rounded-xl border bg-[var(--archibald-surface)] p-5 ${
        isActioned
          ? "border-[var(--archibald-border)] opacity-60"
          : "border-[var(--archibald-border)]"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              data-testid={`priority-badge-${decision.id}`}
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_BADGE[decision.priority]}`}
            >
              {decision.priority}
            </span>
            <span className="text-xs text-[var(--archibald-text-muted)]">
              {decision.productName}
            </span>
            <span className="text-xs text-[var(--archibald-text-muted)]">·</span>
            <span className="text-xs text-[var(--archibald-text-muted)]">{decision.createdAt}</span>
          </div>
          <h3 className="mt-1.5 text-sm font-semibold leading-snug">{decision.title}</h3>
          <p className="mt-1 text-xs text-[var(--archibald-text-muted)] leading-relaxed">
            {decision.context}
          </p>
          {decision.deadline && (
            <p className="mt-1 text-xs text-amber-400">
              Deadline: {decision.deadline}
            </p>
          )}
        </div>
        {decision.status !== "pending" && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              decision.status === "decided"
                ? "bg-green-400/20 text-green-400"
                : "bg-blue-400/20 text-blue-400"
            }`}
          >
            {decision.status}
          </span>
        )}
      </div>

      {/* Divider */}
      <div className="my-4 border-t border-[var(--archibald-border)]" />

      {/* Options */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-[var(--archibald-text-muted)] uppercase tracking-wide">
          Options
        </p>
        {decision.options.map((option) => {
          const isRecommended = option.id === decision.recommendedOption;
          const isSelected = selectedOption === option.id;

          return (
            <label
              key={option.id}
              data-testid={`option-${decision.id}-${option.id}`}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                isSelected
                  ? "border-[var(--archibald-primary)]/60 bg-[var(--archibald-primary)]/5"
                  : "border-[var(--archibald-border)] hover:border-[var(--archibald-primary)]/30"
              }`}
            >
              <input
                type="radio"
                name={`decision-${decision.id}`}
                value={option.id}
                checked={isSelected}
                onChange={() => setSelectedOption(option.id)}
                disabled={isActioned}
                className="mt-0.5 shrink-0 accent-[var(--archibald-primary)]"
                data-testid={`radio-${decision.id}-${option.id}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{option.label}</span>
                  {isRecommended && (
                    <span
                      data-testid={`recommended-badge-${decision.id}-${option.id}`}
                      className="rounded-full bg-[var(--archibald-primary)]/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[var(--archibald-primary)]"
                    >
                      AI recommended
                    </span>
                  )}
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <div>
                    {option.pros.map((pro) => (
                      <p key={pro} className="flex items-start gap-1 text-[10px] text-green-400">
                        <span className="mt-0.5 shrink-0">+</span>
                        {pro}
                      </p>
                    ))}
                  </div>
                  <div>
                    {option.cons.map((con) => (
                      <p key={con} className="flex items-start gap-1 text-[10px] text-red-400">
                        <span className="mt-0.5 shrink-0">-</span>
                        {con}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {/* Reject reason */}
      {showRejectReason && (
        <div className="mt-3">
          <textarea
            data-testid={`reject-reason-${decision.id}`}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection..."
            rows={2}
            className="w-full rounded-lg border border-[var(--archibald-border)] bg-[var(--archibald-bg)] px-3 py-2 text-sm text-[var(--archibald-text)] placeholder:text-[var(--archibald-text-muted)] focus:outline-none focus:border-[var(--archibald-primary)]"
          />
        </div>
      )}

      {/* Divider */}
      {!isActioned && <div className="my-4 border-t border-[var(--archibald-border)]" />}

      {/* Actions */}
      {!isActioned && (
        <div className="flex items-center gap-2">
          <button
            data-testid={`defer-btn-${decision.id}`}
            onClick={() => onDecide(decision.id, "defer")}
            className="rounded-lg border border-[var(--archibald-border)] px-3 py-1.5 text-xs font-medium text-[var(--archibald-text-muted)] hover:text-[var(--archibald-text)] transition-colors"
          >
            Defer
          </button>
          <button
            data-testid={`reject-btn-${decision.id}`}
            onClick={() => {
              if (showRejectReason) {
                onDecide(decision.id, "reject", undefined, rejectReason);
                setShowRejectReason(false);
              } else {
                setShowRejectReason(true);
              }
            }}
            className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
          >
            {showRejectReason ? "Confirm Reject" : "Reject"}
          </button>
          <button
            data-testid={`approve-btn-${decision.id}`}
            onClick={() => {
              if (selectedOption) {
                onDecide(decision.id, "approve", selectedOption);
              }
            }}
            disabled={!selectedOption}
            className="ml-auto rounded-lg bg-[var(--archibald-primary)] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Approve Selected
          </button>
        </div>
      )}
    </div>
  );
}

export default function DecisionsInboxPage() {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [decisions, setDecisions] = useState<Decision[]>(MOCK_DECISIONS);

  const filterTabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "critical", label: "Critical" },
    { key: "decided", label: "Decided" },
    { key: "deferred", label: "Deferred" },
  ];

  const pendingCount = decisions.filter((d) => d.status === "pending").length;

  const filtered = useMemo(() => {
    let result = [...decisions];

    if (activeFilter === "pending") {
      result = result.filter((d) => d.status === "pending");
    } else if (activeFilter === "critical") {
      result = result.filter((d) => d.priority === "critical");
    } else if (activeFilter === "decided") {
      result = result.filter((d) => d.status === "decided");
    } else if (activeFilter === "deferred") {
      result = result.filter((d) => d.status === "deferred");
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.productName.toLowerCase().includes(q) ||
          d.context.toLowerCase().includes(q),
      );
    }

    return result;
  }, [decisions, activeFilter, search]);

  const handleDecide = async (
    id: string,
    action: "approve" | "reject" | "defer",
    optionId?: string,
    reason?: string,
  ) => {
    // Optimistic update
    setDecisions((prev) =>
      prev.map((d) =>
        d.id === id
          ? { ...d, status: action === "defer" ? "deferred" : action === "approve" ? "decided" : "decided" }
          : d,
      ),
    );

    // Fire and forget API call
    try {
      const apiBase = process.env.NEXT_PUBLIC_ARCHIBALD_API_URL ?? "http://localhost:3004";
      await fetch(`${apiBase}/api/decisions/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId, action, reason }),
      });
    } catch {
      // Silent fail — optimistic update already applied
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">Decisions Inbox</h1>
            {pendingCount > 0 && (
              <span
                data-testid="pending-count-badge"
                className="rounded-full bg-amber-400/20 px-3 py-1 text-sm font-semibold text-amber-400"
              >
                {pendingCount} pending
              </span>
            )}
          </div>
          <p className="mt-1 text-[var(--archibald-text-muted)]">
            Architecture decisions awaiting your input.
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="flex gap-1 rounded-lg border border-[var(--archibald-border)] bg-[var(--archibald-surface)] p-1"
          data-testid="decisions-filter-tabs"
        >
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              data-testid={`decisions-filter-${tab.key}`}
              onClick={() => setActiveFilter(tab.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeFilter === tab.key
                  ? "bg-[var(--archibald-primary)] text-white"
                  : "text-[var(--archibald-text-muted)] hover:text-[var(--archibald-text)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          data-testid="decisions-search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search decisions..."
          className="rounded-lg border border-[var(--archibald-border)] bg-[var(--archibald-surface)] px-3 py-1.5 text-sm text-[var(--archibald-text)] placeholder:text-[var(--archibald-text-muted)] focus:outline-none focus:border-[var(--archibald-primary)]"
        />
      </div>

      {/* Decision cards */}
      {filtered.length === 0 ? (
        <div
          data-testid="decisions-empty-state"
          className="rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)] py-16 text-center"
        >
          <p className="text-sm text-[var(--archibald-text-muted)]">
            No decisions match this filter.
          </p>
        </div>
      ) : (
        <div className="space-y-4" data-testid="decisions-list">
          {filtered.map((decision) => (
            <DecisionCard key={decision.id} decision={decision} onDecide={handleDecide} />
          ))}
        </div>
      )}

      <p className="text-xs text-[var(--archibald-text-muted)]">
        Showing {filtered.length} of {decisions.length} decisions
      </p>
    </div>
  );
}

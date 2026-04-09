"use client";

import { useState, useMemo } from "react";

interface Product {
  id: string;
  name: string;
  description: string;
  lifecycleStage: "requirements" | "design" | "build" | "test" | "deploy" | "monitor";
  stageProgress: number;
  health: "healthy" | "degraded" | "incident";
  pendingDecisions: number;
  lastUpdated: string;
}

const LIFECYCLE_STAGES = ["requirements", "design", "build", "test", "deploy", "monitor"] as const;

const MOCK_PRODUCTS: Product[] = [
  {
    id: "prod-001",
    name: "auth-service",
    description: "OAuth2 authentication with Google and GitHub providers",
    lifecycleStage: "build",
    stageProgress: 72,
    health: "healthy",
    pendingDecisions: 3,
    lastUpdated: "2h ago",
  },
  {
    id: "prod-002",
    name: "billing-api",
    description: "Stripe-powered subscription and invoice management",
    lifecycleStage: "test",
    stageProgress: 45,
    health: "degraded",
    pendingDecisions: 1,
    lastUpdated: "4h ago",
  },
  {
    id: "prod-003",
    name: "notification-worker",
    description: "Multi-channel notifications via email, SMS, and push",
    lifecycleStage: "build",
    stageProgress: 20,
    health: "healthy",
    pendingDecisions: 0,
    lastUpdated: "6h ago",
  },
  {
    id: "prod-004",
    name: "payment-service",
    description: "PCI-compliant payment processing and reconciliation",
    lifecycleStage: "monitor",
    stageProgress: 90,
    health: "healthy",
    pendingDecisions: 0,
    lastUpdated: "1d ago",
  },
  {
    id: "prod-005",
    name: "reporting-service",
    description: "Real-time analytics and scheduled PDF reports",
    lifecycleStage: "requirements",
    stageProgress: 60,
    health: "healthy",
    pendingDecisions: 2,
    lastUpdated: "30m ago",
  },
  {
    id: "prod-006",
    name: "user-service",
    description: "User profiles, preferences, and GDPR compliance",
    lifecycleStage: "deploy",
    stageProgress: 85,
    health: "incident",
    pendingDecisions: 0,
    lastUpdated: "2h ago",
  },
  {
    id: "prod-007",
    name: "search-api",
    description: "Full-text search powered by OpenSearch",
    lifecycleStage: "design",
    stageProgress: 55,
    health: "healthy",
    pendingDecisions: 1,
    lastUpdated: "3h ago",
  },
  {
    id: "prod-008",
    name: "analytics-platform",
    description: "Event streaming and funnel analysis dashboard",
    lifecycleStage: "monitor",
    stageProgress: 100,
    health: "healthy",
    pendingDecisions: 0,
    lastUpdated: "5d ago",
  },
];

type FilterTab = "all" | "active-builds" | "pending-decisions" | "in-production";
type SortOption = "name-az" | "most-recent" | "priority";

const HEALTH_DOT: Record<Product["health"], string> = {
  healthy: "bg-green-400",
  degraded: "bg-amber-400",
  incident: "bg-red-400",
};

const HEALTH_TITLE: Record<Product["health"], string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  incident: "Incident",
};

const STAGE_COLORS: Record<string, string> = {
  requirements: "bg-blue-500",
  design: "bg-indigo-500",
  build: "bg-orange-500",
  test: "bg-pink-500",
  deploy: "bg-teal-500",
  monitor: "bg-green-500",
};

function LifecycleProgressBar({
  currentStage,
  stageProgress,
}: {
  currentStage: Product["lifecycleStage"];
  stageProgress: number;
}) {
  const currentIdx = LIFECYCLE_STAGES.indexOf(currentStage);

  return (
    <div data-testid="lifecycle-progress-bar" className="mt-3">
      <div className="flex items-center gap-1">
        {LIFECYCLE_STAGES.map((stage, i) => {
          const isCurrent = stage === currentStage;
          const isCompleted = i < currentIdx;

          return (
            <div key={stage} className="flex-1">
              <div
                className={`relative h-1.5 overflow-hidden rounded-full ${
                  isCompleted
                    ? "bg-green-500"
                    : isCurrent
                      ? "bg-[var(--archibald-border)]"
                      : "bg-[var(--archibald-border)]"
                }`}
              >
                {isCurrent && (
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all ${STAGE_COLORS[stage] ?? "bg-[var(--archibald-primary)]"}`}
                    style={{ width: `${stageProgress}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <div className="flex gap-1 overflow-hidden">
          {LIFECYCLE_STAGES.map((stage, i) => {
            const isCurrent = stage === currentStage;
            const isCompleted = i < currentIdx;
            return (
              <span
                key={stage}
                data-testid={isCurrent ? `stage-label-current` : undefined}
                className={`flex-1 truncate text-[9px] font-medium capitalize ${
                  isCurrent
                    ? "text-[var(--archibald-primary)]"
                    : isCompleted
                      ? "text-green-400"
                      : "text-[var(--archibald-text-muted)]"
                }`}
              >
                {stage}
              </span>
            );
          })}
        </div>
        <span className="ml-2 shrink-0 text-[10px] text-[var(--archibald-text-muted)]">
          {stageProgress}%
        </span>
      </div>
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  return (
    <div
      data-testid={`product-card-${product.id}`}
      className="rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)] p-5 hover:border-[var(--archibald-primary)]/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate">{product.name}</h3>
            {/* Health dot */}
            <span
              data-testid={`health-dot-${product.id}`}
              className={`h-2 w-2 shrink-0 rounded-full ${HEALTH_DOT[product.health]}`}
              title={HEALTH_TITLE[product.health]}
            />
          </div>
          <p className="mt-0.5 text-xs text-[var(--archibald-text-muted)] leading-snug line-clamp-2">
            {product.description}
          </p>
        </div>

        {/* Pending decisions badge */}
        {product.pendingDecisions > 0 && (
          <span
            data-testid={`decisions-badge-${product.id}`}
            className="shrink-0 rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-medium text-amber-400"
          >
            {product.pendingDecisions} decision{product.pendingDecisions !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <LifecycleProgressBar
        currentStage={product.lifecycleStage}
        stageProgress={product.stageProgress}
      />

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] text-[var(--archibald-text-muted)]">
          Updated {product.lastUpdated}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${STAGE_COLORS[product.lifecycleStage] ?? "bg-gray-500"}`}
        >
          {product.lifecycleStage}
        </span>
      </div>
    </div>
  );
}

export default function ProductsListPage() {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("most-recent");

  const filterTabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active-builds", label: "Active Builds" },
    { key: "pending-decisions", label: "Pending Decisions" },
    { key: "in-production", label: "In Production" },
  ];

  const filtered = useMemo(() => {
    let result = [...MOCK_PRODUCTS];

    // Apply tab filter
    if (activeFilter === "active-builds") {
      result = result.filter((p) => p.lifecycleStage === "build" || p.lifecycleStage === "test");
    } else if (activeFilter === "pending-decisions") {
      result = result.filter((p) => p.pendingDecisions > 0);
    } else if (activeFilter === "in-production") {
      result = result.filter((p) => p.lifecycleStage === "monitor");
    }

    // Apply search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q),
      );
    }

    // Apply sort
    if (sort === "name-az") {
      result = result.slice().sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "most-recent") {
      // Already in most-recent order by default
    } else if (sort === "priority") {
      const priorityOrder: Record<Product["health"], number> = {
        incident: 0,
        degraded: 1,
        healthy: 2,
      };
      result = result.slice().sort((a, b) => priorityOrder[a.health] - priorityOrder[b.health]);
    }

    return result;
  }, [activeFilter, search, sort]);

  const totalPending = MOCK_PRODUCTS.reduce((sum, p) => sum + p.pendingDecisions, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Products</h1>
          <p className="mt-1 text-[var(--archibald-text-muted)]">
            Managed products and their lifecycle stages.
          </p>
        </div>
        {totalPending > 0 && (
          <span className="rounded-full bg-amber-400/20 px-3 py-1 text-sm font-medium text-amber-400">
            {totalPending} pending decision{totalPending !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Tab filters */}
        <div
          className="flex gap-1 rounded-lg border border-[var(--archibald-border)] bg-[var(--archibald-surface)] p-1"
          data-testid="filter-tabs"
        >
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              data-testid={`filter-tab-${tab.key}`}
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

        {/* Search + Sort */}
        <div className="flex items-center gap-2">
          <input
            data-testid="search-input"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="rounded-lg border border-[var(--archibald-border)] bg-[var(--archibald-surface)] px-3 py-1.5 text-sm text-[var(--archibald-text)] placeholder:text-[var(--archibald-text-muted)] focus:outline-none focus:border-[var(--archibald-primary)]"
          />
          <select
            data-testid="sort-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="rounded-lg border border-[var(--archibald-border)] bg-[var(--archibald-surface)] px-3 py-1.5 text-sm text-[var(--archibald-text)] focus:outline-none focus:border-[var(--archibald-primary)]"
          >
            <option value="most-recent">Most Recent</option>
            <option value="name-az">Name A-Z</option>
            <option value="priority">Priority</option>
          </select>
        </div>
      </div>

      {/* Products Grid */}
      {filtered.length === 0 ? (
        <div
          data-testid="empty-state"
          className="rounded-xl border border-[var(--archibald-border)] bg-[var(--archibald-surface)] py-16 text-center"
        >
          <p className="text-sm text-[var(--archibald-text-muted)]">No products match this filter.</p>
        </div>
      ) : (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="products-grid"
        >
          {filtered.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      <p className="text-xs text-[var(--archibald-text-muted)]">
        Showing {filtered.length} of {MOCK_PRODUCTS.length} products
      </p>
    </div>
  );
}

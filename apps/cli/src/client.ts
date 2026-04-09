/**
 * Typed API client for the ARCHIBALD CLI.
 * Wraps fetch with auth headers and typed return shapes.
 */

export interface ClientConfig {
  archibaldUrl: string;
  archintelUrl: string;
  sentinelUrl: string;
  phoenixUrl: string;
  apiKey: string;
}

export function resolveConfig(): ClientConfig {
  return {
    archibaldUrl: process.env["ARCHIBALD_API_URL"] ?? "http://localhost:8120",
    archintelUrl: process.env["ARCHINTEL_API_URL"] ?? "http://localhost:8090",
    sentinelUrl: process.env["SENTINEL_API_URL"] ?? "http://localhost:8080",
    phoenixUrl: process.env["PHOENIX_API_URL"] ?? "http://localhost:8100",
    apiKey: process.env["ARCHIBALD_API_KEY"] ?? "",
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  baseUrl: string,
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();

  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const msg =
      parsed != null && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>)
        ? String((parsed as Record<string, unknown>)["error"])
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, parsed, msg);
  }

  return parsed as T;
}

// ── Type shapes ──────────────────────────────────────────────────────────────

export interface LifecycleRun {
  id: string;
  productId: string;
  requirement: string;
  type: string;
  status: "running" | "waiting" | "completed" | "failed";
  currentStage: string;
  createdAt: string;
  completedAt?: string | null;
}

export interface Decision {
  id: string;
  productId: string;
  runId: string;
  description: string;
  urgency: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: string;
  status: "open" | "diagnosing" | "fixing" | "resolved";
  createdAt: string;
  resolvedAt?: string | null;
}

export interface Insight {
  id: string;
  type: string;
  title: string;
  description: string;
  confidence: number;
  createdAt: string;
}

export interface EcosystemInsightsResponse {
  orgId: string;
  summary: {
    productCount: number;
    totalLifecycleRuns: number;
    confidenceScore: number | null;
    confidenceNote: string | null;
  };
  antiPatterns: Insight[];
  positivePatterns: Insight[];
  techRecommendations: Insight[];
  allInsights: Insight[];
}

export interface ProductInsightsResponse {
  productId: string;
  productName: string;
  metrics: {
    totalLifecycleRuns: number;
    avgDurationMs: number;
    loopStageFrequency: Record<string, number>;
  };
  insights: Insight[];
}

export interface AskResponse {
  answer: string;
  citations?: Array<{ nodeId: string; label: string; type: string }>;
  mode: string;
}

export interface ScanFinding {
  id: string;
  severity: string;
  title: string;
  file?: string | null;
  line?: number | null;
  ruleId?: string | null;
}

export interface ScanResult {
  verdict: "pass" | "fail" | "warn";
  findings: ScanFinding[];
  summary?: string | null;
}

// ── API client methods ────────────────────────────────────────────────────────

export function createClient(cfg: ClientConfig) {
  const arch = (path: string, init?: RequestInit) =>
    apiFetch(cfg.archibaldUrl, path, cfg.apiKey, init);

  const intel = (path: string, init?: RequestInit) =>
    apiFetch(cfg.archintelUrl, path, cfg.apiKey, init);

  const sentinel = (path: string, init?: RequestInit) =>
    apiFetch(cfg.sentinelUrl, path, cfg.apiKey, init);

  const phoenix = (path: string, init?: RequestInit) =>
    apiFetch(cfg.phoenixUrl, path, cfg.apiKey, init);

  return {
    /** Start a lifecycle run for a product */
    startLifecycle(
      productId: string,
      body: { requirement: string; type: string },
    ): Promise<{ run: LifecycleRun; message: string }> {
      return arch(`/v1/products/${productId}/lifecycle/start`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    /** Get lifecycle run status via the product lifecycle endpoint */
    getLifecycle(productId: string): Promise<{
      productId: string;
      currentStage: string;
      activeRun: LifecycleRun | null;
      pendingDecisions: Decision[];
    }> {
      return arch(`/v1/products/${productId}/lifecycle`);
    },

    /** List products */
    listProducts(): Promise<{ products: Array<{ id: string; name: string; currentStage: string }> }> {
      return arch("/v1/products");
    },

    /** Approve a decision */
    approveDecision(
      productId: string,
      decisionId: string,
      comment?: string,
    ): Promise<{ decision: Decision }> {
      return arch(`/v1/products/${productId}/decisions/${decisionId}/approve`, {
        method: "POST",
        body: JSON.stringify({ comment: comment ?? null }),
      });
    },

    /** Get product-level insights */
    getProductInsights(productId: string): Promise<ProductInsightsResponse> {
      return arch(`/v1/products/${productId}/insights`);
    },

    /** Get ecosystem-level insights */
    getEcosystemInsights(): Promise<EcosystemInsightsResponse> {
      return arch("/v1/ecosystem/insights");
    },

    /** Ask ARCHINTEL a question */
    ask(body: {
      question: string;
      repoId?: string;
      mode?: string;
    }): Promise<AskResponse> {
      return intel("/v1/ask", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    /** Submit a diff to SENTINEL pre-commit hook */
    submitDiff(body: { diff: string; repoId?: string }): Promise<ScanResult> {
      return sentinel("/v1/hooks/pre-commit", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    /** List SENTINEL findings for a repo */
    getFindings(repoId: string): Promise<{ findings: ScanFinding[] }> {
      return sentinel(`/v1/findings?repoId=${encodeURIComponent(repoId)}`);
    },

    /** List PHOENIX incidents */
    getIncidents(status?: string): Promise<{ incidents: Incident[] }> {
      const qs = status ? `?status=${encodeURIComponent(status)}` : "";
      return phoenix(`/v1/incidents${qs}`);
    },
  };
}

export type ArchibaldClient = ReturnType<typeof createClient>;

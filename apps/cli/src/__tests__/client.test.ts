import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  apiFetch,
  ApiError,
  resolveConfig,
  createClient,
  type ClientConfig,
} from "../client.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  });
}

const BASE_CFG: ClientConfig = {
  archibaldUrl: "http://localhost:8120",
  archintelUrl: "http://localhost:8090",
  sentinelUrl: "http://localhost:8080",
  phoenixUrl: "http://localhost:8100",
  apiKey: "test-key",
};

// ── apiFetch ──────────────────────────────────────────────────────────────────

describe("apiFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch(200, { ok: true }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the correct URL", async () => {
    const result = await apiFetch("http://localhost:8120", "/v1/products", "key");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8120/v1/products",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer key" }) }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("sets Authorization header from apiKey", async () => {
    await apiFetch("http://localhost:8120", "/v1/test", "my-api-key");
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-api-key");
  });

  it("omits Authorization header when apiKey is empty", async () => {
    await apiFetch("http://localhost:8120", "/v1/test", "");
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("throws ApiError on non-2xx with error field", async () => {
    vi.stubGlobal("fetch", mockFetch(404, { error: "Not found" }));
    await expect(apiFetch("http://localhost:8120", "/v1/missing", "k")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "Not found",
    });
  });

  it("throws ApiError on 500 with generic message", async () => {
    vi.stubGlobal("fetch", mockFetch(500, { message: "boom" }));
    await expect(apiFetch("http://localhost:8120", "/v1/crash", "k")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
    });
  });

  it("parses empty response body as null", async () => {
    vi.stubGlobal("fetch", mockFetch(204, ""));
    const result = await apiFetch("http://localhost:8120", "/v1/empty", "k");
    expect(result).toBeNull();
  });

  it("returns plain text when body is not JSON", async () => {
    vi.stubGlobal("fetch", mockFetch(200, "plain text"));
    const result = await apiFetch("http://localhost:8120", "/v1/text", "k");
    expect(result).toBe("plain text");
  });

  it("forwards custom headers from options", async () => {
    await apiFetch("http://localhost:8120", "/v1/test", "k", {
      headers: { "X-Custom": "yes" },
    });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Custom"]).toBe("yes");
  });
});

// ── resolveConfig ─────────────────────────────────────────────────────────────

describe("resolveConfig", () => {
  afterEach(() => {
    delete process.env["ARCHIBALD_API_URL"];
    delete process.env["ARCHINTEL_API_URL"];
    delete process.env["SENTINEL_API_URL"];
    delete process.env["PHOENIX_API_URL"];
    delete process.env["ARCHIBALD_API_KEY"];
  });

  it("returns default URLs when env vars are not set", () => {
    const cfg = resolveConfig();
    expect(cfg.archibaldUrl).toBe("http://localhost:8120");
    expect(cfg.archintelUrl).toBe("http://localhost:8090");
    expect(cfg.sentinelUrl).toBe("http://localhost:8080");
    expect(cfg.phoenixUrl).toBe("http://localhost:8100");
    expect(cfg.apiKey).toBe("");
  });

  it("reads URLs from environment variables", () => {
    process.env["ARCHIBALD_API_URL"] = "http://custom:9000";
    process.env["ARCHINTEL_API_URL"] = "http://intel:9001";
    process.env["SENTINEL_API_URL"] = "http://sentinel:9002";
    process.env["PHOENIX_API_URL"] = "http://phoenix:9003";
    process.env["ARCHIBALD_API_KEY"] = "secret-key";

    const cfg = resolveConfig();
    expect(cfg.archibaldUrl).toBe("http://custom:9000");
    expect(cfg.archintelUrl).toBe("http://intel:9001");
    expect(cfg.sentinelUrl).toBe("http://sentinel:9002");
    expect(cfg.phoenixUrl).toBe("http://phoenix:9003");
    expect(cfg.apiKey).toBe("secret-key");
  });
});

// ── createClient — individual methods ─────────────────────────────────────────

describe("createClient.startLifecycle", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to the correct endpoint with requirement and type", async () => {
    const mockRun = {
      id: "run-1",
      productId: "prod-1",
      requirement: "Add OAuth",
      type: "feature",
      status: "running",
      currentStage: "requirements",
      createdAt: new Date().toISOString(),
    };
    vi.stubGlobal("fetch", mockFetch(202, { run: mockRun, message: "Started" }));

    const client = createClient(BASE_CFG);
    const result = await client.startLifecycle("prod-1", {
      requirement: "Add OAuth",
      type: "feature",
    });

    expect(result.run.id).toBe("run-1");
    expect(result.message).toBe("Started");

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8120/v1/products/prod-1/lifecycle/start");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      requirement: "Add OAuth",
      type: "feature",
    });
  });
});

describe("createClient.getLifecycle", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GETs the product lifecycle endpoint", async () => {
    const payload = {
      productId: "prod-2",
      currentStage: "design",
      activeRun: null,
      pendingDecisions: [],
    };
    vi.stubGlobal("fetch", mockFetch(200, payload));

    const client = createClient(BASE_CFG);
    const result = await client.getLifecycle("prod-2");

    expect(result.productId).toBe("prod-2");
    expect(result.currentStage).toBe("design");

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("http://localhost:8120/v1/products/prod-2/lifecycle");
  });
});

describe("createClient.approveDecision", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to approve endpoint with optional comment", async () => {
    const decision = {
      id: "dec-1",
      productId: "prod-1",
      runId: "run-1",
      description: "Deploy to production?",
      urgency: "high",
      status: "approved",
      createdAt: new Date().toISOString(),
    };
    vi.stubGlobal("fetch", mockFetch(200, { decision }));

    const client = createClient(BASE_CFG);
    const result = await client.approveDecision("prod-1", "dec-1", "LGTM");

    expect(result.decision.status).toBe("approved");

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8120/v1/products/prod-1/decisions/dec-1/approve");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ comment: "LGTM" });
  });

  it("sends null comment when not provided", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(200, {
        decision: { id: "dec-2", status: "approved", productId: "p", runId: "r", description: "x", urgency: "low", createdAt: "" },
      }),
    );
    const client = createClient(BASE_CFG);
    await client.approveDecision("prod-1", "dec-2");

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ comment: null });
  });
});

describe("createClient.getProductInsights", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GETs product insights endpoint", async () => {
    const payload = {
      productId: "prod-3",
      productName: "My App",
      metrics: { totalLifecycleRuns: 5, avgDurationMs: 12000, loopStageFrequency: {} },
      insights: [],
    };
    vi.stubGlobal("fetch", mockFetch(200, payload));

    const client = createClient(BASE_CFG);
    const result = await client.getProductInsights("prod-3");

    expect(result.productName).toBe("My App");
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("http://localhost:8120/v1/products/prod-3/insights");
  });
});

describe("createClient.getEcosystemInsights", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GETs ecosystem insights endpoint", async () => {
    const payload = {
      orgId: "org-1",
      summary: { productCount: 3, totalLifecycleRuns: 10, confidenceScore: 65, confidenceNote: null },
      antiPatterns: [],
      positivePatterns: [],
      techRecommendations: [],
      allInsights: [],
    };
    vi.stubGlobal("fetch", mockFetch(200, payload));

    const client = createClient(BASE_CFG);
    const result = await client.getEcosystemInsights();

    expect(result.summary.productCount).toBe(3);
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("http://localhost:8120/v1/ecosystem/insights");
  });
});

describe("createClient.ask", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to ARCHINTEL /v1/ask with question and optional repoId/mode", async () => {
    const payload = {
      answer: "The service is in src/services/auth.ts",
      citations: [{ nodeId: "uuid-1", label: "AuthService", type: "class" }],
      mode: "chat",
    };
    vi.stubGlobal("fetch", mockFetch(200, payload));

    const client = createClient(BASE_CFG);
    const result = await client.ask({
      question: "Where is auth?",
      repoId: "repo-1",
      mode: "chat",
    });

    expect(result.answer).toContain("src/services/auth.ts");
    expect(result.citations).toHaveLength(1);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8090/v1/ask");
    expect(JSON.parse(init.body as string)).toEqual({
      question: "Where is auth?",
      repoId: "repo-1",
      mode: "chat",
    });
  });
});

describe("createClient.submitDiff", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSTs diff to SENTINEL pre-commit endpoint", async () => {
    const payload = {
      verdict: "pass",
      findings: [],
      summary: "No issues found",
    };
    vi.stubGlobal("fetch", mockFetch(200, payload));

    const client = createClient(BASE_CFG);
    const result = await client.submitDiff({ diff: "diff --git a/foo.ts b/foo.ts\n+added line" });

    expect(result.verdict).toBe("pass");

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8080/v1/hooks/pre-commit");
    expect(init.method).toBe("POST");
  });
});

describe("createClient.getFindings", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GETs findings with URL-encoded repoId query param", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { findings: [] }));

    const client = createClient(BASE_CFG);
    await client.getFindings("my repo/with spaces");

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("http://localhost:8080/v1/findings?repoId=my%20repo%2Fwith%20spaces");
  });
});

describe("createClient.getIncidents", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GETs incidents without query param when status is undefined", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { incidents: [] }));
    const client = createClient(BASE_CFG);
    await client.getIncidents();

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("http://localhost:8100/v1/incidents");
  });

  it("appends status query param when provided", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { incidents: [] }));
    const client = createClient(BASE_CFG);
    await client.getIncidents("open");

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("http://localhost:8100/v1/incidents?status=open");
  });

  it("returns incident list from response", async () => {
    const incident = {
      id: "inc-1",
      title: "DB CPU spike",
      severity: "high",
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    vi.stubGlobal("fetch", mockFetch(200, { incidents: [incident] }));

    const client = createClient(BASE_CFG);
    const result = await client.getIncidents("open");

    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0]?.title).toBe("DB CPU spike");
  });
});

// ── ApiError ──────────────────────────────────────────────────────────────────

describe("ApiError", () => {
  it("is instanceof Error", () => {
    const err = new ApiError(404, { error: "Not found" }, "Not found");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.name).toBe("ApiError");
  });

  it("carries the original body", () => {
    const body = { error: "Forbidden", details: ["missing scope"] };
    const err = new ApiError(403, body, "Forbidden");
    expect(err.body).toEqual(body);
  });
});

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";

// ── Prisma stub ────────────────────────────────────────────────────────────────
function makePrismaStub() {
  const products: Record<string, any> = {};
  const runs: Record<string, any> = {};
  const insights: Record<string, any> = {};

  return {
    archibaldProduct: {
      findFirst: async ({ where }: any) => {
        return (
          Object.values(products).find((p: any) => {
            if (where?.id && p.id !== where.id) return false;
            if (where?.orgId && p.orgId !== where.orgId) return false;
            return true;
          }) ?? null
        );
      },
      findMany: async ({ where }: any) => Object.values(products).filter((p: any) => p.orgId === where?.orgId),
      count: async ({ where }: any) =>
        Object.values(products).filter((p: any) => p.orgId === where?.orgId).length,
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const product = { id, ...data, createdAt: new Date().toISOString() };
        products[id] = product;
        return product;
      },
      _seed: (product: any) => { products[product.id] = product; },
    },
    archibaldLifecycleRun: {
      findFirst: async () => null,
      findMany: async ({ where }: any) => {
        return Object.values(runs).filter((r: any) => {
          if (where?.productId && r.productId !== where.productId) return false;
          if (where?.status && r.status !== where.status) return false;
          if (where?.orgId && r.orgId !== where.orgId) return false;
          return true;
        });
      },
      count: async ({ where }: any) =>
        Object.values(runs).filter((r: any) => {
          if (where?.orgId && r.orgId !== where.orgId) return false;
          return true;
        }).length,
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const run = { id, ...data, createdAt: new Date().toISOString() };
        runs[id] = run;
        return run;
      },
      _seed: (run: any) => { runs[run.id] = run; },
    },
    archibaldDecision: {
      findFirst: async () => null,
      findMany: async () => [],
      update: async ({ where, data }: any) => ({ id: where.id, ...data }),
    },
    archibaldInsight: {
      findMany: async ({ where }: any) => {
        return Object.values(insights).filter((i: any) => {
          if (where?.productId && i.productId !== where.productId) return false;
          if (where?.orgId && i.orgId !== where.orgId) return false;
          if (where?.dismissed !== undefined && i.dismissed !== where.dismissed) return false;
          if (where?.scope && i.scope !== where.scope) return false;
          return true;
        });
      },
      _seed: (insight: any) => { insights[insight.id] = insight; },
    },
    archibaldAgentExecution: {
      findMany: async () => [],
      count: async () => 0,
      findFirst: async () => null,
    },
  };
}

function makePublishStub() {
  const published: Array<{ stream: string; data: Record<string, unknown> }> = [];
  const publish = async (stream: string, data: Record<string, unknown>): Promise<string> => {
    published.push({ stream, data });
    return crypto.randomUUID();
  };
  return { publish, published };
}

// ── Auth headers ───────────────────────────────────────────────────────────────
const ORG = "org-insights-test";
const adminHeaders = { "x-org-id": ORG, "x-user-id": "user-admin", "x-role": "ADMIN" };
const engineerHeaders = { "x-org-id": ORG, "x-user-id": "user-eng", "x-role": "ENGINEER" };
const viewerHeaders = { "x-org-id": ORG, "x-user-id": "user-viewer", "x-role": "VIEWER" };

// ── Helpers ────────────────────────────────────────────────────────────────────
function makeProduct(orgId: string, name?: string) {
  return {
    id: crypto.randomUUID(),
    orgId,
    name: name ?? `product-${crypto.randomUUID().slice(0, 8)}`,
    currentStage: "conception",
    createdAt: new Date().toISOString(),
  };
}

function makeLifecycleRun(productId: string, orgId: string, overrides: Record<string, any> = {}) {
  const createdAt = new Date(Date.now() - 3600_000).toISOString();
  const completedAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    productId,
    orgId,
    status: "completed",
    agentExecutions: [],
    stageTransitions: [],
    createdAt,
    completedAt,
    ...overrides,
  };
}

function makeInsight(productId: string, orgId: string, overrides: Record<string, any> = {}) {
  return {
    id: crypto.randomUUID(),
    productId,
    orgId,
    dismissed: false,
    confidence: 0.85,
    type: "pattern",
    scope: "product",
    summary: "Test insight",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("Insights routes", () => {
  let app: FastifyInstance;
  let prisma: ReturnType<typeof makePrismaStub>;
  let publishHelper: ReturnType<typeof makePublishStub>;

  beforeEach(async () => {
    prisma = makePrismaStub();
    publishHelper = makePublishStub();

    app = await buildApp({
      auth: { jwtSecret: "test-secret", lookupApiKey: async () => null },
      products: { prisma, publish: publishHelper.publish },
      decisions: { prisma, publish: publishHelper.publish },
      insights: { prisma },
      agents: { prisma },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── GET /v1/products/:id/insights ──────────────────────────────────────────

  it("GET /v1/products/:id/insights returns 200 with structured metrics", async () => {
    const product = makeProduct(ORG, "my-service");
    prisma.archibaldProduct._seed(product);

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}/insights`,
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.productId).toBe(product.id);
    expect(body.productName).toBe("my-service");
    expect(body.metrics).toBeDefined();
    expect(typeof body.metrics.totalLifecycleRuns).toBe("number");
    expect(typeof body.metrics.avgDurationMs).toBe("number");
    expect(body.metrics.loopStageFrequency).toBeDefined();
    expect(Array.isArray(body.insights)).toBe(true);
  });

  it("GET /v1/products/:id/insights returns totalLifecycleRuns=0 when no runs", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}/insights`,
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().metrics.totalLifecycleRuns).toBe(0);
    expect(res.json().metrics.avgDurationMs).toBe(0);
  });

  it("GET /v1/products/:id/insights computes avgDurationMs from completed runs", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);

    const run = makeLifecycleRun(product.id, ORG, { status: "completed" });
    prisma.archibaldLifecycleRun._seed(run);

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}/insights`,
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metrics.totalLifecycleRuns).toBe(1);
    expect(body.metrics.avgDurationMs).toBeGreaterThan(0);
  });

  it("GET /v1/products/:id/insights returns product-scoped insights", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);

    const insight = makeInsight(product.id, ORG, { dismissed: false });
    const dismissedInsight = makeInsight(product.id, ORG, { dismissed: true });
    prisma.archibaldInsight._seed(insight);
    prisma.archibaldInsight._seed(dismissedInsight);

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}/insights`,
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Only non-dismissed insights returned
    expect(body.insights.every((i: any) => !i.dismissed)).toBe(true);
  });

  it("GET /v1/products/:id/insights computes loopStageFrequency from transitions", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);

    const run = makeLifecycleRun(product.id, ORG, {
      stageTransitions: [
        { fromStage: "design", isLoopback: true },
        { fromStage: "design", isLoopback: true },
        { fromStage: "build", isLoopback: false },
      ],
    });
    prisma.archibaldLifecycleRun._seed(run);

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}/insights`,
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metrics.loopStageFrequency.design).toBe(2);
    expect(body.metrics.loopStageFrequency.build).toBeUndefined();
  });

  it("GET /v1/products/:id/insights returns 404 for unknown product", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${crypto.randomUUID()}/insights`,
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Product not found");
  });

  it("GET /v1/products/:id/insights returns 404 when product belongs to another org", async () => {
    const product = makeProduct("org-other");
    prisma.archibaldProduct._seed(product);

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}/insights`,
      headers: viewerHeaders, // ORG != org-other
    });

    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/products/:id/insights returns 400 for non-UUID product ID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/products/not-a-uuid/insights",
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("GET /v1/products/:id/insights returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${crypto.randomUUID()}/insights`,
    });

    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/products/:id/insights is accessible by VIEWER role", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}/insights`,
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
  });

  // ── GET /v1/ecosystem/insights ─────────────────────────────────────────────

  it("GET /v1/ecosystem/insights returns 200 with summary structure", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/ecosystem/insights",
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.orgId).toBe(ORG);
    expect(body.summary).toBeDefined();
    expect(typeof body.summary.productCount).toBe("number");
    expect(typeof body.summary.totalLifecycleRuns).toBe("number");
    expect(Array.isArray(body.antiPatterns)).toBe(true);
    expect(Array.isArray(body.positivePatterns)).toBe(true);
    expect(Array.isArray(body.techRecommendations)).toBe(true);
    expect(Array.isArray(body.allInsights)).toBe(true);
  });

  it("GET /v1/ecosystem/insights returns confidenceScore=null when < 5 runs", async () => {
    // Seed fewer than 5 runs
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    for (let i = 0; i < 3; i++) {
      prisma.archibaldLifecycleRun._seed(makeLifecycleRun(product.id, ORG));
    }

    const res = await app.inject({
      method: "GET",
      url: "/v1/ecosystem/insights",
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.confidenceScore).toBeNull();
    expect(body.summary.confidenceNote).toBeDefined();
    expect(typeof body.summary.confidenceNote).toBe("string");
  });

  it("GET /v1/ecosystem/insights returns confidenceScore when >= 5 runs", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    for (let i = 0; i < 6; i++) {
      prisma.archibaldLifecycleRun._seed(makeLifecycleRun(product.id, ORG));
    }

    const res = await app.inject({
      method: "GET",
      url: "/v1/ecosystem/insights",
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.confidenceScore).not.toBeNull();
    expect(typeof body.summary.confidenceScore).toBe("number");
    expect(body.summary.confidenceNote).toBeNull();
  });

  it("GET /v1/ecosystem/insights correctly categorises insights by type", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);

    prisma.archibaldInsight._seed(makeInsight(product.id, ORG, { type: "anti_pattern", scope: "ecosystem" }));
    prisma.archibaldInsight._seed(makeInsight(product.id, ORG, { type: "pattern", scope: "ecosystem" }));
    prisma.archibaldInsight._seed(makeInsight(product.id, ORG, { type: "tech_recommendation", scope: "ecosystem" }));

    const res = await app.inject({
      method: "GET",
      url: "/v1/ecosystem/insights",
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.antiPatterns.length).toBe(1);
    expect(body.positivePatterns.length).toBe(1);
    expect(body.techRecommendations.length).toBe(1);
    expect(body.allInsights.length).toBe(3);
  });

  it("GET /v1/ecosystem/insights does not include dismissed insights", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);

    prisma.archibaldInsight._seed(makeInsight(product.id, ORG, { type: "pattern", scope: "ecosystem", dismissed: true }));

    const res = await app.inject({
      method: "GET",
      url: "/v1/ecosystem/insights",
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().allInsights.length).toBe(0);
  });

  it("GET /v1/ecosystem/insights returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/ecosystem/insights",
    });

    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/ecosystem/insights is accessible by VIEWER role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/ecosystem/insights",
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
  });

  // ── GET /v1/ecosystem/health ───────────────────────────────────────────────

  it("GET /v1/ecosystem/health returns 200 with ecosystem health structure", async () => {
    // All external service fetches will fail (unreachable in test), which is expected
    const res = await app.inject({
      method: "GET",
      url: "/v1/ecosystem/health",
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(["healthy", "degraded", "critical"]).toContain(body.overallStatus);
    expect(typeof body.healthyCount).toBe("number");
    expect(body.totalCount).toBe(5);
    expect(Array.isArray(body.solutions)).toBe(true);
    expect(body.solutions.length).toBe(5);
    expect(body.checkedAt).toBeDefined();
  });

  it("GET /v1/ecosystem/health solution entries have required fields", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/ecosystem/health",
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const solutionNames = body.solutions.map((s: any) => s.name);
    expect(solutionNames).toContain("SENTINEL");
    expect(solutionNames).toContain("ARCHINTEL");
    expect(solutionNames).toContain("PHOENIX");
    expect(solutionNames).toContain("FORGE");
    expect(solutionNames).toContain("ARCHIBALD");
  });

  it("GET /v1/ecosystem/health returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/ecosystem/health",
    });

    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/ecosystem/health is accessible by VIEWER role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/ecosystem/health",
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/ecosystem/health overallStatus is consistent with healthyCount", async () => {
    // The overallStatus must be derived correctly from healthyCount regardless of
    // which services happen to be reachable in the current environment.
    const res = await app.inject({
      method: "GET",
      url: "/v1/ecosystem/health",
      headers: adminHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const { healthyCount, overallStatus } = body;

    const expectedStatus =
      healthyCount === 5 ? "healthy" : healthyCount >= 3 ? "degraded" : "critical";

    expect(overallStatus).toBe(expectedStatus);
  });
});

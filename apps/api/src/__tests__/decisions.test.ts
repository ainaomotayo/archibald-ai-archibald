import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";

// ── Prisma stub ────────────────────────────────────────────────────────────────
function makePrismaStub() {
  const products: Record<string, any> = {};
  const decisions: Record<string, any> = {};

  return {
    archibaldProduct: {
      findFirst: async ({ where }: any) => {
        return (
          Object.values(products).find((p: any) => {
            if (where?.id && p.id !== where.id) return false;
            if (where?.orgId && p.orgId !== where.orgId) return false;
            if (where?.name && p.name !== where.name) return false;
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
      findMany: async () => [],
      create: async ({ data }: any) => ({
        id: crypto.randomUUID(),
        ...data,
        createdAt: new Date().toISOString(),
      }),
    },
    archibaldDecision: {
      findFirst: async ({ where }: any) => {
        return (
          Object.values(decisions).find((d: any) => {
            if (where?.id && d.id !== where.id) return false;
            if (where?.productId && d.productId !== where.productId) return false;
            if (where?.orgId && d.orgId !== where.orgId) return false;
            if (where?.status && d.status !== where.status) return false;
            return true;
          }) ?? null
        );
      },
      findMany: async ({ where }: any) => {
        return Object.values(decisions).filter((d: any) => {
          if (where?.productId && d.productId !== where.productId) return false;
          if (where?.status && d.status !== where.status) return false;
          return true;
        });
      },
      update: async ({ where, data }: any) => {
        const existing = decisions[where.id];
        if (!existing) return null;
        const updated = { ...existing, ...data };
        decisions[where.id] = updated;
        return updated;
      },
      _seed: (decision: any) => { decisions[decision.id] = decision; },
    },
    archibaldInsight: {
      findMany: async () => [],
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
const ORG = "org-decisions-test";
const adminHeaders = { "x-org-id": ORG, "x-user-id": "user-admin", "x-role": "ADMIN" };
const engineerHeaders = { "x-org-id": ORG, "x-user-id": "user-eng-456", "x-role": "ENGINEER" };
const viewerHeaders = { "x-org-id": ORG, "x-user-id": "user-viewer", "x-role": "VIEWER" };

// ── Helpers ────────────────────────────────────────────────────────────────────
function makeProduct(orgId: string) {
  return {
    id: crypto.randomUUID(),
    orgId,
    name: `product-${crypto.randomUUID().slice(0, 8)}`,
    currentStage: "conception",
    createdAt: new Date().toISOString(),
  };
}

function makeDecision(productId: string, orgId: string, overrides: Record<string, any> = {}) {
  return {
    id: crypto.randomUUID(),
    productId,
    orgId,
    runId: crypto.randomUUID(),
    status: "pending",
    urgency: "normal",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("Decisions routes", () => {
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

  // ── GET /v1/products/:id/decisions ─────────────────────────────────────────

  it("GET /v1/products/:id/decisions returns 200 with empty list when none pending", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}/decisions`,
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.decisions)).toBe(true);
    expect(body.decisions.length).toBe(0);
  });

  it("GET /v1/products/:id/decisions returns only pending decisions", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);

    const pending = makeDecision(product.id, ORG, { status: "pending" });
    const resolved = makeDecision(product.id, ORG, { status: "approved" });
    prisma.archibaldDecision._seed(pending);
    prisma.archibaldDecision._seed(resolved);

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}/decisions`,
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.decisions.length).toBe(1);
    expect(body.decisions[0].id).toBe(pending.id);
    expect(body.decisions[0].status).toBe("pending");
  });

  it("GET /v1/products/:id/decisions returns 404 for unknown product", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${crypto.randomUUID()}/decisions`,
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Product not found");
  });

  it("GET /v1/products/:id/decisions returns 404 when product belongs to another org", async () => {
    const product = makeProduct("org-other");
    prisma.archibaldProduct._seed(product);

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}/decisions`,
      headers: viewerHeaders, // ORG != org-other
    });

    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/products/:id/decisions returns 400 for non-UUID product ID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/products/not-a-uuid/decisions",
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("GET /v1/products/:id/decisions returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${crypto.randomUUID()}/decisions`,
    });

    expect(res.statusCode).toBe(401);
  });

  // VIEWER is the minimum required role — all authenticated roles should succeed
  it("GET /v1/products/:id/decisions accessible by VIEWER role", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}/decisions`,
      headers: viewerHeaders,
    });

    expect(res.statusCode).toBe(200);
  });

  // ── POST /v1/products/:id/decisions/:decisionId/approve ────────────────────

  it("POST approve returns 200 and updates decision to approved", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    const decision = makeDecision(product.id, ORG);
    prisma.archibaldDecision._seed(decision);

    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${decision.id}/approve`,
      headers: engineerHeaders,
      body: { comment: "LGTM" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.decision).toBeDefined();
    expect(body.decision.status).toBe("approved");
  });

  it("POST approve publishes decision.approved event", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    const decision = makeDecision(product.id, ORG);
    prisma.archibaldDecision._seed(decision);

    await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${decision.id}/approve`,
      headers: engineerHeaders,
      body: {},
    });

    const event = publishHelper.published.find((p) => p.stream === "archibald.decisions");
    expect(event).toBeDefined();
    expect(event!.data.type).toBe("decision.approved");
    expect(event!.data.decisionId).toBe(decision.id);
    expect(event!.data.productId).toBe(product.id);
  });

  it("POST approve records optional comment in event", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    const decision = makeDecision(product.id, ORG);
    prisma.archibaldDecision._seed(decision);

    await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${decision.id}/approve`,
      headers: engineerHeaders,
      body: { comment: "Approved after security review" },
    });

    const event = publishHelper.published.find((p) => p.stream === "archibald.decisions");
    expect(event!.data.comment).toBe("Approved after security review");
  });

  it("POST approve works with no comment (optional field)", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    const decision = makeDecision(product.id, ORG);
    prisma.archibaldDecision._seed(decision);

    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${decision.id}/approve`,
      headers: engineerHeaders,
      body: {},
    });

    expect(res.statusCode).toBe(200);
  });

  it("POST approve returns 404 for unknown decision", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);

    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${crypto.randomUUID()}/approve`,
      headers: engineerHeaders,
      body: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Decision not found or already resolved");
  });

  it("POST approve returns 404 when decision belongs to another product", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    const otherProduct = makeProduct(ORG);
    prisma.archibaldProduct._seed(otherProduct);
    const decision = makeDecision(otherProduct.id, ORG);
    prisma.archibaldDecision._seed(decision);

    // Use product.id but decisionId that belongs to otherProduct
    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${decision.id}/approve`,
      headers: engineerHeaders,
      body: {},
    });

    expect(res.statusCode).toBe(404);
  });

  it("POST approve returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${crypto.randomUUID()}/decisions/${crypto.randomUUID()}/approve`,
      body: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it("POST approve returns 403 for VIEWER role (ENGINEER required)", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    const decision = makeDecision(product.id, ORG);
    prisma.archibaldDecision._seed(decision);

    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${decision.id}/approve`,
      headers: viewerHeaders,
      body: {},
    });

    expect(res.statusCode).toBe(403);
  });

  it("POST approve returns 400 for non-UUID param IDs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/products/bad-id/decisions/also-bad/approve",
      headers: engineerHeaders,
      body: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("POST approve returns 400 when extra unknown fields are sent", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    const decision = makeDecision(product.id, ORG);
    prisma.archibaldDecision._seed(decision);

    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${decision.id}/approve`,
      headers: engineerHeaders,
      body: { comment: "ok", unknownField: "should fail" },
    });

    // Schema is strict — unknown fields rejected
    expect(res.statusCode).toBe(400);
  });

  // ── POST /v1/products/:id/decisions/:decisionId/reject ─────────────────────

  it("POST reject returns 200 and updates decision to rejected", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    const decision = makeDecision(product.id, ORG);
    prisma.archibaldDecision._seed(decision);

    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${decision.id}/reject`,
      headers: engineerHeaders,
      body: { justification: "Security requirements not met" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.decision).toBeDefined();
    expect(body.decision.status).toBe("rejected");
  });

  it("POST reject publishes decision.rejected event with justification", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    const decision = makeDecision(product.id, ORG);
    prisma.archibaldDecision._seed(decision);

    const justification = "Compliance policy violation detected";

    await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${decision.id}/reject`,
      headers: engineerHeaders,
      body: { justification },
    });

    const event = publishHelper.published.find((p) => p.stream === "archibald.decisions");
    expect(event).toBeDefined();
    expect(event!.data.type).toBe("decision.rejected");
    expect(event!.data.justification).toBe(justification);
    expect(event!.data.decisionId).toBe(decision.id);
    expect(event!.data.productId).toBe(product.id);
  });

  it("POST reject returns 400 when justification is missing (required field)", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    const decision = makeDecision(product.id, ORG);
    prisma.archibaldDecision._seed(decision);

    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${decision.id}/reject`,
      headers: engineerHeaders,
      body: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("POST reject returns 400 when justification is empty string", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    const decision = makeDecision(product.id, ORG);
    prisma.archibaldDecision._seed(decision);

    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${decision.id}/reject`,
      headers: engineerHeaders,
      body: { justification: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("POST reject returns 404 for unknown decision", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);

    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${crypto.randomUUID()}/reject`,
      headers: engineerHeaders,
      body: { justification: "not applicable" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Decision not found or already resolved");
  });

  it("POST reject returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${crypto.randomUUID()}/decisions/${crypto.randomUUID()}/reject`,
      body: { justification: "reason" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("POST reject returns 403 for VIEWER role", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    const decision = makeDecision(product.id, ORG);
    prisma.archibaldDecision._seed(decision);

    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${decision.id}/reject`,
      headers: viewerHeaders,
      body: { justification: "reason" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("POST reject returns 400 for non-UUID param IDs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/products/bad-id/decisions/also-bad/reject",
      headers: engineerHeaders,
      body: { justification: "reason" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("POST reject sets resolvedBy to the authenticated user", async () => {
    const product = makeProduct(ORG);
    prisma.archibaldProduct._seed(product);
    const decision = makeDecision(product.id, ORG);
    prisma.archibaldDecision._seed(decision);

    await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/decisions/${decision.id}/reject`,
      headers: engineerHeaders,
      body: { justification: "Policy says no" },
    });

    const event = publishHelper.published.find((p) => p.stream === "archibald.decisions");
    expect(event!.data.resolvedBy).toBe("user-eng-456");
  });
});

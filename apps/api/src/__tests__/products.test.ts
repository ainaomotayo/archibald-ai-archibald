import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";

// Minimal stub prisma for testing route shapes
function makePrismaStub() {
  const products: Record<string, any> = {};
  const runs: Record<string, any> = {};

  return {
    archibaldProduct: {
      findFirst: async ({ where }: any) => {
        return Object.values(products).find((p: any) => {
          if (where.id && p.id !== where.id) return false;
          if (where.orgId && p.orgId !== where.orgId) return false;
          if (where.name && p.name !== where.name) return false;
          return true;
        }) ?? null;
      },
      findMany: async ({ where }: any) => {
        return Object.values(products).filter((p: any) => p.orgId === where.orgId);
      },
      count: async ({ where }: any) => {
        return Object.values(products).filter((p: any) => p.orgId === where.orgId).length;
      },
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const product = { id, ...data, createdAt: new Date().toISOString() };
        products[id] = product;
        return product;
      },
    },
    archibaldLifecycleRun: {
      findFirst: async ({ where }: any) => {
        return Object.values(runs).find((r: any) => {
          if (where.productId && r.productId !== where.productId) return false;
          if (where.status && Array.isArray(where.status?.in)) {
            if (!where.status.in.includes(r.status)) return false;
          }
          return true;
        }) ?? null;
      },
      findMany: async () => [],
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const run = { id, ...data, createdAt: new Date().toISOString() };
        runs[id] = run;
        return run;
      },
    },
    archibaldDecision: {
      findMany: async () => [],
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

// Auth headers for test requests
const authHeaders = {
  "x-org-id": "org-test-123",
  "x-user-id": "user-test-456",
  "x-role": "ADMIN",
};

describe("Products routes", () => {
  let app: FastifyInstance;
  let prisma: ReturnType<typeof makePrismaStub>;
  let publishHelper: ReturnType<typeof makePublishStub>;

  beforeEach(async () => {
    prisma = makePrismaStub();
    publishHelper = makePublishStub();

    app = await buildApp({
      auth: {
        jwtSecret: "test-secret",
        lookupApiKey: async () => null,
      },
      products: { prisma, publish: publishHelper.publish },
      decisions: { prisma, publish: publishHelper.publish },
      insights: { prisma },
      agents: { prisma },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("POST /v1/products creates a product and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: authHeaders,
      body: {
        name: "test-service",
        description: "A test microservice",
        owner: "team-platform",
        techStack: ["TypeScript", "PostgreSQL"],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.product).toBeDefined();
    expect(body.product.name).toBe("test-service");
    expect(body.product.currentStage).toBe("conception");
    expect(body.product.id).toBeDefined();
  });

  it("POST /v1/products validates required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: authHeaders,
      body: { name: "missing-fields" },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.fields).toBeDefined();
  });

  it("GET /v1/products returns list of products", async () => {
    // Create a product first
    await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: authHeaders,
      body: {
        name: "list-test-service",
        description: "For list test",
        owner: "team-alpha",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/products",
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.products)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(body.page).toBeDefined();
    expect(body.limit).toBeDefined();
  });

  it("GET /v1/products/:id returns product details", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: authHeaders,
      body: {
        name: "detail-test-service",
        description: "For detail test",
        owner: "team-beta",
      },
    });

    const { product } = createRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(product.id);
    expect(body.name).toBe("detail-test-service");
  });

  it("GET /v1/products/:id returns 404 for unknown product", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${crypto.randomUUID()}`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/products/:id/lifecycle returns lifecycle state", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: authHeaders,
      body: {
        name: "lifecycle-test-service",
        description: "For lifecycle test",
        owner: "team-gamma",
      },
    });

    const { product } = createRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}/lifecycle`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.productId).toBe(product.id);
    expect(body.currentStage).toBe("conception");
    expect(body.pendingDecisions).toBeDefined();
  });

  it("POST /v1/products/:id/lifecycle/start triggers a lifecycle run", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: authHeaders,
      body: {
        name: "start-lifecycle-service",
        description: "For start test",
        owner: "team-delta",
      },
    });

    const { product } = createRes.json();

    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/lifecycle/start`,
      headers: authHeaders,
      body: {
        requirement: "Add OAuth2 authentication with Google and GitHub providers",
        type: "feature",
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.run).toBeDefined();
    expect(body.run.status).toBe("running");
    expect(body.run.currentStage).toBe("requirements");
    expect(body.message).toBeDefined();

    // Verify event was published
    const event = publishHelper.published.find((p) => p.stream === "archibald.lifecycle");
    expect(event).toBeDefined();
    expect(event!.data.type).toBe("lifecycle.start.requested");
  });

  it("GET /v1/products/:id/lifecycle/history returns run history", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: authHeaders,
      body: {
        name: "history-test-service",
        description: "For history test",
        owner: "team-epsilon",
      },
    });

    const { product } = createRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/v1/products/${product.id}/lifecycle/history`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.productId).toBe(product.id);
    expect(Array.isArray(body.runs)).toBe(true);
  });

  it("POST /v1/products requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/products",
      body: {
        name: "unauth-service",
        description: "Should fail",
        owner: "nobody",
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/products/:id/lifecycle/start validates requirement length", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: authHeaders,
      body: {
        name: "validation-service",
        description: "For validation test",
        owner: "team-zeta",
      },
    });

    const { product } = createRes.json();

    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${product.id}/lifecycle/start`,
      headers: authHeaders,
      body: {
        requirement: "short", // too short (min 10 chars)
        type: "feature",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });
});

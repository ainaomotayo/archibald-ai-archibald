import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";

// ── Prisma stub ────────────────────────────────────────────────────────────────
function makePrismaStub() {
  const executions: Record<string, any> = {};

  return {
    archibaldProduct: {
      findFirst: async () => null,
      findMany: async () => [],
      count: async () => 0,
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        return { id, ...data, createdAt: new Date().toISOString() };
      },
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
      findFirst: async () => null,
      findMany: async () => [],
      update: async ({ where, data }: any) => ({ id: where.id, ...data }),
    },
    archibaldAgentExecution: {
      findMany: async ({ where }: any) => {
        return Object.values(executions).filter((e: any) => {
          if (where?.orgId && e.orgId !== where.orgId) return false;
          if (where?.status?.in && !where.status.in.includes(e.status)) return false;
          return true;
        });
      },
      count: async ({ where }: any) => {
        return Object.values(executions).filter((e: any) => {
          if (where?.orgId && e.orgId !== where.orgId) return false;
          if (where?.status?.in && !where.status.in.includes(e.status)) return false;
          return true;
        }).length;
      },
      findFirst: async ({ where }: any) => {
        return (
          Object.values(executions).find((e: any) => {
            if (where?.id && e.id !== where.id) return false;
            if (where?.orgId && e.orgId !== where.orgId) return false;
            return true;
          }) ?? null
        );
      },
      _seed: (execution: any) => {
        executions[execution.id] = execution;
      },
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
const adminHeaders = { "x-org-id": "org-agents-test", "x-user-id": "user-admin", "x-role": "ADMIN" };
const engineerHeaders = { "x-org-id": "org-agents-test", "x-user-id": "user-eng", "x-role": "ENGINEER" };
const viewerHeaders = { "x-org-id": "org-agents-test", "x-user-id": "user-viewer", "x-role": "VIEWER" };

// ── Helpers ────────────────────────────────────────────────────────────────────
function makeExecution(orgId: string, overrides: Record<string, any> = {}) {
  const id = crypto.randomUUID();
  return {
    id,
    orgId,
    status: "running",
    lifecycleRun: { id: crypto.randomUUID(), product: { name: "test-product" } },
    evidence: [],
    logs: [],
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("Agents routes", () => {
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

  // ── GET /v1/agents ─────────────────────────────────────────────────────────

  it("GET /v1/agents returns 200 with empty list when no active executions", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/agents", headers: adminHeaders });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.executions)).toBe(true);
    expect(body.total).toBe(0);
    expect(body.page).toBeDefined();
    expect(body.limit).toBeDefined();
  });

  it("GET /v1/agents returns active executions for the org", async () => {
    const exec = makeExecution("org-agents-test", { status: "running" });
    prisma.archibaldAgentExecution._seed(exec);

    const res = await app.inject({ method: "GET", url: "/v1/agents", headers: adminHeaders });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.executions.length).toBe(1);
    expect(body.total).toBe(1);
  });

  it("GET /v1/agents does not return executions from other orgs", async () => {
    const exec = makeExecution("org-other");
    prisma.archibaldAgentExecution._seed(exec);

    const res = await app.inject({ method: "GET", url: "/v1/agents", headers: adminHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.json().executions.length).toBe(0);
  });

  it("GET /v1/agents respects pagination query params", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/agents?page=2&limit=10",
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.page).toBe(2);
    expect(body.limit).toBe(10);
  });

  it("GET /v1/agents returns 400 for invalid pagination params", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/agents?limit=999",
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("GET /v1/agents returns 401 when no auth headers", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/agents" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/agents returns 403 for ENGINEER role (ADMIN required)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/agents", headers: engineerHeaders });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/agents returns 403 for VIEWER role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/agents", headers: viewerHeaders });
    expect(res.statusCode).toBe(403);
  });

  // ── GET /v1/agents/:executionId ────────────────────────────────────────────

  it("GET /v1/agents/:executionId returns 200 with execution detail", async () => {
    const exec = makeExecution("org-agents-test");
    prisma.archibaldAgentExecution._seed(exec);

    const res = await app.inject({
      method: "GET",
      url: `/v1/agents/${exec.id}`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(exec.id);
    expect(body.orgId).toBe("org-agents-test");
  });

  it("GET /v1/agents/:executionId returns 404 for unknown execution", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/agents/${crypto.randomUUID()}`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Agent execution not found");
  });

  it("GET /v1/agents/:executionId returns 404 for execution belonging to another org", async () => {
    const exec = makeExecution("org-other");
    prisma.archibaldAgentExecution._seed(exec);

    const res = await app.inject({
      method: "GET",
      url: `/v1/agents/${exec.id}`,
      headers: adminHeaders, // org-agents-test, not org-other
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/agents/:executionId returns 400 for non-UUID execution ID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/agents/not-a-uuid",
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("GET /v1/agents/:executionId returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/agents/${crypto.randomUUID()}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/agents/:executionId returns 403 for ENGINEER role", async () => {
    const exec = makeExecution("org-agents-test");
    prisma.archibaldAgentExecution._seed(exec);

    const res = await app.inject({
      method: "GET",
      url: `/v1/agents/${exec.id}`,
      headers: engineerHeaders,
    });
    expect(res.statusCode).toBe(403);
  });
});

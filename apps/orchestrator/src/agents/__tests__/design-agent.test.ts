import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DesignAgent } from "../design-agent.js";
import type { AgentContext } from "../base-agent.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRedisMock() {
  return { xadd: vi.fn().mockResolvedValue("0-1") };
}

function makeLlmMock(response: string) {
  return { complete: vi.fn().mockResolvedValue(response) };
}

const validDesignJson = JSON.stringify({
  components: [
    {
      name: "auth-api",
      type: "service",
      responsibility: "Handles authentication",
      technology: "Fastify 5",
      rationale: "Ecosystem standard",
    },
    {
      name: "postgres",
      type: "database",
      responsibility: "User data storage",
      technology: "PostgreSQL 16",
      rationale: "Proven reliability",
    },
  ],
  dataFlow: [
    { from: "auth-api", to: "postgres", protocol: "Prisma ORM", description: "All reads and writes" },
  ],
  technologyChoices: [
    {
      category: "runtime",
      choice: "Node.js 22",
      alternatives: ["Bun"],
      rationale: "LTS stability",
      evidenceSource: "internal-standards",
    },
  ],
  rationale: "Proven Fastify + PostgreSQL pattern",
  costEstimate: { devWeeks: 6, infrastructureMonthlyUsd: 80, confidence: "medium" },
  risks: [
    { description: "Migration risk", severity: "medium", mitigation: "Use zero-downtime migrations" },
  ],
  architecturalPatterns: ["REST API", "Event sourcing"],
});

const mockContext: AgentContext = {
  productId: "prod-design",
  lifecycleRunId: "run-design-001",
  stage: "design",
  requirement: "Build an authentication service",
  previousStageOutput: {
    summary: "Build a user authentication system with email and password login",
    estimatedComplexity: "medium",
  },
  orgContext: {
    orgId: "org-123",
    techStack: ["Node.js", "PostgreSQL", "Redis"],
    patterns: ["REST API", "Event sourcing"],
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DesignAgent", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-expect-error — replace global fetch for tests
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path: ARCHINTEL available + LLM succeeds ────────────────────────

  it("returns wait_for_human with a DesignProposal output on success", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ answer: "Use REST API pattern", patterns: ["REST API", "Event sourcing"] }),
    });

    const llm = makeLlmMock(validDesignJson);
    const agent = new DesignAgent({ llm, archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    // Design always requires human review
    expect(result.nextAction).toBe("wait_for_human");
    expect(result.success).toBe(true);
    expect(result.pendingDecision).toBeDefined();
    expect(result.pendingDecision!.urgency).toBe("high");
    expect(result.pendingDecision!.timeoutHours).toBe(72);
  });

  it("output has components, dataFlow, technologyChoices, rationale, costEstimate, risks, architecturalPatterns", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ patterns: [] }),
    });

    const llm = makeLlmMock(validDesignJson);
    const agent = new DesignAgent({ llm, archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    const output = result.output as {
      components: unknown[];
      dataFlow: unknown[];
      technologyChoices: unknown[];
      rationale: string;
      costEstimate: { devWeeks: number; infrastructureMonthlyUsd: number; confidence: string };
      risks: unknown[];
      architecturalPatterns: string[];
    };

    expect(Array.isArray(output.components)).toBe(true);
    expect(output.components.length).toBeGreaterThan(0);
    expect(Array.isArray(output.dataFlow)).toBe(true);
    expect(Array.isArray(output.technologyChoices)).toBe(true);
    expect(typeof output.rationale).toBe("string");
    expect(typeof output.costEstimate.devWeeks).toBe("number");
    expect(typeof output.costEstimate.infrastructureMonthlyUsd).toBe("number");
    expect(["low", "medium", "high"]).toContain(output.costEstimate.confidence);
    expect(Array.isArray(output.risks)).toBe(true);
    expect(Array.isArray(output.architecturalPatterns)).toBe(true);
  });

  it("pendingDecision title mentions architecture review", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ patterns: [] }) });
    const llm = makeLlmMock(validDesignJson);
    const agent = new DesignAgent({ llm, archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    expect(result.pendingDecision!.title).toMatch(/architecture|design/i);
  });

  // ── ARCHINTEL query parameters ────────────────────────────────────────────

  it("ARCHINTEL request includes x-org-id header from context", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ patterns: [] }) });
    const llm = makeLlmMock(validDesignJson);
    const agent = new DesignAgent({ llm, archintelUrl: "http://archintel-test:8090" });
    await agent.execute(mockContext);

    const firstCallInit = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = firstCallInit.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org-123");
  });

  it("ARCHINTEL POST body contains a meaningful query", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ patterns: [] }) });
    const llm = makeLlmMock(validDesignJson);
    const agent = new DesignAgent({ llm, archintelUrl: "http://archintel-test:8090" });
    await agent.execute(mockContext);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(typeof body.query).toBe("string");
    expect(body.query.length).toBeGreaterThan(10);
  });

  it("ARCHINTEL patterns are passed into the LLM prompt", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ patterns: ["use-circuit-breaker", "blue-green-deploy"] }),
    });
    const llm = makeLlmMock(validDesignJson);
    const agent = new DesignAgent({ llm, archintelUrl: "http://archintel-test:8090" });
    await agent.execute(mockContext);

    const prompt = (llm.complete.mock.calls[0] as [string])[0];
    expect(prompt).toContain("use-circuit-breaker");
    expect(prompt).toContain("blue-green-deploy");
  });

  it("evidence includes archintel:org-patterns when ARCHINTEL is reachable", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ answer: "Use microservices", patterns: ["microservices"] }),
    });
    const llm = makeLlmMock(validDesignJson);
    const agent = new DesignAgent({ llm, archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("archintel:org-patterns");
  });

  // ── ARCHINTEL unavailable → continues without org patterns ───────────────

  it("succeeds even when ARCHINTEL is unreachable (proceeds without org patterns)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const llm = makeLlmMock(validDesignJson);
    const agent = new DesignAgent({ llm, archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("wait_for_human");
    expect(result.success).toBe(true);
  });

  it("evidence includes archintel:unavailable when ARCHINTEL throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network failure"));
    const llm = makeLlmMock(validDesignJson);
    const agent = new DesignAgent({ llm, archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("archintel:unavailable");
  });

  it("ARCHINTEL non-OK response is handled gracefully (no patterns, no crash)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const llm = makeLlmMock(validDesignJson);
    const agent = new DesignAgent({ llm, archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("wait_for_human");
    expect(result.success).toBe(true);
  });

  it("LLM prompt contains requirement from previousStageOutput.summary when available", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ patterns: [] }) });
    const llm = makeLlmMock(validDesignJson);
    const agent = new DesignAgent({ llm, archintelUrl: "http://archintel-test:8090" });
    await agent.execute(mockContext);

    const prompt = (llm.complete.mock.calls[0] as [string])[0];
    expect(prompt).toContain("Build a user authentication system with email and password login");
  });

  // ── Empty ARCHINTEL context → sensible stub proposal ─────────────────────

  it("produces valid proposal using stub when ARCHINTEL has no patterns and LLM not configured", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ patterns: [] }) });
    // No LLM configured
    const agent = new DesignAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("wait_for_human");
    const output = result.output as { components: unknown[]; rationale: string };
    expect(output.components.length).toBeGreaterThan(0);
    expect(typeof output.rationale).toBe("string");
  });

  // ── LLM failure ───────────────────────────────────────────────────────────

  it("returns fail result when LLM throws", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ patterns: [] }) });
    const llm = { complete: vi.fn().mockRejectedValue(new Error("Model overloaded")) };
    const agent = new DesignAgent({ llm, archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(false);
    expect(result.nextAction).toBe("fail");
    expect(result.failureReason).toContain("LLM unavailable");
  });

  // ── Malformed LLM JSON → falls back to stub proposal ─────────────────────

  it("falls back to stub proposal when LLM returns malformed JSON", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ patterns: [] }) });
    const llm = makeLlmMock("this is definitely not valid JSON {{{{");
    const agent = new DesignAgent({ llm, archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("wait_for_human");
    const output = result.output as { components: unknown[] };
    expect(Array.isArray(output.components)).toBe(true);
  });

  // ── Event bus emission ────────────────────────────────────────────────────

  it("emits agent.started and agent.completed to archibald.lifecycle", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ patterns: [] }) });
    const redis = makeRedisMock();
    const llm = makeLlmMock(validDesignJson);
    const agent = new DesignAgent({ redis: redis as any, llm, archintelUrl: "http://archintel-test:8090" });
    await agent.execute(mockContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain("agent.started");
    expect(allArgs).toContain("agent.completed");

    const streams = (redis.xadd.mock.calls as string[][]).map((c) => c[0]);
    expect(streams.every((s) => s === "archibald.lifecycle")).toBe(true);
  });

  it("emitted events carry correct productId", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ patterns: [] }) });
    const redis = makeRedisMock();
    const llm = makeLlmMock(validDesignJson);
    const agent = new DesignAgent({ redis: redis as any, llm, archintelUrl: "http://archintel-test:8090" });
    await agent.execute(mockContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain(mockContext.productId);
  });
});

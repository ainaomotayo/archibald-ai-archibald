import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BuildAgent } from "../agents/build-agent.js";
import type { AgentContext } from "../agents/base-agent.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SPEC_ID = "spec-00000000-0000-0000-0000-000000000001";
const BUILD_ID = "build-00000000-0000-0000-0000-000000000002";

const mockContext: AgentContext = {
  productId: "product-test",
  lifecycleRunId: "run-build-test",
  stage: "build",
  requirement: "Build the payment service",
  previousStageOutput: {
    rationale: "Microservices architecture using Fastify",
  },
  orgContext: { orgId: "org-abc" },
};

function makeSpecResponse(overrides: Record<string, unknown> = {}) {
  return { ok: true, status: 201, json: async () => ({ id: SPEC_ID, status: "PENDING", ...overrides }) };
}

function makeBuildResponse(overrides: Record<string, unknown> = {}) {
  return { ok: true, status: 201, json: async () => ({ id: BUILD_ID, status: "PENDING", ...overrides }) };
}

function makePollResponse(status: string, outputDir: string | null = "/dist/app") {
  return { ok: true, status: 200, json: async () => ({ id: BUILD_ID, status, outputDir }) };
}

function makeRedisMock() {
  return { xadd: vi.fn().mockResolvedValue("0-1") };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BuildAgent", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-expect-error — replace global fetch for tests
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("returns nextAction 'proceed' with buildId on FORGE SUCCESS", async () => {
    fetchMock
      .mockResolvedValueOnce(makeSpecResponse())       // POST /v1/specs
      .mockResolvedValueOnce(makeBuildResponse())       // POST /v1/builds
      .mockResolvedValueOnce(makePollResponse("SUCCESS", "/dist/output")); // GET /v1/builds/:id

    const redis = makeRedisMock();
    const agent = new BuildAgent({ redis: redis as any, forgeUrl: "http://forge-test:8110" });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("proceed");
    expect(result.success).toBe(true);
    const output = result.output as { buildId: string; specId: string; outputDir: string; forgeStatus: string };
    expect(output.buildId).toBe(BUILD_ID);
    expect(output.specId).toBe(SPEC_ID);
    expect(output.forgeStatus).toBe("SUCCESS");
    expect(output.outputDir).toBe("/dist/output");
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("includes evidence entries for spec creation, build trigger, and success", async () => {
    fetchMock
      .mockResolvedValueOnce(makeSpecResponse())
      .mockResolvedValueOnce(makeBuildResponse())
      .mockResolvedValueOnce(makePollResponse("SUCCESS"));

    const agent = new BuildAgent({ forgeUrl: "http://forge-test:8110" });
    const result = await agent.execute(mockContext);

    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("forge:spec-created");
    expect(sources).toContain("forge:build-triggered");
    expect(sources).toContain("forge:build-success");
  });

  // ── FORGE FAILED status ─────────────────────────────────────────────────────

  it("returns nextAction 'retry' when FORGE build status is FAILED", async () => {
    fetchMock
      .mockResolvedValueOnce(makeSpecResponse())
      .mockResolvedValueOnce(makeBuildResponse())
      .mockResolvedValueOnce(makePollResponse("FAILED", null));

    const agent = new BuildAgent({ forgeUrl: "http://forge-test:8110" });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("retry");
    expect(result.success).toBe(false);
    expect(result.failureReason).toContain("FAILED");
    const output = result.output as { forgeStatus: string };
    expect(output.forgeStatus).toBe("FAILED");
  });

  // ── Network error ───────────────────────────────────────────────────────────

  it("returns nextAction 'wait_for_human' with pendingDecision when FORGE is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED"));

    const agent = new BuildAgent({ forgeUrl: "http://forge-test:8110" });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("wait_for_human");
    expect(result.success).toBe(true); // waitForHuman sets success:true
    expect(result.pendingDecision).toBeDefined();
    expect(result.pendingDecision!.title).toMatch(/FORGE unavailable/i);
    expect(result.pendingDecision!.urgency).toBe("high");
    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("forge:unavailable");
  });

  it("pendingDecision contains productId and runId in description when unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8110"));

    const agent = new BuildAgent({ forgeUrl: "http://forge-test:8110" });
    const result = await agent.execute(mockContext);

    expect(result.pendingDecision!.description).toContain(mockContext.productId);
    expect(result.pendingDecision!.description).toContain(mockContext.lifecycleRunId);
  });

  // ── Poll timeout ────────────────────────────────────────────────────────────

  it("returns nextAction 'retry' when build is stuck IN_PROGRESS and poll times out", async () => {
    // Override MAX poll count to keep test fast: use a tiny BuildAgent with 2 polls max
    // We do this by subclassing and patching sleep + iterating manually via fetchMock
    // Strategy: mock spec + build OK, then all polls return IN_PROGRESS
    fetchMock
      .mockResolvedValueOnce(makeSpecResponse())   // POST /v1/specs
      .mockResolvedValueOnce(makeBuildResponse())   // POST /v1/builds
      // Return IN_PROGRESS indefinitely — we need the agent's internal loop to hit MAX
      // We patch sleep to be instant and set a tiny maxPoll via env trick
      .mockResolvedValue(makePollResponse("IN_PROGRESS"));

    // Create an agent subclass that overrides the poll limit to 2 iterations
    class FastBuildAgent extends BuildAgent {
      protected override sleep(_ms: number): Promise<void> {
        return Promise.resolve(); // instant sleep
      }
    }

    // Patch the max iterations constant by monkey-patching the execute method behaviour
    // We rely on having enough mocked responses. With sleep=0ms and 120 iterations,
    // it will run through quickly. We need 120 poll responses returning IN_PROGRESS.
    // mockResolvedValue (without Once) already returns IN_PROGRESS for all subsequent calls.

    const agent = new FastBuildAgent({ forgeUrl: "http://forge-test:8110" });

    // This will run 120 iterations instantly
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("retry");
    expect(result.success).toBe(false);
    expect(result.failureReason).toMatch(/timed out/i);
    const output = result.output as { forgeStatus: string };
    expect(output.forgeStatus).toBe("IN_PROGRESS");
  }, 30_000); // 30s safety timeout for the test itself

  // ── Lifecycle event emission ────────────────────────────────────────────────

  it("emits archibald.lifecycle events for started and completed stages", async () => {
    fetchMock
      .mockResolvedValueOnce(makeSpecResponse())
      .mockResolvedValueOnce(makeBuildResponse())
      .mockResolvedValueOnce(makePollResponse("SUCCESS"));

    const redis = makeRedisMock();
    const agent = new BuildAgent({ redis: redis as any, forgeUrl: "http://forge-test:8110" });
    await agent.execute(mockContext);

    expect(redis.xadd).toHaveBeenCalledWith(
      "archibald.lifecycle",
      "*",
      expect.any(String), expect.any(String), // type field
      expect.any(String), expect.any(String), // more fields
    );

    // Find the "agent.started" and "agent.completed" calls
    const calls: string[][] = redis.xadd.mock.calls;
    const streams = calls.map((c) => c[0]);
    expect(streams.every((s) => s === "archibald.lifecycle")).toBe(true);

    const allArgs = calls.flatMap((c) => c);
    expect(allArgs).toContain("agent.started");
    expect(allArgs).toContain("agent.completed");
  });

  it("emits polling event after triggering build successfully", async () => {
    fetchMock
      .mockResolvedValueOnce(makeSpecResponse())
      .mockResolvedValueOnce(makeBuildResponse())
      .mockResolvedValueOnce(makePollResponse("SUCCESS"));

    const redis = makeRedisMock();
    const agent = new BuildAgent({ redis: redis as any, forgeUrl: "http://forge-test:8110" });
    await agent.execute(mockContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain("agent.polling");
  });

  // ── Authorization header ────────────────────────────────────────────────────

  it("includes Authorization Bearer header when apiKey is set", async () => {
    fetchMock
      .mockResolvedValueOnce(makeSpecResponse())
      .mockResolvedValueOnce(makeBuildResponse())
      .mockResolvedValueOnce(makePollResponse("SUCCESS"));

    const agent = new BuildAgent({
      forgeUrl: "http://forge-test:8110",
      apiKey: "secret-token-123",
    });
    await agent.execute(mockContext);

    const firstCall = fetchMock.mock.calls[0];
    const init = firstCall[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer secret-token-123");
  });

  // ── FORGE non-OK on spec creation ───────────────────────────────────────────

  it("returns wait_for_human when FORGE returns 500 on spec creation", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const agent = new BuildAgent({ forgeUrl: "http://forge-test:8110" });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("wait_for_human");
    expect(result.pendingDecision!.title).toMatch(/spec creation failed/i);
  });

  // ── FORGE non-OK on build trigger ──────────────────────────────────────────

  it("returns wait_for_human when FORGE returns 404 on build trigger", async () => {
    fetchMock
      .mockResolvedValueOnce(makeSpecResponse())
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "Not Found" });

    const agent = new BuildAgent({ forgeUrl: "http://forge-test:8110" });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("wait_for_human");
    expect(result.pendingDecision!.description).toContain(SPEC_ID);
  });
});

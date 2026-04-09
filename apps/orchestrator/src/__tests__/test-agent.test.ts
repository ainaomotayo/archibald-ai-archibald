import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TestAgent } from "../agents/test-agent.js";
import type { AgentContext } from "../agents/base-agent.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const BUILD_ID = "build-00000000-0000-0000-0000-000000000099";

const mockContext: AgentContext = {
  productId: "product-test",
  lifecycleRunId: "run-test-agent",
  stage: "test",
  requirement: "Ensure the payment service is tested",
  previousStageOutput: {
    buildId: BUILD_ID,
    specId: "spec-00000000-0000-0000-0000-000000000001",
    outputDir: "/dist/output",
    forgeStatus: "SUCCESS",
  },
  orgContext: { orgId: "org-abc" },
};

function makeBuildDetail(
  status: string,
  testStatus: "PASS" | "FAIL" | "PENDING" | undefined,
  coverageEstimate: number,
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: BUILD_ID,
      status,
      testStatus,
      coverageEstimate,
      outputDir: "/dist/output",
    }),
  };
}

function makeRedisMock() {
  return { xadd: vi.fn().mockResolvedValue("0-1") };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TestAgent", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-expect-error — replace global fetch for tests
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── High coverage → proceed ─────────────────────────────────────────────────

  it("returns nextAction 'proceed' when coverage meets threshold (0.8 >= 0.6)", async () => {
    fetchMock.mockResolvedValueOnce(makeBuildDetail("SUCCESS", "PASS", 0.8));

    const agent = new TestAgent({ forgeUrl: "http://forge-test:8110", coverageThreshold: 0.6 });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("proceed");
    expect(result.success).toBe(true);
    const output = result.output as {
      buildId: string; coverageEstimate: number; coverageMetThreshold: boolean;
    };
    expect(output.buildId).toBe(BUILD_ID);
    expect(output.coverageEstimate).toBe(0.8);
    expect(output.coverageMetThreshold).toBe(true);
  });

  it("includes coverage gate evidence when proceeding", async () => {
    fetchMock.mockResolvedValueOnce(makeBuildDetail("SUCCESS", "PASS", 0.75));

    const agent = new TestAgent({ forgeUrl: "http://forge-test:8110", coverageThreshold: 0.6 });
    const result = await agent.execute(mockContext);

    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("forge:test-results");
    expect(sources).toContain("gate:coverage-passed");
  });

  // ── Low coverage → wait_for_human ──────────────────────────────────────────

  it("returns nextAction 'wait_for_human' with pendingDecision when coverage is below threshold", async () => {
    fetchMock.mockResolvedValueOnce(makeBuildDetail("SUCCESS", "PASS", 0.35));

    const agent = new TestAgent({ forgeUrl: "http://forge-test:8110", coverageThreshold: 0.6 });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("wait_for_human");
    expect(result.pendingDecision).toBeDefined();
    expect(result.pendingDecision!.title).toMatch(/coverage below threshold/i);
    expect(result.pendingDecision!.description).toContain("35.0%");
    expect(result.pendingDecision!.description).toContain("60.0%");
    expect(result.pendingDecision!.urgency).toBe("medium");
  });

  it("pendingDecision options list accept/reject choices when coverage is low", async () => {
    fetchMock.mockResolvedValueOnce(makeBuildDetail("SUCCESS", "PASS", 0.4));

    const agent = new TestAgent({ forgeUrl: "http://forge-test:8110", coverageThreshold: 0.6 });
    const result = await agent.execute(mockContext);

    expect(Array.isArray(result.pendingDecision!.options)).toBe(true);
    expect(result.pendingDecision!.options!.length).toBeGreaterThan(0);
  });

  it("output reflects actual coverage when below threshold", async () => {
    fetchMock.mockResolvedValueOnce(makeBuildDetail("SUCCESS", "PASS", 0.25));

    const agent = new TestAgent({ forgeUrl: "http://forge-test:8110", coverageThreshold: 0.6 });
    const result = await agent.execute(mockContext);

    const output = result.output as { coverageEstimate: number; coverageMetThreshold: boolean };
    expect(output.coverageEstimate).toBe(0.25);
    expect(output.coverageMetThreshold).toBe(false);
  });

  // ── Test FAIL status → retry ────────────────────────────────────────────────

  it("returns nextAction 'retry' when test status is FAIL", async () => {
    fetchMock.mockResolvedValueOnce(makeBuildDetail("FAILED", "FAIL", 0.0));

    const agent = new TestAgent({ forgeUrl: "http://forge-test:8110", coverageThreshold: 0.6 });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("retry");
    expect(result.success).toBe(false);
    expect(result.failureReason).toMatch(/test.*failed/i);
  });

  it("returns nextAction 'retry' when FORGE status is TEST_FAILED", async () => {
    fetchMock.mockResolvedValueOnce(makeBuildDetail("TEST_FAILED", "FAIL", 0.0));

    const agent = new TestAgent({ forgeUrl: "http://forge-test:8110" });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("retry");
    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("gate:test-failed");
  });

  it("retry result has retryAfterMs set", async () => {
    fetchMock.mockResolvedValueOnce(makeBuildDetail("FAILED", "FAIL", 0.0));

    const agent = new TestAgent({ forgeUrl: "http://forge-test:8110" });
    const result = await agent.execute(mockContext);

    expect(typeof result.retryAfterMs).toBe("number");
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  // ── FORGE network error ─────────────────────────────────────────────────────

  it("returns wait_for_human when FORGE is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED"));

    const agent = new TestAgent({ forgeUrl: "http://forge-test:8110" });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("wait_for_human");
    expect(result.pendingDecision).toBeDefined();
    expect(result.pendingDecision!.title).toMatch(/FORGE unavailable/i);
    expect(result.pendingDecision!.description).toContain(BUILD_ID);
  });

  // ── Missing buildId ─────────────────────────────────────────────────────────

  it("returns fail when previousStageOutput has no buildId", async () => {
    const contextNoBuildId: AgentContext = {
      ...mockContext,
      previousStageOutput: { someOtherKey: "value" },
    };

    const agent = new TestAgent({ forgeUrl: "http://forge-test:8110" });
    const result = await agent.execute(contextNoBuildId);

    expect(result.nextAction).toBe("fail");
    expect(result.success).toBe(false);
    expect(result.failureReason).toMatch(/buildId/i);
  });

  it("returns fail when previousStageOutput is undefined", async () => {
    const contextNoPrev: AgentContext = {
      ...mockContext,
      previousStageOutput: undefined,
    };

    const agent = new TestAgent({ forgeUrl: "http://forge-test:8110" });
    const result = await agent.execute(contextNoPrev);

    expect(result.nextAction).toBe("fail");
  });

  // ── Polling for pending test results ───────────────────────────────────────

  it("polls until test results appear and proceeds on PASS", async () => {
    // First call: build still in PENDING test status → triggers poll loop
    // Second call (poll): still PENDING
    // Third call (poll): PASS
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: BUILD_ID, status: "SUCCESS", testStatus: "PENDING", coverageEstimate: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: BUILD_ID, status: "SUCCESS", testStatus: "PENDING", coverageEstimate: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: BUILD_ID, status: "SUCCESS", testStatus: "PASS", coverageEstimate: 0.72 }),
      });

    class FastTestAgent extends TestAgent {
      protected override sleep(_ms: number): Promise<void> {
        return Promise.resolve();
      }
    }

    const agent = new FastTestAgent({ forgeUrl: "http://forge-test:8110", coverageThreshold: 0.6 });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("proceed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // ── Default coverage threshold ──────────────────────────────────────────────

  it("uses default 0.6 threshold when none specified and rejects 0.59 coverage", async () => {
    fetchMock.mockResolvedValueOnce(makeBuildDetail("SUCCESS", "PASS", 0.59));

    const agent = new TestAgent({ forgeUrl: "http://forge-test:8110" }); // no threshold set
    const result = await agent.execute(mockContext);

    // Should fail the gate (0.59 < 0.6)
    expect(result.nextAction).toBe("wait_for_human");
  });

  it("passes with exactly threshold coverage (0.6 >= 0.6)", async () => {
    fetchMock.mockResolvedValueOnce(makeBuildDetail("SUCCESS", "PASS", 0.6));

    const agent = new TestAgent({ forgeUrl: "http://forge-test:8110", coverageThreshold: 0.6 });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("proceed");
  });

  // ── Lifecycle event emission ────────────────────────────────────────────────

  it("emits agent.started event at the beginning of execution", async () => {
    fetchMock.mockResolvedValueOnce(makeBuildDetail("SUCCESS", "PASS", 0.8));

    const redis = makeRedisMock();
    const agent = new TestAgent({ redis: redis as any, forgeUrl: "http://forge-test:8110" });
    await agent.execute(mockContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain("agent.started");
  });
});

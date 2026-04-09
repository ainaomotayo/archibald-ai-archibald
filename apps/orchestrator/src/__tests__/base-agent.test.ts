import { describe, it, expect, vi } from "vitest";
import { BaseAgent, type AgentContext, type AgentResult, type Evidence } from "../agents/base-agent.js";

// Concrete implementation for testing
class TestAgent extends BaseAgent {
  readonly name = "TestAgent";

  private emitSpy = vi.fn();
  private emitCalled = false;

  async execute(context: AgentContext): Promise<AgentResult> {
    this.emitCalled = true;
    await this.emit("test.stream", {
      type: "test.event",
      productId: context.productId,
    });

    return {
      success: true,
      output: { processed: context.requirement },
      nextAction: "proceed",
      evidence: [
        {
          source: "test:source",
          finding: "Test finding",
          confidence: 0.9,
        },
      ],
    };
  }

  wasEmitCalled(): boolean {
    return this.emitCalled;
  }
}

// Agent that returns wait_for_human
class GatingAgent extends BaseAgent {
  readonly name = "GatingAgent";

  async execute(_context: AgentContext): Promise<AgentResult> {
    return this.waitForHuman(
      {
        title: "Needs review",
        description: "Please review this decision",
        urgency: "high",
        timeoutHours: 24,
      },
      { partialOutput: "something" },
      [{ source: "gate:check", finding: "Gate requires human", confidence: 1.0 }],
    );
  }
}

// Agent that returns failure
class FailingAgent extends BaseAgent {
  readonly name = "FailingAgent";

  async execute(_context: AgentContext): Promise<AgentResult> {
    return this.failResult("Something went critically wrong", [
      { source: "error:source", finding: "Fatal error encountered", confidence: 1.0 },
    ]);
  }
}

const mockContext: AgentContext = {
  productId: "product-abc",
  lifecycleRunId: "run-xyz",
  stage: "test",
  requirement: "Add user authentication",
  orgContext: { orgId: "org-123" },
};

describe("BaseAgent", () => {
  // ─── emit behaviour ────────────────────────────────────────────────────────

  it("BaseAgent subclass calls emit on execute", async () => {
    const redisMock = {
      xadd: vi.fn().mockResolvedValue("1234567890-0"),
    };

    const agent = new TestAgent({ redis: redisMock as any });
    await agent.execute(mockContext);

    expect(redisMock.xadd).toHaveBeenCalledOnce();
    const callArgs: string[] = redisMock.xadd.mock.calls[0];
    expect(callArgs[0]).toBe("test.stream");
    expect(callArgs[1]).toBe("*");
    expect(callArgs).toContain("type");
    expect(callArgs).toContain("test.event");
  });

  it("emit is skipped when Redis is not configured", async () => {
    const consoleSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const agent = new TestAgent({ redis: null });
    // Should not throw
    await expect(agent.execute(mockContext)).resolves.toBeDefined();
    consoleSpy.mockRestore();
  });

  // ─── AgentResult shape ─────────────────────────────────────────────────────

  it("AgentResult always has required fields", async () => {
    const agent = new TestAgent({});
    const result = await agent.execute(mockContext);

    expect(typeof result.success).toBe("boolean");
    expect(result.output).toBeDefined();
    expect(typeof result.nextAction).toBe("string");
    expect(Array.isArray(result.evidence)).toBe(true);
  });

  it("AgentResult.nextAction is one of the valid values", async () => {
    const validActions: AgentResult["nextAction"][] = ["proceed", "wait_for_human", "retry", "fail"];
    const agent = new TestAgent({});
    const result = await agent.execute(mockContext);
    expect(validActions).toContain(result.nextAction);
  });

  // ─── Evidence ─────────────────────────────────────────────────────────────

  it("evidence is always an array", async () => {
    const agent = new TestAgent({});
    const result = await agent.execute(mockContext);
    expect(Array.isArray(result.evidence)).toBe(true);
  });

  it("evidence items have source, finding, confidence fields", async () => {
    const agent = new TestAgent({});
    const result = await agent.execute(mockContext);
    expect(result.evidence.length).toBeGreaterThan(0);
    const ev = result.evidence[0]!;
    expect(typeof ev.source).toBe("string");
    expect(typeof ev.finding).toBe("string");
    expect(typeof ev.confidence).toBe("number");
    expect(ev.confidence).toBeGreaterThanOrEqual(0);
    expect(ev.confidence).toBeLessThanOrEqual(1);
  });

  // ─── waitForHuman helper ───────────────────────────────────────────────────

  it("waitForHuman produces result with nextAction: wait_for_human", async () => {
    const agent = new GatingAgent({});
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("wait_for_human");
    expect(result.pendingDecision).toBeDefined();
    expect(result.pendingDecision!.title).toBe("Needs review");
    expect(result.pendingDecision!.urgency).toBe("high");
    expect(result.pendingDecision!.timeoutHours).toBe(24);
    expect(result.success).toBe(true);
  });

  it("waitForHuman includes evidence in result", async () => {
    const agent = new GatingAgent({});
    const result = await agent.execute(mockContext);

    expect(Array.isArray(result.evidence)).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0]!.confidence).toBe(1.0);
  });

  // ─── failResult helper ─────────────────────────────────────────────────────

  it("failResult produces result with nextAction: fail and success: false", async () => {
    const agent = new FailingAgent({});
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(false);
    expect(result.nextAction).toBe("fail");
    expect(result.failureReason).toBe("Something went critically wrong");
    expect(Array.isArray(result.evidence)).toBe(true);
  });

  // ─── backoffMs utility ─────────────────────────────────────────────────────

  it("backoffMs returns increasing delays with exponential growth", () => {
    // Access protected method via test subclass
    class BackoffTestAgent extends BaseAgent {
      readonly name = "BackoffTestAgent";
      async execute(_c: AgentContext): Promise<AgentResult> {
        return { success: true, output: null, nextAction: "proceed", evidence: [] };
      }
      public testBackoff(attempt: number): number {
        return this.backoffMs(attempt, 1000, 60000);
      }
    }

    const agent = new BackoffTestAgent({});
    const d0 = agent.testBackoff(0);
    const d1 = agent.testBackoff(1);
    const d2 = agent.testBackoff(2);
    const d5 = agent.testBackoff(5);
    const d6 = agent.testBackoff(6);

    expect(d0).toBe(1000);
    expect(d1).toBe(2000);
    expect(d2).toBe(4000);
    expect(d5).toBe(32000); // 1000 * 2^5 = 32000
    expect(d6).toBe(60000); // 1000 * 2^6 = 64000 capped to 60000
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RequirementsAgent } from "../requirements-agent.js";
import type { AgentContext } from "../base-agent.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRedisMock() {
  return { xadd: vi.fn().mockResolvedValue("0-1") };
}

function makeLlmMock(response: string) {
  return { complete: vi.fn().mockResolvedValue(response) };
}

const validLlmJson = JSON.stringify({
  summary: "Build a user authentication system",
  userStories: [
    {
      as: "a user",
      iWant: "to log in securely",
      soThat: "my account is protected",
      acceptanceCriteria: ["Login works with email and password"],
    },
  ],
  acceptanceCriteria: ["Users can log in", "Sessions expire after 24 hours"],
  outOfScope: ["OAuth social login"],
  clarificationsNeeded: [],
  estimatedComplexity: "medium",
  technicalConsiderations: ["Use JWT for sessions", "bcrypt for password hashing"],
});

const mockContext: AgentContext = {
  productId: "prod-auth",
  lifecycleRunId: "run-req-001",
  stage: "requirements",
  requirement: "Build a user authentication system with email and password login",
  orgContext: { orgId: "org-123", techStack: ["Node.js", "PostgreSQL"] },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RequirementsAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path: LLM returns valid JSON ────────────────────────────────────

  it("returns success:true with nextAction 'proceed' on valid LLM output", async () => {
    const llm = makeLlmMock(validLlmJson);
    const agent = new RequirementsAgent({ llm });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
  });

  it("output has all required StructuredRequirements fields", async () => {
    const llm = makeLlmMock(validLlmJson);
    const agent = new RequirementsAgent({ llm });
    const result = await agent.execute(mockContext);

    const output = result.output as {
      summary: string;
      userStories: unknown[];
      acceptanceCriteria: string[];
      outOfScope: string[];
      clarificationsNeeded: string[];
      estimatedComplexity: string;
      technicalConsiderations: string[];
    };

    expect(typeof output.summary).toBe("string");
    expect(output.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(output.userStories)).toBe(true);
    expect(Array.isArray(output.acceptanceCriteria)).toBe(true);
    expect(Array.isArray(output.outOfScope)).toBe(true);
    expect(Array.isArray(output.clarificationsNeeded)).toBe(true);
    expect(Array.isArray(output.technicalConsiderations)).toBe(true);
    expect(["low", "medium", "high", "very_high"]).toContain(output.estimatedComplexity);
  });

  it("output summary matches the LLM-returned summary", async () => {
    const llm = makeLlmMock(validLlmJson);
    const agent = new RequirementsAgent({ llm });
    const result = await agent.execute(mockContext);

    const output = result.output as { summary: string };
    expect(output.summary).toBe("Build a user authentication system");
  });

  it("evidence array contains at least one entry from llm:requirements-structuring", async () => {
    const llm = makeLlmMock(validLlmJson);
    const agent = new RequirementsAgent({ llm });
    const result = await agent.execute(mockContext);

    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("llm:requirements-structuring");
  });

  // ── Prompt contains the user's requirement ────────────────────────────────

  it("LLM prompt contains the user's requirement verbatim", async () => {
    const llm = makeLlmMock(validLlmJson);
    const agent = new RequirementsAgent({ llm });
    await agent.execute(mockContext);

    const capturedPrompt = (llm.complete.mock.calls[0] as [string])[0];
    expect(capturedPrompt).toContain(mockContext.requirement);
  });

  it("LLM prompt contains the org tech stack when provided", async () => {
    const llm = makeLlmMock(validLlmJson);
    const agent = new RequirementsAgent({ llm });
    await agent.execute(mockContext);

    const capturedPrompt = (llm.complete.mock.calls[0] as [string])[0];
    expect(capturedPrompt).toContain("Node.js");
    expect(capturedPrompt).toContain("PostgreSQL");
  });

  it("LLM called with maxTokens: 2000 and temperature: 0.2", async () => {
    const llm = makeLlmMock(validLlmJson);
    const agent = new RequirementsAgent({ llm });
    await agent.execute(mockContext);

    const callOptions = (llm.complete.mock.calls[0] as [string, { maxTokens: number; temperature: number }])[1];
    expect(callOptions).toMatchObject({ maxTokens: 2000, temperature: 0.2 });
  });

  // ── LLM returns JSON in markdown code block ───────────────────────────────

  it("parses LLM output wrapped in markdown code block", async () => {
    const wrapped = `\`\`\`json\n${validLlmJson}\n\`\`\``;
    const llm = makeLlmMock(wrapped);
    const agent = new RequirementsAgent({ llm });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(true);
    const output = result.output as { summary: string };
    expect(output.summary).toBe("Build a user authentication system");
  });

  // ── Clarifications needed → wait_for_human ────────────────────────────────

  it("returns wait_for_human when LLM flags clarificationsNeeded", async () => {
    const withClarifications = JSON.stringify({
      summary: "Vague requirement",
      userStories: [],
      acceptanceCriteria: [],
      outOfScope: [],
      clarificationsNeeded: ["What authentication providers are needed?", "Should MFA be supported?"],
      estimatedComplexity: "medium",
      technicalConsiderations: [],
    });

    const llm = makeLlmMock(withClarifications);
    const agent = new RequirementsAgent({ llm });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("wait_for_human");
    expect(result.pendingDecision).toBeDefined();
    expect(result.pendingDecision!.title).toContain("clarification");
    expect(result.pendingDecision!.urgency).toBe("high");
    expect(result.pendingDecision!.timeoutHours).toBe(48);
  });

  it("pendingDecision description contains each clarification question", async () => {
    const q1 = "What authentication providers are needed?";
    const q2 = "Should MFA be supported?";
    const withClarifications = JSON.stringify({
      summary: "Vague",
      userStories: [],
      acceptanceCriteria: [],
      outOfScope: [],
      clarificationsNeeded: [q1, q2],
      estimatedComplexity: "medium",
      technicalConsiderations: [],
    });

    const llm = makeLlmMock(withClarifications);
    const agent = new RequirementsAgent({ llm });
    const result = await agent.execute(mockContext);

    expect(result.pendingDecision!.description).toContain(q1);
    expect(result.pendingDecision!.description).toContain(q2);
  });

  // ── LLM failure ───────────────────────────────────────────────────────────

  it("returns fail result when LLM throws", async () => {
    const llm = { complete: vi.fn().mockRejectedValue(new Error("LLM quota exceeded")) };
    const agent = new RequirementsAgent({ llm });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(false);
    expect(result.nextAction).toBe("fail");
    expect(result.failureReason).toContain("LLM unavailable");
    expect(result.failureReason).toContain("LLM quota exceeded");
  });

  it("failResult has empty output when LLM throws", async () => {
    const llm = { complete: vi.fn().mockRejectedValue(new Error("timeout")) };
    const agent = new RequirementsAgent({ llm });
    const result = await agent.execute(mockContext);

    expect(result.output).toBeNull();
  });

  // ── Invalid / malformed LLM JSON → falls back to stub ─────────────────────

  it("falls back to stub output when LLM returns invalid JSON", async () => {
    const llm = makeLlmMock("this is not json at all");
    const agent = new RequirementsAgent({ llm });
    const result = await agent.execute(mockContext);

    // Should still succeed — falls back to stub
    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
    const output = result.output as { summary: string };
    expect(typeof output.summary).toBe("string");
  });

  // ── No LLM (stub mode) ────────────────────────────────────────────────────

  it("returns stub output when no LLM is configured", async () => {
    const agent = new RequirementsAgent({});
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
    const output = result.output as { summary: string };
    expect(output.summary).toContain("Build a user authentication system");
  });

  it("stub evidence source is 'stub'", async () => {
    const agent = new RequirementsAgent({});
    const result = await agent.execute(mockContext);

    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("stub");
  });

  // ── Event bus emission ────────────────────────────────────────────────────

  it("emits agent.started and agent.completed events to archibald.lifecycle", async () => {
    const redis = makeRedisMock();
    const llm = makeLlmMock(validLlmJson);
    const agent = new RequirementsAgent({ redis: redis as any, llm });
    await agent.execute(mockContext);

    expect(redis.xadd).toHaveBeenCalled();
    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    const streams = (redis.xadd.mock.calls as string[][]).map((c) => c[0]);

    expect(streams.every((s) => s === "archibald.lifecycle")).toBe(true);
    expect(allArgs).toContain("agent.started");
    expect(allArgs).toContain("agent.completed");
  });

  it("emits events carrying correct productId and runId", async () => {
    const redis = makeRedisMock();
    const llm = makeLlmMock(validLlmJson);
    const agent = new RequirementsAgent({ redis: redis as any, llm });
    await agent.execute(mockContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain(mockContext.productId);
    expect(allArgs).toContain(mockContext.lifecycleRunId);
  });

  it("does not emit agent.completed when LLM throws", async () => {
    const redis = makeRedisMock();
    const llm = { complete: vi.fn().mockRejectedValue(new Error("network error")) };
    const agent = new RequirementsAgent({ redis: redis as any, llm });
    await agent.execute(mockContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).not.toContain("agent.completed");
  });

  it("emits agent.started even when LLM is not configured", async () => {
    const redis = makeRedisMock();
    const agent = new RequirementsAgent({ redis: redis as any });
    await agent.execute(mockContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain("agent.started");
  });

  it("skips Redis emit gracefully when no redis configured", async () => {
    const llm = makeLlmMock(validLlmJson);
    const agent = new RequirementsAgent({ llm, redis: null });
    await expect(agent.execute(mockContext)).resolves.toBeDefined();
  });
});

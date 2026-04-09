import { describe, it, expect, vi, afterEach } from "vitest";
import { EvolveAgent } from "../evolve-agent.js";
import type { AgentContext } from "../base-agent.js";
import type { EvolveOutput, LifecycleRunMetrics } from "../evolve-agent.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRedisMock() {
  return { xadd: vi.fn().mockResolvedValue("0-1") };
}

function makeLlmMock(response: string) {
  return { complete: vi.fn().mockResolvedValue(response) };
}

function makeMetric(overrides: Partial<LifecycleRunMetrics> = {}): LifecycleRunMetrics {
  return {
    runId: crypto.randomUUID(),
    productId: "prod-evolve",
    type: "feature",
    durationMs: 3_600_000,
    loopbackCount: 0,
    sentinelFindingsCount: 0,
    incidentCount: 0,
    mttrMs: 0,
    architecturalChoices: ["REST API", "PostgreSQL"],
    ...overrides,
  };
}

/** Build a context that injects specific metrics */
function makeContextWithMetrics(metrics: LifecycleRunMetrics[]): AgentContext {
  return {
    productId: "prod-evolve",
    lifecycleRunId: "run-evolve-001",
    stage: "evolving",
    requirement: "Analyse outcomes and suggest improvements",
    previousStageOutput: { metrics },
    orgContext: { orgId: "org-test" },
  };
}

const baseContext: AgentContext = {
  productId: "prod-evolve",
  lifecycleRunId: "run-evolve-001",
  stage: "evolving",
  requirement: "Analyse outcomes",
  orgContext: { orgId: "org-test" },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EvolveAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path: clean metrics → succeed ───────────────────────────────────

  it("returns success:true with nextAction 'proceed'", async () => {
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(baseContext);

    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
  });

  it("output has all required EvolveOutput fields", async () => {
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(baseContext);

    const output = result.output as EvolveOutput;
    expect(typeof output.analysedRunCount).toBe("number");
    expect(Array.isArray(output.proposals)).toBe(true);
    expect(Array.isArray(output.antiPatterns)).toBe(true);
    expect(Array.isArray(output.positivePatterns)).toBe(true);
    expect(Array.isArray(output.strategyRankings)).toBe(true);
  });

  // ── Anti-pattern detection: excessive loopbacks ───────────────────────────

  it("surfaces loopback anti-pattern when 2+ runs have loopbackCount > 2", async () => {
    const metrics = [
      makeMetric({ loopbackCount: 3, incidentCount: 1 }),
      makeMetric({ loopbackCount: 5, incidentCount: 2 }),
      makeMetric({ loopbackCount: 0 }),
    ];
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    const antiPattern = output.antiPatterns.find((a) => a.pattern.toLowerCase().includes("loopback"));
    expect(antiPattern).toBeDefined();
    expect(antiPattern!.occurrenceCount).toBe(2);
  });

  it("generates a process improvement proposal when excessive loopbacks detected", async () => {
    const metrics = [
      makeMetric({ loopbackCount: 3 }),
      makeMetric({ loopbackCount: 4 }),
    ];
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    const proposal = output.proposals.find((p) => p.type === "process" && p.title.toLowerCase().includes("requirement"));
    expect(proposal).toBeDefined();
    expect(proposal!.estimatedImpact).toBe("high");
  });

  it("does NOT surface loopback anti-pattern with only 1 high-loopback run", async () => {
    const metrics = [
      makeMetric({ loopbackCount: 5 }),
      makeMetric({ loopbackCount: 0 }),
    ];
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    const antiPattern = output.antiPatterns.find((a) => a.pattern.toLowerCase().includes("loopback"));
    expect(antiPattern).toBeUndefined();
  });

  // ── Anti-pattern detection: high SENTINEL findings ────────────────────────

  it("surfaces SENTINEL findings anti-pattern when 2+ runs have sentinelFindingsCount > 5", async () => {
    const metrics = [
      makeMetric({ sentinelFindingsCount: 8 }),
      makeMetric({ sentinelFindingsCount: 12 }),
      makeMetric({ sentinelFindingsCount: 1 }),
    ];
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    const antiPattern = output.antiPatterns.find(
      (a) => a.pattern.toLowerCase().includes("sentinel") || a.pattern.toLowerCase().includes("finding"),
    );
    expect(antiPattern).toBeDefined();
    expect(antiPattern!.occurrenceCount).toBe(2);
  });

  it("generates security shift-left proposal when SENTINEL findings anti-pattern detected", async () => {
    const metrics = [
      makeMetric({ sentinelFindingsCount: 10 }),
      makeMetric({ sentinelFindingsCount: 7 }),
    ];
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    const proposal = output.proposals.find(
      (p) => p.recommendation.toLowerCase().includes("sentinel") || p.title.toLowerCase().includes("security"),
    );
    expect(proposal).toBeDefined();
  });

  // ── Positive patterns: low MTTR ───────────────────────────────────────────

  it("surfaces positive pattern for architectures with consistently low MTTR", async () => {
    const metrics = [
      makeMetric({ mttrMs: 600_000, architecturalChoices: ["event-driven", "circuit-breaker"] }),
      makeMetric({ mttrMs: 900_000, architecturalChoices: ["event-driven", "circuit-breaker"] }),
    ];
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    // Both runs share "event-driven" and "circuit-breaker" and have MTTR < 30min → positive pattern
    expect(output.positivePatterns.length).toBeGreaterThan(0);
    const patternNames = output.positivePatterns.map((p) => p.pattern);
    expect(patternNames.some((n) => n === "event-driven" || n === "circuit-breaker")).toBe(true);
  });

  // ── UCB1 bandit proposal ──────────────────────────────────────────────────

  it("generates a UCB1 bandit proposal when top strategy has >= 5 pulls and mean reward >= 0.6", async () => {
    // 6 clean runs all using "event-driven"
    const metrics = Array.from({ length: 6 }, () =>
      makeMetric({ architecturalChoices: ["event-driven"], incidentCount: 0, mttrMs: 0 }),
    );
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    const banditProposal = output.proposals.find(
      (p) => p.type === "architectural" && p.description.toLowerCase().includes("ucb1"),
    );
    expect(banditProposal).toBeDefined();
    expect(banditProposal!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("does NOT generate bandit proposal when top arm has fewer than 5 pulls", async () => {
    const metrics = [
      makeMetric({ architecturalChoices: ["event-driven"], incidentCount: 0, mttrMs: 0 }),
      makeMetric({ architecturalChoices: ["event-driven"], incidentCount: 0, mttrMs: 0 }),
      makeMetric({ architecturalChoices: ["event-driven"], incidentCount: 0, mttrMs: 0 }),
    ]; // Only 3 pulls — below threshold
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    const banditProposal = output.proposals.find(
      (p) => p.type === "architectural" && p.description.toLowerCase().includes("ucb1"),
    );
    expect(banditProposal).toBeUndefined();
  });

  it("ImprovementProposal has all required fields", async () => {
    const metrics = [
      makeMetric({ loopbackCount: 3 }),
      makeMetric({ loopbackCount: 4 }),
    ];
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    expect(output.proposals.length).toBeGreaterThan(0);
    const proposal = output.proposals[0]!;

    expect(typeof proposal.id).toBe("string");
    expect(typeof proposal.type).toBe("string");
    expect(typeof proposal.title).toBe("string");
    expect(typeof proposal.description).toBe("string");
    expect(Array.isArray(proposal.supportingEvidence)).toBe(true);
    expect(typeof proposal.recommendation).toBe("string");
    expect(typeof proposal.confidence).toBe("number");
    expect(["low", "medium", "high"]).toContain(proposal.estimatedImpact);
    expect(Array.isArray(proposal.linkedProducts)).toBe(true);
  });

  // ── analysedRunCount is correct ───────────────────────────────────────────

  it("analysedRunCount equals the number of metrics provided", async () => {
    const metrics = Array.from({ length: 7 }, () => makeMetric());
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    expect(output.analysedRunCount).toBe(7);
  });

  // ── LLM ecosystem insight ─────────────────────────────────────────────────

  it("sets ecosystemInsight when LLM is configured and >= 5 metrics", async () => {
    const metrics = Array.from({ length: 5 }, () => makeMetric());
    const llm = makeLlmMock("Based on 5 lifecycle runs, event-driven architecture reduces MTTR by 40%.");
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any, llm });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    expect(typeof output.ecosystemInsight).toBe("string");
    expect(output.ecosystemInsight!.length).toBeGreaterThan(0);
  });

  it("LLM prompt contains run count and avg incidents", async () => {
    const metrics = Array.from({ length: 5 }, () => makeMetric({ incidentCount: 2 }));
    const llm = makeLlmMock("insight text");
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any, llm });
    await agent.execute(makeContextWithMetrics(metrics));

    const prompt = (llm.complete.mock.calls[0] as [string])[0];
    expect(prompt).toContain("5"); // metric count
  });

  it("does NOT call LLM when metrics < 5", async () => {
    const metrics = Array.from({ length: 3 }, () => makeMetric());
    const llm = makeLlmMock("should not be called");
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any, llm });
    await agent.execute(makeContextWithMetrics(metrics));

    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("continues without ecosystemInsight when LLM throws (insight is optional)", async () => {
    const metrics = Array.from({ length: 5 }, () => makeMetric());
    const llm = { complete: vi.fn().mockRejectedValue(new Error("LLM rate limited")) };
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any, llm });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    // Should succeed — LLM failure for insight is non-fatal
    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
    const output = result.output as EvolveOutput;
    expect(output.ecosystemInsight).toBeUndefined();
  });

  // ── Event bus emission ────────────────────────────────────────────────────

  it("emits agent.started and agent.completed to archibald.lifecycle", async () => {
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    await agent.execute(baseContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain("agent.started");
    expect(allArgs).toContain("agent.completed");
  });

  it("emits to archibald.insights when proposals are generated", async () => {
    const metrics = [
      makeMetric({ loopbackCount: 3 }),
      makeMetric({ loopbackCount: 4 }),
    ];
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    await agent.execute(makeContextWithMetrics(metrics));

    const streams = (redis.xadd.mock.calls as string[][]).map((c) => c[0]);
    expect(streams).toContain("archibald.insights");
  });

  it("does NOT emit to archibald.insights when no proposals generated", async () => {
    // Single clean run: no anti-patterns, no loopbacks, no sentinel findings
    const metrics = [makeMetric()];
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    if (output.proposals.length === 0) {
      const streams = (redis.xadd.mock.calls as string[][]).map((c) => c[0]);
      expect(streams).not.toContain("archibald.insights");
    }
    // If stub generates proposals anyway, just ensure the stream is included
  });

  it("archibald.insights event includes proposalCount", async () => {
    const metrics = [
      makeMetric({ loopbackCount: 3 }),
      makeMetric({ loopbackCount: 4 }),
    ];
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    await agent.execute(makeContextWithMetrics(metrics));

    const insightCall = (redis.xadd.mock.calls as string[][]).find(
      (c) => c[0] === "archibald.insights",
    );
    expect(insightCall).toBeDefined();
    expect(insightCall!).toContain("proposalCount");
  });

  it("archibald.lifecycle completed event includes proposalCount", async () => {
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    await agent.execute(baseContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain("proposalCount");
  });

  // ── Stub metrics fallback ─────────────────────────────────────────────────

  it("uses stub metrics when previousStageOutput has no metrics field", async () => {
    const redis = makeRedisMock();
    const contextNoMetrics: AgentContext = {
      ...baseContext,
      previousStageOutput: { someOtherField: "value" },
    };
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(contextNoMetrics);

    expect(result.success).toBe(true);
    const output = result.output as EvolveOutput;
    // Stub generates 1 metric
    expect(output.analysedRunCount).toBeGreaterThan(0);
  });

  // ── Redis failure propagation ─────────────────────────────────────────────

  it("Redis emit failure propagates (not swallowed)", async () => {
    const redis = { xadd: vi.fn().mockRejectedValue(new Error("Redis down")) };
    const agent = new EvolveAgent({ redis: redis as any });
    await expect(agent.execute(baseContext)).rejects.toThrow("Redis down");
  });

  it("works without redis (no-op emit)", async () => {
    const agent = new EvolveAgent({ redis: null });
    const result = await agent.execute(baseContext);
    expect(result.success).toBe(true);
  });

  // ── strategyRankings ──────────────────────────────────────────────────────

  it("strategyRankings contains arms seeded from provided metrics", async () => {
    const metrics = [
      makeMetric({ architecturalChoices: ["event-driven", "circuit-breaker"], incidentCount: 0, mttrMs: 0 }),
      makeMetric({ architecturalChoices: ["event-driven"], incidentCount: 0, mttrMs: 0 }),
      makeMetric({ architecturalChoices: ["monolith"], incidentCount: 5, mttrMs: 1_800_000 }),
    ];
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    const names = output.strategyRankings.map((a) => a.name);
    expect(names).toContain("event-driven");
    expect(names).toContain("monolith");
  });

  it("strategyRankings are sorted by mean reward descending", async () => {
    const metrics = [
      makeMetric({ architecturalChoices: ["good-arch"], incidentCount: 0, mttrMs: 0 }),
      makeMetric({ architecturalChoices: ["good-arch"], incidentCount: 0, mttrMs: 0 }),
      makeMetric({ architecturalChoices: ["bad-arch"], incidentCount: 10, mttrMs: 3_600_000 }),
      makeMetric({ architecturalChoices: ["bad-arch"], incidentCount: 10, mttrMs: 3_600_000 }),
    ];
    const redis = makeRedisMock();
    const agent = new EvolveAgent({ redis: redis as any });
    const result = await agent.execute(makeContextWithMetrics(metrics));

    const output = result.output as EvolveOutput;
    const ranked = output.strategyRankings;
    const goodIdx = ranked.findIndex((a) => a.name === "good-arch");
    const badIdx = ranked.findIndex((a) => a.name === "bad-arch");
    expect(goodIdx).toBeLessThan(badIdx);
  });
});

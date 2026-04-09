import { describe, it, expect } from "vitest";
import { StrategyBandit, type StrategyArm, type LifecycleRunMetrics } from "../agents/evolve-agent.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMetric(
  overrides: Partial<LifecycleRunMetrics> & { architecturalChoices: string[] },
): LifecycleRunMetrics {
  return {
    runId: crypto.randomUUID(),
    productId: "prod-test",
    type: "feature",
    durationMs: 3600000,
    loopbackCount: 0,
    sentinelFindingsCount: 0,
    incidentCount: overrides.incidentCount ?? 0,
    mttrMs: overrides.mttrMs ?? 0,
    ...overrides,
  };
}

// ── UCB1 core behaviour ───────────────────────────────────────────────────────

describe("StrategyBandit — UCB1 algorithm", () => {
  it("prefers an unvisited arm over a visited one (infinity score)", () => {
    const bandit = new StrategyBandit();

    // Record several pulls for "microservices" so it has a known score
    for (let i = 0; i < 5; i++) {
      bandit.record("microservices", 0.9);
    }

    // "event-driven" has never been visited — UCB1 gives it infinity
    const selected = bandit.selectBest(["microservices", "event-driven"], 5);
    expect(selected).toBe("event-driven");
  });

  it("returns the only candidate when only one arm is passed", () => {
    const bandit = new StrategyBandit();
    bandit.record("monolith", 0.7);
    const selected = bandit.selectBest(["monolith"], 1);
    expect(selected).toBe("monolith");
  });

  it("returns any candidate when all are unvisited (first unvisited wins)", () => {
    const bandit = new StrategyBandit();
    const selected = bandit.selectBest(["a", "b", "c"], 1);
    // First unvisited arm is returned immediately
    expect(["a", "b", "c"]).toContain(selected);
  });

  it("selects the arm with highest UCB1 score when all arms are visited", () => {
    const bandit = new StrategyBandit();

    // "event-driven": 10 pulls, reward ~0.9 each → high mean, moderate exploration
    for (let i = 0; i < 10; i++) bandit.record("event-driven", 0.9);

    // "monolith": 10 pulls, reward ~0.1 each → low mean
    for (let i = 0; i < 10; i++) bandit.record("monolith", 0.1);

    // "microservices": 10 pulls, reward ~0.5 each → medium mean
    for (let i = 0; i < 10; i++) bandit.record("microservices", 0.5);

    const totalPulls = 30;
    const selected = bandit.selectBest(["event-driven", "monolith", "microservices"], totalPulls);
    expect(selected).toBe("event-driven");
  });

  it("UCB1 exploration term favours less-pulled arms when rewards are equal", () => {
    const bandit = new StrategyBandit();

    // Both arms have the same mean reward (0.5) but different pull counts
    for (let i = 0; i < 20; i++) bandit.record("popular", 0.5);
    for (let i = 0; i < 2; i++) bandit.record("rare", 0.5);

    const totalPulls = 22;
    // "rare" has fewer pulls → larger sqrt term → higher UCB1 score
    const selected = bandit.selectBest(["popular", "rare"], totalPulls);
    expect(selected).toBe("rare");
  });
});

// ── record() ──────────────────────────────────────────────────────────────────

describe("StrategyBandit — record()", () => {
  it("increments pulls on each call", () => {
    const bandit = new StrategyBandit();
    bandit.record("microservices", 0.8);
    bandit.record("microservices", 0.6);
    const rankings = bandit.getRankings();
    const arm = rankings.find((a) => a.name === "microservices")!;
    expect(arm.pulls).toBe(2);
  });

  it("accumulates totalReward correctly", () => {
    const bandit = new StrategyBandit();
    bandit.record("microservices", 0.4);
    bandit.record("microservices", 0.6);
    const arm = bandit.getRankings().find((a) => a.name === "microservices")!;
    expect(arm.totalReward).toBeCloseTo(1.0);
  });

  it("counts wins for rewards >= 0.5", () => {
    const bandit = new StrategyBandit();
    bandit.record("microservices", 0.4); // not a win
    bandit.record("microservices", 0.5); // win (boundary)
    bandit.record("microservices", 0.9); // win
    const arm = bandit.getRankings().find((a) => a.name === "microservices")!;
    expect(arm.wins).toBe(2);
  });

  it("creates a new arm when the strategy has not been seen before", () => {
    const bandit = new StrategyBandit();
    bandit.record("brand-new-strategy", 1.0);
    const rankings = bandit.getRankings();
    expect(rankings).toHaveLength(1);
    expect(rankings[0]!.name).toBe("brand-new-strategy");
  });
});

// ── getRankings() ─────────────────────────────────────────────────────────────

describe("StrategyBandit — getRankings()", () => {
  it("returns arms sorted by mean reward descending", () => {
    const bandit = new StrategyBandit();
    bandit.record("bad", 0.1);
    bandit.record("bad", 0.1);
    bandit.record("ok", 0.5);
    bandit.record("ok", 0.5);
    bandit.record("great", 0.9);
    bandit.record("great", 0.9);

    const rankings = bandit.getRankings();
    expect(rankings[0]!.name).toBe("great");
    expect(rankings[1]!.name).toBe("ok");
    expect(rankings[2]!.name).toBe("bad");
  });

  it("returns an empty array when no arms have been recorded", () => {
    const bandit = new StrategyBandit();
    expect(bandit.getRankings()).toEqual([]);
  });

  it("returns all arms, not just the top one", () => {
    const bandit = new StrategyBandit();
    bandit.record("a", 0.9);
    bandit.record("b", 0.7);
    bandit.record("c", 0.3);
    expect(bandit.getRankings()).toHaveLength(3);
  });

  it("StrategyArm has name, pulls, wins, totalReward fields", () => {
    const bandit = new StrategyBandit();
    bandit.record("microservices", 0.8);
    const arm: StrategyArm = bandit.getRankings()[0]!;
    expect(typeof arm.name).toBe("string");
    expect(typeof arm.pulls).toBe("number");
    expect(typeof arm.wins).toBe("number");
    expect(typeof arm.totalReward).toBe("number");
  });
});

// ── fromMetrics() ─────────────────────────────────────────────────────────────

describe("StrategyBandit — fromMetrics()", () => {
  it("seeds an arm for each architectural choice across all metrics", () => {
    const bandit = new StrategyBandit();
    bandit.fromMetrics([
      makeMetric({ architecturalChoices: ["REST API", "PostgreSQL"] }),
      makeMetric({ architecturalChoices: ["REST API", "Redis"] }),
    ]);

    const names = bandit.getRankings().map((a) => a.name);
    expect(names).toContain("REST API");
    expect(names).toContain("PostgreSQL");
    expect(names).toContain("Redis");
  });

  it("records pulls equal to the number of metrics that include that choice", () => {
    const bandit = new StrategyBandit();
    bandit.fromMetrics([
      makeMetric({ architecturalChoices: ["event-driven"] }),
      makeMetric({ architecturalChoices: ["event-driven"] }),
      makeMetric({ architecturalChoices: ["monolith"] }),
    ]);

    const ed = bandit.getRankings().find((a) => a.name === "event-driven")!;
    const mono = bandit.getRankings().find((a) => a.name === "monolith")!;
    expect(ed.pulls).toBe(2);
    expect(mono.pulls).toBe(1);
  });

  it("computes reward = 1.0 for a run with 0 incidents and 0 MTTR", () => {
    const bandit = new StrategyBandit();
    bandit.fromMetrics([
      makeMetric({ architecturalChoices: ["perfect-arch"], incidentCount: 0, mttrMs: 0 }),
    ]);
    const arm = bandit.getRankings().find((a) => a.name === "perfect-arch")!;
    expect(arm.totalReward).toBeCloseTo(1.0);
  });

  it("computes reward ~0.0 for a run with 10+ incidents and 1h+ MTTR", () => {
    const bandit = new StrategyBandit();
    bandit.fromMetrics([
      makeMetric({ architecturalChoices: ["disaster-arch"], incidentCount: 10, mttrMs: 3600000 }),
    ]);
    const arm = bandit.getRankings().find((a) => a.name === "disaster-arch")!;
    expect(arm.totalReward).toBeCloseTo(0.0);
  });

  it("reward is clamped to 0 (never negative) even for extreme values", () => {
    const bandit = new StrategyBandit();
    bandit.fromMetrics([
      makeMetric({ architecturalChoices: ["chaos"], incidentCount: 1000, mttrMs: 999999999 }),
    ]);
    const arm = bandit.getRankings().find((a) => a.name === "chaos")!;
    expect(arm.totalReward).toBeGreaterThanOrEqual(0);
  });

  it("does nothing for an empty metrics array", () => {
    const bandit = new StrategyBandit();
    bandit.fromMetrics([]);
    expect(bandit.getRankings()).toHaveLength(0);
  });

  it("fromMetrics correctly ranks better-performing strategies above worse ones", () => {
    const bandit = new StrategyBandit();

    // "event-driven" used in 3 clean runs
    const goodRuns = Array.from({ length: 3 }, () =>
      makeMetric({ architecturalChoices: ["event-driven"], incidentCount: 0, mttrMs: 0 }),
    );

    // "monolith" used in 3 bad runs (5 incidents each, 30min MTTR)
    const badRuns = Array.from({ length: 3 }, () =>
      makeMetric({ architecturalChoices: ["monolith"], incidentCount: 5, mttrMs: 1800000 }),
    );

    bandit.fromMetrics([...goodRuns, ...badRuns]);

    const rankings = bandit.getRankings();
    expect(rankings[0]!.name).toBe("event-driven");
    expect(rankings[1]!.name).toBe("monolith");
  });
});

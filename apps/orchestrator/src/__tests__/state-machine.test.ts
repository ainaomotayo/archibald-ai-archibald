import { describe, it, expect, beforeEach } from "vitest";
import {
  LifecycleStateMachine,
  VALID_TRANSITIONS,
  type LifecycleStage,
} from "../lifecycle/state-machine.js";

describe("LifecycleStateMachine — construction", () => {
  it("initialises at conception by default", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1");
    expect(sm.getStage()).toBe("conception");
  });

  it("accepts a custom initial stage", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1", "build");
    expect(sm.getStage()).toBe("build");
  });

  it("starts with empty history", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1");
    expect(sm.getHistory()).toHaveLength(0);
  });
});

describe("LifecycleStateMachine — happy path conception → live", () => {
  let sm: LifecycleStateMachine;

  beforeEach(() => {
    sm = new LifecycleStateMachine("prod-1", "run-1");
  });

  it("conception → requirements via lifecycle.start", () => {
    const result = sm.transition("requirements", "lifecycle.start");
    expect(result.success).toBe(true);
    expect(sm.getStage()).toBe("requirements");
  });

  it("requirements → design via agent.completed", () => {
    sm.transition("requirements", "lifecycle.start");
    const result = sm.transition("design", "agent.completed");
    expect(result.success).toBe(true);
    expect(sm.getStage()).toBe("design");
  });

  it("design → review via agent.completed", () => {
    sm.transition("requirements", "lifecycle.start");
    sm.transition("design", "agent.completed");
    const result = sm.transition("review", "agent.completed");
    expect(result.success).toBe(true);
    expect(sm.getStage()).toBe("review");
  });

  it("review → build via human.approved", () => {
    sm.transition("requirements", "lifecycle.start");
    sm.transition("design", "agent.completed");
    sm.transition("review", "agent.completed");
    const result = sm.transition("build", "human.approved");
    expect(result.success).toBe(true);
    expect(sm.getStage()).toBe("build");
  });

  it("full happy path through scan gate reaches deploy", () => {
    sm.transition("requirements", "lifecycle.start");
    sm.transition("design", "agent.completed");
    sm.transition("review", "agent.completed");
    sm.transition("build", "human.approved");
    sm.transition("test", "agent.completed");
    const scanResult = sm.transition("scan", "agent.completed", {
      testCoverageThreshold: 80,
      actualCoverage: 92,
    });
    expect(scanResult.success).toBe(true);

    const deployResult = sm.transition("deploy", "sentinel.certificate.received", {
      sentinelCertificateId: "cert-abc",
      sentinelMaxSeverity: "LOW",
    });
    expect(deployResult.success).toBe(true);
    expect(sm.getStage()).toBe("deploy");
  });

  it("deploy → monitor → live via phoenix.configured", () => {
    sm = new LifecycleStateMachine("prod-1", "run-1", "deploy");
    sm.transition("monitor", "deploy.succeeded", { smokTestsPassed: true });
    const result = sm.transition("live", "phoenix.configured");
    expect(result.success).toBe(true);
    expect(sm.getStage()).toBe("live");
  });
});

describe("LifecycleStateMachine — gate enforcement", () => {
  it("blocks test → scan when coverage below threshold", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1", "test");
    const result = sm.transition("scan", "agent.completed", {
      testCoverageThreshold: 80,
      actualCoverage: 65,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("65%");
    expect(result.error).toContain("80%");
    expect(sm.getStage()).toBe("test"); // stage unchanged
  });

  it("allows test → scan when coverage meets threshold", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1", "test");
    const result = sm.transition("scan", "agent.completed", {
      testCoverageThreshold: 80,
      actualCoverage: 80,
    });
    expect(result.success).toBe(true);
  });

  it("blocks scan → deploy when no SENTINEL certificate", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1", "scan");
    const result = sm.transition("deploy", "sentinel.certificate.received", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("No SENTINEL certificate");
    expect(sm.getStage()).toBe("scan");
  });

  it("blocks scan → deploy when CRITICAL findings present", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1", "scan");
    const result = sm.transition("deploy", "sentinel.certificate.received", {
      sentinelCertificateId: "cert-xyz",
      sentinelMaxSeverity: "CRITICAL",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("CRITICAL");
    expect(sm.getStage()).toBe("scan");
  });

  it("blocks scan → deploy when HIGH findings present", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1", "scan");
    const result = sm.transition("deploy", "sentinel.certificate.received", {
      sentinelCertificateId: "cert-xyz",
      sentinelMaxSeverity: "HIGH",
    });
    expect(result.success).toBe(false);
    expect(sm.getStage()).toBe("scan");
  });

  it("blocks deploy → monitor when smoke tests not passed", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1", "deploy");
    const result = sm.transition("monitor", "deploy.succeeded", {
      smokTestsPassed: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("smoke tests");
  });
});

describe("LifecycleStateMachine — loopback transitions", () => {
  it("review → design via human.rejected (loopback)", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1", "review");
    const result = sm.transition("design", "human.rejected");
    expect(result.success).toBe(true);
    expect(sm.getStage()).toBe("design");
    expect(result.transition?.isLoopback).toBe(true);
  });

  it("scan → build via sentinel.findings.critical (loopback)", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1", "scan");
    const result = sm.transition("build", "sentinel.findings.critical");
    expect(result.success).toBe(true);
    expect(result.transition?.isLoopback).toBe(true);
  });

  it("deploy → scan via deploy.failed (loopback)", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1", "deploy");
    const result = sm.transition("scan", "deploy.failed");
    expect(result.success).toBe(true);
    expect(result.transition?.isLoopback).toBe(true);
  });

  it("evolving → requirements via new.lifecycle.run", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1", "evolving");
    const result = sm.transition("requirements", "new.lifecycle.run");
    expect(result.success).toBe(true);
    expect(sm.getStage()).toBe("requirements");
  });
});

describe("LifecycleStateMachine — invalid transitions", () => {
  it("rejects invalid stage transition", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1", "conception");
    const result = sm.transition("deploy", "lifecycle.start");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid transition");
    expect(sm.getStage()).toBe("conception");
  });

  it("rejects wrong trigger for valid stage pair", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1", "conception");
    const result = sm.transition("requirements", "agent.completed");
    expect(result.success).toBe(false);
    expect(sm.getStage()).toBe("conception");
  });
});

describe("LifecycleStateMachine — history tracking", () => {
  it("records each transition in history", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1");
    sm.transition("requirements", "lifecycle.start");
    sm.transition("design", "agent.completed");

    const history = sm.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].from).toBe("conception");
    expect(history[0].to).toBe("requirements");
    expect(history[1].from).toBe("requirements");
    expect(history[1].to).toBe("design");
  });

  it("history entries have occurredAt timestamps", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1");
    sm.transition("requirements", "lifecycle.start");
    const history = sm.getHistory();
    expect(history[0].occurredAt).toBeInstanceOf(Date);
  });

  it("failed transitions do not appear in history", () => {
    const sm = new LifecycleStateMachine("prod-1", "run-1");
    sm.transition("deploy", "lifecycle.start"); // invalid
    expect(sm.getHistory()).toHaveLength(0);
  });
});

describe("VALID_TRANSITIONS — completeness", () => {
  it("has at least 14 transitions defined", () => {
    expect(VALID_TRANSITIONS.length).toBeGreaterThanOrEqual(14);
  });

  it("every stage except live/evolving has at least one outbound transition", () => {
    const stages: LifecycleStage[] = [
      "conception", "requirements", "design", "review",
      "build", "test", "scan", "deploy", "monitor",
    ];
    for (const stage of stages) {
      const outbound = VALID_TRANSITIONS.filter((t) => t.from === stage);
      expect(outbound.length, `Stage '${stage}' has no outbound transitions`).toBeGreaterThan(0);
    }
  });
});

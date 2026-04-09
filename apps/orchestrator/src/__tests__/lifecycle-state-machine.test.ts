import { describe, it, expect, beforeEach } from "vitest";
import { LifecycleStateMachine } from "../lifecycle/state-machine.js";

describe("LifecycleStateMachine", () => {
  let machine: LifecycleStateMachine;

  beforeEach(() => {
    machine = new LifecycleStateMachine("product-123", "run-456", "conception");
  });

  // ─── Valid transitions ─────────────────────────────────────────────────────

  it("valid transition: conception → requirements on lifecycle.start", () => {
    const result = machine.transition("requirements", "lifecycle.start");
    expect(result.success).toBe(true);
    expect(result.newStage).toBe("requirements");
    expect(machine.getStage()).toBe("requirements");
  });

  it("valid transition: requirements → design on agent.completed", () => {
    machine.transition("requirements", "lifecycle.start");
    const result = machine.transition("design", "agent.completed");
    expect(result.success).toBe(true);
    expect(machine.getStage()).toBe("design");
  });

  it("valid transition: design → review on agent.completed", () => {
    machine.transition("requirements", "lifecycle.start");
    machine.transition("design", "agent.completed");
    const result = machine.transition("review", "agent.completed");
    expect(result.success).toBe(true);
    expect(machine.getStage()).toBe("review");
  });

  it("valid transition: review → build on human.approved", () => {
    machine.transition("requirements", "lifecycle.start");
    machine.transition("design", "agent.completed");
    machine.transition("review", "agent.completed");
    const result = machine.transition("build", "human.approved");
    expect(result.success).toBe(true);
    expect(machine.getStage()).toBe("build");
  });

  it("valid loopback: review → design on human.rejected", () => {
    machine.transition("requirements", "lifecycle.start");
    machine.transition("design", "agent.completed");
    machine.transition("review", "agent.completed");
    const result = machine.transition("design", "human.rejected");
    expect(result.success).toBe(true);
    expect(result.transition?.isLoopback).toBe(true);
    expect(machine.getStage()).toBe("design");
  });

  it("valid loopback: test → build when coverage insufficient", () => {
    machine.transition("requirements", "lifecycle.start");
    machine.transition("design", "agent.completed");
    machine.transition("review", "agent.completed");
    machine.transition("build", "human.approved");
    machine.transition("test", "agent.completed");
    const result = machine.transition("build", "agent.completed");
    expect(result.success).toBe(true);
    expect(result.transition?.isLoopback).toBe(true);
  });

  // ─── Invalid transitions ───────────────────────────────────────────────────

  it("invalid transition: conception → deploy throws error", () => {
    const result = machine.transition("deploy", "lifecycle.start");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid transition");
    expect(result.error).toContain("conception");
    expect(machine.getStage()).toBe("conception"); // stage unchanged
  });

  it("invalid transition: conception → build with wrong trigger", () => {
    const result = machine.transition("requirements", "human.approved");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("cannot skip stages: requirements → scan is invalid", () => {
    machine.transition("requirements", "lifecycle.start");
    const result = machine.transition("scan", "agent.completed");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid transition");
  });

  // ─── Gate enforcement ──────────────────────────────────────────────────────

  it("scan → deploy gate: requires SENTINEL certificate", () => {
    // Navigate to scan stage
    machine.transition("requirements", "lifecycle.start");
    machine.transition("design", "agent.completed");
    machine.transition("review", "agent.completed");
    machine.transition("build", "human.approved");
    machine.transition("test", "agent.completed");
    machine.transition("scan", "agent.completed");

    // Attempt deploy without certificate
    const result = machine.transition("deploy", "sentinel.certificate.received", {
      sentinelCertificateId: undefined,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No SENTINEL certificate");
    expect(machine.getStage()).toBe("scan"); // blocked
  });

  it("scan → deploy gate: blocks on CRITICAL severity", () => {
    machine.transition("requirements", "lifecycle.start");
    machine.transition("design", "agent.completed");
    machine.transition("review", "agent.completed");
    machine.transition("build", "human.approved");
    machine.transition("test", "agent.completed");
    machine.transition("scan", "agent.completed");

    const result = machine.transition("deploy", "sentinel.certificate.received", {
      sentinelCertificateId: "cert-abc123",
      sentinelMaxSeverity: "CRITICAL",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("CRITICAL");
  });

  it("scan → deploy gate: passes for LOW severity with certificate", () => {
    machine.transition("requirements", "lifecycle.start");
    machine.transition("design", "agent.completed");
    machine.transition("review", "agent.completed");
    machine.transition("build", "human.approved");
    machine.transition("test", "agent.completed");
    machine.transition("scan", "agent.completed");

    const result = machine.transition("deploy", "sentinel.certificate.received", {
      sentinelCertificateId: "cert-clean-456",
      sentinelMaxSeverity: "LOW",
    });
    expect(result.success).toBe(true);
    expect(machine.getStage()).toBe("deploy");
  });

  it("test → scan gate: blocks when coverage below threshold", () => {
    machine.transition("requirements", "lifecycle.start");
    machine.transition("design", "agent.completed");
    machine.transition("review", "agent.completed");
    machine.transition("build", "human.approved");
    machine.transition("test", "agent.completed");

    const result = machine.transition("scan", "agent.completed", {
      testCoverageThreshold: 80,
      actualCoverage: 65,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("65%");
    expect(result.error).toContain("80%");
  });

  it("test → scan gate: passes when coverage meets threshold", () => {
    machine.transition("requirements", "lifecycle.start");
    machine.transition("design", "agent.completed");
    machine.transition("review", "agent.completed");
    machine.transition("build", "human.approved");
    machine.transition("test", "agent.completed");

    const result = machine.transition("scan", "agent.completed", {
      testCoverageThreshold: 80,
      actualCoverage: 87,
    });
    expect(result.success).toBe(true);
    expect(machine.getStage()).toBe("scan");
  });

  // ─── State inspection ──────────────────────────────────────────────────────

  it("getValidNextStages returns correct options from current stage", () => {
    machine.transition("requirements", "lifecycle.start");
    const next = machine.getValidNextStages();
    expect(next).toContain("design");
  });

  it("transition history is recorded", () => {
    machine.transition("requirements", "lifecycle.start");
    machine.transition("design", "agent.completed");
    const history = machine.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]!.from).toBe("conception");
    expect(history[0]!.to).toBe("requirements");
    expect(history[1]!.from).toBe("requirements");
    expect(history[1]!.to).toBe("design");
  });

  it("canTransition returns false for invalid moves", () => {
    expect(machine.canTransition("deploy", "lifecycle.start")).toBe(false);
  });

  it("canTransition returns true for valid moves", () => {
    expect(machine.canTransition("requirements", "lifecycle.start")).toBe(true);
  });
});

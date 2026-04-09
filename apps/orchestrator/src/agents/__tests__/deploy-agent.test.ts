import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DeployAgent } from "../deploy-agent.js";
import type { AgentContext } from "../base-agent.js";
import type { DeploymentRecord } from "../deploy-agent.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRedisMock() {
  return { xadd: vi.fn().mockResolvedValue("0-1") };
}

const CERT_ID = "cert-00000001";
const COMMIT_SHA = "abc123def456";

const mockContext: AgentContext = {
  productId: "prod-deploy",
  lifecycleRunId: "run-deploy-001",
  stage: "deploy",
  requirement: "Deploy the payment service to staging",
  previousStageOutput: {
    sentinelCertificateId: CERT_ID,
    commitSha: COMMIT_SHA,
    certificate: { id: CERT_ID, maxSeverity: "LOW" },
  },
  orgContext: { orgId: "org-test" },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DeployAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path: deployment request emitted ────────────────────────────────

  it("returns wait_for_human with nextAction 'wait_for_human' (async deployment pattern)", async () => {
    const redis = makeRedisMock();
    const agent = new DeployAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("wait_for_human");
    expect(result.success).toBe(true);
  });

  it("output is a DeploymentRecord with required fields", async () => {
    const redis = makeRedisMock();
    const agent = new DeployAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const output = result.output as DeploymentRecord;
    expect(typeof output.id).toBe("string");
    expect(output.id.length).toBeGreaterThan(0);
    expect(output.productId).toBe(mockContext.productId);
    expect(output.runId).toBe(mockContext.lifecycleRunId);
    expect(output.environment).toBe("staging");
    expect(output.status).toBe("requested");
    expect(typeof output.requestedAt).toBe("string");
  });

  it("output DeploymentRecord contains the commitSha from previousStageOutput", async () => {
    const redis = makeRedisMock();
    const agent = new DeployAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const output = result.output as DeploymentRecord;
    expect(output.commitSha).toBe(COMMIT_SHA);
  });

  it("pendingDecision describes deployment-in-progress state", async () => {
    const redis = makeRedisMock();
    const agent = new DeployAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    expect(result.pendingDecision).toBeDefined();
    expect(result.pendingDecision!.title).toMatch(/deployment|deploy/i);
    expect(result.pendingDecision!.urgency).toBe("medium");
    expect(result.pendingDecision!.timeoutHours).toBe(4);
  });

  it("pendingDecision description includes environment, commitSha, and certificateId", async () => {
    const redis = makeRedisMock();
    const agent = new DeployAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const desc = result.pendingDecision!.description;
    expect(desc).toContain("staging");
    expect(desc).toContain(COMMIT_SHA);
    expect(desc).toContain(CERT_ID);
  });

  it("evidence contains archibald:deploy-request source", async () => {
    const redis = makeRedisMock();
    const agent = new DeployAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("archibald:deploy-request");
  });

  it("evidence confidence for deploy-request is 1.0", async () => {
    const redis = makeRedisMock();
    const agent = new DeployAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const deployEvidence = result.evidence.find((e) => e.source === "archibald:deploy-request");
    expect(deployEvidence!.confidence).toBe(1.0);
  });

  // ── deploymentId is a unique UUID ─────────────────────────────────────────

  it("each execution generates a unique deploymentId", async () => {
    const redis = makeRedisMock();
    const agent = new DeployAgent({ redis: redis as any });
    const result1 = await agent.execute(mockContext);
    const result2 = await agent.execute(mockContext);

    const out1 = result1.output as DeploymentRecord;
    const out2 = result2.output as DeploymentRecord;
    expect(out1.id).not.toBe(out2.id);
  });

  // ── Event bus emission ────────────────────────────────────────────────────

  it("emits to archibald.lifecycle (agent.started) and archibald.deploy.requested", async () => {
    const redis = makeRedisMock();
    const agent = new DeployAgent({ redis: redis as any });
    await agent.execute(mockContext);

    const streams = (redis.xadd.mock.calls as string[][]).map((c) => c[0]);
    expect(streams).toContain("archibald.lifecycle");
    expect(streams).toContain("archibald.deploy.requested");
  });

  it("archibald.deploy.requested event includes deploymentId, commitSha, productId, environment", async () => {
    const redis = makeRedisMock();
    const agent = new DeployAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const output = result.output as DeploymentRecord;
    const deployStream = (redis.xadd.mock.calls as string[][]).find((c) => c[0] === "archibald.deploy.requested");
    expect(deployStream).toBeDefined();

    const deployArgs = deployStream!;
    expect(deployArgs).toContain(output.id);
    expect(deployArgs).toContain(mockContext.productId);
    expect(deployArgs).toContain("staging");
    expect(deployArgs).toContain(COMMIT_SHA);
  });

  it("archibald.deploy.requested event includes sentinelCertificateId", async () => {
    const redis = makeRedisMock();
    const agent = new DeployAgent({ redis: redis as any });
    await agent.execute(mockContext);

    const deployStreamArgs = (redis.xadd.mock.calls as string[][]).find(
      (c) => c[0] === "archibald.deploy.requested",
    )!;
    expect(deployStreamArgs).toContain(CERT_ID);
  });

  it("archibald.deploy.requested emitted even when no certificateId in previousStageOutput", async () => {
    const redis = makeRedisMock();
    const contextNoCert: AgentContext = {
      ...mockContext,
      previousStageOutput: { commitSha: COMMIT_SHA },
    };
    const agent = new DeployAgent({ redis: redis as any });
    await agent.execute(contextNoCert);

    const streams = (redis.xadd.mock.calls as string[][]).map((c) => c[0]);
    expect(streams).toContain("archibald.deploy.requested");
  });

  it("agent.started event is emitted to archibald.lifecycle", async () => {
    const redis = makeRedisMock();
    const agent = new DeployAgent({ redis: redis as any });
    await agent.execute(mockContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain("agent.started");
  });

  it("Redis emit failure propagates (not swallowed)", async () => {
    const redis = { xadd: vi.fn().mockRejectedValue(new Error("Redis unavailable")) };
    const agent = new DeployAgent({ redis: redis as any });
    await expect(agent.execute(mockContext)).rejects.toThrow("Redis unavailable");
  });

  it("gracefully handles missing redis (no-op emit)", async () => {
    const agent = new DeployAgent({ redis: null });
    const result = await agent.execute(mockContext);
    // Should still succeed and produce the record
    expect(result.nextAction).toBe("wait_for_human");
    const output = result.output as DeploymentRecord;
    expect(typeof output.id).toBe("string");
  });

  // ── commitSha fallback when previousStageOutput is absent ─────────────────

  it("falls back to 'HEAD' commitSha when previousStageOutput is undefined", async () => {
    const redis = makeRedisMock();
    const contextNoPrev: AgentContext = { ...mockContext, previousStageOutput: undefined };
    const agent = new DeployAgent({ redis: redis as any });
    const result = await agent.execute(contextNoPrev);

    const output = result.output as DeploymentRecord;
    expect(output.commitSha).toBe("HEAD");
  });

  // ── orgId in the deploy event ─────────────────────────────────────────────

  it("deploy.requested event includes orgId from context", async () => {
    const redis = makeRedisMock();
    const agent = new DeployAgent({ redis: redis as any });
    await agent.execute(mockContext);

    const deployArgs = (redis.xadd.mock.calls as string[][]).find(
      (c) => c[0] === "archibald.deploy.requested",
    )!;
    expect(deployArgs).toContain("org-test");
  });
});

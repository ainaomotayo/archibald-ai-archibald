import { describe, it, expect, vi, afterEach } from "vitest";
import { MonitorAgent } from "../monitor-agent.js";
import type { AgentContext } from "../base-agent.js";
import type { MonitoringConfig } from "../monitor-agent.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRedisMock() {
  return { xadd: vi.fn().mockResolvedValue("0-1") };
}

const mockContext: AgentContext = {
  productId: "prod-monitor",
  lifecycleRunId: "run-monitor-001",
  stage: "monitor",
  requirement: "Monitor the payment service",
  previousStageOutput: {
    id: "deploy-00000001",
    productId: "prod-monitor",
    runId: "run-monitor-001",
    environment: "staging",
    commitSha: "abc123",
    requestedAt: new Date().toISOString(),
    status: "requested",
    serviceName: "payment-service",
  },
  orgContext: { orgId: "org-test" },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MonitorAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("returns success:true with nextAction 'proceed'", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
  });

  it("output contains config and monitoringConfiguredAt", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const output = result.output as { config: MonitoringConfig; monitoringConfiguredAt: string };
    expect(output.config).toBeDefined();
    expect(typeof output.monitoringConfiguredAt).toBe("string");
    // monitoringConfiguredAt should be a valid ISO datetime
    expect(() => new Date(output.monitoringConfiguredAt)).not.toThrow();
  });

  // ── MonitoringConfig structure ─────────────────────────────────────────────

  it("MonitoringConfig has productId, serviceName, expectedBaselines, alertThresholds", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const output = result.output as { config: MonitoringConfig };
    const { config } = output;

    expect(config.productId).toBe(mockContext.productId);
    expect(typeof config.serviceName).toBe("string");
    expect(config.serviceName.length).toBeGreaterThan(0);
    expect(config.expectedBaselines).toBeDefined();
    expect(config.alertThresholds).toBeDefined();
    expect(typeof config.autoRemediationEnabled).toBe("boolean");
    expect(typeof config.escalationTimeoutMinutes).toBe("number");
  });

  it("alertThresholds have errorRatePercent, p95LatencyMs, cpuPercent", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const { config } = result.output as { config: MonitoringConfig };
    expect(typeof config.alertThresholds.errorRatePercent).toBe("number");
    expect(typeof config.alertThresholds.p95LatencyMs).toBe("number");
    expect(typeof config.alertThresholds.cpuPercent).toBe("number");
  });

  it("autoRemediationEnabled is true by default", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const { config } = result.output as { config: MonitoringConfig };
    expect(config.autoRemediationEnabled).toBe(true);
  });

  it("escalationTimeoutMinutes is 15 by default", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const { config } = result.output as { config: MonitoringConfig };
    expect(config.escalationTimeoutMinutes).toBe(15);
  });

  // ── serviceName derivation ────────────────────────────────────────────────

  it("uses serviceName from previousStageOutput when available", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const { config } = result.output as { config: MonitoringConfig };
    expect(config.serviceName).toBe("payment-service");
  });

  it("derives serviceName from productId when previousStageOutput has no serviceName", async () => {
    const redis = makeRedisMock();
    const contextNoName: AgentContext = {
      ...mockContext,
      previousStageOutput: { id: "deploy-001" },
    };
    const agent = new MonitorAgent({ redis: redis as any });
    const result = await agent.execute(contextNoName);

    const { config } = result.output as { config: MonitoringConfig };
    // productId is "prod-monitor" → should be normalised to kebab-case
    expect(config.serviceName).toMatch(/^[a-z0-9-]+$/);
    expect(config.serviceName).toContain("prod");
  });

  it("serviceName is lowercase kebab-case when derived from productId", async () => {
    const redis = makeRedisMock();
    const contextSpecialChars: AgentContext = {
      ...mockContext,
      productId: "MyProduct_Service.v2",
      previousStageOutput: {},
    };
    const agent = new MonitorAgent({ redis: redis as any });
    const result = await agent.execute(contextSpecialChars);

    const { config } = result.output as { config: MonitoringConfig };
    expect(config.serviceName).toMatch(/^[a-z0-9-]+$/);
  });

  // ── PHOENIX event emission ────────────────────────────────────────────────

  it("emits to phoenix.monitoring.configure stream", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    await agent.execute(mockContext);

    const streams = (redis.xadd.mock.calls as string[][]).map((c) => c[0]);
    expect(streams).toContain("phoenix.monitoring.configure");
  });

  it("phoenix.monitoring.configure event contains serviceName, productId, runId", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    await agent.execute(mockContext);

    const phoenixCall = (redis.xadd.mock.calls as string[][]).find(
      (c) => c[0] === "phoenix.monitoring.configure",
    )!;
    expect(phoenixCall).toBeDefined();
    expect(phoenixCall).toContain(mockContext.productId);
    expect(phoenixCall).toContain(mockContext.lifecycleRunId);
    expect(phoenixCall).toContain("payment-service");
  });

  it("phoenix.monitoring.configure event includes autoRemediationEnabled as string", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    await agent.execute(mockContext);

    const phoenixCall = (redis.xadd.mock.calls as string[][]).find(
      (c) => c[0] === "phoenix.monitoring.configure",
    )!;
    // autoRemediationEnabled is serialised as string in the event
    expect(phoenixCall).toContain("true");
  });

  it("phoenix.monitoring.configure event includes expectedBaselines and alertThresholds as JSON", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    await agent.execute(mockContext);

    const phoenixCall = (redis.xadd.mock.calls as string[][]).find(
      (c) => c[0] === "phoenix.monitoring.configure",
    )!;
    // expectedBaselines and alertThresholds are JSON-serialised in the event
    expect(phoenixCall).toContain("expectedBaselines");
    expect(phoenixCall).toContain("alertThresholds");
  });

  // ── archibald.lifecycle events ────────────────────────────────────────────

  it("emits agent.started and agent.completed to archibald.lifecycle", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    await agent.execute(mockContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain("agent.started");
    expect(allArgs).toContain("agent.completed");
  });

  // ── evidence ──────────────────────────────────────────────────────────────

  it("evidence contains phoenix:monitoring-configure source", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("phoenix:monitoring-configure");
  });

  it("evidence confidence for monitoring-configure is 1.0", async () => {
    const redis = makeRedisMock();
    const agent = new MonitorAgent({ redis: redis as any });
    const result = await agent.execute(mockContext);

    const ev = result.evidence.find((e) => e.source === "phoenix:monitoring-configure");
    expect(ev!.confidence).toBe(1.0);
  });

  // ── Redis failure propagation ─────────────────────────────────────────────

  it("Redis emit failure propagates (not swallowed)", async () => {
    const redis = { xadd: vi.fn().mockRejectedValue(new Error("Redis unreachable")) };
    const agent = new MonitorAgent({ redis: redis as any });
    await expect(agent.execute(mockContext)).rejects.toThrow("Redis unreachable");
  });

  it("works without Redis configured (no-op emit)", async () => {
    const agent = new MonitorAgent({ redis: null });
    const result = await agent.execute(mockContext);
    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
  });

  // ── High-traffic baseline ─────────────────────────────────────────────────

  it("sets higher requestsPerSecond baseline when estimatedRps > 1000", async () => {
    const redis = makeRedisMock();
    const highTrafficContext: AgentContext = {
      ...mockContext,
      previousStageOutput: {
        serviceName: "high-traffic-service",
        designOutput: { estimatedRps: 5000 },
      },
    };
    const agent = new MonitorAgent({ redis: redis as any });
    const result = await agent.execute(highTrafficContext);

    const { config } = result.output as { config: MonitoringConfig };
    expect(config.expectedBaselines.requestsPerSecond).toBe(1000);
  });

  it("sets standard requestsPerSecond baseline for low-traffic service", async () => {
    const redis = makeRedisMock();
    const lowTrafficContext: AgentContext = {
      ...mockContext,
      previousStageOutput: {
        serviceName: "low-traffic-service",
        designOutput: { estimatedRps: 50 },
      },
    };
    const agent = new MonitorAgent({ redis: redis as any });
    const result = await agent.execute(lowTrafficContext);

    const { config } = result.output as { config: MonitoringConfig };
    expect(config.expectedBaselines.requestsPerSecond).toBe(100);
  });
});

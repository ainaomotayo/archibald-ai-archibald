// MonitorAgent — configures PHOENIX self-healing monitoring after successful deployment.
// Publishes phoenix.monitoring.configure event. PHOENIX consumes this and sets up
// monitoring baselines, alert thresholds, and auto-remediation rules.

import { BaseAgent, type AgentContext, type AgentResult, type Evidence } from "./base-agent.js";

export interface MonitoringConfig {
  productId: string;
  serviceName: string;
  expectedBaselines: {
    requestsPerSecond?: number;
    p50LatencyMs?: number;
    p95LatencyMs?: number;
    p99LatencyMs?: number;
    errorRatePercent?: number;
    cpuPercent?: number;
    memoryMb?: number;
  };
  alertThresholds: {
    errorRatePercent: number;
    p95LatencyMs: number;
    cpuPercent: number;
    memoryMb?: number;
    podRestartCount?: number;
  };
  autoRemediationEnabled: boolean;
  escalationTimeoutMinutes: number;
}

export class MonitorAgent extends BaseAgent {
  readonly name = "MonitorAgent";

  async execute(context: AgentContext): Promise<AgentResult> {
    this.log("info", "MonitorAgent: configuring PHOENIX monitoring", {
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    await this.emit("archibald.lifecycle", {
      type: "agent.started",
      agent: this.name,
      stage: "monitor",
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    const evidence: Evidence[] = [];

    // Derive service name from product ID (normalize to kebab-case)
    const deployOutput = context.previousStageOutput as Record<string, unknown> | undefined;
    const serviceName = (deployOutput?.["serviceName"] as string | undefined)
      ?? context.productId.toLowerCase().replace(/[^a-z0-9]/g, "-");

    // Derive sensible defaults from design stage outputs if available
    const designOutput = deployOutput?.["designOutput"] as Record<string, unknown> | undefined;
    const isHighTraffic = (designOutput?.["estimatedRps"] as number | undefined ?? 0) > 1000;

    const config: MonitoringConfig = {
      productId: context.productId,
      serviceName,
      expectedBaselines: {
        requestsPerSecond: isHighTraffic ? 1000 : 100,
        p50LatencyMs: 50,
        p95LatencyMs: 200,
        p99LatencyMs: 500,
        errorRatePercent: 0.1,
        cpuPercent: 30,
        memoryMb: 256,
      },
      alertThresholds: {
        errorRatePercent: 5.0,
        p95LatencyMs: 2000,
        cpuPercent: 80,
        memoryMb: 768,
        podRestartCount: 3,
      },
      autoRemediationEnabled: true,
      escalationTimeoutMinutes: 15,
    };

    // Publish monitoring configuration to PHOENIX via event bus
    await this.emit("phoenix.monitoring.configure", {
      type: "monitoring.configure",
      productId: context.productId,
      runId: context.lifecycleRunId,
      orgId: context.orgContext?.orgId ?? "unknown",
      serviceName: config.serviceName,
      expectedBaselines: JSON.stringify(config.expectedBaselines),
      alertThresholds: JSON.stringify(config.alertThresholds),
      autoRemediationEnabled: String(config.autoRemediationEnabled),
      escalationTimeoutMinutes: String(config.escalationTimeoutMinutes),
      configuredAt: new Date().toISOString(),
    });

    evidence.push({
      source: "phoenix:monitoring-configure",
      finding: `Monitoring configuration published for service '${serviceName}'`,
      confidence: 1.0,
    });

    this.log("info", "MonitorAgent: monitoring configuration published to PHOENIX", {
      serviceName,
    });

    await this.emit("archibald.lifecycle", {
      type: "agent.completed",
      agent: this.name,
      stage: "monitor",
      productId: context.productId,
      runId: context.lifecycleRunId,
      serviceName,
    });

    return {
      success: true,
      output: { config, monitoringConfiguredAt: new Date().toISOString() },
      nextAction: "proceed",
      evidence,
    };
  }
}

// DeployAgent — emits deployment requested event and waits for async completion.
// Deployment itself is handled by external CI/CD; ARCHIBALD tracks state.

import { BaseAgent, type AgentContext, type AgentResult, type Evidence } from "./base-agent.js";

export interface DeploymentRecord {
  id: string;
  productId: string;
  runId: string;
  environment: "staging" | "production";
  commitSha?: string;
  requestedAt: string;
  status: "requested" | "in_progress" | "succeeded" | "failed";
}

export class DeployAgent extends BaseAgent {
  readonly name = "DeployAgent";

  async execute(context: AgentContext): Promise<AgentResult> {
    this.log("info", "DeployAgent: requesting deployment", {
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    await this.emit("archibald.lifecycle", {
      type: "agent.started",
      agent: this.name,
      stage: "deploy",
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    const evidence: Evidence[] = [];

    // Extract certificate and commit info from previous stage
    const scanOutput = context.previousStageOutput as Record<string, unknown> | undefined;
    const certificateId = (scanOutput?.["sentinelCertificateId"] as string | undefined) ?? null;
    const commitSha = (scanOutput?.["commitSha"] as string | undefined) ?? "HEAD";

    const deploymentId = crypto.randomUUID();
    const deploymentRecord: DeploymentRecord = {
      id: deploymentId,
      productId: context.productId,
      runId: context.lifecycleRunId,
      environment: "staging",
      commitSha,
      requestedAt: new Date().toISOString(),
      status: "requested",
    };

    // Emit deployment request to the event bus
    // External CI/CD systems (GitHub Actions, ArgoCD, etc.) consume this
    await this.emit("archibald.deploy.requested", {
      type: "deploy.requested",
      deploymentId,
      productId: context.productId,
      runId: context.lifecycleRunId,
      orgId: context.orgContext?.orgId ?? "unknown",
      environment: "staging",
      commitSha,
      sentinelCertificateId: certificateId ?? "",
      requestedAt: deploymentRecord.requestedAt,
    });

    evidence.push({
      source: "archibald:deploy-request",
      finding: `Deployment request ${deploymentId} emitted to archibald.deploy.requested stream`,
      confidence: 1.0,
    });

    this.log("info", "DeployAgent: deployment request published, waiting for CI/CD completion");

    // Deployment completion is async — external system will emit
    // archibald.deploy.completed event when done
    return this.waitForHuman(
      {
        title: "Deployment in progress — awaiting completion",
        description: [
          `Deployment request ${deploymentId} has been submitted to your CI/CD pipeline.`,
          ``,
          `Environment: staging`,
          `Commit: ${commitSha}`,
          `SENTINEL certificate: ${certificateId ?? "none"}`,
          ``,
          `ARCHIBALD is waiting for the deployment to complete and smoke tests to pass.`,
          `This will auto-resolve when CI/CD reports success, or you can manually approve/reject.`,
        ].join("\n"),
        urgency: "medium",
        timeoutHours: 4,
      },
      deploymentRecord,
      evidence,
    );
  }
}

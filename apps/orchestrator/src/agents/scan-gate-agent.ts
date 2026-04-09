// ScanGateAgent — queries SENTINEL for a certificate on the current build.
// Implements exponential backoff polling (Agent Orchestrator pattern).
// HIGH/CRITICAL findings block deployment entirely.

import { BaseAgent, type AgentContext, type AgentResult, type Evidence } from "./base-agent.js";

export interface SentinelCertificate {
  id: string;
  commitSha: string;
  issuedAt: string;
  expiresAt: string;
  maxSeverity: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  findingsSummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  passed: boolean;
}

export class ScanGateAgent extends BaseAgent {
  readonly name = "ScanGateAgent";

  private sentinelUrl: string;
  private maxAttempts: number;
  private baseDelayMs: number;

  constructor(options: {
    redis?: InstanceType<typeof import("ioredis").default> | null;
    llm?: import("./base-agent.js").LLMProvider | null;
    sentinelUrl?: string;
    maxAttempts?: number;
    baseDelayMs?: number;
  } = {}) {
    super(options);
    this.sentinelUrl = options.sentinelUrl ?? process.env["SENTINEL_API_URL"] ?? "http://localhost:8080";
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 30_000;
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    this.log("info", "ScanGateAgent: checking SENTINEL for certificate", {
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    await this.emit("archibald.lifecycle", {
      type: "agent.started",
      agent: this.name,
      stage: "scan",
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    const evidence: Evidence[] = [];

    // Extract commit SHA from previous stage output if available
    const buildOutput = context.previousStageOutput as Record<string, unknown> | undefined;
    const commitSha = (buildOutput?.["commitSha"] as string | undefined) ?? "HEAD";

    // Poll SENTINEL with exponential backoff
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = this.backoffMs(attempt - 1, this.baseDelayMs);
        this.log("info", `ScanGateAgent: waiting ${delay}ms before retry ${attempt}/${this.maxAttempts}`);
        await this.sleep(delay);
      }

      let certificate: SentinelCertificate | null = null;

      try {
        const response = await fetch(
          `${this.sentinelUrl}/v1/certificates?commitSha=${encodeURIComponent(commitSha)}&productId=${context.productId}`,
          {
            headers: {
              "x-org-id": context.orgContext?.orgId ?? "unknown",
              "x-user-id": "archibald-scan-gate",
              "x-role": "VIEWER",
            },
            signal: AbortSignal.timeout(10_000),
          },
        );

        if (response.ok) {
          const data = await response.json() as { certificates?: SentinelCertificate[]; certificate?: SentinelCertificate };
          certificate = data.certificate ?? data.certificates?.[0] ?? null;

          evidence.push({
            source: "sentinel:certificate-check",
            finding: certificate
              ? `Certificate ${certificate.id} found — maxSeverity: ${certificate.maxSeverity}`
              : "No certificate found yet",
            confidence: 0.95,
            url: `${this.sentinelUrl}/v1/certificates`,
          });
        } else if (response.status !== 404) {
          this.log("warn", "SENTINEL returned unexpected status", { status: response.status });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "SENTINEL unreachable";
        this.log("warn", `ScanGateAgent: SENTINEL unavailable on attempt ${attempt + 1}`, { error: message });
        evidence.push({
          source: "sentinel:unreachable",
          finding: `SENTINEL unavailable on attempt ${attempt + 1}: ${message}`,
          confidence: 0.0,
        });
        continue;
      }

      if (certificate) {
        // Certificate found — evaluate findings
        const hasCritical = certificate.findingsSummary.critical > 0;
        const hasHigh = certificate.findingsSummary.high > 0;

        if (hasCritical || hasHigh) {
          this.log("warn", "ScanGateAgent: BLOCKING — HIGH/CRITICAL findings found", {
            critical: certificate.findingsSummary.critical,
            high: certificate.findingsSummary.high,
          });

          await this.emit("archibald.lifecycle", {
            type: "scan.blocked",
            agent: this.name,
            productId: context.productId,
            runId: context.lifecycleRunId,
            certificateId: certificate.id,
            maxSeverity: certificate.maxSeverity,
          });

          return {
            success: false,
            output: { certificate },
            nextAction: "fail",
            evidence,
            failureReason: `SENTINEL certificate ${certificate.id} has ${certificate.findingsSummary.critical} CRITICAL and ${certificate.findingsSummary.high} HIGH findings. Deployment blocked. Fix all HIGH/CRITICAL issues and rescan.`,
          };
        }

        // Certificate is clean
        this.log("info", "ScanGateAgent: SENTINEL certificate clean — proceeding to deploy");

        await this.emit("archibald.lifecycle", {
          type: "agent.completed",
          agent: this.name,
          stage: "scan",
          productId: context.productId,
          runId: context.lifecycleRunId,
          certificateId: certificate.id,
          maxSeverity: certificate.maxSeverity,
        });

        return {
          success: true,
          output: { certificate, sentinelCertificateId: certificate.id, maxSeverity: certificate.maxSeverity },
          nextAction: "proceed",
          evidence,
        };
      }
    }

    // Exhausted retries — certificate not yet available
    this.log("warn", "ScanGateAgent: certificate not found after all attempts — waiting for human");

    return this.waitForHuman(
      {
        title: "SENTINEL scan certificate not yet available",
        description: [
          `ARCHIBALD checked SENTINEL ${this.maxAttempts} times with exponential backoff but no certificate was found for commit ${commitSha}.`,
          ``,
          `This may mean:`,
          `1. SENTINEL is still scanning (large codebase)`,
          `2. The scan has not been triggered yet`,
          `3. The commit SHA doesn't match what SENTINEL has`,
          ``,
          `Please check SENTINEL and approve once the certificate is available, or reject to return to build.`,
        ].join("\n"),
        urgency: "high",
        timeoutHours: 24,
      },
      { commitSha, attempts: this.maxAttempts },
      evidence,
    );
  }
}

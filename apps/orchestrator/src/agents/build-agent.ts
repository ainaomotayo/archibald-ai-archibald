// BuildAgent — delegates build execution to FORGE, polls until completion,
// and gates the lifecycle on a successful build status.
// Follows the DesignAgent pattern: native fetch, Redis event emission, structured output.

import { BaseAgent, type AgentContext, type AgentResult, type Evidence } from "./base-agent.js";

export interface BuildOutput {
  specId: string;
  buildId: string;
  outputDir: string | null;
  forgeStatus: string;
}

/** Statuses that indicate the build is still in flight */
const IN_FLIGHT_STATUSES = new Set(["PENDING", "IN_PROGRESS"]);

/** Max poll iterations: 120 × 5 s = 10 minutes */
const MAX_POLL_ITERATIONS = 120;
const POLL_INTERVAL_MS = 5_000;

export class BuildAgent extends BaseAgent {
  readonly name = "BuildAgent";

  private forgeUrl: string;
  private apiKey: string;

  constructor(
    options: {
      redis?: InstanceType<typeof import("ioredis").default> | null;
      llm?: import("./base-agent.js").LLMProvider | null;
      forgeUrl?: string;
      apiKey?: string;
    } = {},
  ) {
    super(options);
    this.forgeUrl = options.forgeUrl ?? process.env["FORGE_API_URL"] ?? "http://localhost:8110";
    this.apiKey = options.apiKey ?? process.env["ARCHIBALD_API_KEY"] ?? "";
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    this.log("info", "BuildAgent starting", {
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    await this.emit("archibald.lifecycle", {
      type: "agent.started",
      agent: this.name,
      stage: "build",
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    const evidence: Evidence[] = [];

    // ── Step 1: Extract spec content from DesignAgent output ─────────────────
    const previousOutput = context.previousStageOutput as Record<string, unknown> | undefined;
    const specRequirements =
      typeof previousOutput?.["rationale"] === "string"
        ? previousOutput["rationale"]
        : context.requirement;

    // ── Step 2: POST /v1/specs to FORGE ──────────────────────────────────────
    let specId: string;
    try {
      const specRes = await fetch(`${this.forgeUrl}/v1/specs`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({
          // Use a synthetic projectId derived from the product — FORGE will validate
          projectId: context.productId,
          requirements: specRequirements,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!specRes.ok) {
        const body = await specRes.text().catch(() => "");
        this.log("warn", "FORGE /v1/specs returned non-OK", { status: specRes.status, body });
        return this.waitForHuman(
          {
            title: "FORGE spec creation failed",
            description: `FORGE returned HTTP ${specRes.status} when creating the spec. Please investigate and trigger the build manually, then approve this decision to proceed.\n\nProductId: ${context.productId}\nRunId: ${context.lifecycleRunId}`,
            urgency: "high",
            timeoutHours: 24,
          },
          null,
          evidence,
        );
      }

      const specData = await specRes.json() as { id: string };
      specId = specData.id;

      evidence.push({
        source: "forge:spec-created",
        finding: `Spec created in FORGE with id=${specId}`,
        confidence: 1.0,
        url: `${this.forgeUrl}/v1/specs/${specId}`,
      });

      this.log("info", "FORGE spec created", { specId });
    } catch (err) {
      return this.handleForgeNetworkError(err, context, evidence, "spec creation");
    }

    // ── Step 3: POST /v1/builds to FORGE ─────────────────────────────────────
    let buildId: string;
    try {
      const buildRes = await fetch(`${this.forgeUrl}/v1/builds`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({ specId }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!buildRes.ok) {
        const body = await buildRes.text().catch(() => "");
        this.log("warn", "FORGE /v1/builds returned non-OK", { status: buildRes.status, body });
        return this.waitForHuman(
          {
            title: "FORGE build trigger failed",
            description: `FORGE returned HTTP ${buildRes.status} when triggering the build for specId=${specId}. Please trigger the build manually then approve this decision.\n\nRunId: ${context.lifecycleRunId}`,
            urgency: "high",
            timeoutHours: 24,
          },
          { specId },
          evidence,
        );
      }

      const buildData = await buildRes.json() as { id: string; status: string };
      buildId = buildData.id;

      evidence.push({
        source: "forge:build-triggered",
        finding: `Build triggered in FORGE with id=${buildId}, initial status=${buildData.status}`,
        confidence: 1.0,
        url: `${this.forgeUrl}/v1/builds/${buildId}`,
      });

      this.log("info", "FORGE build triggered", { buildId });
    } catch (err) {
      return this.handleForgeNetworkError(err, context, evidence, "build trigger");
    }

    // ── Step 4: Poll until the build leaves the in-flight states ─────────────
    await this.emit("archibald.lifecycle", {
      type: "agent.polling",
      agent: this.name,
      stage: "build",
      productId: context.productId,
      runId: context.lifecycleRunId,
      buildId,
    });

    let finalStatus = "PENDING";
    let outputDir: string | null = null;
    let pollCount = 0;

    while (pollCount < MAX_POLL_ITERATIONS) {
      await this.sleep(POLL_INTERVAL_MS);
      pollCount++;

      let buildDetail: { status: string; outputDir?: string | null } | null = null;
      try {
        const pollRes = await fetch(`${this.forgeUrl}/v1/builds/${buildId}`, {
          headers: this.authHeaders(),
          signal: AbortSignal.timeout(10_000),
        });

        if (!pollRes.ok) {
          this.log("warn", "FORGE poll returned non-OK", { status: pollRes.status, pollCount });
          // Treat non-OK as transient — keep polling
          continue;
        }

        buildDetail = await pollRes.json() as { status: string; outputDir?: string | null };
      } catch (err) {
        // Network blip during polling — log and continue (do not abort the whole run)
        const message = err instanceof Error ? err.message : String(err);
        this.log("warn", "Transient fetch error during poll", { error: message, pollCount });
        continue;
      }

      finalStatus = buildDetail.status;
      outputDir = buildDetail.outputDir ?? null;

      this.log("info", "Build poll result", { buildId, status: finalStatus, pollCount });

      if (!IN_FLIGHT_STATUSES.has(finalStatus)) {
        break;
      }
    }

    // ── Step 5 / 6: Evaluate final status ────────────────────────────────────
    const output: BuildOutput = { specId, buildId, outputDir, forgeStatus: finalStatus };

    if (pollCount >= MAX_POLL_ITERATIONS && IN_FLIGHT_STATUSES.has(finalStatus)) {
      // Timeout — return retry so the orchestrator can loop back
      this.log("warn", "Build poll timed out after 10 minutes", { buildId });
      evidence.push({
        source: "forge:poll-timeout",
        finding: `Build ${buildId} still in status=${finalStatus} after ${MAX_POLL_ITERATIONS} polls (10 min). Requesting retry.`,
        confidence: 0.9,
      });
      return {
        success: false,
        output,
        nextAction: "retry",
        evidence,
        retryAfterMs: 30_000,
        failureReason: `Build ${buildId} timed out after 10 minutes in status=${finalStatus}`,
      };
    }

    if (finalStatus !== "SUCCESS") {
      this.log("warn", "Build ended in non-SUCCESS state", { buildId, finalStatus });
      evidence.push({
        source: "forge:build-failed",
        finding: `Build ${buildId} completed with status=${finalStatus}. Requesting retry.`,
        confidence: 1.0,
      });
      return {
        success: false,
        output,
        nextAction: "retry",
        evidence,
        retryAfterMs: 15_000,
        failureReason: `FORGE build ${buildId} finished with status=${finalStatus}`,
      };
    }

    // Build succeeded
    evidence.push({
      source: "forge:build-success",
      finding: `Build ${buildId} completed successfully. outputDir=${outputDir ?? "N/A"}`,
      confidence: 1.0,
      url: `${this.forgeUrl}/v1/builds/${buildId}`,
    });

    await this.emit("archibald.lifecycle", {
      type: "agent.completed",
      agent: this.name,
      stage: "build",
      productId: context.productId,
      runId: context.lifecycleRunId,
      buildId,
      forgeStatus: finalStatus,
    });

    return {
      success: true,
      output,
      nextAction: "proceed",
      evidence,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey ? { "Authorization": `Bearer ${this.apiKey}` } : {}),
    };
  }

  private handleForgeNetworkError(
    err: unknown,
    context: AgentContext,
    evidence: Evidence[],
    operation: string,
  ): AgentResult {
    const message = err instanceof Error ? err.message : String(err);
    this.log("error", `FORGE network error during ${operation}`, { error: message });

    evidence.push({
      source: "forge:unavailable",
      finding: `FORGE unreachable during ${operation}: ${message}`,
      confidence: 1.0,
    });

    return this.waitForHuman(
      {
        title: `FORGE unavailable — manual ${operation} required`,
        description: [
          `The FORGE API at ${this.forgeUrl} could not be reached during ${operation}.`,
          `Error: ${message}`,
          ``,
          `Please manually trigger the build for product=${context.productId} and approve this`,
          `decision once a successful build is available so the lifecycle can proceed.`,
          `RunId: ${context.lifecycleRunId}`,
        ].join("\n"),
        urgency: "high",
        timeoutHours: 48,
      },
      null,
      evidence,
    );
  }
}

// TestAgent — reads test results from FORGE for the build produced by BuildAgent,
// enforces a coverage gate, and routes the lifecycle accordingly.
// Follows the DesignAgent / BuildAgent pattern: native fetch, Redis event emission.

import { BaseAgent, type AgentContext, type AgentResult, type Evidence } from "./base-agent.js";

export interface TestOutput {
  buildId: string;
  forgeStatus: string;
  testStatus: "PASS" | "FAIL" | "UNKNOWN";
  coverageEstimate: number;
  coverageThreshold: number;
  coverageMetThreshold: boolean;
}

/** Default coverage threshold (fraction 0.0–1.0) */
const DEFAULT_COVERAGE_THRESHOLD = 0.6;

/** Poll for test results for up to 5 minutes */
const MAX_POLL_ITERATIONS = 60;
const POLL_INTERVAL_MS = 5_000;

/** Build status values that indicate tests have finished */
const TERMINAL_STATUSES = new Set(["SUCCESS", "FAILED", "TEST_FAILED", "CANCELLED"]);

export class TestAgent extends BaseAgent {
  readonly name = "TestAgent";

  private forgeUrl: string;
  private apiKey: string;
  private coverageThreshold: number;

  constructor(
    options: {
      redis?: InstanceType<typeof import("ioredis").default> | null;
      llm?: import("./base-agent.js").LLMProvider | null;
      forgeUrl?: string;
      apiKey?: string;
      coverageThreshold?: number;
    } = {},
  ) {
    super(options);
    this.forgeUrl = options.forgeUrl ?? process.env["FORGE_API_URL"] ?? "http://localhost:8110";
    this.apiKey = options.apiKey ?? process.env["ARCHIBALD_API_KEY"] ?? "";
    this.coverageThreshold =
      options.coverageThreshold ??
      Number(process.env["TEST_COVERAGE_THRESHOLD"] ?? DEFAULT_COVERAGE_THRESHOLD);
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    this.log("info", "TestAgent starting", {
      productId: context.productId,
      runId: context.lifecycleRunId,
      threshold: this.coverageThreshold,
    });

    await this.emit("archibald.lifecycle", {
      type: "agent.started",
      agent: this.name,
      stage: "test",
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    const evidence: Evidence[] = [];

    // ── Step 1: Extract buildId from BuildAgent's output ──────────────────────
    const previousOutput = context.previousStageOutput as Record<string, unknown> | undefined;
    const buildId = typeof previousOutput?.["buildId"] === "string"
      ? previousOutput["buildId"]
      : null;

    if (!buildId) {
      this.log("error", "No buildId in previousStageOutput — cannot run tests", {
        runId: context.lifecycleRunId,
      });
      return this.failResult(
        "TestAgent requires a buildId from BuildAgent output but none was provided.",
      );
    }

    // ── Step 2: GET /v1/builds/:buildId — check current status and test results ──
    let buildDetail: BuildDetail | null = null;
    try {
      buildDetail = await this.fetchBuild(buildId);
    } catch (err) {
      return this.handleForgeNetworkError(err, context, buildId, evidence);
    }

    if (!buildDetail) {
      return this.handleForgeNetworkError(
        new Error("Build not found in FORGE"),
        context,
        buildId,
        evidence,
      );
    }

    // ── Step 3: If tests already finished, evaluate now ───────────────────────
    if (this.hasTestResults(buildDetail)) {
      return this.evaluateResults(buildDetail, buildId, context, evidence);
    }

    // ── Step 4: Poll until test results arrive (max 5 minutes) ───────────────
    await this.emit("archibald.lifecycle", {
      type: "agent.polling",
      agent: this.name,
      stage: "test",
      productId: context.productId,
      runId: context.lifecycleRunId,
      buildId,
    });

    let pollCount = 0;
    while (pollCount < MAX_POLL_ITERATIONS) {
      await this.sleep(POLL_INTERVAL_MS);
      pollCount++;

      try {
        buildDetail = await this.fetchBuild(buildId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log("warn", "Transient fetch error during test poll", { error: message, pollCount });
        continue;
      }

      if (!buildDetail) continue;

      this.log("info", "Test poll result", {
        buildId,
        status: buildDetail.status,
        testStatus: buildDetail.testStatus,
        pollCount,
      });

      if (this.hasTestResults(buildDetail)) {
        break;
      }
    }

    if (!buildDetail || !this.hasTestResults(buildDetail)) {
      // Timed out waiting for test results — treat as transient failure
      this.log("warn", "Test poll timed out after 5 minutes", { buildId });
      evidence.push({
        source: "forge:test-poll-timeout",
        finding: `Build ${buildId} test results not available after ${MAX_POLL_ITERATIONS} polls (5 min).`,
        confidence: 0.9,
      });
      return {
        success: false,
        output: {
          buildId,
          forgeStatus: buildDetail?.status ?? "UNKNOWN",
          testStatus: "UNKNOWN",
          coverageEstimate: 0,
          coverageThreshold: this.coverageThreshold,
          coverageMetThreshold: false,
        } satisfies TestOutput,
        nextAction: "retry",
        evidence,
        retryAfterMs: 30_000,
        failureReason: `Test results for build ${buildId} did not arrive within 5 minutes.`,
      };
    }

    return this.evaluateResults(buildDetail, buildId, context, evidence);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async fetchBuild(buildId: string): Promise<BuildDetail | null> {
    const res = await fetch(`${this.forgeUrl}/v1/builds/${buildId}`, {
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`FORGE returned HTTP ${res.status} for build ${buildId}`);
    }
    return res.json() as Promise<BuildDetail>;
  }

  private hasTestResults(detail: BuildDetail): boolean {
    // Test results are available when: status is terminal, or testStatus is explicitly set
    return (
      TERMINAL_STATUSES.has(detail.status) ||
      (typeof detail.testStatus === "string" && detail.testStatus !== "PENDING")
    );
  }

  private evaluateResults(
    detail: BuildDetail,
    buildId: string,
    context: AgentContext,
    evidence: Evidence[],
  ): AgentResult {
    const forgeStatus = detail.status;
    const testStatus: TestOutput["testStatus"] =
      detail.testStatus === "PASS" || detail.testStatus === "FAIL"
        ? detail.testStatus
        : forgeStatus === "SUCCESS"
          ? "PASS"
          : forgeStatus === "FAILED" || forgeStatus === "TEST_FAILED"
            ? "FAIL"
            : "UNKNOWN";

    const coverageEstimate = typeof detail.coverageEstimate === "number"
      ? detail.coverageEstimate
      : 0;

    const coverageMetThreshold = coverageEstimate >= this.coverageThreshold;

    const output: TestOutput = {
      buildId,
      forgeStatus,
      testStatus,
      coverageEstimate,
      coverageThreshold: this.coverageThreshold,
      coverageMetThreshold,
    };

    evidence.push({
      source: "forge:test-results",
      finding: `Build ${buildId}: status=${forgeStatus}, testStatus=${testStatus}, coverage=${(coverageEstimate * 100).toFixed(1)}%`,
      confidence: 1.0,
      url: `${this.forgeUrl}/v1/builds/${buildId}`,
    });

    // Gate: FAIL status → retry (go back to build)
    if (testStatus === "FAIL") {
      this.log("warn", "Tests failed — routing back to build", { buildId, forgeStatus });
      evidence.push({
        source: "gate:test-failed",
        finding: "Test suite failed. Build will be retried.",
        confidence: 1.0,
      });
      return {
        success: false,
        output,
        nextAction: "retry",
        evidence,
        retryAfterMs: 15_000,
        failureReason: `Tests failed for build ${buildId} (forgeStatus=${forgeStatus})`,
      };
    }

    // Gate: coverage below threshold → wait for human decision
    if (!coverageMetThreshold) {
      this.log("warn", "Coverage below threshold", {
        buildId,
        coverageEstimate,
        threshold: this.coverageThreshold,
      });
      evidence.push({
        source: "gate:coverage-low",
        finding: `Coverage ${(coverageEstimate * 100).toFixed(1)}% is below threshold of ${(this.coverageThreshold * 100).toFixed(1)}%.`,
        confidence: 1.0,
      });

      return this.waitForHuman(
        {
          title: "Test coverage below threshold",
          description: [
            `Build ${buildId} passed tests but coverage is insufficient.`,
            ``,
            `Actual coverage:    ${(coverageEstimate * 100).toFixed(1)}%`,
            `Required threshold: ${(this.coverageThreshold * 100).toFixed(1)}%`,
            ``,
            `Options:`,
            `  - Approve: accept current coverage and proceed to security scan`,
            `  - Reject: loop back to build to add more tests`,
            ``,
            `ProductId: ${context.productId}  |  RunId: ${context.lifecycleRunId}`,
          ].join("\n"),
          options: ["Accept coverage and proceed", "Reject — add more tests"],
          urgency: "medium",
          timeoutHours: 24,
        },
        output,
        evidence,
      );
    }

    // All gates passed — proceed
    this.log("info", "Tests passed and coverage met threshold", {
      buildId,
      coverageEstimate,
      threshold: this.coverageThreshold,
    });

    evidence.push({
      source: "gate:coverage-passed",
      finding: `Coverage ${(coverageEstimate * 100).toFixed(1)}% meets threshold ${(this.coverageThreshold * 100).toFixed(1)}%.`,
      confidence: 1.0,
    });

    this.emit("archibald.lifecycle", {
      type: "agent.completed",
      agent: this.name,
      stage: "test",
      productId: context.productId,
      runId: context.lifecycleRunId,
      buildId,
      coverageEstimate,
    }).catch(() => {/* non-blocking */});

    return {
      success: true,
      output,
      nextAction: "proceed",
      evidence,
    };
  }

  private handleForgeNetworkError(
    err: unknown,
    context: AgentContext,
    buildId: string,
    evidence: Evidence[],
  ): AgentResult {
    const message = err instanceof Error ? err.message : String(err);
    this.log("error", "FORGE network error in TestAgent", { error: message, buildId });

    evidence.push({
      source: "forge:unavailable",
      finding: `FORGE unreachable when fetching build ${buildId}: ${message}`,
      confidence: 1.0,
    });

    return this.waitForHuman(
      {
        title: "FORGE unavailable — cannot retrieve test results",
        description: [
          `The FORGE API at ${this.forgeUrl} could not be reached while fetching test results.`,
          `BuildId: ${buildId}`,
          `Error: ${message}`,
          ``,
          `Please verify the build and approve this decision to proceed, or reject to retry.`,
          `RunId: ${context.lifecycleRunId}`,
        ].join("\n"),
        urgency: "high",
        timeoutHours: 24,
      },
      { buildId },
      evidence,
    );
  }

  private authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey ? { "Authorization": `Bearer ${this.apiKey}` } : {}),
    };
  }
}

// ── Internal type for FORGE build detail response ─────────────────────────────
interface BuildDetail {
  id: string;
  status: string;
  testStatus?: "PASS" | "FAIL" | "PENDING" | string;
  coverageEstimate?: number;
  outputDir?: string | null;
  progress?: number;
  logs?: string[];
}

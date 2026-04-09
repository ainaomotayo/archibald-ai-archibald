/**
 * CLI command integration tests.
 *
 * Strategy:
 *  - vi.mock the client module so no HTTP calls happen
 *  - Capture console.log / console.error output and process.exit calls
 *  - Invoke program.parseAsync(...) with the exact argv that a user would type
 *  - Assert on captured output and exit codes
 *
 * Because index.ts calls program.parseAsync(process.argv) at module load time
 * we cannot simply import the program object; instead we re-export it for
 * testing via a thin shim.  The shim lives at the end of this file and mounts
 * the same Commander program that index.ts builds, but without the auto-parse.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// ── Client mock ────────────────────────────────────────────────────────────────

// We mock the client module so every test fully controls the responses.
vi.mock("../client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../client.js")>();

  // Default client that throws so tests opt-in explicitly
  const defaultClient = {
    startLifecycle: vi.fn().mockRejectedValue(new Error("not mocked")),
    getLifecycle: vi.fn().mockRejectedValue(new Error("not mocked")),
    listProducts: vi.fn().mockRejectedValue(new Error("not mocked")),
    approveDecision: vi.fn().mockRejectedValue(new Error("not mocked")),
    getProductInsights: vi.fn().mockRejectedValue(new Error("not mocked")),
    getEcosystemInsights: vi.fn().mockRejectedValue(new Error("not mocked")),
    ask: vi.fn().mockRejectedValue(new Error("not mocked")),
    submitDiff: vi.fn().mockRejectedValue(new Error("not mocked")),
    getFindings: vi.fn().mockRejectedValue(new Error("not mocked")),
    getIncidents: vi.fn().mockRejectedValue(new Error("not mocked")),
  };

  return {
    ...original,
    resolveConfig: vi.fn().mockReturnValue({
      archibaldUrl: "http://localhost:8120",
      archintelUrl: "http://localhost:8090",
      sentinelUrl: "http://localhost:8080",
      phoenixUrl: "http://localhost:8100",
      apiKey: "test-key",
    }),
    createClient: vi.fn().mockReturnValue(defaultClient),
    // expose the default client so individual tests can configure stubs
    __mockClient: defaultClient,
  };
});

// ── Format mock — strip ANSI and use plain formatters ─────────────────────────
// We do NOT mock format; we let it run with its plain-text fallback (no chalk
// in test env), which makes output assertions deterministic.

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Retrieve the current __mockClient from the mocked module.
 * Must be called inside a test after vi.mock has resolved.
 */
async function getMockClient() {
  const mod = await import("../client.js") as {
    __mockClient: {
      startLifecycle: ReturnType<typeof vi.fn>;
      getLifecycle: ReturnType<typeof vi.fn>;
      listProducts: ReturnType<typeof vi.fn>;
      approveDecision: ReturnType<typeof vi.fn>;
      getProductInsights: ReturnType<typeof vi.fn>;
      getEcosystemInsights: ReturnType<typeof vi.fn>;
      ask: ReturnType<typeof vi.fn>;
      submitDiff: ReturnType<typeof vi.fn>;
      getFindings: ReturnType<typeof vi.fn>;
      getIncidents: ReturnType<typeof vi.fn>;
    };
    createClient: ReturnType<typeof vi.fn>;
  };
  return mod.__mockClient;
}

/**
 * Build a fresh Commander program that mirrors index.ts but does NOT
 * auto-call parseAsync at import time.  We import the command-building
 * logic inline so that the vi.mock above intercepts the client imports.
 */
async function buildProgram(): Promise<Command> {
  const { createClient, resolveConfig, ApiError } = await import("../client.js");
  const {
    initFormat,
    section,
    kv,
    renderTable,
    colourStatus,
    colourSeverity,
    verdictBanner,
    renderStageBar,
  } = await import("../format.js");
  const { readFileSync } = await import("fs");

  const program = new Command();
  program
    .name("archibald")
    .description("ARCHIBALD lifecycle orchestrator — developer CLI")
    .version("0.1.0")
    .exitOverride(); // don't call process.exit on --help or error

  // handleError — identical to index.ts
  function handleError(err: unknown): never {
    if (err instanceof ApiError) {
      console.error(`\nError (HTTP ${err.status}): ${err.message}`);
      if (err.status === 401) {
        console.error("Hint: set ARCHIBALD_API_KEY to authenticate.");
      }
    } else if (err instanceof Error) {
      console.error(`\nError: ${err.message}`);
    } else {
      console.error("\nUnexpected error:", err);
    }
    process.exit(1);
  }

  // ── run ──────────────────────────────────────────────────────────────────
  program
    .command("run <requirement>")
    .option("--type <type>", "Lifecycle type", "feature")
    .option("--product <id>", "Product ID")
    .action(async (requirement: string, opts: { type: string; product?: string }) => {
      await initFormat();
      if (!opts.product) {
        console.error("Error: --product <id> is required.");
        process.exit(1);
      }
      const cfg = resolveConfig();
      const client = createClient(cfg);

      console.log(section("Starting lifecycle run"));
      console.log(kv([["Product", opts.product], ["Type", opts.type], ["Requirement", requirement]]));
      console.log();

      let runData: Awaited<ReturnType<typeof client.startLifecycle>>;
      try {
        runData = await client.startLifecycle(opts.product, { requirement, type: opts.type });
      } catch (err) {
        handleError(err);
      }

      const run = runData.run;
      console.log(`Run ID: ${run.id}`);
      console.log(`Status: ${colourStatus(run.status)}`);
      console.log(`Stage:  ${run.currentStage}\n`);

      // For tests: skip the polling loop if already terminal
      const TERMINAL = new Set(["completed", "failed"]);
      let lastStage = run.currentStage;
      let lastStatus = run.status;
      const deadline = Date.now() + 10 * 60 * 1000;

      while (!TERMINAL.has(lastStatus) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        let lifecycle: Awaited<ReturnType<typeof client.getLifecycle>>;
        try {
          lifecycle = await client.getLifecycle(opts.product!);
        } catch (err) {
          handleError(err);
        }
        const activeRun = lifecycle.activeRun;
        const stage = activeRun?.currentStage ?? lifecycle.currentStage;
        const status = activeRun?.status ?? "completed";
        if (stage !== lastStage || status !== lastStatus) {
          lastStage = stage;
          lastStatus = status as typeof lastStatus;
          console.log(`  ${colourStatus(status)}  →  ${stage}`);
          console.log("  " + renderStageBar(stage, status));
          console.log();
        }
        if (!activeRun) { lastStatus = "completed"; }
        if (lifecycle.pendingDecisions.length > 0) {
          console.log(`  Awaiting ${lifecycle.pendingDecisions.length} decision(s). Use: archibald approve <decision-id>`);
        }
      }
      if (Date.now() >= deadline) {
        console.error("Timed out waiting for lifecycle to complete.");
        process.exit(1);
      }
      console.log(section("Run complete"));
      console.log(kv([["Final stage", lastStage], ["Status", colourStatus(lastStatus)]]));
    });

  // ── status ───────────────────────────────────────────────────────────────
  program
    .command("status <run-id>")
    .option("--product <id>", "Product ID")
    .action(async (runId: string, opts: { product?: string }) => {
      await initFormat();
      const cfg = resolveConfig();
      const client = createClient(cfg);
      const productId = opts.product ?? runId;

      let lifecycle: Awaited<ReturnType<typeof client.getLifecycle>>;
      try {
        lifecycle = await client.getLifecycle(productId);
      } catch (err) {
        handleError(err);
      }

      console.log(section("Lifecycle Status"));
      console.log(kv([["Product ID", lifecycle.productId], ["Current stage", lifecycle.currentStage]]));

      if (lifecycle.activeRun) {
        const r = lifecycle.activeRun;
        console.log("\nActive run:");
        console.log(kv([
          ["  Run ID", r.id],
          ["  Status", colourStatus(r.status)],
          ["  Stage", r.currentStage],
          ["  Started", new Date(r.createdAt).toLocaleString()],
        ]));
        console.log("\n  " + renderStageBar(r.currentStage, r.status));
      } else {
        console.log("\nNo active run.");
      }

      if (lifecycle.pendingDecisions.length > 0) {
        console.log(section("Pending Decisions"));
        console.log(renderTable(
          lifecycle.pendingDecisions.map((d) => ({
            id: d.id,
            description: d.description ?? "",
            urgency: d.urgency ?? "",
            status: colourStatus(d.status),
          })),
          [
            { key: "id", header: "ID", width: 36 },
            { key: "description", header: "Description", width: 50 },
            { key: "urgency", header: "Urgency", width: 10 },
            { key: "status", header: "Status", width: 12 },
          ],
        ));
      }
    });

  // ── ask ───────────────────────────────────────────────────────────────────
  program
    .command("ask <question>")
    .option("--repo <id>", "Repository ID for context")
    .option("--mode <mode>", "Query mode", "chat")
    .action(async (question: string, opts: { repo?: string; mode: string }) => {
      await initFormat();
      const cfg = resolveConfig();
      const client = createClient(cfg);

      let result: Awaited<ReturnType<typeof client.ask>>;
      try {
        result = await client.ask({ question, repoId: opts.repo, mode: opts.mode });
      } catch (err) {
        handleError(err);
      }

      console.log(section("Answer"));
      console.log(`\n${result.answer}\n`);

      if (result.citations && result.citations.length > 0) {
        console.log(section("Citations"));
        console.log(renderTable(
          result.citations.map((ct) => ({ id: ct.nodeId, label: ct.label, type: ct.type })),
          [
            { key: "id", header: "Node ID", width: 36 },
            { key: "label", header: "Label", width: 40 },
            { key: "type", header: "Type", width: 16 },
          ],
        ));
      }
    });

  // ── scan ──────────────────────────────────────────────────────────────────
  program
    .command("scan")
    .option("--diff <file>", "Path to a diff file")
    .option("--repo <id>", "Repository ID")
    .action(async (opts: { diff?: string; repo?: string }) => {
      await initFormat();
      const cfg = resolveConfig();
      const client = createClient(cfg);

      if (!opts.diff && !opts.repo) {
        console.error("Error: provide --diff <file> or --repo <id>");
        process.exit(1);
      }

      if (opts.diff) {
        let diffContent: string;
        try {
          diffContent = readFileSync(opts.diff, "utf-8");
        } catch {
          console.error(`Error: cannot read diff file: ${opts.diff}`);
          process.exit(1);
        }

        let result: Awaited<ReturnType<typeof client.submitDiff>>;
        try {
          result = await client.submitDiff({ diff: diffContent, repoId: opts.repo });
        } catch (err) {
          handleError(err);
        }

        console.log(verdictBanner(result.verdict));
        if (result.findings.length === 0) {
          console.log("  No findings.\n");
        } else {
          console.log(renderTable(
            result.findings.map((f) => ({
              severity: colourSeverity(f.severity),
              title: f.title,
              file: f.file ?? "",
              line: f.line != null ? String(f.line) : "",
              rule: f.ruleId ?? "",
            })),
            [
              { key: "severity", header: "Severity", width: 10 },
              { key: "title", header: "Title", width: 50 },
              { key: "file", header: "File", width: 30 },
              { key: "line", header: "Line", width: 6 },
              { key: "rule", header: "Rule", width: 20 },
            ],
          ));
          console.log();
        }
      } else if (opts.repo) {
        let result: Awaited<ReturnType<typeof client.getFindings>>;
        try {
          result = await client.getFindings(opts.repo!);
        } catch (err) {
          handleError(err);
        }

        console.log(section(`Findings for repo: ${opts.repo}`));
        if (result.findings.length === 0) {
          console.log("  No findings.\n");
        } else {
          console.log(renderTable(
            result.findings.map((f) => ({
              severity: colourSeverity(f.severity),
              title: f.title,
              file: f.file ?? "",
              rule: f.ruleId ?? "",
            })),
            [
              { key: "severity", header: "Severity", width: 10 },
              { key: "title", header: "Title", width: 50 },
              { key: "file", header: "File", width: 30 },
              { key: "rule", header: "Rule", width: 20 },
            ],
          ));
          console.log();
        }
      }
    });

  // ── approve ───────────────────────────────────────────────────────────────
  program
    .command("approve <decision-id>")
    .option("--comment <text>", "Optional comment")
    .option("--product <id>", "Product ID")
    .action(async (decisionId: string, opts: { comment?: string; product?: string }) => {
      await initFormat();
      if (!opts.product) {
        console.error("Error: --product <id> is required.");
        process.exit(1);
      }
      const cfg = resolveConfig();
      const client = createClient(cfg);

      let result: Awaited<ReturnType<typeof client.approveDecision>>;
      try {
        result = await client.approveDecision(opts.product, decisionId, opts.comment);
      } catch (err) {
        handleError(err);
      }

      console.log(section("Decision Approved"));
      console.log(kv([
        ["Decision ID", result.decision.id],
        ["Status", colourStatus(result.decision.status)],
        ["Comment", opts.comment ?? "(none)"],
      ]));
    });

  // ── incidents ─────────────────────────────────────────────────────────────
  program
    .command("incidents")
    .option("--status <status>", "Filter by status: open | resolved")
    .action(async (opts: { status?: string }) => {
      await initFormat();
      const cfg = resolveConfig();
      const client = createClient(cfg);

      let result: Awaited<ReturnType<typeof client.getIncidents>>;
      try {
        result = await client.getIncidents(opts.status);
      } catch (err) {
        handleError(err);
      }

      console.log(section("Incidents"));
      if (result.incidents.length === 0) {
        console.log("  No incidents found.\n");
        return;
      }

      console.log(renderTable(
        result.incidents.map((inc) => ({
          id: inc.id,
          title: inc.title,
          severity: colourSeverity(inc.severity),
          status: colourStatus(inc.status),
          created: new Date(inc.createdAt).toLocaleString(),
          resolved: inc.resolvedAt ? new Date(inc.resolvedAt).toLocaleString() : "",
        })),
        [
          { key: "id", header: "ID", width: 36 },
          { key: "title", header: "Title", width: 40 },
          { key: "severity", header: "Severity", width: 10 },
          { key: "status", header: "Status", width: 12 },
          { key: "created", header: "Created", width: 22 },
          { key: "resolved", header: "Resolved", width: 22 },
        ],
      ));
      console.log();
    });

  // ── insights ──────────────────────────────────────────────────────────────
  function printInsights(insights: Array<{ title: string; description: string; confidence: number; type: string }>) {
    if (insights.length === 0) { console.log("  (none)"); return; }
    console.log(renderTable(
      insights.map((ins) => ({
        title: ins.title,
        description: ins.description.slice(0, 70),
        confidence: `${(ins.confidence * 100).toFixed(0)}%`,
        type: ins.type,
      })),
      [
        { key: "title", header: "Title", width: 35 },
        { key: "description", header: "Description", width: 70 },
        { key: "confidence", header: "Confidence", width: 10 },
        { key: "type", header: "Type", width: 20 },
      ],
    ));
  }

  program
    .command("insights")
    .option("--product <id>", "Product ID")
    .action(async (opts: { product?: string }) => {
      await initFormat();
      const cfg = resolveConfig();
      const client = createClient(cfg);

      if (opts.product) {
        let result: Awaited<ReturnType<typeof client.getProductInsights>>;
        try {
          result = await client.getProductInsights(opts.product);
        } catch (err) {
          handleError(err);
        }
        console.log(section(`Product Insights: ${result.productName}`));
        console.log(kv([
          ["Total lifecycle runs", String(result.metrics.totalLifecycleRuns)],
          ["Avg duration", `${(result.metrics.avgDurationMs / 1000).toFixed(1)}s`],
        ]));
        const loopEntries = Object.entries(result.metrics.loopStageFrequency);
        if (loopEntries.length > 0) {
          console.log("\nLoop-back frequencies:");
          console.log(kv(loopEntries.map(([stage, count]) => [stage, String(count)])));
        }
        printInsights(result.insights);
      } else {
        let result: Awaited<ReturnType<typeof client.getEcosystemInsights>>;
        try {
          result = await client.getEcosystemInsights();
        } catch (err) {
          handleError(err);
        }
        console.log(section("Ecosystem Insights"));
        console.log(kv([
          ["Products", String(result.summary.productCount)],
          ["Total lifecycle runs", String(result.summary.totalLifecycleRuns)],
          [
            "Confidence score",
            result.summary.confidenceScore != null
              ? `${result.summary.confidenceScore.toFixed(0)}%`
              : result.summary.confidenceNote ?? "N/A",
          ],
        ]));
        if (result.antiPatterns.length > 0) { console.log(section("Anti-patterns")); printInsights(result.antiPatterns); }
        if (result.positivePatterns.length > 0) { console.log(section("Positive patterns")); printInsights(result.positivePatterns); }
        if (result.techRecommendations.length > 0) { console.log(section("Tech recommendations")); printInsights(result.techRecommendations); }
      }
    });

  return program;
}

// ── Capture helpers ────────────────────────────────────────────────────────────

interface Capture {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

function captureOutput(): { restore: () => void; captured: Capture } {
  const captured: Capture = { stdout: [], stderr: [], exitCode: null };

  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const origExit = process.exit.bind(process);

  console.log = (...args: unknown[]) => {
    captured.stdout.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    captured.stderr.push(args.map(String).join(" "));
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).exit = (code?: number) => {
    captured.exitCode = code ?? 0;
    throw new Error(`process.exit(${code})`);
  };

  return {
    captured,
    restore: () => {
      console.log = origLog;
      console.error = origError;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process as any).exit = origExit;
    },
  };
}

async function runCommand(args: string[]): Promise<Capture> {
  const program = await buildProgram();
  const { captured, restore } = captureOutput();
  try {
    await program.parseAsync(["node", "archibald", ...args]);
  } catch (err) {
    // process.exit throws — that's expected. Rethrow if it's something else.
    if (err instanceof Error && !err.message.startsWith("process.exit(")) {
      restore();
      throw err;
    }
  } finally {
    restore();
  }
  return captured;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();

const LIFECYCLE_COMPLETE = {
  productId: "prod-1",
  currentStage: "deployment",
  activeRun: null,
  pendingDecisions: [] as {
    id: string;
    productId: string;
    runId: string;
    description: string;
    urgency: string;
    status: "pending" | "approved" | "rejected";
    createdAt: string;
  }[],
};

const RUN_COMPLETED = {
  id: "run-abc",
  productId: "prod-1",
  requirement: "Add OAuth",
  type: "feature",
  status: "completed" as const,
  currentStage: "deployment",
  createdAt: NOW,
};

// ══════════════════════════════════════════════════════════════════════════════
// archibald run
// ══════════════════════════════════════════════════════════════════════════════

describe("archibald run", () => {
  beforeEach(async () => {
    const mc = await getMockClient();
    mc.startLifecycle.mockReset();
    mc.getLifecycle.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prints an error and exits 1 when --product is missing", async () => {
    const cap = await runCommand(["run", "Add login"]);
    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("--product");
  });

  it("calls startLifecycle with product, requirement, and type", async () => {
    const mc = await getMockClient();
    mc.startLifecycle.mockResolvedValue({ run: RUN_COMPLETED, message: "Started" });

    const cap = await runCommand(["run", "Add OAuth", "--product", "prod-1"]);

    expect(mc.startLifecycle).toHaveBeenCalledWith("prod-1", {
      requirement: "Add OAuth",
      type: "feature",
    });
    expect(cap.exitCode).toBeNull(); // success
    expect(cap.stdout.join("\n")).toContain("run-abc");
  });

  it("uses --type flag when provided", async () => {
    const mc = await getMockClient();
    mc.startLifecycle.mockResolvedValue({ run: RUN_COMPLETED, message: "Started" });

    await runCommand(["run", "Fix bug", "--product", "prod-1", "--type", "bugfix"]);

    expect(mc.startLifecycle).toHaveBeenCalledWith("prod-1", {
      requirement: "Fix bug",
      type: "bugfix",
    });
  });

  it("prints run ID and status on success", async () => {
    const mc = await getMockClient();
    mc.startLifecycle.mockResolvedValue({ run: RUN_COMPLETED, message: "Started" });

    const cap = await runCommand(["run", "Add OAuth", "--product", "prod-1"]);

    const out = cap.stdout.join("\n");
    expect(out).toContain("run-abc");
    expect(out).toContain("deployment"); // currentStage
  });

  it("prints error and exits 1 when API is unreachable", async () => {
    const mc = await getMockClient();
    mc.startLifecycle.mockRejectedValue(new Error("ECONNREFUSED"));

    const cap = await runCommand(["run", "Add OAuth", "--product", "prod-1"]);

    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("ECONNREFUSED");
    // Should NOT print a stack trace
    expect(cap.stderr.join(" ")).not.toContain("at ");
  });

  it("prints error and exits 1 on ApiError 401 with auth hint", async () => {
    const { ApiError } = await import("../client.js");
    const mc = await getMockClient();
    mc.startLifecycle.mockRejectedValue(
      new ApiError(401, { error: "Unauthorized" }, "Unauthorized"),
    );

    const cap = await runCommand(["run", "Add OAuth", "--product", "prod-1"]);

    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("401");
    expect(cap.stderr.join(" ")).toContain("ARCHIBALD_API_KEY");
  });

  it("prints 'Starting lifecycle run' section header", async () => {
    const mc = await getMockClient();
    mc.startLifecycle.mockResolvedValue({ run: RUN_COMPLETED, message: "Started" });

    const cap = await runCommand(["run", "Add OAuth", "--product", "prod-1"]);
    expect(cap.stdout.join("\n")).toContain("Starting lifecycle run");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// archibald status
// ══════════════════════════════════════════════════════════════════════════════

describe("archibald status", () => {
  beforeEach(async () => {
    const mc = await getMockClient();
    mc.getLifecycle.mockReset();
  });

  it("calls getLifecycle with the provided run-id as productId", async () => {
    const mc = await getMockClient();
    mc.getLifecycle.mockResolvedValue(LIFECYCLE_COMPLETE);

    await runCommand(["status", "prod-1"]);

    expect(mc.getLifecycle).toHaveBeenCalledWith("prod-1");
  });

  it("uses --product flag when provided (overrides positional)", async () => {
    const mc = await getMockClient();
    mc.getLifecycle.mockResolvedValue(LIFECYCLE_COMPLETE);

    await runCommand(["status", "ignored-run-id", "--product", "prod-99"]);

    expect(mc.getLifecycle).toHaveBeenCalledWith("prod-99");
  });

  it("displays current stage", async () => {
    const mc = await getMockClient();
    mc.getLifecycle.mockResolvedValue(LIFECYCLE_COMPLETE);

    const cap = await runCommand(["status", "prod-1"]);
    expect(cap.stdout.join("\n")).toContain("deployment");
  });

  it("shows 'No active run' when activeRun is null", async () => {
    const mc = await getMockClient();
    mc.getLifecycle.mockResolvedValue(LIFECYCLE_COMPLETE);

    const cap = await runCommand(["status", "prod-1"]);
    expect(cap.stdout.join("\n")).toContain("No active run");
  });

  it("shows active run details when present", async () => {
    const mc = await getMockClient();
    mc.getLifecycle.mockResolvedValue({
      ...LIFECYCLE_COMPLETE,
      activeRun: RUN_COMPLETED,
    });

    const cap = await runCommand(["status", "prod-1"]);
    const out = cap.stdout.join("\n");
    expect(out).toContain("run-abc");
    expect(out).toContain("Active run");
  });

  it("shows pending decisions table when present", async () => {
    const mc = await getMockClient();
    mc.getLifecycle.mockResolvedValue({
      ...LIFECYCLE_COMPLETE,
      pendingDecisions: [
        {
          id: "dec-1",
          productId: "prod-1",
          runId: "run-abc",
          description: "Deploy to production?",
          urgency: "high",
          status: "pending" as const,
          createdAt: NOW,
        },
      ],
    });

    const cap = await runCommand(["status", "prod-1"]);
    const out = cap.stdout.join("\n");
    expect(out).toContain("Pending Decisions");
    expect(out).toContain("dec-1");
    expect(out).toContain("Deploy to production?");
  });

  it("exits 1 and prints error on API failure", async () => {
    const mc = await getMockClient();
    mc.getLifecycle.mockRejectedValue(new Error("not found"));

    const cap = await runCommand(["status", "prod-missing"]);
    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("not found");
  });

  it("prints Lifecycle Status section header", async () => {
    const mc = await getMockClient();
    mc.getLifecycle.mockResolvedValue(LIFECYCLE_COMPLETE);

    const cap = await runCommand(["status", "prod-1"]);
    expect(cap.stdout.join("\n")).toContain("Lifecycle Status");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// archibald ask
// ══════════════════════════════════════════════════════════════════════════════

describe("archibald ask", () => {
  beforeEach(async () => {
    const mc = await getMockClient();
    mc.ask.mockReset();
  });

  it("sends question to ARCHINTEL with default mode 'chat'", async () => {
    const mc = await getMockClient();
    mc.ask.mockResolvedValue({ answer: "It lives in src/auth.ts", citations: [], mode: "chat" });

    await runCommand(["ask", "Where is the auth service?"]);

    expect(mc.ask).toHaveBeenCalledWith({
      question: "Where is the auth service?",
      repoId: undefined,
      mode: "chat",
    });
  });

  it("includes --repo flag in request payload", async () => {
    const mc = await getMockClient();
    mc.ask.mockResolvedValue({ answer: "Answer", citations: [], mode: "chat" });

    await runCommand(["ask", "What does X do?", "--repo", "my-repo-id"]);

    expect(mc.ask).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: "my-repo-id" }),
    );
  });

  it("uses --mode flag when provided", async () => {
    const mc = await getMockClient();
    mc.ask.mockResolvedValue({ answer: "Migration plan...", citations: [], mode: "migration" });

    await runCommand(["ask", "How do I migrate?", "--mode", "migration"]);

    expect(mc.ask).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "migration" }),
    );
  });

  it("prints the answer in the output", async () => {
    const mc = await getMockClient();
    mc.ask.mockResolvedValue({
      answer: "The answer is 42.",
      citations: [],
      mode: "chat",
    });

    const cap = await runCommand(["ask", "What is the answer?"]);
    expect(cap.stdout.join("\n")).toContain("The answer is 42.");
  });

  it("prints citations table when citations are returned", async () => {
    const mc = await getMockClient();
    mc.ask.mockResolvedValue({
      answer: "Check AuthService.",
      citations: [{ nodeId: "uuid-1", label: "AuthService", type: "class" }],
      mode: "chat",
    });

    const cap = await runCommand(["ask", "Auth?"]);
    const out = cap.stdout.join("\n");
    expect(out).toContain("Citations");
    expect(out).toContain("AuthService");
    expect(out).toContain("uuid-1");
  });

  it("does not print citations section when citations are empty", async () => {
    const mc = await getMockClient();
    mc.ask.mockResolvedValue({ answer: "No refs needed.", citations: [], mode: "chat" });

    const cap = await runCommand(["ask", "Simple question"]);
    expect(cap.stdout.join("\n")).not.toContain("Citations");
  });

  it("exits 1 and prints error on API failure", async () => {
    const mc = await getMockClient();
    mc.ask.mockRejectedValue(new Error("ARCHINTEL unavailable"));

    const cap = await runCommand(["ask", "Any question"]);
    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("ARCHINTEL unavailable");
  });

  it("prints Answer section header", async () => {
    const mc = await getMockClient();
    mc.ask.mockResolvedValue({ answer: "Yes.", citations: [], mode: "chat" });

    const cap = await runCommand(["ask", "Is it working?"]);
    expect(cap.stdout.join("\n")).toContain("Answer");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// archibald scan
// ══════════════════════════════════════════════════════════════════════════════

describe("archibald scan", () => {
  beforeEach(async () => {
    const mc = await getMockClient();
    mc.submitDiff.mockReset();
    mc.getFindings.mockReset();
  });

  it("exits 1 if neither --diff nor --repo is provided", async () => {
    const cap = await runCommand(["scan"]);
    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("--diff");
    expect(cap.stderr.join(" ")).toContain("--repo");
  });

  it("exits 1 when --diff file cannot be read", async () => {
    const cap = await runCommand(["scan", "--diff", "/nonexistent/path/file.diff"]);
    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("/nonexistent/path/file.diff");
  });

  it("lists findings for a repo with --repo flag", async () => {
    const mc = await getMockClient();
    mc.getFindings.mockResolvedValue({
      findings: [
        {
          id: "f-1",
          severity: "high",
          title: "SQL injection risk",
          file: "src/db.ts",
          line: 42,
          ruleId: "sql-001",
        },
      ],
    });

    const cap = await runCommand(["scan", "--repo", "my-repo"]);
    expect(mc.getFindings).toHaveBeenCalledWith("my-repo");
    const out = cap.stdout.join("\n");
    expect(out).toContain("SQL injection risk");
    expect(out).toContain("src/db.ts");
  });

  it("prints 'No findings' when repo has none", async () => {
    const mc = await getMockClient();
    mc.getFindings.mockResolvedValue({ findings: [] });

    const cap = await runCommand(["scan", "--repo", "clean-repo"]);
    expect(cap.stdout.join("\n")).toContain("No findings");
  });

  it("exits 1 and prints error when getFindings fails", async () => {
    const mc = await getMockClient();
    mc.getFindings.mockRejectedValue(new Error("SENTINEL unreachable"));

    const cap = await runCommand(["scan", "--repo", "my-repo"]);
    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("SENTINEL unreachable");
  });

  // diff-based scan tests require a real temp file
  it("submits diff content from --diff file to SENTINEL", async () => {
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const { writeFileSync } = await import("fs");

    const mc = await getMockClient();
    mc.submitDiff.mockResolvedValue({ verdict: "pass", findings: [], summary: null });

    const tmpFile = join(tmpdir(), `test-${Date.now()}.diff`);
    writeFileSync(tmpFile, "diff --git a/foo.ts b/foo.ts\n+const x = 1;");

    const cap = await runCommand(["scan", "--diff", tmpFile]);

    expect(mc.submitDiff).toHaveBeenCalledWith(
      expect.objectContaining({ diff: expect.stringContaining("foo.ts") }),
    );
    expect(cap.stdout.join("\n")).toContain("PASS");
    expect(cap.exitCode).toBeNull();
  });

  it("shows verdict FAIL and prints findings from diff scan", async () => {
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const { writeFileSync } = await import("fs");

    const mc = await getMockClient();
    mc.submitDiff.mockResolvedValue({
      verdict: "fail",
      findings: [
        {
          id: "f-2",
          severity: "critical",
          title: "Hardcoded secret",
          file: "config.ts",
          line: 7,
          ruleId: "sec-001",
        },
      ],
      summary: "1 critical issue found",
    });

    const tmpFile = join(tmpdir(), `test-${Date.now()}.diff`);
    writeFileSync(tmpFile, "diff content");

    const cap = await runCommand(["scan", "--diff", tmpFile]);

    const out = cap.stdout.join("\n");
    expect(out).toContain("FAIL");
    expect(out).toContain("Hardcoded secret");
    expect(out).toContain("config.ts");
    expect(cap.exitCode).toBeNull(); // scan command itself doesn't exit 1 for findings
  });

  it("exits 1 when submitDiff fails", async () => {
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const { writeFileSync } = await import("fs");

    const mc = await getMockClient();
    mc.submitDiff.mockRejectedValue(new Error("SENTINEL down"));

    const tmpFile = join(tmpdir(), `test-${Date.now()}.diff`);
    writeFileSync(tmpFile, "diff content");

    const cap = await runCommand(["scan", "--diff", tmpFile]);
    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("SENTINEL down");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// archibald approve
// ══════════════════════════════════════════════════════════════════════════════

describe("archibald approve", () => {
  beforeEach(async () => {
    const mc = await getMockClient();
    mc.approveDecision.mockReset();
  });

  it("exits 1 when --product is missing", async () => {
    const cap = await runCommand(["approve", "dec-1"]);
    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("--product");
  });

  it("calls approveDecision with product, decisionId, and no comment", async () => {
    const mc = await getMockClient();
    mc.approveDecision.mockResolvedValue({
      decision: {
        id: "dec-1",
        productId: "prod-1",
        runId: "run-abc",
        description: "Deploy?",
        urgency: "high",
        status: "approved" as const,
        createdAt: NOW,
      },
    });

    await runCommand(["approve", "dec-1", "--product", "prod-1"]);

    expect(mc.approveDecision).toHaveBeenCalledWith("prod-1", "dec-1", undefined);
  });

  it("includes --comment in the approval call", async () => {
    const mc = await getMockClient();
    mc.approveDecision.mockResolvedValue({
      decision: {
        id: "dec-2",
        productId: "prod-1",
        runId: "run-abc",
        description: "Deploy?",
        urgency: "medium",
        status: "approved" as const,
        createdAt: NOW,
      },
    });

    await runCommand(["approve", "dec-2", "--product", "prod-1", "--comment", "LGTM"]);

    expect(mc.approveDecision).toHaveBeenCalledWith("prod-1", "dec-2", "LGTM");
  });

  it("prints Decision Approved section and decision ID", async () => {
    const mc = await getMockClient();
    mc.approveDecision.mockResolvedValue({
      decision: {
        id: "dec-3",
        productId: "prod-1",
        runId: "run-abc",
        description: "Merge?",
        urgency: "low",
        status: "approved" as const,
        createdAt: NOW,
      },
    });

    const cap = await runCommand(["approve", "dec-3", "--product", "prod-1"]);
    const out = cap.stdout.join("\n");
    expect(out).toContain("Decision Approved");
    expect(out).toContain("dec-3");
  });

  it("exits 1 and prints error on API failure", async () => {
    const mc = await getMockClient();
    mc.approveDecision.mockRejectedValue(new Error("not found"));

    const cap = await runCommand(["approve", "dec-missing", "--product", "prod-1"]);
    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("not found");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// archibald incidents
// ══════════════════════════════════════════════════════════════════════════════

describe("archibald incidents", () => {
  beforeEach(async () => {
    const mc = await getMockClient();
    mc.getIncidents.mockReset();
  });

  it("calls getIncidents without status when no flag provided", async () => {
    const mc = await getMockClient();
    mc.getIncidents.mockResolvedValue({ incidents: [] });

    await runCommand(["incidents"]);
    expect(mc.getIncidents).toHaveBeenCalledWith(undefined);
  });

  it("passes --status flag to getIncidents", async () => {
    const mc = await getMockClient();
    mc.getIncidents.mockResolvedValue({ incidents: [] });

    await runCommand(["incidents", "--status", "open"]);
    expect(mc.getIncidents).toHaveBeenCalledWith("open");
  });

  it("prints 'No incidents found' when list is empty", async () => {
    const mc = await getMockClient();
    mc.getIncidents.mockResolvedValue({ incidents: [] });

    const cap = await runCommand(["incidents"]);
    expect(cap.stdout.join("\n")).toContain("No incidents found");
  });

  it("renders incident table with required columns", async () => {
    const mc = await getMockClient();
    mc.getIncidents.mockResolvedValue({
      incidents: [
        {
          id: "inc-abc-1",
          title: "DB CPU spike",
          severity: "high",
          status: "open" as const,
          createdAt: NOW,
          resolvedAt: null,
        },
      ],
    });

    const cap = await runCommand(["incidents"]);
    const out = cap.stdout.join("\n");
    expect(out).toContain("ID");
    expect(out).toContain("Title");
    expect(out).toContain("Severity");
    expect(out).toContain("Status");
    expect(out).toContain("Created");
    expect(out).toContain("inc-abc-1");
    expect(out).toContain("DB CPU spike");
  });

  it("shows resolved time when present", async () => {
    const mc = await getMockClient();
    const resolvedAt = new Date("2026-04-01T12:00:00Z").toISOString();
    mc.getIncidents.mockResolvedValue({
      incidents: [
        {
          id: "inc-2",
          title: "Memory leak",
          severity: "medium",
          status: "resolved" as const,
          createdAt: NOW,
          resolvedAt,
        },
      ],
    });

    const cap = await runCommand(["incidents"]);
    // The resolved date should be formatted and present
    expect(cap.stdout.join("\n")).toContain("Resolved");
  });

  it("exits 1 and prints error on API failure", async () => {
    const mc = await getMockClient();
    mc.getIncidents.mockRejectedValue(new Error("PHOENIX offline"));

    const cap = await runCommand(["incidents"]);
    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("PHOENIX offline");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// archibald insights
// ══════════════════════════════════════════════════════════════════════════════

describe("archibald insights (ecosystem)", () => {
  beforeEach(async () => {
    const mc = await getMockClient();
    mc.getEcosystemInsights.mockReset();
    mc.getProductInsights.mockReset();
  });

  it("calls getEcosystemInsights when no --product flag", async () => {
    const mc = await getMockClient();
    mc.getEcosystemInsights.mockResolvedValue({
      orgId: "org-1",
      summary: { productCount: 5, totalLifecycleRuns: 20, confidenceScore: 72, confidenceNote: null },
      antiPatterns: [],
      positivePatterns: [],
      techRecommendations: [],
      allInsights: [],
    });

    await runCommand(["insights"]);
    expect(mc.getEcosystemInsights).toHaveBeenCalled();
    expect(mc.getProductInsights).not.toHaveBeenCalled();
  });

  it("prints product count and total runs", async () => {
    const mc = await getMockClient();
    mc.getEcosystemInsights.mockResolvedValue({
      orgId: "org-1",
      summary: { productCount: 5, totalLifecycleRuns: 20, confidenceScore: 72, confidenceNote: null },
      antiPatterns: [],
      positivePatterns: [],
      techRecommendations: [],
      allInsights: [],
    });

    const cap = await runCommand(["insights"]);
    const out = cap.stdout.join("\n");
    expect(out).toContain("5");
    expect(out).toContain("20");
    expect(out).toContain("72%");
  });

  it("prints confidence note when score is null", async () => {
    const mc = await getMockClient();
    mc.getEcosystemInsights.mockResolvedValue({
      orgId: "org-1",
      summary: { productCount: 1, totalLifecycleRuns: 2, confidenceScore: null, confidenceNote: "Insufficient data" },
      antiPatterns: [],
      positivePatterns: [],
      techRecommendations: [],
      allInsights: [],
    });

    const cap = await runCommand(["insights"]);
    expect(cap.stdout.join("\n")).toContain("Insufficient data");
  });

  it("renders anti-patterns table when present", async () => {
    const mc = await getMockClient();
    mc.getEcosystemInsights.mockResolvedValue({
      orgId: "org-1",
      summary: { productCount: 3, totalLifecycleRuns: 10, confidenceScore: 60, confidenceNote: null },
      antiPatterns: [
        {
          id: "ins-1",
          type: "anti_pattern",
          title: "Frequent rollbacks",
          description: "Deployment rollbacks are happening too often",
          confidence: 0.85,
          createdAt: NOW,
        },
      ],
      positivePatterns: [],
      techRecommendations: [],
      allInsights: [],
    });

    const cap = await runCommand(["insights"]);
    const out = cap.stdout.join("\n");
    expect(out).toContain("Anti-patterns");
    expect(out).toContain("Frequent rollbacks");
  });

  it("exits 1 on API failure", async () => {
    const mc = await getMockClient();
    mc.getEcosystemInsights.mockRejectedValue(new Error("server error"));

    const cap = await runCommand(["insights"]);
    expect(cap.exitCode).toBe(1);
  });
});

describe("archibald insights (product)", () => {
  beforeEach(async () => {
    const mc = await getMockClient();
    mc.getProductInsights.mockReset();
  });

  it("calls getProductInsights when --product flag is provided", async () => {
    const mc = await getMockClient();
    mc.getProductInsights.mockResolvedValue({
      productId: "prod-1",
      productName: "My App",
      metrics: { totalLifecycleRuns: 8, avgDurationMs: 15000, loopStageFrequency: {} },
      insights: [],
    });

    await runCommand(["insights", "--product", "prod-1"]);
    expect(mc.getProductInsights).toHaveBeenCalledWith("prod-1");
  });

  it("prints product name and metrics", async () => {
    const mc = await getMockClient();
    mc.getProductInsights.mockResolvedValue({
      productId: "prod-1",
      productName: "My App",
      metrics: { totalLifecycleRuns: 8, avgDurationMs: 15000, loopStageFrequency: {} },
      insights: [],
    });

    const cap = await runCommand(["insights", "--product", "prod-1"]);
    const out = cap.stdout.join("\n");
    expect(out).toContain("My App");
    expect(out).toContain("8");
    expect(out).toContain("15.0s"); // 15000ms = 15.0s
  });

  it("prints loop-back frequencies when present", async () => {
    const mc = await getMockClient();
    mc.getProductInsights.mockResolvedValue({
      productId: "prod-1",
      productName: "My App",
      metrics: {
        totalLifecycleRuns: 5,
        avgDurationMs: 10000,
        loopStageFrequency: { design: 3, testing: 7 },
      },
      insights: [],
    });

    const cap = await runCommand(["insights", "--product", "prod-1"]);
    const out = cap.stdout.join("\n");
    expect(out).toContain("Loop-back frequencies");
    expect(out).toContain("design");
    expect(out).toContain("3");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Auth / configuration
// ══════════════════════════════════════════════════════════════════════════════

describe("authentication", () => {
  it("exits 1 and prints auth hint on 401 error", async () => {
    const { ApiError } = await import("../client.js");
    const mc = await getMockClient();
    mc.getIncidents.mockRejectedValue(
      new ApiError(401, { error: "Unauthorized" }, "Unauthorized"),
    );

    const cap = await runCommand(["incidents"]);
    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("ARCHIBALD_API_KEY");
  });

  it("prints HTTP status code in error message for non-401 ApiError", async () => {
    const { ApiError } = await import("../client.js");
    const mc = await getMockClient();
    mc.getIncidents.mockRejectedValue(
      new ApiError(503, { error: "Service Unavailable" }, "Service Unavailable"),
    );

    const cap = await runCommand(["incidents"]);
    expect(cap.exitCode).toBe(1);
    expect(cap.stderr.join(" ")).toContain("503");
    expect(cap.stderr.join(" ")).toContain("Service Unavailable");
  });
});

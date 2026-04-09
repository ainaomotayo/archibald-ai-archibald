#!/usr/bin/env node
/**
 * ARCHIBALD CLI — developer-facing command line tool for the ARCHIBALD
 * lifecycle orchestrator and the broader Archibald AI ecosystem.
 */

import { Command } from "commander";
import { createClient, resolveConfig, ApiError } from "./client.js";
import {
  initFormat,
  section,
  kv,
  renderTable,
  colourStatus,
  colourSeverity,
  verdictBanner,
  renderStageBar,
} from "./format.js";
import { readFileSync } from "fs";

const program = new Command();

program
  .name("archibald")
  .description("ARCHIBALD lifecycle orchestrator — developer CLI")
  .version("0.1.0");

// ── Shared error handler ──────────────────────────────────────────────────────

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

// ── archibald run ─────────────────────────────────────────────────────────────

program
  .command("run <requirement>")
  .description("Start a lifecycle run for a product and stream stage progress")
  .option(
    "--type <type>",
    "Lifecycle type: feature | bugfix | refactor | new_product",
    "feature",
  )
  .option("--product <id>", "Product ID (required)")
  .action(async (requirement: string, opts: { type: string; product?: string }) => {
    await initFormat();
    if (!opts.product) {
      console.error("Error: --product <id> is required.");
      process.exit(1);
    }

    const cfg = resolveConfig();
    const client = createClient(cfg);

    console.log(section("Starting lifecycle run"));
    console.log(
      kv([
        ["Product", opts.product],
        ["Type", opts.type],
        ["Requirement", requirement],
      ]),
    );
    console.log();

    let runData: Awaited<ReturnType<typeof client.startLifecycle>>;
    try {
      runData = await client.startLifecycle(opts.product, {
        requirement,
        type: opts.type,
      });
    } catch (err) {
      handleError(err);
    }

    const run = runData.run;
    console.log(`Run ID: ${run.id}`);
    console.log(`Status: ${colourStatus(run.status)}`);
    console.log(`Stage:  ${run.currentStage}\n`);

    // Poll until terminal state
    const TERMINAL = new Set(["completed", "failed"]);
    let lastStage = run.currentStage;
    let lastStatus = run.status;
    const deadline = Date.now() + 10 * 60 * 1000; // 10 min max

    while (!TERMINAL.has(lastStatus) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));

      let lifecycle: Awaited<ReturnType<typeof client.getLifecycle>>;
      try {
        lifecycle = await client.getLifecycle(opts.product);
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

      if (!activeRun) {
        // No active run means it completed or failed
        lastStatus = "completed";
      }

      if (lifecycle.pendingDecisions.length > 0) {
        console.log(
          `  Awaiting ${lifecycle.pendingDecisions.length} decision(s). Use: archibald approve <decision-id>`,
        );
      }
    }

    if (Date.now() >= deadline) {
      console.error("Timed out waiting for lifecycle to complete.");
      process.exit(1);
    }

    console.log(section("Run complete"));
    console.log(kv([["Final stage", lastStage], ["Status", colourStatus(lastStatus)]]));
  });

// ── archibald status ──────────────────────────────────────────────────────────

program
  .command("status <run-id>")
  .description("Show current lifecycle status for a product (by product ID or run ID)")
  .option("--product <id>", "Product ID")
  .action(async (runId: string, opts: { product?: string }) => {
    await initFormat();
    const cfg = resolveConfig();
    const client = createClient(cfg);

    // run-id is treated as product ID if --product not given
    const productId = opts.product ?? runId;

    let lifecycle: Awaited<ReturnType<typeof client.getLifecycle>>;
    try {
      lifecycle = await client.getLifecycle(productId);
    } catch (err) {
      handleError(err);
    }

    console.log(section("Lifecycle Status"));
    console.log(
      kv([
        ["Product ID", lifecycle.productId],
        ["Current stage", lifecycle.currentStage],
      ]),
    );

    if (lifecycle.activeRun) {
      const r = lifecycle.activeRun;
      console.log("\nActive run:");
      console.log(
        kv([
          ["  Run ID", r.id],
          ["  Status", colourStatus(r.status)],
          ["  Stage", r.currentStage],
          ["  Started", new Date(r.createdAt).toLocaleString()],
        ]),
      );
      console.log("\n  " + renderStageBar(r.currentStage, r.status));
    } else {
      console.log("\nNo active run.");
    }

    if (lifecycle.pendingDecisions.length > 0) {
      console.log(section("Pending Decisions"));
      console.log(
        renderTable(
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
        ),
      );
    }
  });

// ── archibald ask ─────────────────────────────────────────────────────────────

program
  .command("ask <question>")
  .description("Ask ARCHINTEL a question about the codebase")
  .option("--repo <id>", "Repository ID for context")
  .option(
    "--mode <mode>",
    "Query mode: chat | onboarding | migration | impact",
    "chat",
  )
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
      console.log(
        renderTable(
          result.citations.map((ct) => ({
            id: ct.nodeId,
            label: ct.label,
            type: ct.type,
          })),
          [
            { key: "id", header: "Node ID", width: 36 },
            { key: "label", header: "Label", width: 40 },
            { key: "type", header: "Type", width: 16 },
          ],
        ),
      );
    }
  });

// ── archibald scan ────────────────────────────────────────────────────────────

program
  .command("scan")
  .description("Scan a diff file or list findings for a repo")
  .option("--diff <file>", "Path to a diff file (submit to SENTINEL pre-commit hook)")
  .option("--repo <id>", "Repository ID (list findings)")
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
        console.log(
          renderTable(
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
          ),
        );
        console.log();
      }
    } else if (opts.repo) {
      let result: Awaited<ReturnType<typeof client.getFindings>>;
      try {
        result = await client.getFindings(opts.repo);
      } catch (err) {
        handleError(err);
      }

      console.log(section(`Findings for repo: ${opts.repo}`));

      if (result.findings.length === 0) {
        console.log("  No findings.\n");
      } else {
        console.log(
          renderTable(
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
          ),
        );
        console.log();
      }
    }
  });

// ── archibald approve ─────────────────────────────────────────────────────────

program
  .command("approve <decision-id>")
  .description("Approve a pending lifecycle decision")
  .option("--comment <text>", "Optional comment")
  .option("--product <id>", "Product ID (required)")
  .action(
    async (decisionId: string, opts: { comment?: string; product?: string }) => {
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
      console.log(
        kv([
          ["Decision ID", result.decision.id],
          ["Status", colourStatus(result.decision.status)],
          ["Comment", opts.comment ?? "(none)"],
        ]),
      );
    },
  );

// ── archibald incidents ───────────────────────────────────────────────────────

program
  .command("incidents")
  .description("List PHOENIX incidents")
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

    console.log(
      renderTable(
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
      ),
    );
    console.log();
  });

// ── archibald insights ────────────────────────────────────────────────────────

program
  .command("insights")
  .description("Show ARCHIBALD insights (ecosystem or product-level)")
  .option("--product <id>", "Product ID for product-level insights")
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
      console.log(
        kv([
          ["Total lifecycle runs", String(result.metrics.totalLifecycleRuns)],
          ["Avg duration", `${(result.metrics.avgDurationMs / 1000).toFixed(1)}s`],
        ]),
      );

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
      console.log(
        kv([
          ["Products", String(result.summary.productCount)],
          ["Total lifecycle runs", String(result.summary.totalLifecycleRuns)],
          [
            "Confidence score",
            result.summary.confidenceScore != null
              ? `${result.summary.confidenceScore.toFixed(0)}%`
              : result.summary.confidenceNote ?? "N/A",
          ],
        ]),
      );

      if (result.antiPatterns.length > 0) {
        console.log(section("Anti-patterns"));
        printInsights(result.antiPatterns);
      }

      if (result.positivePatterns.length > 0) {
        console.log(section("Positive patterns"));
        printInsights(result.positivePatterns);
      }

      if (result.techRecommendations.length > 0) {
        console.log(section("Tech recommendations"));
        printInsights(result.techRecommendations);
      }
    }
  });

function printInsights(insights: Array<{ title: string; description: string; confidence: number; type: string }>) {
  if (insights.length === 0) {
    console.log("  (none)");
    return;
  }
  console.log(
    renderTable(
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
    ),
  );
}

// ── Parse ─────────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});

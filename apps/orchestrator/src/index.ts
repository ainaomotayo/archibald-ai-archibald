// ARCHIBALD Orchestrator entry point.
// Creates Redis consumer for archibald.* events, instantiates all agents,
// starts the orchestrator event loop.

import IORedis from "ioredis";
import { Orchestrator, type OrchestratorEvent } from "./orchestrator.js";
import { RequirementsAgent } from "./agents/requirements-agent.js";
import { DesignAgent } from "./agents/design-agent.js";
import { ScanGateAgent } from "./agents/scan-gate-agent.js";
import { DeployAgent } from "./agents/deploy-agent.js";
import { MonitorAgent } from "./agents/monitor-agent.js";
import { ResearchAgent } from "./agents/research-agent.js";
import { EvolveAgent } from "./agents/evolve-agent.js";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const CONSUMER_GROUP = "archibald-orchestrator";
const CONSUMER_NAME = `orchestrator-${process.pid}`;

// Streams to consume
const STREAMS = [
  "archibald.lifecycle",
  "archibald.decisions",
  "archibald.deploy.completed",
  "phoenix.monitoring.configured",
];

async function main(): Promise<void> {
  const redis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  const redisConsumer = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  await redis.connect();
  await redisConsumer.connect();

  log("info", "ARCHIBALD Orchestrator starting up");

  // Create consumer groups (idempotent)
  for (const stream of STREAMS) {
    try {
      await redisConsumer.xgroup("CREATE", stream, CONSUMER_GROUP, "$", "MKSTREAM");
    } catch (err: unknown) {
      // Group already exists — that's fine
      if (err instanceof Error && !err.message.includes("BUSYGROUP")) {
        log("warn", `Could not create consumer group for ${stream}`, { error: err.message });
      }
    }
  }

  // Instantiate all specialist agents
  const agents = new Map([
    ["RequirementsAgent", new RequirementsAgent({ redis, llm: null })],
    ["DesignAgent", new DesignAgent({ redis, llm: null })],
    ["ScanGateAgent", new ScanGateAgent({ redis, baseDelayMs: 5000 })], // faster in dev
    ["DeployAgent", new DeployAgent({ redis })],
    ["MonitorAgent", new MonitorAgent({ redis })],
    ["ResearchAgent", new ResearchAgent({ redis })],
    ["EvolveAgent", new EvolveAgent({ redis })],
  ]);

  const orchestrator = new Orchestrator({ redis, agents });

  log("info", "ARCHIBALD Orchestrator ready", {
    agents: Array.from(agents.keys()),
    streams: STREAMS,
  });

  // Main event loop
  let running = true;

  const shutdown = (signal: string): void => {
    log("info", `Received ${signal} — shutting down`);
    running = false;
    redis.quit().catch(() => null);
    redisConsumer.quit().catch(() => null);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  while (running) {
    try {
      // Read from all streams using XREADGROUP
      const results = await redisConsumer.xreadgroup(
        "GROUP", CONSUMER_GROUP, CONSUMER_NAME,
        "COUNT", "10",
        "BLOCK", "2000",
        "STREAMS",
        ...STREAMS,
        ...STREAMS.map(() => ">"),
      ) as Array<[string, Array<[string, string[]]>]> | null;

      if (!results) continue;

      for (const [stream, messages] of results) {
        for (const [messageId, fields] of messages) {
          try {
            const data = parseFields(fields);
            await processMessage(orchestrator, stream, data);

            // Acknowledge successful processing
            await redisConsumer.xack(stream, CONSUMER_GROUP, messageId);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            log("error", "Failed to process message", { stream, messageId, error: message });
            // Message remains in PEL for retry/dead-letter processing
          }
        }
      }
    } catch (err) {
      if (!running) break;
      const message = err instanceof Error ? err.message : "Unknown error";
      log("error", "Event loop error", { error: message });
      await sleep(1000);
    }
  }
}

async function processMessage(
  orchestrator: Orchestrator,
  stream: string,
  data: Record<string, string>,
): Promise<void> {
  const type = data["type"];
  if (!type) return;

  log("debug", "Processing event", { stream, type });

  // Route events to orchestrator
  switch (type) {
    case "lifecycle.start.requested":
      await orchestrator.handleExternalEvent({
        type: "lifecycle.start.requested",
        runId: data["runId"] ?? "",
        productId: data["productId"] ?? "",
        orgId: data["orgId"] ?? "",
        requirement: data["requirement"] ?? "",
        lifecycleType: data["lifecycleType"] ?? "feature",
        triggeredBy: data["triggeredBy"] ?? "system",
      } satisfies OrchestratorEvent);
      break;

    case "decision.approved":
      await orchestrator.handleExternalEvent({
        type: "decision.approved",
        decisionId: data["decisionId"] ?? "",
        productId: data["productId"] ?? "",
        runId: data["runId"] ?? "",
        resolvedBy: data["resolvedBy"] ?? "",
        comment: data["comment"],
      } satisfies OrchestratorEvent);
      break;

    case "decision.rejected":
      await orchestrator.handleExternalEvent({
        type: "decision.rejected",
        decisionId: data["decisionId"] ?? "",
        productId: data["productId"] ?? "",
        runId: data["runId"] ?? "",
        resolvedBy: data["resolvedBy"] ?? "",
        justification: data["justification"] ?? "",
      } satisfies OrchestratorEvent);
      break;

    case "deploy.completed":
      await orchestrator.handleExternalEvent({
        type: "deploy.completed",
        productId: data["productId"] ?? "",
        runId: data["runId"] ?? "",
        deploymentId: data["deploymentId"] ?? "",
        success: data["success"] === "true",
        smokeTestsPassed: data["smokeTestsPassed"] === "true",
      } satisfies OrchestratorEvent);
      break;

    case "monitoring.configured":
      await orchestrator.handleExternalEvent({
        type: "phoenix.monitoring.configured",
        productId: data["productId"] ?? "",
        runId: data["runId"] ?? "",
      } satisfies OrchestratorEvent);
      break;

    default:
      // Event not relevant to orchestrator — ignore
      break;
  }
}

function parseFields(fields: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < fields.length - 1; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key !== undefined && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  process.stdout.write(
    JSON.stringify({ timestamp: new Date().toISOString(), level, service: "archibald-orchestrator", message: msg, ...meta }) + "\n",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

// Orchestrator — main coordinator for ARCHIBALD.
// Combines Agent Orchestrator's state machine with MetaGPT's async messaging
// and OpenHands' event sourcing. All agent communication via Redis Streams.

import type IORedis from "ioredis";
import {
  LifecycleStateMachine,
  type LifecycleStage,
  type TransitionTrigger,
  type GateCriteria,
} from "./lifecycle/state-machine.js";
import type { BaseAgent, AgentContext, AgentResult } from "./agents/base-agent.js";
import { ForgeClient } from "./forge-client.js";

export interface LifecycleRunState {
  runId: string;
  productId: string;
  orgId: string;
  requirement: string;
  type: "feature" | "bugfix" | "refactor" | "new_product";
  triggeredBy: string;
  startedAt: Date;
  currentStage: LifecycleStage;
  stageOutputs: Map<LifecycleStage, unknown>;
  pendingDecisions: Map<string, PendingDecision>;
  machine: LifecycleStateMachine;
}

export interface PendingDecision {
  id: string;
  runId: string;
  productId: string;
  title: string;
  description: string;
  stage: LifecycleStage;
  urgency: "low" | "medium" | "high" | "critical";
  createdAt: Date;
  timeoutAt?: Date;
  resolvedAt?: Date;
  resolution?: "approved" | "rejected";
  justification?: string;
}

export type OrchestratorEvent =
  | { type: "lifecycle.start.requested"; runId: string; productId: string; orgId: string; requirement: string; lifecycleType: string; triggeredBy: string }
  | { type: "decision.approved"; decisionId: string; productId: string; runId: string; resolvedBy: string; comment?: string }
  | { type: "decision.rejected"; decisionId: string; productId: string; runId: string; resolvedBy: string; justification: string }
  | { type: "sentinel.certificate.received"; productId: string; runId: string; certificateId: string; maxSeverity: string }
  | { type: "deploy.completed"; productId: string; runId: string; deploymentId: string; success: boolean; smokeTestsPassed: boolean }
  | { type: "phoenix.monitoring.configured"; productId: string; runId: string }
  | { type: "phoenix.incident.resolved"; productId: string; incidentId: string; mttrMs: number; fixStrategy: string };

export class Orchestrator {
  private runs = new Map<string, LifecycleRunState>();
  private redis: InstanceType<typeof IORedis> | null;
  private agents: Map<string, BaseAgent>;
  private forgeClient: ForgeClient | null;

  constructor(
    options: {
      redis?: InstanceType<typeof IORedis> | null;
      agents?: Map<string, BaseAgent>;
      forgeClient?: ForgeClient | null;
    } = {},
  ) {
    this.redis = options.redis ?? null;
    this.agents = options.agents ?? new Map();
    this.forgeClient =
      options.forgeClient !== undefined
        ? options.forgeClient
        : process.env["FORGE_API_URL"] || process.env["FORGE_API_KEY"]
          ? new ForgeClient(
              process.env["FORGE_API_URL"] ?? "http://localhost:8110",
              process.env["FORGE_API_KEY"] ?? "",
            )
          : null;
  }

  // ─── Lifecycle Management ──────────────────────────────────────────────────

  async startLifecycleRun(
    runId: string,
    productId: string,
    orgId: string,
    requirement: string,
    type: "feature" | "bugfix" | "refactor" | "new_product",
    triggeredBy: string,
    orgContext?: { techStack?: string[] },
  ): Promise<void> {
    this.log("info", "Starting lifecycle run", { runId, productId, type });

    const machine = new LifecycleStateMachine(productId, runId, "conception");

    const state: LifecycleRunState = {
      runId,
      productId,
      orgId,
      requirement,
      type,
      triggeredBy,
      startedAt: new Date(),
      currentStage: "conception",
      stageOutputs: new Map(),
      pendingDecisions: new Map(),
      machine,
    };

    this.runs.set(runId, state);

    // Publish state snapshot for audit trail (OpenHands event sourcing)
    await this.emit("archibald.audit", {
      type: "run.started",
      runId,
      productId,
      orgId,
      requirement: requirement.slice(0, 500),
      lifecycleType: type,
      triggeredBy,
    });

    // Transition: conception → requirements
    const transitionResult = machine.transition("requirements", "lifecycle.start");
    if (!transitionResult.success) {
      this.log("error", "Failed to start lifecycle", { error: transitionResult.error });
      throw new Error(transitionResult.error);
    }

    state.currentStage = "requirements";
    await this.runStage(state, "requirements", { orgId, techStack: orgContext?.techStack });
  }

  async handleAgentCompletion(runId: string, result: AgentResult): Promise<void> {
    const state = this.runs.get(runId);
    if (!state) {
      this.log("warn", "handleAgentCompletion: run not found", { runId });
      return;
    }

    // Store stage output for subsequent agents (context chain)
    state.stageOutputs.set(state.currentStage, result.output);

    if (result.nextAction === "fail") {
      this.log("error", "Agent reported failure", {
        runId,
        stage: state.currentStage,
        reason: result.failureReason,
      });

      await this.emit("archibald.lifecycle", {
        type: "run.failed",
        runId,
        productId: state.productId,
        stage: state.currentStage,
        reason: result.failureReason ?? "Agent failed without reason",
      });

      // Handle scan failure → loop back to build
      if (state.currentStage === "scan") {
        await this.transitionAndRun(state, "build", "sentinel.findings.critical");
      }
      return;
    }

    if (result.nextAction === "wait_for_human") {
      if (result.pendingDecision) {
        await this.createPendingDecision(state, result.pendingDecision);
      }
      // Pause — will resume on handleHumanDecision
      return;
    }

    if (result.nextAction === "retry") {
      const delay = result.retryAfterMs ?? 30_000;
      this.log("info", "Agent requested retry", { runId, stage: state.currentStage, delay });
      // In production: schedule retry via Redis delayed queue
      await this.sleep(Math.min(delay, 5000)); // cap at 5s in orchestrator context
      await this.runStage(state, state.currentStage, {
        orgId: state.orgId,
      });
      return;
    }

    // nextAction === "proceed" — advance to next stage
    await this.advanceStage(state, result);
  }

  async handleHumanDecision(
    runId: string,
    decisionId: string,
    approved: boolean,
    justification?: string,
  ): Promise<void> {
    const state = this.runs.get(runId);
    if (!state) {
      this.log("warn", "handleHumanDecision: run not found", { runId });
      return;
    }

    const decision = state.pendingDecisions.get(decisionId);
    if (!decision) {
      this.log("warn", "handleHumanDecision: decision not found", { decisionId });
      return;
    }

    decision.resolvedAt = new Date();
    decision.resolution = approved ? "approved" : "rejected";
    decision.justification = justification;

    await this.emit("archibald.audit", {
      type: "decision.resolved",
      runId,
      decisionId,
      stage: decision.stage,
      resolution: decision.resolution,
    });

    const currentStage = state.currentStage;

    if (approved) {
      // Approval semantics depend on current stage
      if (currentStage === "review") {
        await this.transitionAndRun(state, "build", "human.approved");
      } else if (currentStage === "requirements") {
        // Clarifications provided — re-run requirements with updated context
        await this.runStage(state, "requirements", { orgId: state.orgId });
      } else if (currentStage === "scan") {
        // Human confirmed certificate exists — proceed to deploy
        await this.transitionAndRun(state, "deploy", "sentinel.certificate.received");
      } else if (currentStage === "deploy") {
        // Human confirmed deployment success
        await this.transitionAndRun(state, "monitor", "deploy.succeeded", {
          smokTestsPassed: true,
        });
      } else {
        // Generic: advance to next stage
        await this.advanceStageFromHuman(state);
      }
    } else {
      // Rejection — loop back to previous stage
      if (currentStage === "review") {
        await this.transitionAndRun(state, "design", "human.rejected");
      } else {
        this.log("info", "Human rejected — run paused pending new instructions", {
          runId,
          stage: currentStage,
        });
        await this.emit("archibald.lifecycle", {
          type: "run.paused",
          runId,
          productId: state.productId,
          stage: currentStage,
          reason: justification ?? "Human rejected",
        });
      }
    }
  }

  async handleExternalEvent(event: OrchestratorEvent): Promise<void> {
    this.log("info", "Handling external event", { type: event.type });

    switch (event.type) {
      case "lifecycle.start.requested": {
        const validType = ["feature", "bugfix", "refactor", "new_product"].includes(event.lifecycleType)
          ? (event.lifecycleType as "feature" | "bugfix" | "refactor" | "new_product")
          : "feature";
        await this.startLifecycleRun(
          event.runId,
          event.productId,
          event.orgId,
          event.requirement,
          validType,
          event.triggeredBy,
        );
        break;
      }

      case "decision.approved":
        await this.handleHumanDecision(event.runId, event.decisionId, true, event.comment);
        break;

      case "decision.rejected":
        await this.handleHumanDecision(event.runId, event.decisionId, false, event.justification);
        break;

      case "sentinel.certificate.received": {
        const state = this.findRunByProductId(event.productId);
        if (state && state.currentStage === "scan") {
          const severity = event.maxSeverity as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "NONE";
          if (severity === "HIGH" || severity === "CRITICAL") {
            await this.transitionAndRun(state, "build", "sentinel.findings.critical");
          } else {
            await this.transitionAndRun(state, "deploy", "sentinel.certificate.received", {
              sentinelCertificateId: event.certificateId,
              sentinelMaxSeverity: severity,
            });
          }
        }
        break;
      }

      case "deploy.completed": {
        const state = this.findRunByProductId(event.productId);
        if (state && state.currentStage === "deploy") {
          if (event.success && event.smokeTestsPassed) {
            await this.transitionAndRun(state, "monitor", "deploy.succeeded", {
              smokTestsPassed: true,
            });
          } else {
            await this.transitionAndRun(state, "scan", "deploy.failed");
          }
        }
        break;
      }

      case "phoenix.monitoring.configured": {
        const state = this.findRunByProductId(event.productId);
        if (state && state.currentStage === "monitor") {
          await this.transitionAndRun(state, "live", "phoenix.configured");
        }
        break;
      }

      case "phoenix.incident.resolved": {
        const state = this.findRunByProductId(event.productId);
        if (state) {
          // Record incident metrics in run metadata for EvolveAgent UCB1 bandit
          const existing = (state.stageOutputs.get("_incidentMeta") ?? {}) as Record<string, unknown>;
          const incidentCount = ((existing["incidentCount"] as number | undefined) ?? 0) + 1;
          const mttrHistory = ((existing["mttrHistory"] as number[] | undefined) ?? []).concat(event.mttrMs);
          const avgMttrMs = mttrHistory.reduce((a, b) => a + b, 0) / mttrHistory.length;

          state.stageOutputs.set("_incidentMeta", {
            incidentCount,
            mttrHistory,
            avgMttrMs,
            lastFixStrategy: event.fixStrategy,
            lastIncidentId: event.incidentId,
            updatedAt: new Date().toISOString(),
          });

          this.log("info", "Phoenix incident resolved — metadata updated", {
            productId: event.productId,
            incidentId: event.incidentId,
            incidentCount,
            avgMttrMs,
            fixStrategy: event.fixStrategy,
          });

          await this.emit("archibald.lifecycle", {
            type: "phoenix.incident.feedback",
            productId: event.productId,
            incidentId: event.incidentId,
            incidentCount,
            avgMttrMs,
            fixStrategy: event.fixStrategy,
          });
        }
        break;
      }
    }
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private async runStage(
    state: LifecycleRunState,
    stage: LifecycleStage,
    orgContext?: { orgId?: string; techStack?: string[] },
  ): Promise<void> {
    // ─── Build stage: delegate to FORGE API ───────────────────────────────────
    if (stage === "build") {
      await this.runBuildViaForge(state);
      return;
    }

    const agentName = this.stageToAgent(stage);
    if (!agentName) {
      this.log("info", `Stage ${stage} has no agent — auto-advancing`);
      await this.advanceStageAuto(state, stage);
      return;
    }

    const agent = this.agents.get(agentName);
    if (!agent) {
      this.log("warn", `Agent ${agentName} not registered — skipping stage ${stage}`);
      return;
    }

    const context: AgentContext = {
      productId: state.productId,
      lifecycleRunId: state.runId,
      stage,
      requirement: state.requirement,
      previousStageOutput: this.getPreviousOutput(state, stage),
      orgContext: {
        orgId: orgContext?.orgId ?? state.orgId,
        techStack: orgContext?.techStack,
      },
    };

    this.log("info", `Running agent ${agentName} for stage ${stage}`, {
      runId: state.runId,
    });

    try {
      const result = await agent.execute(context);
      await this.handleAgentCompletion(state.runId, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      this.log("error", `Agent ${agentName} threw an exception`, { error: message });
      await this.emit("archibald.lifecycle", {
        type: "agent.error",
        agent: agentName,
        stage,
        runId: state.runId,
        error: message,
      });
    }
  }

  private async runBuildViaForge(state: LifecycleRunState): Promise<void> {
    this.log("info", "Build stage — delegating to FORGE API", {
      runId: state.runId,
      productId: state.productId,
    });

    if (!this.forgeClient) {
      // FORGE unavailable — create a pending decision for manual build
      this.log("warn", "FORGE client not configured — requesting manual build decision", {
        runId: state.runId,
      });
      await this.createPendingDecision(state, {
        title: "Manual build required — FORGE unavailable",
        description:
          "The FORGE build service is not configured. Please trigger a build manually " +
          "and approve this decision once the build artefacts are ready.",
        urgency: "high",
        timeoutHours: 48,
      });
      return;
    }

    // Extract design output to derive requirements and components for the spec
    const designOutput = state.stageOutputs.get("review") ?? state.stageOutputs.get("design");
    const design = designOutput as Record<string, unknown> | undefined;
    const requirementsText = state.requirement;
    const components = Array.isArray(design?.["components"]) ? design["components"] : undefined;

    await this.emit("archibald.lifecycle", {
      type: "forge.build.started",
      runId: state.runId,
      productId: state.productId,
    });

    try {
      // 1. Create spec
      const spec = await this.forgeClient.createSpec(state.productId, requirementsText, components);
      this.log("info", "FORGE spec created", { specId: spec.id, runId: state.runId });

      // 2. Trigger build
      const build = await this.forgeClient.triggerBuild(spec.id);
      this.log("info", "FORGE build triggered", { buildId: build.id, runId: state.runId });

      await this.emit("archibald.lifecycle", {
        type: "forge.build.polling",
        runId: state.runId,
        productId: state.productId,
        buildId: build.id,
      });

      // 3. Poll until complete
      const completedBuild = await this.forgeClient.pollBuildUntilComplete(build.id);

      if (completedBuild.status === "SUCCESS") {
        this.log("info", "FORGE build succeeded — advancing to test", {
          buildId: completedBuild.id,
          runId: state.runId,
        });

        // Store build output for the test stage
        state.stageOutputs.set("build", {
          forgeBuildId: completedBuild.id,
          forgeSpecId: spec.id,
          outputDir: completedBuild.outputDir,
          progress: completedBuild.progress,
        });

        await this.emit("archibald.lifecycle", {
          type: "forge.build.succeeded",
          runId: state.runId,
          productId: state.productId,
          buildId: completedBuild.id,
          outputDir: completedBuild.outputDir ?? null,
        });

        // Advance to test
        await this.transitionAndRun(state, "test", "agent.completed");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "FORGE build failed";
      this.log("error", "FORGE build failed — storing error, staying in build for retry", {
        error: message,
        runId: state.runId,
      });

      state.stageOutputs.set("build", { error: message, forgeFailed: true });

      await this.emit("archibald.lifecycle", {
        type: "forge.build.failed",
        runId: state.runId,
        productId: state.productId,
        error: message,
      });
    }
  }

  private async advanceStage(state: LifecycleRunState, result: AgentResult): Promise<void> {
    const nextStage = this.getNextStageForProceed(state.currentStage);
    if (!nextStage) {
      this.log("info", "No next stage — lifecycle run complete", { runId: state.runId });
      await this.emit("archibald.lifecycle", {
        type: "run.completed",
        runId: state.runId,
        productId: state.productId,
        finalStage: state.currentStage,
      });
      return;
    }

    const trigger = this.getAutoTrigger(state.currentStage);
    if (!trigger) return;

    const criteria = this.extractGateCriteria(state.currentStage, result);
    const transitionResult = state.machine.transition(nextStage, trigger, criteria);

    if (!transitionResult.success) {
      // Gate check failed — loop back
      const loopbackStage = this.getLoopbackStage(state.currentStage);
      if (loopbackStage) {
        const loopbackTrigger = this.getLoopbackTrigger(state.currentStage);
        if (loopbackTrigger) {
          this.log("info", `Gate failed — looping back to ${loopbackStage}`, {
            reason: transitionResult.error,
          });
          state.machine.transition(loopbackStage, loopbackTrigger);
          state.currentStage = loopbackStage;
          await this.runStage(state, loopbackStage, { orgId: state.orgId });
        }
      }
      return;
    }

    state.currentStage = nextStage;
    await this.runStage(state, nextStage, { orgId: state.orgId });
  }

  private async advanceStageFromHuman(state: LifecycleRunState): Promise<void> {
    const nextStage = this.getNextStageForProceed(state.currentStage);
    if (!nextStage) return;
    const trigger = this.getAutoTrigger(state.currentStage);
    if (!trigger) return;

    const transitionResult = state.machine.transition(nextStage, trigger);
    if (transitionResult.success) {
      state.currentStage = nextStage;
      await this.runStage(state, nextStage, { orgId: state.orgId });
    }
  }

  private async advanceStageAuto(state: LifecycleRunState, _currentStage: LifecycleStage): Promise<void> {
    const nextStage = this.getNextStageForProceed(state.currentStage);
    if (!nextStage) return;
    const trigger = this.getAutoTrigger(state.currentStage);
    if (!trigger) return;

    const transitionResult = state.machine.transition(nextStage, trigger);
    if (transitionResult.success) {
      state.currentStage = nextStage;
      await this.runStage(state, nextStage, { orgId: state.orgId });
    }
  }

  private async transitionAndRun(
    state: LifecycleRunState,
    targetStage: LifecycleStage,
    trigger: TransitionTrigger,
    criteria?: GateCriteria,
  ): Promise<void> {
    const result = state.machine.transition(targetStage, trigger, criteria);
    if (!result.success) {
      this.log("error", "Transition failed", { error: result.error });
      return;
    }
    state.currentStage = targetStage;
    await this.runStage(state, targetStage, { orgId: state.orgId });
  }

  private async createPendingDecision(
    state: LifecycleRunState,
    decisionSpec: NonNullable<AgentResult["pendingDecision"]>,
  ): Promise<PendingDecision> {
    const decision: PendingDecision = {
      id: crypto.randomUUID(),
      runId: state.runId,
      productId: state.productId,
      title: decisionSpec.title,
      description: decisionSpec.description,
      stage: state.currentStage,
      urgency: decisionSpec.urgency ?? "medium",
      createdAt: new Date(),
      timeoutAt: decisionSpec.timeoutHours
        ? new Date(Date.now() + decisionSpec.timeoutHours * 60 * 60 * 1000)
        : undefined,
    };

    state.pendingDecisions.set(decision.id, decision);

    await this.emit("archibald.decisions", {
      type: "decision.created",
      decisionId: decision.id,
      runId: state.runId,
      productId: state.productId,
      title: decisionSpec.title,
      urgency: decisionSpec.urgency ?? "medium",
    });

    return decision;
  }

  private stageToAgent(stage: LifecycleStage): string | null {
    const map: Partial<Record<LifecycleStage, string>> = {
      requirements: "RequirementsAgent",
      design: "DesignAgent",
      build: "BuildAgent",
      test: "QualityAgent",
      scan: "ScanGateAgent",
      deploy: "DeployAgent",
      monitor: "MonitorAgent",
      evolving: "EvolveAgent",
    };
    return map[stage] ?? null;
  }

  private getNextStageForProceed(current: LifecycleStage): LifecycleStage | null {
    const sequence: Record<LifecycleStage, LifecycleStage | null> = {
      conception: "requirements",
      requirements: "design",
      design: "review",
      review: "build",
      build: "test",
      test: "scan",
      scan: "deploy",
      deploy: "monitor",
      monitor: "live",
      live: "evolving",
      evolving: null,
    };
    return sequence[current] ?? null;
  }

  private getAutoTrigger(current: LifecycleStage): TransitionTrigger | null {
    const map: Partial<Record<LifecycleStage, TransitionTrigger>> = {
      conception: "lifecycle.start",
      requirements: "agent.completed",
      design: "agent.completed",
      review: "human.approved",
      build: "agent.completed",
      test: "agent.completed",
      scan: "sentinel.certificate.received",
      deploy: "deploy.succeeded",
      monitor: "phoenix.configured",
      live: "evolve.triggered",
    };
    return map[current] ?? null;
  }

  private getLoopbackStage(current: LifecycleStage): LifecycleStage | null {
    const map: Partial<Record<LifecycleStage, LifecycleStage>> = {
      test: "build",
      scan: "build",
      deploy: "scan",
    };
    return map[current] ?? null;
  }

  private getLoopbackTrigger(current: LifecycleStage): TransitionTrigger | null {
    const map: Partial<Record<LifecycleStage, TransitionTrigger>> = {
      test: "agent.completed",
      scan: "sentinel.findings.critical",
      deploy: "deploy.failed",
    };
    return map[current] ?? null;
  }

  private extractGateCriteria(stage: LifecycleStage, result: AgentResult): GateCriteria {
    const output = result.output as Record<string, unknown> | null | undefined;
    return {
      testCoverageThreshold: (output?.["coverageThreshold"] as number | undefined) ?? 80,
      actualCoverage: output?.["actualCoverage"] as number | undefined,
      sentinelCertificateId: output?.["sentinelCertificateId"] as string | undefined,
      sentinelMaxSeverity: output?.["maxSeverity"] as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | undefined,
      smokTestsPassed: output?.["smokeTestsPassed"] as boolean | undefined,
    };
  }

  private getPreviousOutput(state: LifecycleRunState, stage: LifecycleStage): unknown {
    const previousStageOrder: LifecycleStage[] = [
      "conception", "requirements", "design", "review",
      "build", "test", "scan", "deploy", "monitor", "live", "evolving",
    ];
    const idx = previousStageOrder.indexOf(stage);
    if (idx <= 0) return undefined;
    const prevStage = previousStageOrder[idx - 1];
    return prevStage ? state.stageOutputs.get(prevStage) : undefined;
  }

  private findRunByProductId(productId: string): LifecycleRunState | undefined {
    for (const state of this.runs.values()) {
      if (state.productId === productId) return state;
    }
    return undefined;
  }

  private async emit(stream: string, data: Record<string, unknown>): Promise<void> {
    if (!this.redis) return;
    const fields = Object.entries({ ...data, orchestratorAt: new Date().toISOString() })
      .flatMap(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]);
    await this.redis.xadd(stream, "*", ...fields);
  }

  private log(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>): void {
    process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), level, component: "Orchestrator", message: msg, ...meta }) + "\n");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Public access for testing
  getRunState(runId: string): LifecycleRunState | undefined {
    return this.runs.get(runId);
  }
}

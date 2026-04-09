// LifecycleStateMachine — adapts the Agent Orchestrator's 14-state lifecycle
// pattern to ARCHIBALD's 11-stage software lifecycle. Each stage maps to one
// or more specialist agents. Gates enforce quality criteria before advancing.

export type LifecycleStage =
  | "conception"    // Product registered, no lifecycle run yet
  | "requirements"  // RequirementsAgent gathering and structuring
  | "design"        // DesignAgent creating architecture proposal
  | "review"        // Human reviewing design (gate)
  | "build"         // BuildAgent generating code
  | "test"          // QualityAgent validating test coverage
  | "scan"          // ScanGateAgent waiting for SENTINEL certificate
  | "deploy"        // DeployAgent deploying to staging then production
  | "monitor"       // MonitorAgent configuring PHOENIX
  | "live"          // Product live, PHOENIX monitoring active
  | "evolving";     // EvolveAgent proposing improvements

export type TransitionTrigger =
  | "lifecycle.start"
  | "agent.completed"
  | "human.approved"
  | "human.rejected"
  | "sentinel.certificate.received"
  | "sentinel.findings.critical"
  | "deploy.succeeded"
  | "deploy.failed"
  | "phoenix.configured"
  | "evolve.triggered"
  | "new.lifecycle.run";

export interface StageTransition {
  from: LifecycleStage;
  to: LifecycleStage;
  trigger: TransitionTrigger;
  isLoopback?: boolean;
  requiresGate?: boolean;
  gateDescription?: string;
}

// All valid transitions with their triggers and gate criteria
export const VALID_TRANSITIONS: StageTransition[] = [
  {
    from: "conception",
    to: "requirements",
    trigger: "lifecycle.start",
  },
  {
    from: "requirements",
    to: "design",
    trigger: "agent.completed",
  },
  {
    from: "design",
    to: "review",
    trigger: "agent.completed",
  },
  {
    from: "review",
    to: "build",
    trigger: "human.approved",
  },
  {
    from: "review",
    to: "design",
    trigger: "human.rejected",
    isLoopback: true,
    gateDescription: "Human requested design changes",
  },
  {
    from: "build",
    to: "test",
    trigger: "agent.completed",
  },
  {
    from: "test",
    to: "scan",
    trigger: "agent.completed",
    requiresGate: true,
    gateDescription: "Coverage must meet or exceed the configured threshold",
  },
  {
    from: "test",
    to: "build",
    trigger: "agent.completed",
    isLoopback: true,
    gateDescription: "Coverage insufficient — returning to build for fixes",
  },
  {
    from: "scan",
    to: "deploy",
    trigger: "sentinel.certificate.received",
    requiresGate: true,
    gateDescription: "SENTINEL certificate received with no HIGH/CRITICAL findings",
  },
  {
    from: "scan",
    to: "build",
    trigger: "sentinel.findings.critical",
    isLoopback: true,
    gateDescription: "SENTINEL found HIGH/CRITICAL issues — returning to build",
  },
  {
    from: "deploy",
    to: "monitor",
    trigger: "deploy.succeeded",
    requiresGate: true,
    gateDescription: "Staging smoke tests must pass before promoting to production",
  },
  {
    from: "deploy",
    to: "scan",
    trigger: "deploy.failed",
    isLoopback: true,
    gateDescription: "Deployment failed — re-scanning before retry",
  },
  {
    from: "monitor",
    to: "live",
    trigger: "phoenix.configured",
  },
  {
    from: "live",
    to: "evolving",
    trigger: "evolve.triggered",
  },
  {
    from: "evolving",
    to: "requirements",
    trigger: "new.lifecycle.run",
  },
];

export interface TransitionResult {
  success: boolean;
  newStage?: LifecycleStage;
  transition?: StageTransition;
  error?: string;
}

export interface GateCriteria {
  testCoverageThreshold?: number;
  actualCoverage?: number;
  sentinelCertificateId?: string;
  sentinelMaxSeverity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  smokTestsPassed?: boolean;
}

export class LifecycleStateMachine {
  private currentStage: LifecycleStage;
  private readonly productId: string;
  private readonly runId: string;
  private transitionHistory: Array<{
    from: LifecycleStage;
    to: LifecycleStage;
    trigger: TransitionTrigger;
    occurredAt: Date;
    metadata?: Record<string, unknown>;
  }> = [];

  constructor(productId: string, runId: string, initialStage: LifecycleStage = "conception") {
    this.productId = productId;
    this.runId = runId;
    this.currentStage = initialStage;
  }

  getStage(): LifecycleStage {
    return this.currentStage;
  }

  getHistory() {
    return [...this.transitionHistory];
  }

  canTransition(to: LifecycleStage, trigger: TransitionTrigger): boolean {
    return VALID_TRANSITIONS.some(
      (t) => t.from === this.currentStage && t.to === to && t.trigger === trigger,
    );
  }

  transition(
    to: LifecycleStage,
    trigger: TransitionTrigger,
    criteria?: GateCriteria,
    metadata?: Record<string, unknown>,
  ): TransitionResult {
    const validTransition = VALID_TRANSITIONS.find(
      (t) => t.from === this.currentStage && t.to === to && t.trigger === trigger,
    );

    if (!validTransition) {
      return {
        success: false,
        error: `Invalid transition: ${this.currentStage} → ${to} on trigger '${trigger}'. ` +
          `Valid transitions from ${this.currentStage}: ${this.getValidNextStages().join(", ")}`,
      };
    }

    // Enforce gate criteria
    if (validTransition.requiresGate && criteria) {
      const gateResult = this.checkGateCriteria(validTransition, criteria);
      if (!gateResult.passed) {
        return {
          success: false,
          error: `Gate check failed for ${this.currentStage} → ${to}: ${gateResult.reason}`,
        };
      }
    }

    const from = this.currentStage;
    this.currentStage = to;
    this.transitionHistory.push({
      from,
      to,
      trigger,
      occurredAt: new Date(),
      metadata,
    });

    return {
      success: true,
      newStage: to,
      transition: validTransition,
    };
  }

  getValidNextStages(): LifecycleStage[] {
    return VALID_TRANSITIONS
      .filter((t) => t.from === this.currentStage)
      .map((t) => t.to);
  }

  getValidTriggers(): TransitionTrigger[] {
    return VALID_TRANSITIONS
      .filter((t) => t.from === this.currentStage)
      .map((t) => t.trigger);
  }

  private checkGateCriteria(
    transition: StageTransition,
    criteria: GateCriteria,
  ): { passed: boolean; reason?: string } {
    // scan → deploy: requires SENTINEL certificate with no HIGH/CRITICAL
    if (transition.from === "scan" && transition.to === "deploy") {
      if (!criteria.sentinelCertificateId) {
        return { passed: false, reason: "No SENTINEL certificate provided" };
      }
      if (
        criteria.sentinelMaxSeverity === "HIGH" ||
        criteria.sentinelMaxSeverity === "CRITICAL"
      ) {
        return {
          passed: false,
          reason: `SENTINEL found ${criteria.sentinelMaxSeverity} severity findings — deployment blocked`,
        };
      }
      return { passed: true };
    }

    // test → scan: requires coverage threshold
    if (transition.from === "test" && transition.to === "scan") {
      const threshold = criteria.testCoverageThreshold ?? 80;
      const actual = criteria.actualCoverage ?? 0;
      if (actual < threshold) {
        return {
          passed: false,
          reason: `Test coverage ${actual}% is below required ${threshold}%`,
        };
      }
      return { passed: true };
    }

    // deploy → monitor: requires smoke tests passing
    if (transition.from === "deploy" && transition.to === "monitor") {
      if (!criteria.smokTestsPassed) {
        return { passed: false, reason: "Staging smoke tests did not pass" };
      }
      return { passed: true };
    }

    return { passed: true };
  }
}

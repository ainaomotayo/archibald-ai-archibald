// EvolveAgent — analyses outcome metrics from completed lifecycle runs and
// identifies patterns: what architectural choices led to incidents, what had
// high MTTR. Surfaces improvement proposals with evidence (self-evolution loop).

import { BaseAgent, type AgentContext, type AgentResult, type Evidence } from "./base-agent.js";

export interface LifecycleRunMetrics {
  runId: string;
  productId: string;
  type: string;
  durationMs: number;
  loopbackCount: number;
  sentinelFindingsCount: number;
  incidentCount: number;
  mttrMs: number;
  deployedAt?: string;
  architecturalChoices: string[];
}

export interface ImprovementProposal {
  id: string;
  type: "architectural" | "process" | "technology" | "testing";
  title: string;
  description: string;
  supportingEvidence: Array<{
    runId: string;
    observation: string;
    impact: string;
  }>;
  recommendation: string;
  confidence: number;
  estimatedImpact: "low" | "medium" | "high";
  linkedProducts: string[];
}

export interface StrategyArm {
  name: string;       // e.g. "microservices", "monolith", "event-driven"
  pulls: number;      // how many times selected
  wins: number;       // how many times led to success (low incidents, low MTTR)
  totalReward: number; // sum of rewards (0.0–1.0 each)
}

export class StrategyBandit {
  private arms: Map<string, StrategyArm> = new Map();

  private getOrCreate(name: string): StrategyArm {
    if (!this.arms.has(name)) {
      this.arms.set(name, { name, pulls: 0, wins: 0, totalReward: 0 });
    }
    return this.arms.get(name)!;
  }

  record(strategyName: string, reward: number): void {
    // reward: 1.0 = perfect run (0 incidents, low MTTR), 0.0 = failed run
    const arm = this.getOrCreate(strategyName);
    arm.pulls += 1;
    arm.totalReward += reward;
    if (reward >= 0.5) {
      arm.wins += 1;
    }
  }

  selectBest(candidates: string[], totalPulls: number): string {
    // UCB1: pick arm with highest mean_reward + sqrt(2 * ln(totalPulls) / arm_pulls)
    // Unvisited arms get infinity score (explore first)
    let bestName = candidates[0]!;
    let bestScore = -Infinity;

    for (const name of candidates) {
      const arm = this.arms.get(name);
      if (!arm || arm.pulls === 0) {
        // Unvisited arm gets infinity — always explore first
        return name;
      }
      const meanReward = arm.totalReward / arm.pulls;
      const exploration = Math.sqrt((2 * Math.log(totalPulls)) / arm.pulls);
      const score = meanReward + exploration;
      if (score > bestScore) {
        bestScore = score;
        bestName = name;
      }
    }

    return bestName;
  }

  getRankings(): StrategyArm[] {
    // Return arms sorted by mean reward desc
    return Array.from(this.arms.values()).sort((a, b) => {
      const meanA = a.pulls > 0 ? a.totalReward / a.pulls : 0;
      const meanB = b.pulls > 0 ? b.totalReward / b.pulls : 0;
      return meanB - meanA;
    });
  }

  fromMetrics(metrics: LifecycleRunMetrics[]): void {
    // Seed bandit from historical metrics.
    // For each metric: reward = 1 - (incidentCount / 10) * 0.5 - (mttrMs / 3600000) * 0.5
    // Each architecturalChoice in the metric = one arm pull
    for (const metric of metrics) {
      const incidentPenalty = Math.min(metric.incidentCount / 10, 1) * 0.5;
      const mttrPenalty = Math.min(metric.mttrMs / 3600000, 1) * 0.5;
      const reward = Math.max(0, 1 - incidentPenalty - mttrPenalty);

      for (const choice of metric.architecturalChoices) {
        this.record(choice, reward);
      }
    }
  }
}

export interface EvolveOutput {
  analysedRunCount: number;
  proposals: ImprovementProposal[];
  antiPatterns: Array<{
    pattern: string;
    occurrenceCount: number;
    avgIncidentRate: number;
    recommendation: string;
  }>;
  positivePatterns: Array<{
    pattern: string;
    occurrenceCount: number;
    avgMttrMs: number;
    recommendation: string;
  }>;
  strategyRankings: StrategyArm[];
  ecosystemInsight?: string;
}

export class EvolveAgent extends BaseAgent {
  readonly name = "EvolveAgent";

  async execute(context: AgentContext): Promise<AgentResult> {
    this.log("info", "EvolveAgent: analysing lifecycle outcomes for self-evolution", {
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    await this.emit("archibald.lifecycle", {
      type: "agent.started",
      agent: this.name,
      stage: "evolving",
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    const evidence: Evidence[] = [];

    // Use historical metrics from context or stub data
    const historicalMetrics = (context.previousStageOutput as { metrics?: LifecycleRunMetrics[] } | undefined)
      ?.metrics ?? this.stubMetrics(context.productId);

    const proposals: ImprovementProposal[] = [];
    const antiPatterns: EvolveOutput["antiPatterns"] = [];
    const positivePatterns: EvolveOutput["positivePatterns"] = [];

    // ── UCB1 multi-armed bandit: seed from historical metrics ─────────────────
    const bandit = new StrategyBandit();
    bandit.fromMetrics(historicalMetrics);
    const strategyRankings = bandit.getRankings();

    // Surface a bandit-driven proposal if there is a clear winner
    if (strategyRankings.length > 0) {
      const topArm = strategyRankings[0]!;
      const meanReward = topArm.pulls > 0 ? topArm.totalReward / topArm.pulls : 0;
      const MIN_PULLS = 5;
      const MIN_CONFIDENCE = 0.6;

      if (topArm.pulls >= MIN_PULLS && meanReward >= MIN_CONFIDENCE) {
        proposals.push({
          id: crypto.randomUUID(),
          type: "architectural",
          title: `Prioritise "${topArm.name}" strategy — highest UCB1 reward`,
          description:
            `UCB1 bandit analysis across ${historicalMetrics.length} lifecycle runs identified ` +
            `"${topArm.name}" as the top-performing architectural strategy (mean reward ` +
            `${meanReward.toFixed(2)}, ${topArm.pulls} observed runs, ${topArm.wins} successful).`,
          supportingEvidence: [
            {
              runId: "bandit-analysis",
              observation: `Mean reward ${meanReward.toFixed(2)} across ${topArm.pulls} pulls`,
              impact: `${topArm.wins} out of ${topArm.pulls} runs met success criteria (low incidents, low MTTR)`,
            },
          ],
          recommendation: `Favour "${topArm.name}" as the default architectural strategy for new products in this ecosystem.`,
          confidence: meanReward,
          estimatedImpact: meanReward >= 0.8 ? "high" : "medium",
          linkedProducts: [context.productId],
        });

        evidence.push({
          source: "bandit:ucb1-analysis",
          finding: `Strategy "${topArm.name}" identified as top performer with mean reward ${meanReward.toFixed(2)}`,
          confidence: meanReward,
        });
      }
    }

    // Analyse loopback patterns
    const highLoopbackRuns = historicalMetrics.filter((m) => m.loopbackCount > 2);
    if (highLoopbackRuns.length >= 2) {
      antiPatterns.push({
        pattern: "Excessive design loopbacks",
        occurrenceCount: highLoopbackRuns.length,
        avgIncidentRate: highLoopbackRuns.reduce((s, m) => s + m.incidentCount, 0) / highLoopbackRuns.length,
        recommendation: "Invest more time in requirements gathering to reduce design rework",
      });

      proposals.push({
        id: crypto.randomUUID(),
        type: "process",
        title: "Strengthen requirements phase to reduce design iterations",
        description: `${highLoopbackRuns.length} lifecycle runs had more than 2 loopbacks to design. Each loopback adds significant delay.`,
        supportingEvidence: highLoopbackRuns.slice(0, 3).map((m) => ({
          runId: m.runId,
          observation: `${m.loopbackCount} design iterations`,
          impact: `~${Math.round(m.durationMs / 1000 / 60)} minutes added to cycle time`,
        })),
        recommendation: "Add a structured requirements review checklist before design begins. Use ARCHIBALD's requirements-validation mode.",
        confidence: 0.8,
        estimatedImpact: "high",
        linkedProducts: [context.productId],
      });

      evidence.push({
        source: "archibald:loopback-analysis",
        finding: `${highLoopbackRuns.length} runs had excessive design loopbacks`,
        confidence: 0.85,
      });
    }

    // Analyse SENTINEL findings patterns
    const highFindingsRuns = historicalMetrics.filter((m) => m.sentinelFindingsCount > 5);
    if (highFindingsRuns.length >= 2) {
      antiPatterns.push({
        pattern: "High SENTINEL finding rate",
        occurrenceCount: highFindingsRuns.length,
        avgIncidentRate: highFindingsRuns.reduce((s, m) => s + m.incidentCount, 0) / highFindingsRuns.length,
        recommendation: "Shift security left — add pre-commit SENTINEL hooks and IDE integration",
      });

      proposals.push({
        id: crypto.randomUUID(),
        type: "process",
        title: "Shift security scanning left to reduce SENTINEL gate failures",
        description: `${highFindingsRuns.length} lifecycle runs had more than 5 SENTINEL findings at scan gate.`,
        supportingEvidence: highFindingsRuns.slice(0, 3).map((m) => ({
          runId: m.runId,
          observation: `${m.sentinelFindingsCount} findings at scan gate`,
          impact: "Deployment blocked; required return to build stage",
        })),
        recommendation: "Enable SENTINEL pre-commit hooks in developer environments to catch issues before the scan gate.",
        confidence: 0.9,
        estimatedImpact: "high",
        linkedProducts: [context.productId],
      });
    }

    // Positive patterns: low MTTR architectures
    const lowMttrRuns = historicalMetrics.filter((m) => m.mttrMs > 0 && m.mttrMs < 30 * 60 * 1000);
    if (lowMttrRuns.length >= 2) {
      const commonChoices = this.findCommonChoices(lowMttrRuns.map((r) => r.architecturalChoices));
      for (const choice of commonChoices) {
        positivePatterns.push({
          pattern: choice,
          occurrenceCount: lowMttrRuns.length,
          avgMttrMs: lowMttrRuns.reduce((s, m) => s + m.mttrMs, 0) / lowMttrRuns.length,
          recommendation: `Continue using ${choice} — correlated with lower MTTR`,
        });
      }
    }

    let ecosystemInsight: string | undefined;
    if (this.llm && historicalMetrics.length >= 5) {
      try {
        const prompt = this.buildInsightPrompt(historicalMetrics, antiPatterns, positivePatterns);
        ecosystemInsight = await this.llm.complete(prompt, { maxTokens: 500, temperature: 0.3 });
        evidence.push({
          source: "llm:ecosystem-insight",
          finding: "LLM synthesised cross-run insight from outcome metrics",
          confidence: 0.75,
        });
      } catch {
        this.log("warn", "EvolveAgent: LLM insight generation failed, continuing without it");
      }
    }

    const output: EvolveOutput = {
      analysedRunCount: historicalMetrics.length,
      proposals,
      antiPatterns,
      positivePatterns,
      strategyRankings,
      ecosystemInsight,
    };

    await this.emit("archibald.lifecycle", {
      type: "agent.completed",
      agent: this.name,
      stage: "evolving",
      productId: context.productId,
      runId: context.lifecycleRunId,
      proposalCount: proposals.length,
    });

    // Publish insights to the ecosystem insights stream
    if (proposals.length > 0) {
      await this.emit("archibald.insights", {
        type: "insights.generated",
        productId: context.productId,
        orgId: context.orgContext?.orgId ?? "unknown",
        proposalCount: proposals.length,
        antiPatternCount: antiPatterns.length,
        positivePatternCount: positivePatterns.length,
      });
    }

    return {
      success: true,
      output,
      nextAction: "proceed",
      evidence,
    };
  }

  private findCommonChoices(choiceSets: string[][]): string[] {
    const counts = new Map<string, number>();
    for (const choices of choiceSets) {
      for (const c of choices) {
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    const threshold = Math.ceil(choiceSets.length * 0.6);
    return Array.from(counts.entries())
      .filter(([, count]) => count >= threshold)
      .map(([choice]) => choice);
  }

  private buildInsightPrompt(
    metrics: LifecycleRunMetrics[],
    antiPatterns: EvolveOutput["antiPatterns"],
    positivePatterns: EvolveOutput["positivePatterns"],
  ): string {
    return `You are ARCHIBALD's EvolveAgent. Synthesise a single, actionable ecosystem insight from these metrics.

LIFECYCLE RUNS ANALYSED: ${metrics.length}
AVG DURATION: ${Math.round(metrics.reduce((s, m) => s + m.durationMs, 0) / metrics.length / 1000 / 60)} minutes
AVG INCIDENTS: ${(metrics.reduce((s, m) => s + m.incidentCount, 0) / metrics.length).toFixed(1)}

ANTI-PATTERNS FOUND: ${antiPatterns.map((a) => a.pattern).join(", ") || "none"}
POSITIVE PATTERNS: ${positivePatterns.map((p) => p.pattern).join(", ") || "none"}

Write a single sentence (max 200 characters) insight that a CTO would find immediately actionable.
Format: "Based on X lifecycle runs, [insight]."`;
  }

  private stubMetrics(productId: string): LifecycleRunMetrics[] {
    return [
      {
        runId: crypto.randomUUID(),
        productId,
        type: "feature",
        durationMs: 7200000,
        loopbackCount: 1,
        sentinelFindingsCount: 2,
        incidentCount: 0,
        mttrMs: 0,
        architecturalChoices: ["REST API", "PostgreSQL", "Redis"],
      },
    ];
  }
}

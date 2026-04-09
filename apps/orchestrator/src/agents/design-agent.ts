// DesignAgent — queries ARCHINTEL for org's architectural patterns, then uses
// the LLM to generate a full architecture proposal. Always gates on human review
// (OpenHands confirmation mode for high-risk actions).

import { BaseAgent, type AgentContext, type AgentResult, type Evidence } from "./base-agent.js";

export interface DesignProposal {
  components: Array<{
    name: string;
    type: "service" | "library" | "database" | "queue" | "gateway" | "worker";
    responsibility: string;
    technology: string;
    rationale: string;
  }>;
  dataFlow: Array<{
    from: string;
    to: string;
    protocol: string;
    description: string;
  }>;
  technologyChoices: Array<{
    category: string;
    choice: string;
    alternatives: string[];
    rationale: string;
    evidenceSource?: string;
  }>;
  rationale: string;
  costEstimate: {
    devWeeks: number;
    infrastructureMonthlyUsd: number;
    confidence: "low" | "medium" | "high";
  };
  risks: Array<{
    description: string;
    severity: "low" | "medium" | "high";
    mitigation: string;
  }>;
  architecturalPatterns: string[];
}

export class DesignAgent extends BaseAgent {
  readonly name = "DesignAgent";

  private archintelUrl: string;

  constructor(options: {
    redis?: InstanceType<typeof import("ioredis").default> | null;
    llm?: import("./base-agent.js").LLMProvider | null;
    archintelUrl?: string;
  } = {}) {
    super(options);
    this.archintelUrl = options.archintelUrl ?? process.env["ARCHINTEL_API_URL"] ?? "http://localhost:8090";
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    this.log("info", "Starting architecture design", {
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    await this.emit("archibald.lifecycle", {
      type: "agent.started",
      agent: this.name,
      stage: "design",
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    const evidence: Evidence[] = [];

    // Step 1: Query ARCHINTEL for org's architectural patterns
    let orgPatterns: string[] = [];
    try {
      const archintelResponse = await fetch(
        `${this.archintelUrl}/v1/ask`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-org-id": context.orgContext?.orgId ?? "unknown",
            "x-user-id": "archibald-design-agent",
            "x-role": "VIEWER",
          },
          body: JSON.stringify({
            query: `What architectural patterns, technology choices, and best practices has this organisation used successfully? What anti-patterns should be avoided?`,
            maxResults: 10,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (archintelResponse.ok) {
        const archintelData = await archintelResponse.json() as { answer?: string; patterns?: string[] };
        orgPatterns = archintelData.patterns ?? [];
        evidence.push({
          source: "archintel:org-patterns",
          finding: archintelData.answer ?? "Architectural patterns retrieved from ARCHINTEL",
          confidence: 0.9,
          url: `${this.archintelUrl}/v1/ask`,
        });
        this.log("info", "Retrieved org patterns from ARCHINTEL", { count: orgPatterns.length });
      } else {
        this.log("warn", "ARCHINTEL query returned non-OK status", { status: archintelResponse.status });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "ARCHINTEL query failed";
      this.log("warn", "Could not query ARCHINTEL — proceeding without org patterns", { error: message });
      evidence.push({
        source: "archintel:unavailable",
        finding: "ARCHINTEL unavailable — design generated without org-specific context",
        confidence: 0.3,
      });
    }

    // Step 2: Generate architecture proposal via LLM
    let proposal: DesignProposal;

    if (this.llm) {
      const prompt = this.buildPrompt(context, orgPatterns);
      let raw: string;
      try {
        raw = await this.llm.complete(prompt, { maxTokens: 3000, temperature: 0.3 });
        evidence.push({
          source: "llm:architecture-design",
          finding: "LLM generated architecture proposal with technology justifications",
          confidence: 0.8,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "LLM call failed";
        return this.failResult(`LLM unavailable: ${message}`);
      }
      proposal = this.parseOutput(raw);
    } else {
      proposal = this.stubProposal(context);
      evidence.push({
        source: "stub",
        finding: "LLM not configured — using stub design proposal",
        confidence: 0.4,
      });
    }

    await this.emit("archibald.lifecycle", {
      type: "agent.completed",
      agent: this.name,
      stage: "design",
      productId: context.productId,
      runId: context.lifecycleRunId,
      componentCount: proposal.components.length,
    });

    // Design always requires human review (high-risk gate)
    return this.waitForHuman(
      {
        title: "Architecture design ready for review",
        description: [
          `ARCHIBALD has generated an architecture proposal for your review.\n`,
          `Components: ${proposal.components.map((c) => c.name).join(", ")}`,
          `Estimated effort: ${proposal.costEstimate.devWeeks} dev-weeks`,
          `Risks: ${proposal.risks.length} identified`,
          `\nPlease review the full proposal and approve or request changes.`,
        ].join("\n"),
        urgency: "high",
        timeoutHours: 72,
      },
      proposal,
      evidence,
    );
  }

  private buildPrompt(context: AgentContext, orgPatterns: string[]): string {
    const requirements = context.previousStageOutput as Record<string, unknown> | undefined;
    const orgPatternsSection = orgPatterns.length > 0
      ? `\nORG ARCHITECTURAL PATTERNS (from ARCHINTEL):\n${orgPatterns.join("\n")}`
      : "";

    return `You are ARCHIBALD's DesignAgent. Generate a detailed architecture proposal.

REQUIREMENT SUMMARY:
${typeof requirements?.summary === "string" ? requirements.summary : context.requirement}

TECH STACK CONTEXT:
${context.orgContext?.techStack?.join(", ") ?? "Not specified"}
${orgPatternsSection}

Return a JSON object with EXACTLY these fields:
{
  "components": [{"name": "", "type": "service|library|database|queue|gateway|worker", "responsibility": "", "technology": "", "rationale": ""}],
  "dataFlow": [{"from": "", "to": "", "protocol": "", "description": ""}],
  "technologyChoices": [{"category": "", "choice": "", "alternatives": [], "rationale": "", "evidenceSource": ""}],
  "rationale": "overall architectural reasoning",
  "costEstimate": {"devWeeks": 0, "infrastructureMonthlyUsd": 0, "confidence": "low|medium|high"},
  "risks": [{"description": "", "severity": "low|medium|high", "mitigation": ""}],
  "architecturalPatterns": ["pattern names used"]
}

For each technology choice, include EVIDENCE — why this over alternatives.
Return ONLY the JSON, no explanation.`;
  }

  private parseOutput(raw: string): DesignProposal {
    try {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      const jsonStr = (jsonMatch[1] ?? raw).trim();
      return JSON.parse(jsonStr) as DesignProposal;
    } catch {
      this.log("warn", "Failed to parse design proposal JSON, using stub");
      return this.stubProposal(null as any);
    }
  }

  private stubProposal(context: AgentContext | null): DesignProposal {
    return {
      components: [
        {
          name: "api-service",
          type: "service",
          responsibility: "HTTP API gateway",
          technology: "Fastify 5 / TypeScript",
          rationale: "Consistent with ecosystem stack",
        },
        {
          name: "postgres",
          type: "database",
          responsibility: "Primary data store",
          technology: "PostgreSQL 16",
          rationale: "Proven reliability; pgvector support for AI features",
        },
      ],
      dataFlow: [
        {
          from: "api-service",
          to: "postgres",
          protocol: "Prisma ORM",
          description: "All reads and writes",
        },
      ],
      technologyChoices: [
        {
          category: "runtime",
          choice: "Node.js 22",
          alternatives: ["Bun", "Deno"],
          rationale: "Ecosystem consistency; LTS stability",
          evidenceSource: "archibald-ecosystem-standard",
        },
      ],
      rationale: "Standard ARCHIBALD ecosystem pattern — Fastify API + PostgreSQL",
      costEstimate: {
        devWeeks: 4,
        infrastructureMonthlyUsd: 50,
        confidence: "medium",
      },
      risks: [
        {
          description: "Database schema migrations under load",
          severity: "medium",
          mitigation: "Use zero-downtime migrations with Prisma",
        },
      ],
      architecturalPatterns: ["REST API", "Event sourcing via Redis Streams"],
    };
  }
}

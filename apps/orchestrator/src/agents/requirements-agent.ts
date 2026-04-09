// RequirementsAgent — takes natural language requirements and structures them
// using the MetaGPT ActionNode pattern. Emits to archibald.lifecycle stream.
// If clarification is needed, creates a pending decision (OpenHands confirmation mode).

import { BaseAgent, type AgentContext, type AgentResult, type Evidence } from "./base-agent.js";

export interface StructuredRequirements {
  summary: string;
  userStories: Array<{
    as: string;
    iWant: string;
    soThat: string;
    acceptanceCriteria: string[];
  }>;
  acceptanceCriteria: string[];
  outOfScope: string[];
  clarificationsNeeded: string[];
  estimatedComplexity: "low" | "medium" | "high" | "very_high";
  technicalConsiderations: string[];
}

export class RequirementsAgent extends BaseAgent {
  readonly name = "RequirementsAgent";

  async execute(context: AgentContext): Promise<AgentResult> {
    this.log("info", "Starting requirements structuring", {
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    await this.emit("archibald.lifecycle", {
      type: "agent.started",
      agent: this.name,
      stage: "requirements",
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    const evidence: Evidence[] = [];

    let structured: StructuredRequirements;

    if (this.llm) {
      const prompt = this.buildPrompt(context);
      let raw: string;
      try {
        raw = await this.llm.complete(prompt, { maxTokens: 2000, temperature: 0.2 });
        evidence.push({
          source: "llm:requirements-structuring",
          finding: "LLM structured requirements from natural language input",
          confidence: 0.85,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "LLM call failed";
        this.log("error", "LLM call failed in RequirementsAgent", { error: message });
        return this.failResult(`LLM unavailable: ${message}`);
      }

      structured = this.parseOutput(raw, context.requirement);
    } else {
      // Stub output when LLM is not configured (test mode)
      structured = this.stubOutput(context.requirement);
      evidence.push({
        source: "stub",
        finding: "LLM not configured — using stub requirements",
        confidence: 0.5,
      });
    }

    // If the LLM flagged clarifications needed, pause for human input
    if (structured.clarificationsNeeded.length > 0) {
      this.log("info", "Clarifications needed — creating pending decision", {
        count: structured.clarificationsNeeded.length,
      });

      return this.waitForHuman(
        {
          title: "Requirements clarification needed",
          description: [
            `The following questions need answers before ARCHIBALD can proceed:\n`,
            ...structured.clarificationsNeeded.map((q, i) => `${i + 1}. ${q}`),
          ].join("\n"),
          urgency: "high",
          timeoutHours: 48,
        },
        structured,
        evidence,
      );
    }

    await this.emit("archibald.lifecycle", {
      type: "agent.completed",
      agent: this.name,
      stage: "requirements",
      productId: context.productId,
      runId: context.lifecycleRunId,
      summary: structured.summary,
      complexity: structured.estimatedComplexity,
    });

    return {
      success: true,
      output: structured,
      nextAction: "proceed",
      evidence,
    };
  }

  private buildPrompt(context: AgentContext): string {
    return `You are ARCHIBALD's RequirementsAgent. Structure the following software requirement into a precise specification.

REQUIREMENT:
${context.requirement}

LIFECYCLE TYPE: ${context.stage}
${context.orgContext?.techStack ? `TECH STACK: ${context.orgContext.techStack.join(", ")}` : ""}

Return a JSON object with EXACTLY these fields:
{
  "summary": "one-sentence summary",
  "userStories": [{"as": "", "iWant": "", "soThat": "", "acceptanceCriteria": []}],
  "acceptanceCriteria": ["criterion 1", "criterion 2"],
  "outOfScope": ["what is explicitly NOT included"],
  "clarificationsNeeded": ["question if ambiguous, empty if clear"],
  "estimatedComplexity": "low|medium|high|very_high",
  "technicalConsiderations": ["technical constraint or consideration"]
}

Return ONLY the JSON, no explanation.`;
  }

  private parseOutput(raw: string, fallbackRequirement: string): StructuredRequirements {
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      const jsonStr = (jsonMatch[1] ?? raw).trim();
      const parsed = JSON.parse(jsonStr) as Partial<StructuredRequirements>;

      return {
        summary: parsed.summary ?? fallbackRequirement.slice(0, 100),
        userStories: parsed.userStories ?? [],
        acceptanceCriteria: parsed.acceptanceCriteria ?? [],
        outOfScope: parsed.outOfScope ?? [],
        clarificationsNeeded: parsed.clarificationsNeeded ?? [],
        estimatedComplexity: parsed.estimatedComplexity ?? "medium",
        technicalConsiderations: parsed.technicalConsiderations ?? [],
      };
    } catch {
      this.log("warn", "Failed to parse LLM JSON output, falling back to stub");
      return this.stubOutput(fallbackRequirement);
    }
  }

  private stubOutput(requirement: string): StructuredRequirements {
    return {
      summary: requirement.slice(0, 150),
      userStories: [
        {
          as: "a developer",
          iWant: requirement,
          soThat: "the system meets the stated requirement",
          acceptanceCriteria: ["Feature is implemented as described", "Tests pass"],
        },
      ],
      acceptanceCriteria: ["Feature is implemented", "Unit tests written", "Integration tests pass"],
      outOfScope: [],
      clarificationsNeeded: [],
      estimatedComplexity: "medium",
      technicalConsiderations: [],
    };
  }
}

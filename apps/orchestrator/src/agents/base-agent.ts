// BaseAgent — abstract foundation for all ARCHIBALD specialist agents.
// Implements the OpenHands event sourcing pattern for audit trail and
// MetaGPT's typed role pattern with structured outputs.

import type IORedis from "ioredis";

export interface Evidence {
  source: string;
  finding: string;
  confidence: number;   // 0.0 – 1.0
  url?: string;
}

export interface AgentContext {
  productId: string;
  lifecycleRunId: string;
  stage: string;
  requirement: string;
  previousStageOutput?: unknown;
  orgContext?: {
    orgId: string;
    techStack?: string[];
    patterns?: string[];
  };
}

export type NextAction =
  | "proceed"           // Advance to next stage
  | "wait_for_human"    // Create pending decision, pause
  | "retry"             // Transient failure — retry with backoff
  | "fail";             // Fatal failure — block this stage

export interface AgentResult {
  success: boolean;
  output: unknown;
  nextAction: NextAction;
  evidence: Evidence[];
  pendingDecision?: {
    title: string;
    description: string;
    options?: string[];
    urgency?: "low" | "medium" | "high" | "critical";
    timeoutHours?: number;
  };
  retryAfterMs?: number;
  failureReason?: string;
}

export interface LLMProvider {
  complete(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string>;
}

export abstract class BaseAgent {
  abstract readonly name: string;

  protected redis: InstanceType<typeof IORedis> | null;
  protected llm: LLMProvider | null;

  constructor(
    options: {
      redis?: InstanceType<typeof IORedis> | null;
      llm?: LLMProvider | null;
    } = {},
  ) {
    this.redis = options.redis ?? null;
    this.llm = options.llm ?? null;
  }

  abstract execute(context: AgentContext): Promise<AgentResult>;

  protected log(
    level: "info" | "warn" | "error",
    msg: string,
    meta?: Record<string, unknown>,
  ): void {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      agent: this.name,
      message: msg,
      ...meta,
    });
    if (level === "error") {
      process.stderr.write(entry + "\n");
    } else {
      process.stdout.write(entry + "\n");
    }
  }

  protected async emit(
    stream: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.redis) {
      this.log("warn", `Redis not available — skipping emit to ${stream}`, { stream, data });
      return;
    }

    const fields = Object.entries({
      ...data,
      agent: this.name,
      emittedAt: new Date().toISOString(),
    }).flatMap(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]);

    await this.redis.xadd(stream, "*", ...fields);
  }

  // Utility: sleep for a given number of milliseconds
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Utility: exponential backoff delay calculation
  protected backoffMs(attempt: number, baseMs = 30_000, maxMs = 300_000): number {
    return Math.min(baseMs * Math.pow(2, attempt), maxMs);
  }

  // Utility: produce a well-formed failure result
  protected failResult(reason: string, evidence: Evidence[] = []): AgentResult {
    return {
      success: false,
      output: null,
      nextAction: "fail",
      evidence,
      failureReason: reason,
    };
  }

  // Utility: produce a well-formed wait-for-human result
  protected waitForHuman(
    decision: NonNullable<AgentResult["pendingDecision"]>,
    output: unknown = null,
    evidence: Evidence[] = [],
  ): AgentResult {
    return {
      success: true,
      output,
      nextAction: "wait_for_human",
      evidence,
      pendingDecision: decision,
    };
  }
}

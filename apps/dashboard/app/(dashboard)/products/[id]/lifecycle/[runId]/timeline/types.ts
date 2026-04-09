// Types for the agent lifecycle run timeline view.

export type AgentStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "AWAITING_APPROVAL"
  | "SKIPPED";

export interface AgentRunRecord {
  agentId: string;
  agentName: string;
  status: AgentStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  llmCallCount?: number;
  totalTokens?: number;
  eventsPublished?: string[];
  pendingDecision?: {
    id: string;
    description: string;
    options: string[];
  };
}

export interface LifecycleRunSummary {
  runId: string;
  productId: string;
  productName: string;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED" | "AWAITING_APPROVAL";
  startedAt: string;
  completedAt?: string;
  agents: AgentRunRecord[];
  gatesTotal: number;
  gatesPassed: number;
  pendingDecisionCount: number;
}

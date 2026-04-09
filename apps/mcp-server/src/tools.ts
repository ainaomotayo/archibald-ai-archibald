/**
 * ARCHIBALD MCP Tools
 *
 * Exposes the full software lifecycle intelligence capabilities of the
 * ARCHIBALD platform as MCP tools. This is the primary integration point
 * for AI agents, IDEs, and any MCP-compatible client.
 *
 * Tools fan out to the appropriate product APIs:
 *   understand_requirement → ARCHIBALD API (orchestrator)
 *   run_pipeline           → ARCHIBALD API (orchestrator)
 *   query_knowledge        → ARCHINTEL API
 *   check_compliance       → SENTINEL API
 *   get_incident_status    → PHOENIX API
 *   analyze_impact         → ARCHINTEL API
 *   create_product         → ARCHIBALD + FORGE API
 *   submit_outcome         → ARCHIBALD self-evolution engine
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface ArchibaldApiClients {
  archibald: {
    startLifecycle(requirement: string, type: string, productId?: string): Promise<{ runId: string; status: string }>;
    getRunStatus(runId: string): Promise<{ runId: string; stage: string; status: string }>;
    listPendingDecisions(): Promise<Array<{ id: string; title: string; urgency: string; stage: string }>>;
    approveDecision(decisionId: string, comment?: string): Promise<{ ok: boolean }>;
    submitOutcome(runId: string, outcome: string, metrics?: Record<string, unknown>): Promise<{ ok: boolean }>;
    getInsights(): Promise<{ topStrategies: Array<{ name: string; successRate: number }>; recentRuns: unknown[] }>;
  };
  archintel: {
    ask(question: string, mode?: string, repoId?: string): Promise<{ answer: string; citations: unknown[] }>;
  };
  sentinel: {
    scanDiff(diff: string): Promise<{ verdict: string; findings?: unknown[] }>;
    checkCompliance(repoId: string): Promise<{ compliant: boolean; highSeverityCount: number }>;
  };
  phoenix: {
    listIncidents(status?: string): Promise<Array<{ id: string; severity: string; service: string; status: string }>>;
    getIncident(id: string): Promise<unknown>;
  };
}

export function createArchibaldTools(clients: ArchibaldApiClients): Record<string, McpTool> {
  const { archibald, archintel, sentinel, phoenix } = clients;

  return {
    understand_requirement: {
      name: "understand_requirement",
      description: "Deep research on a product requirement — analyzes existing codebase context, " +
        "identifies affected services, and returns a structured spec with user stories, " +
        "acceptance criteria, and technical considerations. This is the first step of any " +
        "ARCHIBALD lifecycle run.",
      inputSchema: {
        type: "object",
        properties: {
          requirement: {
            type: "string",
            description: "Natural language requirement or feature request",
          },
          productId: {
            type: "string",
            description: "Optional product/service ID to scope the analysis",
          },
        },
        required: ["requirement"],
      },
      handler: async (input) => {
        return archibald.startLifecycle(
          input["requirement"] as string,
          "feature",
          input["productId"] as string | undefined,
        );
      },
    },

    run_pipeline: {
      name: "run_pipeline",
      description: "Execute the full ARCHIBALD lifecycle pipeline for a requirement: " +
        "understand → architect → build → test → SENTINEL scan → deploy → PHOENIX monitor. " +
        "Returns a runId for tracking. Human approval gates are required at review and deploy stages.",
      inputSchema: {
        type: "object",
        properties: {
          requirement: {
            type: "string",
            description: "Natural language requirement to build",
          },
          type: {
            type: "string",
            description: "Type of change",
            enum: ["feature", "bugfix", "refactor", "new_product"],
          },
          productId: {
            type: "string",
            description: "Product ID to build against",
          },
        },
        required: ["requirement"],
      },
      handler: async (input) => {
        return archibald.startLifecycle(
          input["requirement"] as string,
          (input["type"] as string) ?? "feature",
          input["productId"] as string | undefined,
        );
      },
    },

    get_run_status: {
      name: "get_run_status",
      description: "Get the current status of an ARCHIBALD lifecycle run — " +
        "shows which stage is active (requirements/design/build/test/scan/deploy/monitor/live) " +
        "and any pending human decisions that need approval.",
      inputSchema: {
        type: "object",
        properties: {
          runId: {
            type: "string",
            description: "Lifecycle run ID returned by run_pipeline",
          },
        },
        required: ["runId"],
      },
      handler: async (input) => {
        return archibald.getRunStatus(input["runId"] as string);
      },
    },

    query_knowledge: {
      name: "query_knowledge",
      description: "Query the ARCHINTEL codebase knowledge graph. Supports 4 modes: " +
        "chat (general Q&A), onboarding (explain codebase), migration (plan tech migration), " +
        "impact (analyze change blast radius). Uses pgvector semantic search + LLM reasoning.",
      inputSchema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Natural language question about the codebase",
          },
          mode: {
            type: "string",
            description: "Query mode",
            enum: ["chat", "onboarding", "migration", "impact"],
          },
          repoId: {
            type: "string",
            description: "Optional repository ID to scope the search",
          },
        },
        required: ["question"],
      },
      handler: async (input) => {
        return archintel.ask(
          input["question"] as string,
          input["mode"] as string | undefined,
          input["repoId"] as string | undefined,
        );
      },
    },

    check_compliance: {
      name: "check_compliance",
      description: "Run a SENTINEL compliance check on a git diff or repository. " +
        "Checks for security vulnerabilities, IP/license violations, and code quality issues. " +
        "Returns verdict (PASS/FAIL/REVIEW) and specific findings.",
      inputSchema: {
        type: "object",
        properties: {
          diff: {
            type: "string",
            description: "Git diff to scan (use with staged changes)",
          },
          repoId: {
            type: "string",
            description: "Repository ID for compliance status check",
          },
        },
      },
      handler: async (input) => {
        if (input["diff"]) {
          return sentinel.scanDiff(input["diff"] as string);
        }
        if (input["repoId"]) {
          return sentinel.checkCompliance(input["repoId"] as string);
        }
        return { error: "Provide either diff or repoId" };
      },
    },

    get_incident_status: {
      name: "get_incident_status",
      description: "Check PHOENIX for active production incidents — shows severity, " +
        "affected services, root cause analysis, and fix status. " +
        "Use before deploying to ensure no active incidents on target services.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Filter by incident status",
            enum: ["open", "investigating", "mitigated", "resolved"],
          },
          incidentId: {
            type: "string",
            description: "Get details for a specific incident ID",
          },
        },
      },
      handler: async (input) => {
        if (input["incidentId"]) {
          return phoenix.getIncident(input["incidentId"] as string);
        }
        return phoenix.listIncidents(input["status"] as string | undefined);
      },
    },

    analyze_impact: {
      name: "analyze_impact",
      description: "Analyze the blast radius of a proposed code change using the ARCHINTEL " +
        "knowledge graph. Identifies which services, functions, and consumers will be affected, " +
        "with risk levels (HIGH/MEDIUM/LOW). Always run this before making breaking changes.",
      inputSchema: {
        type: "object",
        properties: {
          change: {
            type: "string",
            description: "Description of the proposed change (e.g., 'Remove the legacy payment endpoint')",
          },
          repoId: {
            type: "string",
            description: "Optional repository scope",
          },
        },
        required: ["change"],
      },
      handler: async (input) => {
        return archintel.ask(
          input["change"] as string,
          "impact",
          input["repoId"] as string | undefined,
        );
      },
    },

    submit_outcome: {
      name: "submit_outcome",
      description: "Submit the outcome of a lifecycle run to the ARCHIBALD self-evolution engine. " +
        "Outcomes feed the UCB1 bandit strategy selection algorithm — improving future agent " +
        "decisions based on what actually worked in production.",
      inputSchema: {
        type: "object",
        properties: {
          runId: {
            type: "string",
            description: "Lifecycle run ID",
          },
          outcome: {
            type: "string",
            description: "Outcome of the run",
            enum: ["success", "failure", "partial"],
          },
          metrics: {
            type: "string",
            description: "JSON string with outcome metrics: testPassRate, securityScore, deploymentSucceeded",
          },
        },
        required: ["runId", "outcome"],
      },
      handler: async (input) => {
        let metrics: Record<string, unknown> = {};
        if (input["metrics"]) {
          try {
            metrics = JSON.parse(input["metrics"] as string);
          } catch {
            // ignore parse error
          }
        }
        return archibald.submitOutcome(
          input["runId"] as string,
          input["outcome"] as string,
          metrics,
        );
      },
    },
  };
}

import type { LifecycleRunSummary } from "./types";

// Returns a realistic mock lifecycle run with 8 agents in varied states.
// Used when no real API data is available.
export function mockTimelineData(): LifecycleRunSummary {
  const baseTime = Date.now() - 5 * 60 * 1000; // 5 minutes ago

  // Offset helpers (ms from baseTime)
  const t = (offsetMs: number) => new Date(baseTime + offsetMs).toISOString();

  return {
    runId: "run-demo-001",
    productId: "prod-auth-service",
    productName: "auth-service",
    status: "IN_PROGRESS",
    startedAt: t(0),
    gatesTotal: 4,
    gatesPassed: 3,
    pendingDecisionCount: 1,
    agents: [
      // 1. RequirementsAgent — COMPLETED (0–45 s)
      {
        agentId: "agent-requirements",
        agentName: "RequirementsAgent",
        status: "COMPLETED",
        startedAt: t(0),
        completedAt: t(45_000),
        durationMs: 45_000,
        input: {
          requirement: "Add OAuth2 authentication with Google and GitHub providers",
          orgId: "org-acme",
          techStack: ["fastify", "prisma", "postgresql"],
        },
        output: {
          userStories: 4,
          acceptanceCriteria: 8,
          clarificationsNeeded: false,
        },
        llmCallCount: 2,
        totalTokens: 3_840,
        eventsPublished: ["archibald.lifecycle:requirements.completed"],
      },

      // 2. ResearchAgent — COMPLETED (45 s–1 m 45 s)
      {
        agentId: "agent-research",
        agentName: "ResearchAgent",
        status: "COMPLETED",
        startedAt: t(45_000),
        completedAt: t(105_000),
        durationMs: 60_000,
        input: {
          userStories: 4,
          techStack: ["fastify", "prisma", "postgresql"],
        },
        output: {
          orgPatterns: 6,
          antiPatterns: 1,
          researchSummary: "OAuth2 PKCE flow recommended; avoid implicit grant",
        },
        llmCallCount: 3,
        totalTokens: 5_120,
        eventsPublished: ["archibald.lifecycle:research.completed"],
      },

      // 3. DesignAgent — COMPLETED (1 m 45 s–3 m 15 s)
      {
        agentId: "agent-design",
        agentName: "DesignAgent",
        status: "COMPLETED",
        startedAt: t(105_000),
        completedAt: t(195_000),
        durationMs: 90_000,
        input: {
          orgPatterns: 6,
          requirement: "Add OAuth2 authentication",
        },
        output: {
          components: ["AuthController", "OAuthProvider", "TokenService", "UserRepository"],
          architecture: "REST API + PostgreSQL + Redis sessions",
          diagramUrl: null,
        },
        llmCallCount: 4,
        totalTokens: 8_200,
        eventsPublished: ["archibald.lifecycle:design.completed"],
      },

      // 4. ScanGateAgent — COMPLETED (3 m 15 s–3 m 45 s)
      {
        agentId: "agent-scan-gate",
        agentName: "ScanGateAgent",
        status: "COMPLETED",
        startedAt: t(195_000),
        completedAt: t(225_000),
        durationMs: 30_000,
        input: { sentinelRunId: "sentinel-run-abc" },
        output: {
          sentinelCertificateId: "cert-88f2a",
          maxSeverity: "LOW",
          findingsCount: 2,
        },
        llmCallCount: 0,
        totalTokens: 0,
        eventsPublished: ["archibald.lifecycle:scan.gate.passed"],
      },

      // 5. BuildAgent — COMPLETED (3 m 45 s–5 m 15 s)
      {
        agentId: "agent-build",
        agentName: "BuildAgent",
        status: "COMPLETED",
        startedAt: t(225_000),
        completedAt: t(285_000),
        durationMs: 60_000,
        input: {
          components: ["AuthController", "OAuthProvider", "TokenService", "UserRepository"],
        },
        output: {
          linesOfCode: 847,
          filesGenerated: 12,
          forgeBuildId: "forge-build-002",
        },
        llmCallCount: 6,
        totalTokens: 14_500,
        eventsPublished: ["archibald.lifecycle:build.completed", "forge.build.succeeded"],
      },

      // 6. TestAgent — RUNNING (5 m 15 s → now)
      {
        agentId: "agent-test",
        agentName: "TestAgent",
        status: "RUNNING",
        startedAt: t(285_000),
        llmCallCount: 2,
        totalTokens: 2_100,
        eventsPublished: [],
      },

      // 7. DeployAgent — AWAITING_APPROVAL (has a pending decision)
      {
        agentId: "agent-deploy",
        agentName: "DeployAgent",
        status: "AWAITING_APPROVAL",
        input: { environment: "staging" },
        pendingDecision: {
          id: "dec-deploy-001",
          description:
            "Deployment to staging is ready. All tests passed (94% coverage). " +
            "Please review the staging environment and approve to promote to production.",
          options: ["approve", "reject"],
        },
        eventsPublished: [],
      },

      // 8. MonitorAgent — PENDING
      {
        agentId: "agent-monitor",
        agentName: "MonitorAgent",
        status: "PENDING",
        eventsPublished: [],
      },

      // 9. EvolveAgent — PENDING
      {
        agentId: "agent-evolve",
        agentName: "EvolveAgent",
        status: "PENDING",
        eventsPublished: [],
      },

      // 10. ReviewerAgent — SKIPPED (no FORGE reviewer configured)
      {
        agentId: "agent-reviewer",
        agentName: "ReviewerAgent",
        status: "SKIPPED",
        eventsPublished: [],
      },
    ],
  };
}

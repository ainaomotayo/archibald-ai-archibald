import { describe, it, expect, vi } from "vitest";
import { createArchibaldTools, type ArchibaldApiClients } from "../tools.js";

const mockClients: ArchibaldApiClients = {
  archibald: {
    startLifecycle: vi.fn().mockResolvedValue({ runId: "run-1", status: "started" }),
    getRunStatus: vi.fn().mockResolvedValue({ runId: "run-1", stage: "build", status: "running" }),
    listPendingDecisions: vi.fn().mockResolvedValue([
      { id: "dec-1", title: "Architecture ready for review", urgency: "high", stage: "review" },
    ]),
    approveDecision: vi.fn().mockResolvedValue({ ok: true }),
    submitOutcome: vi.fn().mockResolvedValue({ ok: true }),
    getInsights: vi.fn().mockResolvedValue({ topStrategies: [], recentRuns: [] }),
  },
  archintel: {
    ask: vi.fn().mockResolvedValue({
      answer: "Impact: AuthService will need updates",
      citations: [{ nodeId: "n1", name: "AuthService", filePath: "src/auth.ts", type: "CLASS" }],
    }),
  },
  sentinel: {
    scanDiff: vi.fn().mockResolvedValue({ verdict: "PASS", certificateId: "cert-1" }),
    checkCompliance: vi.fn().mockResolvedValue({ compliant: true, highSeverityCount: 0 }),
  },
  phoenix: {
    listIncidents: vi.fn().mockResolvedValue([
      { id: "inc-1", severity: "HIGH", service: "payment-api", status: "open" },
    ]),
    getIncident: vi.fn().mockResolvedValue({ id: "inc-1", rootCause: "Memory leak" }),
  },
};

describe("ARCHIBALD MCP tools", () => {
  const tools = createArchibaldTools(mockClients);

  it("exposes 8 tools", () => {
    expect(Object.keys(tools)).toHaveLength(8);
  });

  it("understand_requirement starts a lifecycle run", async () => {
    const result = await tools["understand_requirement"]!.handler({
      requirement: "Add OAuth2 login",
    }) as { runId: string };
    expect(result.runId).toBe("run-1");
    expect(mockClients.archibald.startLifecycle).toHaveBeenCalledWith("Add OAuth2 login", "feature", undefined);
  });

  it("run_pipeline passes type to lifecycle", async () => {
    await tools["run_pipeline"]!.handler({ requirement: "Fix memory leak", type: "bugfix", productId: "svc-1" });
    expect(mockClients.archibald.startLifecycle).toHaveBeenCalledWith("Fix memory leak", "bugfix", "svc-1");
  });

  it("get_run_status returns stage info", async () => {
    const result = await tools["get_run_status"]!.handler({ runId: "run-1" }) as { stage: string };
    expect(result.stage).toBe("build");
  });

  it("query_knowledge delegates to archintel.ask", async () => {
    await tools["query_knowledge"]!.handler({ question: "How does billing work?", mode: "chat" });
    expect(mockClients.archintel.ask).toHaveBeenCalledWith("How does billing work?", "chat", undefined);
  });

  it("check_compliance scans a diff", async () => {
    const result = await tools["check_compliance"]!.handler({ diff: "+const x = 1;" }) as { verdict: string };
    expect(result.verdict).toBe("PASS");
  });

  it("check_compliance checks repo compliance", async () => {
    const result = await tools["check_compliance"]!.handler({ repoId: "repo-1" }) as { compliant: boolean };
    expect(result.compliant).toBe(true);
  });

  it("get_incident_status lists incidents", async () => {
    const result = await tools["get_incident_status"]!.handler({}) as unknown[];
    expect(result).toHaveLength(1);
    expect((result[0] as { severity: string }).severity).toBe("HIGH");
  });

  it("analyze_impact calls archintel with impact mode", async () => {
    await tools["analyze_impact"]!.handler({ change: "Remove getUserById", repoId: "r1" });
    expect(mockClients.archintel.ask).toHaveBeenCalledWith("Remove getUserById", "impact", "r1");
  });

  it("submit_outcome records outcome for learning", async () => {
    const result = await tools["submit_outcome"]!.handler({
      runId: "run-1",
      outcome: "success",
      metrics: JSON.stringify({ testPassRate: 0.95 }),
    }) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("all tools have valid MCP schema", () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.name, `${name} name`).toBeTruthy();
      expect(tool.description.length, `${name} description`).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

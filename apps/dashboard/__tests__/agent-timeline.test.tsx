import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mock next/navigation (required for any component that uses usePathname) ──
vi.mock("next/navigation", () => ({
  usePathname: () => "/products/prod-auth-service/lifecycle/run-demo-001/timeline",
}));

// ── Imports under test ────────────────────────────────────────────────────────
import { AgentDAG } from "../app/(dashboard)/products/[id]/lifecycle/[runId]/timeline/AgentDAG";
import { AgentDetailPanel } from "../app/(dashboard)/products/[id]/lifecycle/[runId]/timeline/AgentDetailPanel";
import { AgentGantt } from "../app/(dashboard)/products/[id]/lifecycle/[runId]/timeline/AgentGantt";
import { RunSummaryHeader } from "../app/(dashboard)/products/[id]/lifecycle/[runId]/timeline/RunSummaryHeader";
import AgentTimelinePage from "../app/(dashboard)/products/[id]/lifecycle/[runId]/timeline/page";
import { mockTimelineData } from "../app/(dashboard)/products/[id]/lifecycle/[runId]/timeline/mock-data";
import type { AgentRunRecord, LifecycleRunSummary } from "../app/(dashboard)/products/[id]/lifecycle/[runId]/timeline/types";

// ── Shared fixtures ───────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentRunRecord>): AgentRunRecord {
  return {
    agentId: "agent-test-id",
    agentName: "TestAgent",
    status: "PENDING",
    eventsPublished: [],
    ...overrides,
  };
}

function makeRun(overrides: Partial<LifecycleRunSummary> = {}): LifecycleRunSummary {
  return {
    runId: "run-test-001",
    productId: "prod-test",
    productName: "test-product",
    status: "IN_PROGRESS",
    startedAt: new Date(Date.now() - 120_000).toISOString(), // 2 min ago
    gatesTotal: 4,
    gatesPassed: 2,
    pendingDecisionCount: 0,
    agents: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentDAG
// ─────────────────────────────────────────────────────────────────────────────

describe("AgentDAG", () => {
  it("renders the correct number of nodes for a 10-agent run", () => {
    const run = mockTimelineData();
    render(
      <AgentDAG
        agents={run.agents}
        selectedAgentId={null}
        onSelectAgent={() => {}}
      />,
    );

    // One node button per agent
    const nodes = screen.getAllByTestId(/^dag-node-agent-/);
    expect(nodes.length).toBe(run.agents.length);
  });

  it("completed agent node has green colour class", () => {
    const agents = [
      makeAgent({ agentId: "a1", agentName: "RequirementsAgent", status: "COMPLETED" }),
    ];
    render(
      <AgentDAG agents={agents} selectedAgentId={null} onSelectAgent={() => {}} />,
    );

    const node = screen.getByTestId("dag-node-a1");
    // The circle inside has the bg-green-600 class
    expect(node.innerHTML).toContain("bg-green-600");
  });

  it("running agent node has blue colour class and animate-pulse", () => {
    const agents = [
      makeAgent({ agentId: "a2", agentName: "TestAgent", status: "RUNNING" }),
    ];
    render(
      <AgentDAG agents={agents} selectedAgentId={null} onSelectAgent={() => {}} />,
    );

    const node = screen.getByTestId("dag-node-a2");
    expect(node.innerHTML).toContain("bg-blue-600");
    expect(node.innerHTML).toContain("animate-pulse");
  });

  it("failed agent node has red colour class", () => {
    const agents = [
      makeAgent({ agentId: "a3", agentName: "DeployAgent", status: "FAILED" }),
    ];
    render(
      <AgentDAG agents={agents} selectedAgentId={null} onSelectAgent={() => {}} />,
    );

    const node = screen.getByTestId("dag-node-a3");
    expect(node.innerHTML).toContain("bg-red-600");
  });

  it("AWAITING_APPROVAL agent node has amber colour class", () => {
    const agents = [
      makeAgent({ agentId: "a4", agentName: "DeployAgent", status: "AWAITING_APPROVAL" }),
    ];
    render(
      <AgentDAG agents={agents} selectedAgentId={null} onSelectAgent={() => {}} />,
    );

    const node = screen.getByTestId("dag-node-a4");
    expect(node.innerHTML).toContain("bg-amber-500");
  });

  it("SKIPPED agent node has dotted border class", () => {
    const agents = [
      makeAgent({ agentId: "a5", agentName: "ReviewerAgent", status: "SKIPPED" }),
    ];
    render(
      <AgentDAG agents={agents} selectedAgentId={null} onSelectAgent={() => {}} />,
    );

    const node = screen.getByTestId("dag-node-a5");
    expect(node.innerHTML).toContain("border-dashed");
  });

  it("clicking a node calls onSelectAgent with the agentId", () => {
    const onSelect = vi.fn();
    const agents = [
      makeAgent({ agentId: "a6", agentName: "BuildAgent", status: "COMPLETED" }),
    ];
    render(
      <AgentDAG agents={agents} selectedAgentId={null} onSelectAgent={onSelect} />,
    );

    fireEvent.click(screen.getByTestId("dag-node-a6"));
    expect(onSelect).toHaveBeenCalledWith("a6");
  });

  it("selected node has ring styling", () => {
    const agents = [
      makeAgent({ agentId: "a7", agentName: "BuildAgent", status: "COMPLETED" }),
    ];
    render(
      <AgentDAG agents={agents} selectedAgentId="a7" onSelectAgent={() => {}} />,
    );

    const node = screen.getByTestId("dag-node-a7");
    expect(node.innerHTML).toContain("ring-2");
  });

  it("renders N-1 arrows for N agents", () => {
    const agents = [
      makeAgent({ agentId: "b1", agentName: "A", status: "COMPLETED" }),
      makeAgent({ agentId: "b2", agentName: "B", status: "RUNNING" }),
      makeAgent({ agentId: "b3", agentName: "C", status: "PENDING" }),
    ];
    render(
      <AgentDAG agents={agents} selectedAgentId={null} onSelectAgent={() => {}} />,
    );

    const arrows = screen.getAllByTestId(/^dag-arrow-/);
    expect(arrows.length).toBe(agents.length - 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AgentDetailPanel
// ─────────────────────────────────────────────────────────────────────────────

describe("AgentDetailPanel", () => {
  it("shows agent name in the panel", () => {
    const agent = makeAgent({ agentId: "d1", agentName: "BuildAgent", status: "COMPLETED" });
    render(<AgentDetailPanel agent={agent} onClose={() => {}} />);

    expect(screen.getByTestId("detail-agent-name").textContent).toBe("BuildAgent");
  });

  it("shows duration when agent has completed with durationMs", () => {
    const agent = makeAgent({
      agentId: "d2",
      agentName: "BuildAgent",
      status: "COMPLETED",
      durationMs: 75_000,
      startedAt: new Date(Date.now() - 75_000).toISOString(),
      completedAt: new Date().toISOString(),
    });
    render(<AgentDetailPanel agent={agent} onClose={() => {}} />);

    const duration = screen.getByTestId("detail-duration");
    expect(duration.textContent).toBe("1m 15s");
  });

  it("shows Approve and Reject buttons when status is AWAITING_APPROVAL", () => {
    const agent = makeAgent({
      agentId: "d3",
      agentName: "DeployAgent",
      status: "AWAITING_APPROVAL",
      pendingDecision: {
        id: "dec-001",
        description: "Please review and approve deployment to production.",
        options: ["approve", "reject"],
      },
    });
    render(<AgentDetailPanel agent={agent} onClose={() => {}} />);

    expect(screen.getByTestId("approve-btn-dec-001")).toBeDefined();
    expect(screen.getByTestId("reject-btn-dec-001")).toBeDefined();
    expect(screen.getByTestId("approve-btn-dec-001").textContent).toContain("Approve");
    expect(screen.getByTestId("reject-btn-dec-001").textContent).toContain("Reject");
  });

  it("does NOT show Approve/Reject buttons when status is COMPLETED", () => {
    const agent = makeAgent({ agentId: "d4", agentName: "BuildAgent", status: "COMPLETED" });
    render(<AgentDetailPanel agent={agent} onClose={() => {}} />);

    expect(screen.queryByTestId("detail-pending-decision")).toBeNull();
  });

  it("shows pending decision description text", () => {
    const agent = makeAgent({
      agentId: "d5",
      agentName: "DeployAgent",
      status: "AWAITING_APPROVAL",
      pendingDecision: {
        id: "dec-002",
        description: "Staging smoke tests passed. Approve to deploy to production.",
        options: ["approve", "reject"],
      },
    });
    render(<AgentDetailPanel agent={agent} onClose={() => {}} />);

    expect(screen.getByText(/Staging smoke tests passed/i)).toBeDefined();
  });

  it("shows LLM stats when provided", () => {
    const agent = makeAgent({
      agentId: "d6",
      agentName: "RequirementsAgent",
      status: "COMPLETED",
      llmCallCount: 3,
      totalTokens: 4_500,
    });
    render(<AgentDetailPanel agent={agent} onClose={() => {}} />);

    expect(screen.getByTestId("detail-llm-stats")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("shows events published list when present", () => {
    const agent = makeAgent({
      agentId: "d7",
      agentName: "BuildAgent",
      status: "COMPLETED",
      eventsPublished: ["archibald.lifecycle:build.completed"],
    });
    render(<AgentDetailPanel agent={agent} onClose={() => {}} />);

    expect(screen.getByTestId("detail-events")).toBeDefined();
    expect(screen.getByText("archibald.lifecycle:build.completed")).toBeDefined();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    const agent = makeAgent({ agentId: "d8", agentName: "TestAgent", status: "PENDING" });
    render(<AgentDetailPanel agent={agent} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("detail-close-btn"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows input JSON viewer when input is present", () => {
    const agent = makeAgent({
      agentId: "d9",
      agentName: "ScanGateAgent",
      status: "COMPLETED",
      input: { sentinelRunId: "run-abc" },
      output: { maxSeverity: "LOW" },
    });
    render(<AgentDetailPanel agent={agent} onClose={() => {}} />);

    expect(screen.getByTestId("detail-input")).toBeDefined();
    expect(screen.getByTestId("detail-output")).toBeDefined();
  });

  it("shows error message when status is FAILED", () => {
    const agent = makeAgent({
      agentId: "d10",
      agentName: "DeployAgent",
      status: "FAILED",
      error: "Deployment timed out after 300s",
    });
    render(<AgentDetailPanel agent={agent} onClose={() => {}} />);

    expect(screen.getByTestId("detail-error")).toBeDefined();
    expect(screen.getByText(/Deployment timed out/i)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AgentGantt
// ─────────────────────────────────────────────────────────────────────────────

describe("AgentGantt", () => {
  it("renders one row per agent", () => {
    const run = mockTimelineData();
    render(
      <AgentGantt
        agents={run.agents}
        runStartedAt={run.startedAt}
        runStatus={run.status}
      />,
    );

    const rows = screen.getAllByTestId(/^gantt-row-/);
    expect(rows.length).toBe(run.agents.length);
  });

  it("renders a bar for each agent", () => {
    const run = mockTimelineData();
    render(
      <AgentGantt
        agents={run.agents}
        runStartedAt={run.startedAt}
        runStatus={run.status}
      />,
    );

    const bars = screen.getAllByTestId(/^gantt-bar-/);
    expect(bars.length).toBe(run.agents.length);
  });

  it("completed agent bar uses green background color", () => {
    const start = new Date(Date.now() - 60_000).toISOString();
    const agents: AgentRunRecord[] = [
      {
        agentId: "g1",
        agentName: "RequirementsAgent",
        status: "COMPLETED",
        startedAt: start,
        completedAt: new Date(Date.now() - 15_000).toISOString(),
        durationMs: 45_000,
        eventsPublished: [],
      },
    ];
    render(
      <AgentGantt
        agents={agents}
        runStartedAt={start}
        runStatus="COMPLETED"
      />,
    );

    const bar = screen.getByTestId("gantt-bar-g1");
    // jsdom converts hex to rgb() in inline styles
    const style = bar.getAttribute("style") ?? "";
    expect(style).toMatch(/background-color:\s*rgb\(16,\s*185,\s*129\)/);
  });

  it("running agent bar uses blue background color", () => {
    const start = new Date(Date.now() - 30_000).toISOString();
    const agents: AgentRunRecord[] = [
      {
        agentId: "g2",
        agentName: "TestAgent",
        status: "RUNNING",
        startedAt: start,
        eventsPublished: [],
      },
    ];
    render(
      <AgentGantt
        agents={agents}
        runStartedAt={start}
        runStatus="IN_PROGRESS"
      />,
    );

    const bar = screen.getByTestId("gantt-bar-g2");
    // jsdom converts hex to rgb() in inline styles
    const style = bar.getAttribute("style") ?? "";
    expect(style).toMatch(/background-color:\s*rgb\(59,\s*130,\s*246\)/);
  });

  it("failed agent bar uses red background color", () => {
    const start = new Date(Date.now() - 60_000).toISOString();
    const agents: AgentRunRecord[] = [
      {
        agentId: "g3",
        agentName: "DeployAgent",
        status: "FAILED",
        startedAt: start,
        completedAt: new Date(Date.now() - 10_000).toISOString(),
        durationMs: 50_000,
        eventsPublished: [],
      },
    ];
    render(
      <AgentGantt
        agents={agents}
        runStartedAt={start}
        runStatus="FAILED"
      />,
    );

    const bar = screen.getByTestId("gantt-bar-g3");
    // jsdom converts hex to rgb() in inline styles
    const style = bar.getAttribute("style") ?? "";
    expect(style).toMatch(/background-color:\s*rgb\(239,\s*68,\s*68\)/);
  });

  it("AWAITING_APPROVAL bar uses amber background color", () => {
    const start = new Date(Date.now() - 60_000).toISOString();
    const agents: AgentRunRecord[] = [
      {
        agentId: "g4",
        agentName: "DeployAgent",
        status: "AWAITING_APPROVAL",
        eventsPublished: [],
      },
    ];
    render(
      <AgentGantt
        agents={agents}
        runStartedAt={start}
        runStatus="AWAITING_APPROVAL"
      />,
    );

    const bar = screen.getByTestId("gantt-bar-g4");
    // jsdom converts hex to rgb() in inline styles
    const style = bar.getAttribute("style") ?? "";
    expect(style).toMatch(/background-color:\s*rgb\(245,\s*158,\s*11\)/);
  });

  it("shows formatted duration for completed agents", () => {
    const start = new Date(Date.now() - 120_000).toISOString();
    const agents: AgentRunRecord[] = [
      {
        agentId: "g5",
        agentName: "DesignAgent",
        status: "COMPLETED",
        startedAt: start,
        completedAt: new Date(Date.now() - 30_000).toISOString(),
        durationMs: 90_000,
        eventsPublished: [],
      },
    ];
    render(
      <AgentGantt
        agents={agents}
        runStartedAt={start}
        runStatus="COMPLETED"
      />,
    );

    const dur = screen.getByTestId("gantt-duration-g5");
    expect(dur.textContent).toBe("1m 30s");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RunSummaryHeader
// ─────────────────────────────────────────────────────────────────────────────

describe("RunSummaryHeader", () => {
  it("shows product name", () => {
    const run = makeRun({ productName: "auth-service" });
    render(<RunSummaryHeader run={run} />);

    expect(screen.getByText("auth-service")).toBeDefined();
  });

  it("shows correct gates passed count", () => {
    const run = makeRun({ gatesTotal: 4, gatesPassed: 3 });
    render(<RunSummaryHeader run={run} />);

    expect(screen.getByTestId("run-gates").textContent).toBe("3 / 4 passed");
  });

  it("shows total duration for COMPLETED run", () => {
    const startedAt = new Date(Date.now() - 154_000).toISOString(); // 2m 34s ago
    const completedAt = new Date().toISOString();
    const run = makeRun({ status: "COMPLETED", startedAt, completedAt });
    render(<RunSummaryHeader run={run} />);

    const duration = screen.getByTestId("run-duration");
    // Should be "2m 34s" or similar (allow ±1s of timing variance in CI)
    expect(duration.textContent).toMatch(/\dm \d+s/);
    expect(duration.textContent).not.toContain("In progress");
  });

  it("shows 'In progress' prefix for IN_PROGRESS run", () => {
    const run = makeRun({ status: "IN_PROGRESS" });
    render(<RunSummaryHeader run={run} />);

    expect(screen.getByTestId("run-duration").textContent).toContain("In progress");
  });

  it("shows pending decision badge when count > 0", () => {
    const run = makeRun({ pendingDecisionCount: 2 });
    render(<RunSummaryHeader run={run} />);

    expect(screen.getByTestId("pending-decision-badge").textContent).toBe("2");
  });

  it("does NOT show pending decision badge when count is 0", () => {
    const run = makeRun({ pendingDecisionCount: 0 });
    render(<RunSummaryHeader run={run} />);

    expect(screen.queryByTestId("pending-decision-badge")).toBeNull();
  });

  it("shows IN_PROGRESS blue chip", () => {
    const run = makeRun({ status: "IN_PROGRESS" });
    render(<RunSummaryHeader run={run} />);

    const chip = screen.getByTestId("run-status-chip");
    expect(chip.textContent).toBe("In Progress");
    expect(chip.className).toContain("blue");
  });

  it("shows COMPLETED green chip", () => {
    const run = makeRun({
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
    });
    render(<RunSummaryHeader run={run} />);

    const chip = screen.getByTestId("run-status-chip");
    expect(chip.textContent).toBe("Completed");
    expect(chip.className).toContain("green");
  });

  it("shows FAILED red chip", () => {
    const run = makeRun({ status: "FAILED" });
    render(<RunSummaryHeader run={run} />);

    const chip = screen.getByTestId("run-status-chip");
    expect(chip.textContent).toBe("Failed");
    expect(chip.className).toContain("red");
  });

  it("shows AWAITING_APPROVAL amber chip", () => {
    const run = makeRun({ status: "AWAITING_APPROVAL" });
    render(<RunSummaryHeader run={run} />);

    const chip = screen.getByTestId("run-status-chip");
    expect(chip.textContent).toBe("Awaiting Approval");
    expect(chip.className).toContain("amber");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full AgentTimelinePage integration
// ─────────────────────────────────────────────────────────────────────────────

describe("AgentTimelinePage", () => {
  it("renders the full page without crashing", () => {
    render(<AgentTimelinePage />);
    expect(screen.getByTestId("agent-timeline-page")).toBeDefined();
  });

  it("renders the run summary header", () => {
    render(<AgentTimelinePage />);
    expect(screen.getByTestId("run-summary-header")).toBeDefined();
  });

  it("renders the DAG component", () => {
    render(<AgentTimelinePage />);
    expect(screen.getByTestId("agent-dag")).toBeDefined();
  });

  it("renders the Gantt component", () => {
    render(<AgentTimelinePage />);
    expect(screen.getByTestId("agent-gantt")).toBeDefined();
  });

  it("does NOT show detail panel before any node is clicked", () => {
    render(<AgentTimelinePage />);
    expect(screen.queryByTestId("agent-detail-panel")).toBeNull();
  });

  it("clicking a DAG node reveals the AgentDetailPanel with correct agent name", () => {
    render(<AgentTimelinePage />);

    // Click the RequirementsAgent node
    const node = screen.getByTestId("dag-node-agent-requirements");
    fireEvent.click(node);

    expect(screen.getByTestId("agent-detail-panel")).toBeDefined();
    expect(screen.getByTestId("detail-agent-name").textContent).toBe("RequirementsAgent");
  });

  it("clicking the same node twice closes the detail panel", () => {
    render(<AgentTimelinePage />);

    const node = screen.getByTestId("dag-node-agent-requirements");
    fireEvent.click(node);
    expect(screen.getByTestId("agent-detail-panel")).toBeDefined();

    fireEvent.click(node);
    expect(screen.queryByTestId("agent-detail-panel")).toBeNull();
  });

  it("clicking a different node switches the detail panel to that agent", () => {
    render(<AgentTimelinePage />);

    fireEvent.click(screen.getByTestId("dag-node-agent-requirements"));
    expect(screen.getByTestId("detail-agent-name").textContent).toBe("RequirementsAgent");

    fireEvent.click(screen.getByTestId("dag-node-agent-build"));
    expect(screen.getByTestId("detail-agent-name").textContent).toBe("BuildAgent");
  });

  it("closing the detail panel via the close button hides it", () => {
    render(<AgentTimelinePage />);

    fireEvent.click(screen.getByTestId("dag-node-agent-requirements"));
    expect(screen.getByTestId("agent-detail-panel")).toBeDefined();

    fireEvent.click(screen.getByTestId("detail-close-btn"));
    expect(screen.queryByTestId("agent-detail-panel")).toBeNull();
  });

  it("mock data has 10 agents in the DAG", () => {
    render(<AgentTimelinePage />);
    const nodes = screen.getAllByTestId(/^dag-node-agent-/);
    expect(nodes.length).toBe(10);
  });

  it("mock data has one AWAITING_APPROVAL agent (DeployAgent) with pending decision buttons", () => {
    render(<AgentTimelinePage />);

    // Click the deploy agent
    fireEvent.click(screen.getByTestId("dag-node-agent-deploy"));

    expect(screen.getByTestId("detail-pending-decision")).toBeDefined();
    expect(screen.getByTestId("approve-btn-dec-deploy-001")).toBeDefined();
    expect(screen.getByTestId("reject-btn-dec-deploy-001")).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mockTimelineData
// ─────────────────────────────────────────────────────────────────────────────

describe("mockTimelineData", () => {
  it("returns a LifecycleRunSummary with at least 8 agents", () => {
    const run = mockTimelineData();
    expect(run.agents.length).toBeGreaterThanOrEqual(8);
  });

  it("has at least one COMPLETED agent", () => {
    const run = mockTimelineData();
    expect(run.agents.some((a) => a.status === "COMPLETED")).toBe(true);
  });

  it("has exactly one RUNNING agent", () => {
    const run = mockTimelineData();
    expect(run.agents.filter((a) => a.status === "RUNNING").length).toBe(1);
  });

  it("has exactly one AWAITING_APPROVAL agent with a pendingDecision", () => {
    const run = mockTimelineData();
    const awaiting = run.agents.filter((a) => a.status === "AWAITING_APPROVAL");
    expect(awaiting.length).toBe(1);
    expect(awaiting[0]!.pendingDecision).toBeDefined();
  });

  it("has at least one PENDING agent", () => {
    const run = mockTimelineData();
    expect(run.agents.some((a) => a.status === "PENDING")).toBe(true);
  });

  it("has at least one SKIPPED agent", () => {
    const run = mockTimelineData();
    expect(run.agents.some((a) => a.status === "SKIPPED")).toBe(true);
  });

  it("run startedAt is within the last 10 minutes", () => {
    const run = mockTimelineData();
    const diff = Date.now() - new Date(run.startedAt).getTime();
    expect(diff).toBeLessThan(10 * 60 * 1000);
  });

  it("completed agents have realistic timestamps (30–90s durations)", () => {
    const run = mockTimelineData();
    const completed = run.agents.filter((a) => a.status === "COMPLETED");
    for (const agent of completed) {
      expect(agent.durationMs).toBeDefined();
      expect(agent.durationMs!).toBeGreaterThanOrEqual(30_000);
      expect(agent.durationMs!).toBeLessThanOrEqual(90_000);
    }
  });
});

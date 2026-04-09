"use client";

import { useState } from "react";
import { mockTimelineData } from "./mock-data";
import type { AgentRunRecord, LifecycleRunSummary } from "./types";
import { RunSummaryHeader } from "./RunSummaryHeader";
import { AgentDAG } from "./AgentDAG";
import { AgentDetailPanel } from "./AgentDetailPanel";
import { AgentGantt } from "./AgentGantt";

// In production this would be fetched via GET /v1/products/:id/lifecycle/:runId
function useRunData(): LifecycleRunSummary {
  return mockTimelineData();
}

export default function AgentTimelinePage() {
  const run = useRunData();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const selectedAgent: AgentRunRecord | undefined = run.agents.find(
    (a) => a.agentId === selectedAgentId,
  );

  function handleSelectAgent(agentId: string) {
    setSelectedAgentId((prev) => (prev === agentId ? null : agentId));
  }

  return (
    <div
      className="mx-auto max-w-[1400px] space-y-5"
      data-testid="agent-timeline-page"
    >
      {/* Run Summary Header */}
      <RunSummaryHeader run={run} />

      {/* DAG + Detail Panel side-by-side */}
      <div className="flex gap-5">
        {/* DAG — expands to fill available width */}
        <div className={selectedAgent ? "flex-1 min-w-0" : "w-full"}>
          <AgentDAG
            agents={run.agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={handleSelectAgent}
          />
        </div>

        {/* Detail Panel — slides in when an agent is selected */}
        {selectedAgent && (
          <div className="w-[360px] shrink-0">
            <AgentDetailPanel
              agent={selectedAgent}
              onClose={() => setSelectedAgentId(null)}
            />
          </div>
        )}
      </div>

      {/* Gantt Strip */}
      <AgentGantt
        agents={run.agents}
        runStartedAt={run.startedAt}
        runStatus={run.status}
      />
    </div>
  );
}

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LifecycleTimelinePage from "../app/(dashboard)/products/[id]/lifecycle/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/products/abc123/lifecycle",
}));

describe("LifecycleTimelinePage", () => {
  it("renders the lifecycle timeline", () => {
    render(<LifecycleTimelinePage />);

    const timeline = screen.getByTestId("lifecycle-timeline");
    expect(timeline).toBeDefined();
  });

  it("renders all 11 lifecycle stages", () => {
    render(<LifecycleTimelinePage />);

    const stages = [
      "conception", "requirements", "design", "review", "build",
      "test", "scan", "deploy", "monitor", "live", "evolving",
    ];

    for (const stage of stages) {
      const el = screen.getByTestId(`stage-${stage}`);
      expect(el).toBeDefined();
    }
  });

  it("completed stages show a checkmark", () => {
    render(<LifecycleTimelinePage />);

    // requirements, design, review, build, test are completed (before 'scan' which is current)
    const requirementsBtn = screen.getByTestId("stage-requirements");
    expect(requirementsBtn.textContent).toContain("✓");
  });

  it("current stage has pulsing ring styling", () => {
    render(<LifecycleTimelinePage />);

    // 'scan' is the current stage
    const scanBtn = screen.getByTestId("stage-scan");
    expect(scanBtn.innerHTML).toContain("animate-pulse");
  });

  it("pending decisions section renders with approve and reject buttons", () => {
    render(<LifecycleTimelinePage />);

    const decisionsSection = screen.getByTestId("pending-decisions");
    expect(decisionsSection).toBeDefined();

    // Check for approve/reject buttons
    const approveBtn = screen.getByTestId("approve-dec-scan-001");
    const rejectBtn = screen.getByTestId("reject-dec-scan-001");

    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    expect(approveBtn.textContent).toContain("Approve");
    expect(rejectBtn.textContent).toContain("Reject");
  });

  it("clicking a completed stage expands detail panel", () => {
    render(<LifecycleTimelinePage />);

    // Click on requirements stage (which has mock detail data)
    const requirementsBtn = screen.getByTestId("stage-requirements");
    fireEvent.click(requirementsBtn);

    const detailPanel = screen.getByTestId("stage-detail-panel");
    expect(detailPanel).toBeDefined();
    expect(screen.getByText(/requirements stage details/i)).toBeDefined();
  });

  it("clicking the same stage again collapses the detail panel", () => {
    render(<LifecycleTimelinePage />);

    const requirementsBtn = screen.getByTestId("stage-requirements");
    fireEvent.click(requirementsBtn);

    // Should be visible
    expect(screen.getByTestId("stage-detail-panel")).toBeDefined();

    // Click again to collapse
    fireEvent.click(requirementsBtn);

    // Panel should be gone
    expect(screen.queryByTestId("stage-detail-panel")).toBeNull();
  });

  it("pending decision title is displayed", () => {
    render(<LifecycleTimelinePage />);

    expect(screen.getByText(/SENTINEL scan in progress/i)).toBeDefined();
  });
});

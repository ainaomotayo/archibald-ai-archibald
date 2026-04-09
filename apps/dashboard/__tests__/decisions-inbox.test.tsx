import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DecisionsInboxPage from "../app/(dashboard)/decisions/page";

// Mock fetch for the decide API calls
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ success: true }),
} as Response);

vi.mock("next/navigation", () => ({
  usePathname: () => "/decisions",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("DecisionsInboxPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    render(<DecisionsInboxPage />);
  });

  it("renders the Decisions Inbox heading", () => {
    expect(screen.getByRole("heading", { name: "Decisions Inbox" })).toBeDefined();
  });

  it("renders the page description", () => {
    expect(screen.getByText(/Architecture decisions awaiting your input/i)).toBeDefined();
  });

  it("renders pending count badge with correct number", () => {
    const badge = screen.getByTestId("pending-count-badge");
    expect(badge).toBeDefined();
    // 4 decisions have status "pending" in mock data
    expect(badge.textContent).toContain("4");
  });

  it("renders decision cards with their titles", () => {
    expect(screen.getByText("Use PostgreSQL or MongoDB for user data?")).toBeDefined();
    expect(
      screen.getByText("Requirements clarification: real-time vs. batch reporting?"),
    ).toBeDefined();
  });

  it("renders priority badge for critical decision", () => {
    const badge = screen.getByTestId("priority-badge-dec-001");
    expect(badge).toBeDefined();
    expect(badge.textContent?.toLowerCase()).toContain("critical");
  });

  it("critical priority badge has red styling", () => {
    const badge = screen.getByTestId("priority-badge-dec-001");
    // Check for red class
    expect(badge.className).toContain("red");
  });

  it("renders options with pros and cons", () => {
    // PostgreSQL option pros
    expect(screen.getByText("ACID compliance")).toBeDefined();
    // PostgreSQL option cons
    expect(screen.getByText("More complex schema migrations")).toBeDefined();
    // MongoDB option pros
    expect(screen.getByText("Flexible schema")).toBeDefined();
  });

  it("marks recommended option with AI recommended badge", () => {
    // dec-001 recommends opt-pg (PostgreSQL)
    const badge = screen.getByTestId("recommended-badge-dec-001-opt-pg");
    expect(badge).toBeDefined();
    expect(badge.textContent?.toLowerCase()).toContain("recommended");
  });

  it("recommended option radio is pre-selected", () => {
    const radio = screen.getByTestId("radio-dec-001-opt-pg") as HTMLInputElement;
    expect(radio.checked).toBe(true);
  });

  it("Approve Selected button is present for pending decisions", () => {
    const approveBtn = screen.getByTestId("approve-btn-dec-001");
    expect(approveBtn).toBeDefined();
    expect(approveBtn.textContent).toContain("Approve");
  });

  it("Approve Selected is enabled when an option is selected", () => {
    const approveBtn = screen.getByTestId("approve-btn-dec-001") as HTMLButtonElement;
    // Recommended option is pre-selected so button should be enabled
    expect(approveBtn.disabled).toBe(false);
  });

  it("Defer button is present for pending decisions", () => {
    const deferBtn = screen.getByTestId("defer-btn-dec-001");
    expect(deferBtn).toBeDefined();
    expect(deferBtn.textContent).toContain("Defer");
  });

  it("Reject button is present for pending decisions", () => {
    const rejectBtn = screen.getByTestId("reject-btn-dec-001");
    expect(rejectBtn).toBeDefined();
    expect(rejectBtn.textContent).toContain("Reject");
  });

  it("clicking Reject reveals reason textarea", () => {
    const rejectBtn = screen.getByTestId("reject-btn-dec-001");
    fireEvent.click(rejectBtn);

    const textarea = screen.getByTestId("reject-reason-dec-001");
    expect(textarea).toBeDefined();
  });

  it("renders all filter tabs", () => {
    expect(screen.getByTestId("decisions-filter-all")).toBeDefined();
    expect(screen.getByTestId("decisions-filter-pending")).toBeDefined();
    expect(screen.getByTestId("decisions-filter-critical")).toBeDefined();
    expect(screen.getByTestId("decisions-filter-decided")).toBeDefined();
    expect(screen.getByTestId("decisions-filter-deferred")).toBeDefined();
  });

  it("Pending filter hides decided records", () => {
    const pendingFilter = screen.getByTestId("decisions-filter-pending");
    fireEvent.click(pendingFilter);

    // "Migrate from Stripe API v1 to v2?" has status "decided" — should be hidden
    expect(screen.queryByText("Migrate from Stripe API v1 to v2?")).toBeNull();
  });

  it("Critical filter shows only critical priority decisions", () => {
    const criticalFilter = screen.getByTestId("decisions-filter-critical");
    fireEvent.click(criticalFilter);

    // dec-001 is critical
    expect(screen.getByText("Use PostgreSQL or MongoDB for user data?")).toBeDefined();

    // dec-002 is medium — should be hidden
    expect(
      screen.queryByText("Requirements clarification: real-time vs. batch reporting?"),
    ).toBeNull();
  });

  it("Deferred filter shows only deferred decisions", () => {
    const deferredFilter = screen.getByTestId("decisions-filter-deferred");
    fireEvent.click(deferredFilter);

    // dec-005 is deferred
    expect(
      screen.getByText("Use AWS SNS or self-hosted Redis pub/sub for notifications?"),
    ).toBeDefined();

    // dec-001 is pending — should be hidden
    expect(screen.queryByText("Use PostgreSQL or MongoDB for user data?")).toBeNull();
  });

  it("search filters decisions by title", () => {
    const searchInput = screen.getByTestId("decisions-search");
    fireEvent.change(searchInput, { target: { value: "PostgreSQL" } });

    expect(screen.getByText("Use PostgreSQL or MongoDB for user data?")).toBeDefined();
    expect(
      screen.queryByText("Requirements clarification: real-time vs. batch reporting?"),
    ).toBeNull();
  });

  it("shows empty state when no decisions match filter + search", () => {
    const searchInput = screen.getByTestId("decisions-search");
    fireEvent.change(searchInput, { target: { value: "xyznonexistent999" } });

    expect(screen.getByTestId("decisions-empty-state")).toBeDefined();
  });

  it("Defer button triggers optimistic update — decision moves to deferred", () => {
    const deferBtn = screen.getByTestId("defer-btn-dec-001");
    fireEvent.click(deferBtn);

    // After deferring, the "decided"/"deferred" badge should appear on the card
    // and action buttons should disappear
    expect(screen.queryByTestId("defer-btn-dec-001")).toBeNull();
  });

  it("clicking Approve triggers optimistic update — action buttons disappear", () => {
    const approveBtn = screen.getByTestId("approve-btn-dec-003");
    fireEvent.click(approveBtn);

    expect(screen.queryByTestId("approve-btn-dec-003")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EcosystemOverviewPage from "../app/(dashboard)/page";

// Mock Next.js Link component
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("EcosystemOverviewPage", () => {
  it("renders all 5 solution health cards", () => {
    render(<EcosystemOverviewPage />);

    const grid = screen.getByTestId("solution-health-grid");
    expect(grid).toBeDefined();

    const solutionIds = ["sentinel", "archintel", "phoenix", "forge", "archibald"];
    for (const id of solutionIds) {
      const card = screen.getByTestId(`solution-card-${id}`);
      expect(card).toBeDefined();
    }
  });

  it("displays all solution names", () => {
    render(<EcosystemOverviewPage />);

    expect(screen.getByText("SENTINEL")).toBeDefined();
    expect(screen.getByText("ARCHINTEL")).toBeDefined();
    expect(screen.getByText("PHOENIX")).toBeDefined();
    expect(screen.getByText("FORGE")).toBeDefined();
    expect(screen.getByText("ARCHIBALD")).toBeDefined();
  });

  it("each solution card has a status indicator", () => {
    render(<EcosystemOverviewPage />);

    const solutionIds = ["sentinel", "archintel", "phoenix", "forge", "archibald"];
    for (const id of solutionIds) {
      const status = screen.getByTestId(`solution-status-${id}`);
      expect(status).toBeDefined();
    }
  });

  it("renders active lifecycle runs table", () => {
    render(<EcosystemOverviewPage />);

    const table = screen.getByTestId("active-runs-table");
    expect(table).toBeDefined();

    // Check known mock products appear (getAllByText handles duplicate elements in table/badges)
    expect(screen.getAllByText("auth-service").length).toBeGreaterThan(0);
    expect(screen.getAllByText("billing-api").length).toBeGreaterThan(0);
    expect(screen.getAllByText("notification-worker").length).toBeGreaterThan(0);
  });

  it("renders pending decisions list", () => {
    render(<EcosystemOverviewPage />);

    const decisions = screen.getByTestId("pending-decisions-list");
    expect(decisions).toBeDefined();
  });

  it("renders self-evolution alert", () => {
    render(<EcosystemOverviewPage />);

    const alert = screen.getByTestId("self-evolution-alert");
    expect(alert).toBeDefined();
    expect(screen.getByText(/PostgreSQL over MongoDB/i)).toBeDefined();
  });

  it("displays lifecycle stages as badges", () => {
    render(<EcosystemOverviewPage />);

    expect(screen.getByText("scan")).toBeDefined();
    expect(screen.getByText("review")).toBeDefined();
    expect(screen.getByText("build")).toBeDefined();
  });
});

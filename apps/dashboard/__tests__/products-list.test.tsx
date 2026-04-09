import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProductsListPage from "../app/(dashboard)/products/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/products",
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

describe("ProductsListPage", () => {
  beforeEach(() => {
    render(<ProductsListPage />);
  });

  it("renders the Products heading", () => {
    expect(screen.getByRole("heading", { name: "Products" })).toBeDefined();
  });

  it("renders filter tab: All", () => {
    expect(screen.getByTestId("filter-tab-all")).toBeDefined();
    expect(screen.getByTestId("filter-tab-all").textContent).toBe("All");
  });

  it("renders filter tab: Active Builds", () => {
    expect(screen.getByTestId("filter-tab-active-builds")).toBeDefined();
    expect(screen.getByTestId("filter-tab-active-builds").textContent).toBe("Active Builds");
  });

  it("renders filter tab: Pending Decisions", () => {
    expect(screen.getByTestId("filter-tab-pending-decisions")).toBeDefined();
    expect(screen.getByTestId("filter-tab-pending-decisions").textContent).toBe(
      "Pending Decisions",
    );
  });

  it("renders filter tab: In Production", () => {
    expect(screen.getByTestId("filter-tab-in-production")).toBeDefined();
    expect(screen.getByTestId("filter-tab-in-production").textContent).toBe("In Production");
  });

  it("renders the search input", () => {
    expect(screen.getByTestId("search-input")).toBeDefined();
  });

  it("renders the sort dropdown", () => {
    const select = screen.getByTestId("sort-select");
    expect(select).toBeDefined();
  });

  it("renders product cards with product name", () => {
    expect(screen.getByText("auth-service")).toBeDefined();
    expect(screen.getByText("billing-api")).toBeDefined();
    expect(screen.getByText("notification-worker")).toBeDefined();
  });

  it("renders health dot for each product card", () => {
    const healthDot = screen.getByTestId("health-dot-prod-001");
    expect(healthDot).toBeDefined();
  });

  it("renders lifecycle stage progress bar for each product", () => {
    const progressBars = screen.getAllByTestId("lifecycle-progress-bar");
    expect(progressBars.length).toBeGreaterThan(0);
  });

  it("progress bar highlights current stage label", () => {
    const currentLabels = screen.getAllByTestId("stage-label-current");
    expect(currentLabels.length).toBeGreaterThan(0);
  });

  it("renders pending decisions badge when pendingDecisions > 0", () => {
    // auth-service has 3 pending decisions
    const badge = screen.getByTestId("decisions-badge-prod-001");
    expect(badge).toBeDefined();
    expect(badge.textContent).toContain("3");
  });

  it("does NOT render pending decisions badge when pendingDecisions === 0", () => {
    // notification-worker has 0 pending decisions
    const badge = screen.queryByTestId("decisions-badge-prod-003");
    expect(badge).toBeNull();
  });

  it("Active Builds filter shows only build/test stage products", () => {
    const filterBtn = screen.getByTestId("filter-tab-active-builds");
    fireEvent.click(filterBtn);

    // Should show auth-service (build) and billing-api (test) and notification-worker (build)
    expect(screen.getByText("auth-service")).toBeDefined();
    expect(screen.getByText("billing-api")).toBeDefined();
    expect(screen.getByText("notification-worker")).toBeDefined();

    // Should NOT show payment-service (monitor)
    expect(screen.queryByText("payment-service")).toBeNull();
  });

  it("In Production filter shows only monitor stage products", () => {
    const filterBtn = screen.getByTestId("filter-tab-in-production");
    fireEvent.click(filterBtn);

    // Should show payment-service (monitor) and analytics-platform (monitor)
    expect(screen.getByText("payment-service")).toBeDefined();
    expect(screen.getByText("analytics-platform")).toBeDefined();

    // Should NOT show auth-service (build)
    expect(screen.queryByText("auth-service")).toBeNull();
  });

  it("Pending Decisions filter shows only products with pending decisions", () => {
    const filterBtn = screen.getByTestId("filter-tab-pending-decisions");
    fireEvent.click(filterBtn);

    // notification-worker has 0 pending decisions — should be hidden
    expect(screen.queryByText("notification-worker")).toBeNull();
  });

  it("search input filters products by name", () => {
    const searchInput = screen.getByTestId("search-input");
    fireEvent.change(searchInput, { target: { value: "billing" } });

    expect(screen.getByText("billing-api")).toBeDefined();
    expect(screen.queryByText("auth-service")).toBeNull();
  });

  it("sort by Name A-Z changes order — first card is alphabetically first", () => {
    const sortSelect = screen.getByTestId("sort-select");
    fireEvent.change(sortSelect, { target: { value: "name-az" } });

    const grid = screen.getByTestId("products-grid");
    const firstCard = grid.querySelector("[data-testid^='product-card-']");
    expect(firstCard).toBeDefined();
    // analytics-platform is alphabetically first among mock products
    expect(firstCard!.textContent).toContain("analytics-platform");
  });

  it("shows a count of products in the footer", () => {
    expect(screen.getByText(/Showing \d+ of \d+ products/)).toBeDefined();
  });
});

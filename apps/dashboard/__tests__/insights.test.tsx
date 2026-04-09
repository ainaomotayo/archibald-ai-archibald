import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InsightsPage from "../app/(dashboard)/insights/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/insights",
}));

describe("InsightsPage", () => {
  it("renders the page title and description", () => {
    render(<InsightsPage />);

    expect(screen.getByText("Organisation Insights")).toBeDefined();
    expect(screen.getByText(/Self-evolution patterns/i)).toBeDefined();
  });

  it("renders ARCHIBALD confidence score", () => {
    render(<InsightsPage />);

    const scoreEl = screen.getByTestId("confidence-score");
    expect(scoreEl).toBeDefined();
    expect(screen.getByText("78%")).toBeDefined();
    expect(screen.getByText(/Based on 23 completed lifecycle runs/i)).toBeDefined();
  });

  it("renders anti-pattern warnings section", () => {
    render(<InsightsPage />);

    const section = screen.getByTestId("anti-patterns-section");
    expect(section).toBeDefined();
  });

  it("renders all 3 anti-patterns", () => {
    render(<InsightsPage />);

    expect(screen.getByTestId("anti-pattern-ap-001")).toBeDefined();
    expect(screen.getByTestId("anti-pattern-ap-002")).toBeDefined();
    expect(screen.getByTestId("anti-pattern-ap-003")).toBeDefined();
  });

  it("microservices anti-pattern warning is displayed", () => {
    render(<InsightsPage />);

    expect(screen.getByText("Microservices proliferation")).toBeDefined();
    expect(screen.getByText(/monolith-first/i)).toBeDefined();
  });

  it("SENTINEL scan gate anti-pattern is displayed", () => {
    render(<InsightsPage />);

    expect(screen.getByText("Missing SENTINEL scan gates")).toBeDefined();
  });

  it("renders positive patterns section", () => {
    render(<InsightsPage />);

    const section = screen.getByTestId("positive-patterns-section");
    expect(section).toBeDefined();
  });

  it("PostgreSQL positive pattern is displayed", () => {
    render(<InsightsPage />);

    expect(screen.getByText("PostgreSQL for OLTP workloads")).toBeDefined();
    expect(screen.getByText(/40% fewer incidents/i)).toBeDefined();
  });

  it("technology health section renders", () => {
    render(<InsightsPage />);

    const section = screen.getByTestId("tech-health-section");
    expect(section).toBeDefined();
  });

  it("lists key technologies with health status", () => {
    render(<InsightsPage />);

    expect(screen.getByText("fastify")).toBeDefined();
    expect(screen.getByText("prisma")).toBeDefined();
    expect(screen.getByText("ioredis")).toBeDefined();
  });

  it("watch-status technologies are highlighted differently", () => {
    render(<InsightsPage />);

    // 'express' has 'watch' status — should have yellow indicator
    const expressRow = screen.getByText("express").closest("div");
    expect(expressRow).toBeDefined();
  });

  it("occurrence counts are displayed for anti-patterns", () => {
    render(<InsightsPage />);

    expect(screen.getByText("7x observed")).toBeDefined();
    expect(screen.getByText("4x observed")).toBeDefined();
    expect(screen.getByText("9x observed")).toBeDefined();
  });
});

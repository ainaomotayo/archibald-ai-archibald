import { describe, it, expect, beforeEach } from "vitest";
import {
  colourSeverity,
  colourStatus,
  renderTable,
  section,
  kv,
  renderStageBar,
  verdictBanner,
  initFormat,
} from "../format.js";

// Strip ANSI codes so we can assert on plain content regardless of chalk availability
function strip(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// Warm up chalk before tests
beforeEach(async () => {
  await initFormat();
});

// ── colourSeverity ─────────────────────────────────────────────────────────────

describe("colourSeverity", () => {
  it("returns CRITICAL in uppercase", () => {
    expect(strip(colourSeverity("critical"))).toBe("CRITICAL");
  });

  it("handles already-uppercase input", () => {
    expect(strip(colourSeverity("CRITICAL"))).toBe("CRITICAL");
  });

  it("returns HIGH in uppercase", () => {
    expect(strip(colourSeverity("high"))).toBe("HIGH");
  });

  it("returns MEDIUM in uppercase", () => {
    expect(strip(colourSeverity("medium"))).toBe("MEDIUM");
  });

  it("returns LOW in uppercase", () => {
    expect(strip(colourSeverity("low"))).toBe("LOW");
  });

  it("returns unknown severity as-is (dimmed)", () => {
    expect(strip(colourSeverity("info"))).toBe("info");
  });

  it("is case-insensitive for matching", () => {
    expect(strip(colourSeverity("High"))).toBe("HIGH");
    expect(strip(colourSeverity("MEDIUM"))).toBe("MEDIUM");
  });
});

// ── colourStatus ───────────────────────────────────────────────────────────────

describe("colourStatus", () => {
  it("colours completed as green", () => {
    // We just assert the text is present — colour depends on chalk availability
    expect(strip(colourStatus("completed"))).toBe("completed");
  });

  it("colours healthy as green", () => {
    expect(strip(colourStatus("healthy"))).toBe("healthy");
  });

  it("colours pass as green", () => {
    expect(strip(colourStatus("pass"))).toBe("pass");
  });

  it("colours resolved as green", () => {
    expect(strip(colourStatus("resolved"))).toBe("resolved");
  });

  it("colours running as cyan", () => {
    expect(strip(colourStatus("running"))).toBe("running");
  });

  it("colours diagnosing as cyan", () => {
    expect(strip(colourStatus("diagnosing"))).toBe("diagnosing");
  });

  it("colours fixing as cyan", () => {
    expect(strip(colourStatus("fixing"))).toBe("fixing");
  });

  it("colours waiting as yellow", () => {
    expect(strip(colourStatus("waiting"))).toBe("waiting");
  });

  it("colours warn as yellow", () => {
    expect(strip(colourStatus("warn"))).toBe("warn");
  });

  it("colours failed as red", () => {
    expect(strip(colourStatus("failed"))).toBe("failed");
  });

  it("colours fail as red", () => {
    expect(strip(colourStatus("fail"))).toBe("fail");
  });

  it("colours open as red", () => {
    expect(strip(colourStatus("open"))).toBe("open");
  });

  it("returns unknown status as-is", () => {
    expect(strip(colourStatus("pending"))).toBe("pending");
  });

  it("is case-insensitive", () => {
    expect(strip(colourStatus("COMPLETED"))).toBe("COMPLETED");
    expect(strip(colourStatus("Running"))).toBe("Running");
  });
});

// ── section ────────────────────────────────────────────────────────────────────

describe("section", () => {
  it("contains the title text", () => {
    expect(strip(section("Hello World"))).toContain("Hello World");
  });

  it("starts with a newline", () => {
    expect(section("Test")).toMatch(/^\n/);
  });

  it("includes a divider line of dashes matching title length", () => {
    const title = "My Section";
    const output = strip(section(title));
    // The divider should be a line of '─' characters with the same length as the title
    expect(output).toContain("─".repeat(title.length));
  });

  it("handles empty title", () => {
    const output = section("");
    expect(output).toBeDefined();
    expect(typeof output).toBe("string");
  });
});

// ── kv ─────────────────────────────────────────────────────────────────────────

describe("kv", () => {
  it("renders key-value pairs", () => {
    const output = strip(kv([["Product", "my-app"], ["Stage", "design"]]));
    expect(output).toContain("Product");
    expect(output).toContain("my-app");
    expect(output).toContain("Stage");
    expect(output).toContain("design");
  });

  it("aligns keys to the same width", () => {
    const output = strip(kv([["Short", "v1"], ["LongerKey", "v2"]]));
    const lines = output.split("\n");
    expect(lines).toHaveLength(2);
    // Both lines should have the value starting at the same column
    const col1 = lines[0]!.indexOf("v1");
    const col2 = lines[1]!.indexOf("v2");
    expect(col1).toBe(col2);
  });

  it("handles a single pair", () => {
    const output = strip(kv([["Key", "Value"]]));
    expect(output).toContain("Key");
    expect(output).toContain("Value");
  });

  it("handles empty pairs array", () => {
    const output = kv([]);
    expect(output).toBe("");
  });
});

// ── renderTable ─────────────────────────────────────────────────────────────────

describe("renderTable", () => {
  const columns = [
    { key: "id", header: "ID", width: 10 },
    { key: "name", header: "Name", width: 20 },
    { key: "status", header: "Status", width: 10 },
  ];

  it("renders header row", () => {
    const output = strip(
      renderTable([{ id: "1", name: "Alice", status: "active" }], columns),
    );
    expect(output).toContain("ID");
    expect(output).toContain("Name");
    expect(output).toContain("Status");
  });

  it("renders a divider line", () => {
    const output = strip(
      renderTable([{ id: "1", name: "Alice", status: "active" }], columns),
    );
    expect(output).toContain("─");
  });

  it("renders data rows", () => {
    const output = strip(
      renderTable([{ id: "abc-123", name: "Bob", status: "ok" }], columns),
    );
    expect(output).toContain("abc-123");
    expect(output).toContain("Bob");
    expect(output).toContain("ok");
  });

  it("renders multiple rows", () => {
    const rows = [
      { id: "1", name: "Alice", status: "open" },
      { id: "2", name: "Bob", status: "closed" },
    ];
    const output = strip(renderTable(rows, columns));
    expect(output).toContain("Alice");
    expect(output).toContain("Bob");
  });

  it("returns a no-results message for empty rows", () => {
    const output = strip(renderTable([], columns));
    expect(output).toContain("no results");
  });

  it("handles missing keys gracefully (treats as empty string)", () => {
    const output = strip(
      renderTable([{ id: "1" } as Record<string, string>], columns),
    );
    expect(output).toContain("1");
  });

  it("handles ANSI-coloured values in cells", () => {
    // Coloured value should still render correctly
    const coloured = colourSeverity("high");
    const output = strip(
      renderTable([{ id: "1", name: "Test", status: coloured }], [
        { key: "id", header: "ID", width: 5 },
        { key: "name", header: "Name", width: 10 },
        { key: "status", header: "Status", width: 10 },
      ]),
    );
    expect(output).toContain("HIGH");
  });
});

// ── renderStageBar ─────────────────────────────────────────────────────────────

describe("renderStageBar", () => {
  it("includes all 8 canonical stage names", () => {
    const output = strip(renderStageBar("design", "running"));
    const stages = [
      "requirements",
      "design",
      "planning",
      "implementation",
      "testing",
      "review",
      "deployment",
      "monitoring",
    ];
    for (const stage of stages) {
      expect(output).toContain(stage);
    }
  });

  it("marks completed stages with a checkmark", () => {
    // When current stage is 'design', 'requirements' should be complete
    const output = strip(renderStageBar("design", "running"));
    // requirements comes before design, should have [✓]
    const reqIdx = output.indexOf("requirements");
    const checkIdx = output.lastIndexOf("[✓]", reqIdx);
    expect(checkIdx).toBeGreaterThanOrEqual(0);
    expect(checkIdx).toBeLessThan(reqIdx);
  });

  it("marks current stage with arrow when running", () => {
    const output = strip(renderStageBar("planning", "running"));
    // The [→] marker should appear before 'planning'
    const planIdx = output.indexOf("planning");
    const arrowIdx = output.lastIndexOf("[→]", planIdx);
    expect(arrowIdx).toBeGreaterThanOrEqual(0);
    expect(arrowIdx).toBeLessThan(planIdx);
  });

  it("marks current stage with checkmark when completed", () => {
    const output = strip(renderStageBar("testing", "completed"));
    // [→] should NOT appear at all; instead [✓] before 'testing'
    expect(output).not.toContain("[→]");
    const testIdx = output.indexOf("testing");
    const checkIdx = output.lastIndexOf("[✓]", testIdx);
    expect(checkIdx).toBeLessThan(testIdx);
    expect(checkIdx).toBeGreaterThanOrEqual(0);
  });

  it("marks future stages with empty brackets", () => {
    const output = strip(renderStageBar("requirements", "running"));
    // 'monitoring' is last and should be pending
    expect(output).toContain("[ ] monitoring");
  });

  it("handles unknown stage without throwing", () => {
    expect(() => renderStageBar("unknown-stage", "running")).not.toThrow();
  });
});

// ── verdictBanner ──────────────────────────────────────────────────────────────

describe("verdictBanner", () => {
  it("contains PASS for pass verdict", () => {
    expect(strip(verdictBanner("pass"))).toContain("PASS");
  });

  it("contains FAIL for fail verdict", () => {
    expect(strip(verdictBanner("fail"))).toContain("FAIL");
  });

  it("contains WARN for warn verdict", () => {
    expect(strip(verdictBanner("warn"))).toContain("WARN");
  });

  it("is case-insensitive (PASS / pass / Pass)", () => {
    expect(strip(verdictBanner("PASS"))).toContain("PASS");
    expect(strip(verdictBanner("Pass"))).toContain("PASS");
  });

  it("outputs unknown verdict as-is", () => {
    expect(strip(verdictBanner("unknown"))).toContain("unknown");
  });

  it("output contains a newline for spacing", () => {
    expect(verdictBanner("pass")).toContain("\n");
  });
});

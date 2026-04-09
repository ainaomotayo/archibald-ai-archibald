/**
 * Table and color formatting helpers for the ARCHIBALD CLI.
 * Uses chalk when available, falls back to plain text.
 */

// ── Chalk shim ────────────────────────────────────────────────────────────────

let _chalk: {
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  red: (s: string) => string;
  cyan: (s: string) => string;
  magenta: (s: string) => string;
  blue: (s: string) => string;
  white: (s: string) => string;
} | null = null;

async function getChalk() {
  if (_chalk) return _chalk;
  try {
    const chalk = await import("chalk");
    const c = chalk.default ?? (chalk as unknown as typeof chalk.default);
    _chalk = {
      bold: (s) => c.bold(s),
      dim: (s) => c.dim(s),
      green: (s) => c.green(s),
      yellow: (s) => c.yellow(s),
      red: (s) => c.red(s),
      cyan: (s) => c.cyan(s),
      magenta: (s) => c.magenta(s),
      blue: (s) => c.blue(s),
      white: (s) => c.white(s),
    };
  } catch {
    // Plain-text fallback — all styling is a no-op
    const id = (s: string) => s;
    _chalk = {
      bold: id, dim: id, green: id, yellow: id, red: id,
      cyan: id, magenta: id, blue: id, white: id,
    };
  }
  return _chalk;
}

// ── Sync colour helpers (used after getChalk() has been called once) ──────────

const plain = {
  bold: (s: string) => s,
  dim: (s: string) => s,
  green: (s: string) => s,
  yellow: (s: string) => s,
  red: (s: string) => s,
  cyan: (s: string) => s,
  magenta: (s: string) => s,
  blue: (s: string) => s,
  white: (s: string) => s,
};

function c() {
  return _chalk ?? plain;
}

// ── Severity → colour ─────────────────────────────────────────────────────────

export function colourSeverity(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical": return c().red(severity.toUpperCase());
    case "high":     return c().red(severity.toUpperCase());
    case "medium":   return c().yellow(severity.toUpperCase());
    case "low":      return c().cyan(severity.toUpperCase());
    default:         return c().dim(severity);
  }
}

export function colourStatus(status: string): string {
  switch (status.toLowerCase()) {
    case "completed":
    case "healthy":
    case "pass":
    case "resolved":  return c().green(status);
    case "running":
    case "diagnosing":
    case "fixing":    return c().cyan(status);
    case "waiting":
    case "warn":      return c().yellow(status);
    case "failed":
    case "fail":
    case "open":      return c().red(status);
    default:          return status;
  }
}

// ── Table renderer ────────────────────────────────────────────────────────────

export function renderTable(
  rows: Record<string, string>[],
  columns: { key: string; header: string; width?: number }[],
): string {
  if (rows.length === 0) return c().dim("  (no results)");

  // Calculate column widths
  const widths = columns.map((col) => {
    const dataMax = rows.reduce(
      (m, r) => Math.max(m, stripAnsi(r[col.key] ?? "").length),
      0,
    );
    return col.width ?? Math.max(col.header.length, dataMax);
  });

  const header = columns
    .map((col, i) => c().bold(col.header.padEnd(widths[i] ?? col.header.length)))
    .join("  ");

  const divider = widths.map((w) => "─".repeat(w)).join("──");

  const body = rows
    .map((row) =>
      columns
        .map((col, i) => {
          const raw = row[col.key] ?? "";
          const visible = stripAnsi(raw).padEnd(widths[i] ?? raw.length);
          // Re-apply original colour (raw may contain ansi codes) then pad plain tail
          return raw + " ".repeat(Math.max(0, (widths[i] ?? 0) - stripAnsi(raw).length));
        })
        .join("  "),
    )
    .join("\n");

  return [header, divider, body].join("\n");
}

// Very small ANSI strip — avoids importing strip-ansi
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ── Section header ────────────────────────────────────────────────────────────

export function section(title: string): string {
  return `\n${c().bold(c().cyan(title))}\n${"─".repeat(title.length)}`;
}

// ── Key-value block ───────────────────────────────────────────────────────────

export function kv(pairs: Array<[string, string]>): string {
  const maxKey = pairs.reduce((m, [k]) => Math.max(m, k.length), 0);
  return pairs
    .map(([k, v]) => `  ${c().bold(k.padEnd(maxKey))}  ${v}`)
    .join("\n");
}

// ── Spinner-style stage progress ──────────────────────────────────────────────

const STAGES = [
  "requirements",
  "design",
  "planning",
  "implementation",
  "testing",
  "review",
  "deployment",
  "monitoring",
];

export function renderStageBar(currentStage: string, status: string): string {
  const idx = STAGES.indexOf(currentStage);
  return STAGES.map((s, i) => {
    if (i < idx)  return c().green(`[✓] ${s}`);
    if (i === idx) {
      const marker = status === "completed" ? c().green("[✓]") : c().cyan("[→]");
      return `${marker} ${c().bold(s)}`;
    }
    return c().dim(`[ ] ${s}`);
  }).join("  ");
}

// ── Verdict banner ────────────────────────────────────────────────────────────

export function verdictBanner(verdict: string): string {
  switch (verdict.toLowerCase()) {
    case "pass": return c().green(`\n  VERDICT: PASS\n`);
    case "fail": return c().red(`\n  VERDICT: FAIL\n`);
    case "warn": return c().yellow(`\n  VERDICT: WARN\n`);
    default:     return `\n  VERDICT: ${verdict}\n`;
  }
}

// ── Ensure chalk is warmed up ─────────────────────────────────────────────────

export async function initFormat(): Promise<void> {
  await getChalk();
}

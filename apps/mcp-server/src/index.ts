#!/usr/bin/env node
/**
 * ARCHIBALD MCP Server
 *
 * The unified lifecycle intelligence MCP server — exposes all 7 tools
 * covering the complete software lifecycle from requirement to production.
 *
 * Environment:
 *   ARCHIBALD_API_URL   — ARCHIBALD API (default: http://localhost:8120)
 *   ARCHIBALD_API_KEY   — Auth token
 *   ARCHINTEL_API_URL   — ARCHINTEL API (default: http://localhost:8090)
 *   SENTINEL_API_URL    — SENTINEL API (default: http://localhost:8080)
 *   PHOENIX_API_URL     — PHOENIX API (default: http://localhost:8100)
 */

import { createInterface } from "node:readline";
import { createArchibaldTools, type ArchibaldApiClients } from "./tools.js";

const ARCHIBALD_URL = process.env["ARCHIBALD_API_URL"] ?? "http://localhost:8120";
const ARCHINTEL_URL = process.env["ARCHINTEL_API_URL"] ?? "http://localhost:8090";
const SENTINEL_URL = process.env["SENTINEL_API_URL"] ?? "http://localhost:8080";
const PHOENIX_URL = process.env["PHOENIX_API_URL"] ?? "http://localhost:8100";
const API_KEY = process.env["ARCHIBALD_API_KEY"] ?? "";

const auth = () => ({
  "Content-Type": "application/json",
  ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
});

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...auth(), ...init?.headers } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, string>;
    throw new Error(err["error"] ?? `API error ${res.status}: ${url}`);
  }
  return res.json() as Promise<T>;
}

const clients: ArchibaldApiClients = {
  archibald: {
    async startLifecycle(requirement, type, productId) {
      return apiFetch(`${ARCHIBALD_URL}/v1/lifecycles`, {
        method: "POST",
        body: JSON.stringify({ requirement, type: type ?? "feature", ...(productId ? { productId } : {}) }),
      });
    },
    async getRunStatus(runId) {
      return apiFetch(`${ARCHIBALD_URL}/v1/lifecycles/${runId}`);
    },
    async listPendingDecisions() {
      return apiFetch(`${ARCHIBALD_URL}/v1/decisions?status=pending`);
    },
    async approveDecision(decisionId, comment) {
      return apiFetch(`${ARCHIBALD_URL}/v1/decisions/${decisionId}/approve`, {
        method: "POST",
        body: JSON.stringify({ comment }),
      });
    },
    async submitOutcome(runId, outcome, metrics) {
      return apiFetch(`${ARCHIBALD_URL}/v1/lifecycles/${runId}/outcome`, {
        method: "POST",
        body: JSON.stringify({ outcome, metrics }),
      });
    },
    async getInsights() {
      return apiFetch(`${ARCHIBALD_URL}/v1/insights`);
    },
  },

  archintel: {
    async ask(question, mode, repoId) {
      return apiFetch(`${ARCHINTEL_URL}/v1/ask`, {
        method: "POST",
        body: JSON.stringify({ question, mode: mode ?? "chat", ...(repoId ? { repoId } : {}) }),
      });
    },
  },

  sentinel: {
    async scanDiff(diff) {
      return apiFetch(`${SENTINEL_URL}/v1/hooks/pre-commit`, {
        method: "POST",
        body: JSON.stringify({ diff, timestamp: new Date().toISOString() }),
      });
    },
    async checkCompliance(repoId) {
      const findings = await apiFetch<{ findings?: Array<{ severity: string }> }>(
        `${SENTINEL_URL}/v1/findings?repoId=${repoId}&minSeverity=HIGH`,
      );
      const arr = findings.findings ?? [];
      return {
        compliant: arr.length === 0,
        highSeverityCount: arr.filter(f => f.severity === "HIGH").length,
      };
    },
  },

  phoenix: {
    async listIncidents(status) {
      const params = status ? `?status=${status}` : "";
      const body = await apiFetch<{ incidents?: unknown[] }>(`${PHOENIX_URL}/v1/incidents${params}`);
      return (body.incidents ?? (Array.isArray(body) ? body : [])) as Array<{
        id: string; severity: string; service: string; status: string;
      }>;
    },
    async getIncident(id) {
      return apiFetch(`${PHOENIX_URL}/v1/incidents/${id}`);
    },
  },
};

const tools = createArchibaldTools(clients);

// ─── JSON-RPC 2.0 server ───────────────────────────────────────────────────

function jsonrpc(id: unknown, result: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function jsonrpcError(id: unknown, code: number, message: string) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

const rl = createInterface({ input: process.stdin, terminal: false });

process.stderr.write(
  `ARCHIBALD MCP Server v0.1.0\n` +
  `APIs: archibald=${ARCHIBALD_URL} archintel=${ARCHINTEL_URL} sentinel=${SENTINEL_URL} phoenix=${PHOENIX_URL}\n` +
  `Tools: ${Object.keys(tools).join(", ")}\n`,
);

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    req = JSON.parse(trimmed);
  } catch {
    process.stdout.write(jsonrpcError(null, -32700, "Parse error") + "\n");
    return;
  }

  const { id, method, params = {} } = req;

  try {
    if (method === "initialize") {
      process.stdout.write(jsonrpc(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "archibald-mcp", version: "0.1.0" },
      }) + "\n");
      return;
    }

    if (method === "tools/list") {
      process.stdout.write(jsonrpc(id, {
        tools: Object.values(tools).map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      }) + "\n");
      return;
    }

    if (method === "tools/call") {
      const toolName = (params["name"] ?? params["tool"]) as string;
      const toolArgs = (params["arguments"] ?? params["input"] ?? {}) as Record<string, unknown>;
      const tool = tools[toolName];

      if (!tool) {
        process.stdout.write(jsonrpcError(id, -32601, `Tool not found: ${toolName}`) + "\n");
        return;
      }

      const result = await tool.handler(toolArgs);
      process.stdout.write(jsonrpc(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      }) + "\n");
      return;
    }

    process.stdout.write(jsonrpcError(id, -32601, `Method not found: ${method}`) + "\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    process.stdout.write(jsonrpcError(id, -32603, message) + "\n");
  }
});

rl.on("close", () => process.exit(0));

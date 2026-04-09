import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResearchAgent } from "../research-agent.js";
import type { AgentContext } from "../base-agent.js";
import type { ResearchFindings } from "../research-agent.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRedisMock() {
  return { xadd: vi.fn().mockResolvedValue("0-1") };
}

/** Build a mock npm registry response for a given package name */
function makeNpmResponse(pkg: string, lastPublished: string = new Date().toISOString()) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      name: pkg,
      "dist-tags": { latest: "1.0.0" },
      time: { "1.0.0": lastPublished, modified: lastPublished },
    }),
  };
}

/** Build a mock GitHub repo response */
function makeGitHubResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      stargazers_count: 1000,
      forks_count: 100,
      open_issues_count: 50,
      pushed_at: new Date().toISOString(),
      archived: false,
      ...overrides,
    }),
  };
}

/** Build a mock ARCHINTEL /v1/ask response */
function makeArchintelResponse(patterns: string[] = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ patterns }),
  };
}

const mockContext: AgentContext = {
  productId: "prod-research",
  lifecycleRunId: "run-research-001",
  stage: "research",
  requirement: "Evaluate fastify and prisma for our new service",
  orgContext: {
    orgId: "org-test",
    techStack: ["fastify", "prisma", "postgres"],
  },
};

const contextNoTechStack: AgentContext = {
  ...mockContext,
  orgContext: { orgId: "org-test" },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ResearchAgent", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-expect-error — replace global fetch for tests
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path: all sources reachable ────────────────────────────────────

  it("returns success:true with nextAction 'proceed'", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("registry.npmjs.org")) {
        const pkg = url.split("/").pop()!;
        return Promise.resolve(makeNpmResponse(pkg));
      }
      if (url.includes("api.github.com")) {
        return Promise.resolve(makeGitHubResponse());
      }
      if (url.includes("archintel-test")) {
        return Promise.resolve(makeArchintelResponse(["REST API", "Fastify standard"]));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
  });

  it("output has ResearchFindings structure with required fields", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 }); // all fail → empty arrays

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    const output = result.output as ResearchFindings;
    expect(Array.isArray(output.dependencies)).toBe(true);
    expect(Array.isArray(output.repositories)).toBe(true);
    expect(Array.isArray(output.orgPatterns)).toBe(true);
    expect(Array.isArray(output.recommendations)).toBe(true);
    expect(typeof output.researchedAt).toBe("string");
  });

  it("researchedAt is a valid ISO timestamp", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    const output = result.output as ResearchFindings;
    const d = new Date(output.researchedAt);
    expect(d.getTime()).not.toBeNaN();
  });

  // ── npm package health ────────────────────────────────────────────────────

  it("dependencies populated from npm registry for tech stack packages", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("registry.npmjs.org")) {
        const pkg = url.split("/").pop()!;
        return Promise.resolve(makeNpmResponse(pkg));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    const output = result.output as ResearchFindings;
    expect(output.dependencies.length).toBeGreaterThan(0);
    const names = output.dependencies.map((d) => d.name);
    expect(names.some((n) => ["fastify", "prisma", "postgres"].includes(n))).toBe(true);
  });

  it("NpmPackageHealth has required fields", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("registry.npmjs.org")) {
        const pkg = url.split("/").pop()!;
        return Promise.resolve(makeNpmResponse(pkg));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    const output = result.output as ResearchFindings;
    expect(output.dependencies.length).toBeGreaterThan(0);
    const pkg = output.dependencies[0]!;
    expect(typeof pkg.version).toBe("string");
    expect(typeof pkg.lastPublished).toBe("string");
    expect(typeof pkg.hasSecurityAdvisories).toBe("boolean");
    expect(typeof pkg.isMaintained).toBe("boolean");
    expect(typeof pkg.score).toBe("number");
  });

  it("marks package as isMaintained=false when lastPublished > 1 year ago", async () => {
    const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    // Use a single-package context so we can control exactly which npm response comes back
    const singlePkgContext: AgentContext = {
      ...mockContext,
      orgContext: { orgId: "org-test", techStack: ["fastify"] },
    };
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("registry.npmjs.org")) {
        return Promise.resolve(makeNpmResponse("fastify", oldDate));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(singlePkgContext);

    const output = result.output as ResearchFindings;
    const pkg = output.dependencies.find((d) => d.name === "fastify");
    expect(pkg).toBeDefined();
    expect(pkg!.isMaintained).toBe(false);
  });

  it("generates 'avoid' recommendation for unmaintained package", async () => {
    const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const singlePkgContext: AgentContext = {
      ...mockContext,
      orgContext: { orgId: "org-test", techStack: ["fastify"] },
    };
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("registry.npmjs.org")) {
        return Promise.resolve(makeNpmResponse("fastify", oldDate));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(singlePkgContext);

    const output = result.output as ResearchFindings;
    const rec = output.recommendations.find(
      (r) => r.technology === "fastify" && r.type === "avoid",
    );
    expect(rec).toBeDefined();
    expect(rec!.confidence).toBeGreaterThan(0.5);
  });

  // ── npm package filtering: no package names with "/" or " " ───────────────

  it("skips tech stack entries that look like paths or have spaces (not npm packages)", async () => {
    const contextWithPaths: AgentContext = {
      ...mockContext,
      orgContext: {
        orgId: "org-test",
        techStack: ["fastify", "node/vm", "Ubuntu 22.04", "TypeScript"],
      },
    };

    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    await agent.execute(contextWithPaths);

    // Should only call npm for "fastify" and "TypeScript" — not for "node/vm" or "Ubuntu 22.04"
    const npmCalls = fetchMock.mock.calls.filter(
      (c: [string]) => typeof c[0] === "string" && c[0].includes("registry.npmjs.org"),
    );
    for (const call of npmCalls) {
      expect(call[0]).not.toContain("node/vm");
      expect(call[0]).not.toContain("Ubuntu 22.04");
    }
  });

  // ── GitHub activity ───────────────────────────────────────────────────────

  it("repositories populated from GitHub for known tech stack entries", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("api.github.com")) {
        return Promise.resolve(makeGitHubResponse({ stargazers_count: 31000 }));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    const output = result.output as ResearchFindings;
    expect(output.repositories.length).toBeGreaterThan(0);
  });

  it("GitHubRepoActivity has required fields", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("api.github.com")) {
        return Promise.resolve(makeGitHubResponse());
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    const output = result.output as ResearchFindings;
    expect(output.repositories.length).toBeGreaterThan(0);
    const repo = output.repositories[0]!;
    expect(typeof repo.repo).toBe("string");
    expect(typeof repo.stars).toBe("number");
    expect(typeof repo.isArchived).toBe("boolean");
    expect(typeof repo.isActive).toBe("boolean");
    expect(typeof repo.lastCommitDays).toBe("number");
  });

  it("generates 'avoid' recommendation for archived repository", async () => {
    // Use single-tech context mapping to exactly one GitHub repo
    const singleTechContext: AgentContext = {
      ...mockContext,
      orgContext: { orgId: "org-test", techStack: ["fastify"] },
    };
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("api.github.com")) {
        return Promise.resolve(makeGitHubResponse({ archived: true }));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(singleTechContext);

    const output = result.output as ResearchFindings;
    const rec = output.recommendations.find((r) => r.type === "avoid" && r.confidence === 1.0);
    expect(rec).toBeDefined();
  });

  it("generates 'watch' recommendation for inactive (not archived) repository", async () => {
    const oldPush = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(); // 100 days ago
    const singleTechContext: AgentContext = {
      ...mockContext,
      orgContext: { orgId: "org-test", techStack: ["fastify"] },
    };
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("api.github.com")) {
        return Promise.resolve(makeGitHubResponse({ pushed_at: oldPush, archived: false }));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(singleTechContext);

    const output = result.output as ResearchFindings;
    const watchRec = output.recommendations.find((r) => r.type === "watch");
    expect(watchRec).toBeDefined();
    expect(watchRec!.reasoning).toContain("days");
  });

  // ── ARCHINTEL org patterns ────────────────────────────────────────────────

  it("orgPatterns populated from ARCHINTEL response", async () => {
    // The agent runs npm, github, and archintel checks in parallel via Promise.allSettled.
    // npm: 3 calls (fastify, prisma, postgres), github: 3 calls (fastify, prisma, postgres),
    // archintel: 1 call — all issued concurrently so order is non-deterministic.
    // Use a URL-aware implementation to route responses correctly.
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("archintel-test")) {
        return Promise.resolve(makeArchintelResponse(["REST API", "Event sourcing", "Fastify standard"]));
      }
      // All npm / github calls fail (not relevant to this test)
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    const output = result.output as ResearchFindings;
    expect(output.orgPatterns).toContain("REST API");
    expect(output.orgPatterns).toContain("Event sourcing");
  });

  it("ARCHINTEL request includes x-org-id and x-user-id headers", async () => {
    fetchMock.mockImplementation((url: string) => {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    await agent.execute(mockContext);

    // Find the ARCHINTEL call (POST to /v1/ask)
    const archintelCall = fetchMock.mock.calls.find(
      (c: [string]) => typeof c[0] === "string" && c[0].includes("archintel-test"),
    );
    expect(archintelCall).toBeDefined();
    const headers = archintelCall![1].headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org-test");
    expect(typeof headers["x-user-id"]).toBe("string");
  });

  it("ARCHINTEL request body contains a meaningful query", async () => {
    fetchMock.mockImplementation((_url: string) => {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    await agent.execute(mockContext);

    const archintelCall = fetchMock.mock.calls.find(
      (c: [string]) => typeof c[0] === "string" && c[0].includes("archintel-test"),
    );
    expect(archintelCall).toBeDefined();
    const body = JSON.parse(archintelCall![1].body as string);
    expect(typeof body.query).toBe("string");
    expect(body.query.length).toBeGreaterThan(10);
  });

  // ── Partial failures: web sources fail → continues ────────────────────────

  it("succeeds even when npm registry is completely unreachable", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("registry.npmjs.org")) {
        return Promise.reject(new Error("npm unreachable"));
      }
      if (url.includes("api.github.com")) {
        return Promise.resolve(makeGitHubResponse());
      }
      if (url.includes("archintel-test")) {
        return Promise.resolve(makeArchintelResponse(["event-driven"]));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
  });

  it("succeeds even when GitHub API is completely unreachable", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("registry.npmjs.org")) {
        const pkg = url.split("/").pop()!;
        return Promise.resolve(makeNpmResponse(pkg));
      }
      if (url.includes("api.github.com")) {
        return Promise.reject(new Error("GitHub unreachable"));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
  });

  it("succeeds even when ARCHINTEL is unreachable (orgPatterns is empty array)", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("registry.npmjs.org")) {
        const pkg = url.split("/").pop()!;
        return Promise.resolve(makeNpmResponse(pkg));
      }
      if (url.includes("api.github.com")) {
        return Promise.resolve(makeGitHubResponse());
      }
      if (url.includes("archintel-test")) {
        return Promise.reject(new Error("ARCHINTEL timeout"));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(true);
    const output = result.output as ResearchFindings;
    expect(Array.isArray(output.orgPatterns)).toBe(true);
  });

  it("succeeds when all external sources fail (all-empty findings)", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("network down")));

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(true);
    const output = result.output as ResearchFindings;
    expect(output.dependencies).toEqual([]);
    expect(output.repositories).toEqual([]);
    expect(output.orgPatterns).toEqual([]);
  });

  // ── Empty tech stack ──────────────────────────────────────────────────────

  it("returns empty dependencies and repositories when tech stack is empty", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ patterns: [] }) });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(contextNoTechStack);

    const output = result.output as ResearchFindings;
    expect(output.dependencies).toEqual([]);
    expect(output.repositories).toEqual([]);
  });

  // ── evidence ──────────────────────────────────────────────────────────────

  it("evidence includes npm-registry source when npm succeeds", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("registry.npmjs.org")) {
        const pkg = url.split("/").pop()!;
        return Promise.resolve(makeNpmResponse(pkg));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("npm-registry:dependency-health");
  });

  it("evidence includes github-api source when GitHub succeeds", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("api.github.com")) {
        return Promise.resolve(makeGitHubResponse());
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("github-api:activity");
  });

  it("evidence includes archintel:patterns when ARCHINTEL succeeds", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("archintel-test")) {
        return Promise.resolve(makeArchintelResponse(["pattern1"]));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const agent = new ResearchAgent({ archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);

    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("archintel:patterns");
  });

  // ── Event bus emission ────────────────────────────────────────────────────

  it("emits agent.started and agent.completed to archibald.lifecycle", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const redis = makeRedisMock();
    const agent = new ResearchAgent({ redis: redis as any, archintelUrl: "http://archintel-test:8090" });
    await agent.execute(mockContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain("agent.started");
    expect(allArgs).toContain("agent.completed");
  });

  it("agent.completed event includes recommendationCount", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const redis = makeRedisMock();
    const agent = new ResearchAgent({ redis: redis as any, archintelUrl: "http://archintel-test:8090" });
    await agent.execute(mockContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain("recommendationCount");
  });

  it("Redis emit failure propagates (not swallowed)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const redis = { xadd: vi.fn().mockRejectedValue(new Error("Redis unavailable")) };
    const agent = new ResearchAgent({ redis: redis as any, archintelUrl: "http://archintel-test:8090" });
    await expect(agent.execute(mockContext)).rejects.toThrow("Redis unavailable");
  });

  it("works without redis (no-op emit)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const agent = new ResearchAgent({ redis: null, archintelUrl: "http://archintel-test:8090" });
    const result = await agent.execute(mockContext);
    expect(result.success).toBe(true);
  });
});

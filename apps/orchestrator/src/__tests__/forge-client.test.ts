import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ForgeClient, type ForgeSpec, type ForgeBuild } from "../forge-client.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSpec(overrides: Partial<ForgeSpec> = {}): ForgeSpec {
  return { id: "spec-123", projectId: "proj-abc", status: "CREATED", ...overrides };
}

function makeBuild(overrides: Partial<ForgeBuild> = {}): ForgeBuild {
  return {
    id: "build-456",
    specId: "spec-123",
    status: "PENDING",
    progress: 0,
    ...overrides,
  };
}

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ForgeClient", () => {
  let client: ForgeClient;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new ForgeClient("http://forge.test", "test-api-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── createSpec ───────────────────────────────────────────────────────────

  it("createSpec calls POST /v1/specs with correct body and headers", async () => {
    const spec = makeSpec();
    fetchSpy = mockFetch(() => jsonResponse({ spec }));

    const result = await client.createSpec("proj-abc", "Build a login page", [
      { name: "auth-service" },
    ]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://forge.test/v1/specs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      projectId: "proj-abc",
      requirements: "Build a login page",
      components: [{ name: "auth-service" }],
    });
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-api-key");
    expect(result.id).toBe("spec-123");
  });

  it("createSpec accepts bare spec response (no envelope)", async () => {
    const spec = makeSpec({ id: "spec-bare" });
    fetchSpy = mockFetch(() => jsonResponse(spec));

    const result = await client.createSpec("proj-abc", "requirement");
    expect(result.id).toBe("spec-bare");
  });

  it("createSpec throws on non-OK response", async () => {
    fetchSpy = mockFetch(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401 })),
    );

    await expect(client.createSpec("proj", "req")).rejects.toThrow(
      "FORGE createSpec failed (401)",
    );
  });

  // ─── triggerBuild ─────────────────────────────────────────────────────────

  it("triggerBuild calls POST /v1/builds with specId", async () => {
    const build = makeBuild();
    fetchSpy = mockFetch(() => jsonResponse({ build }));

    const result = await client.triggerBuild("spec-123");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://forge.test/v1/builds");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ specId: "spec-123" });
    expect(result.id).toBe("build-456");
  });

  it("triggerBuild accepts bare build response (no envelope)", async () => {
    const build = makeBuild({ id: "build-bare" });
    fetchSpy = mockFetch(() => jsonResponse(build));

    const result = await client.triggerBuild("spec-123");
    expect(result.id).toBe("build-bare");
  });

  it("triggerBuild throws on non-OK response", async () => {
    fetchSpy = mockFetch(() =>
      Promise.resolve(new Response("Server Error", { status: 500 })),
    );

    await expect(client.triggerBuild("spec-123")).rejects.toThrow(
      "FORGE triggerBuild failed (500)",
    );
  });

  // ─── getBuild ─────────────────────────────────────────────────────────────

  it("getBuild calls GET /v1/builds/:id", async () => {
    const build = makeBuild({ status: "IN_PROGRESS", progress: 50 });
    fetchSpy = mockFetch(() => jsonResponse({ build }));

    const result = await client.getBuild("build-456");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://forge.test/v1/builds/build-456");
    expect(init.method).toBe("GET");
    expect(result.status).toBe("IN_PROGRESS");
    expect(result.progress).toBe(50);
  });

  it("getBuild throws on non-OK response", async () => {
    fetchSpy = mockFetch(() =>
      Promise.resolve(new Response("Not Found", { status: 404 })),
    );

    await expect(client.getBuild("build-missing")).rejects.toThrow(
      "FORGE getBuild failed (404)",
    );
  });

  // ─── pollBuildUntilComplete ───────────────────────────────────────────────

  it("pollBuildUntilComplete resolves immediately on SUCCESS", async () => {
    const build = makeBuild({ status: "SUCCESS", progress: 100, outputDir: "/out/build-456" });
    fetchSpy = mockFetch(() => jsonResponse({ build }));

    const result = await client.pollBuildUntilComplete("build-456", {
      timeoutMs: 10_000,
      intervalMs: 10,
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.outputDir).toBe("/out/build-456");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("pollBuildUntilComplete polls multiple times then resolves on SUCCESS", async () => {
    let calls = 0;
    fetchSpy = mockFetch(() => {
      calls += 1;
      const status = calls < 3 ? "IN_PROGRESS" : "SUCCESS";
      const build = makeBuild({ status, progress: calls < 3 ? 50 : 100 });
      return jsonResponse({ build });
    });

    const result = await client.pollBuildUntilComplete("build-456", {
      timeoutMs: 30_000,
      intervalMs: 1, // near-zero to keep test fast
    });

    expect(result.status).toBe("SUCCESS");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("pollBuildUntilComplete throws on FAILED status", async () => {
    const build = makeBuild({
      status: "FAILED",
      progress: 30,
      logs: ["Error: compilation failed", "Exit code 1"],
    });
    fetchSpy = mockFetch(() => jsonResponse({ build }));

    await expect(
      client.pollBuildUntilComplete("build-456", { timeoutMs: 10_000, intervalMs: 10 }),
    ).rejects.toThrow("FORGE build build-456 failed");
  });

  it("pollBuildUntilComplete throws on timeout", async () => {
    // Always returns IN_PROGRESS
    const build = makeBuild({ status: "IN_PROGRESS", progress: 10 });
    fetchSpy = mockFetch(() => jsonResponse({ build }));

    // timeoutMs so small that after one poll the deadline is already exceeded
    await expect(
      client.pollBuildUntilComplete("build-456", { timeoutMs: 1, intervalMs: 50 }),
    ).rejects.toThrow(/did not complete within/);
  });

  it("pollBuildUntilComplete includes build logs in FAILED error message", async () => {
    const build = makeBuild({
      status: "FAILED",
      logs: ["step 1 ok", "step 2 failed"],
    });
    fetchSpy = mockFetch(() => jsonResponse({ build }));

    await expect(
      client.pollBuildUntilComplete("build-456", { timeoutMs: 10_000, intervalMs: 10 }),
    ).rejects.toThrow("step 1 ok | step 2 failed");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScanGateAgent } from "../scan-gate-agent.js";
import type { AgentContext } from "../base-agent.js";
import type { SentinelCertificate } from "../scan-gate-agent.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRedisMock() {
  return { xadd: vi.fn().mockResolvedValue("0-1") };
}

const COMMIT_SHA = "abc123def456";

const mockContext: AgentContext = {
  productId: "prod-scan",
  lifecycleRunId: "run-scan-001",
  stage: "scan",
  requirement: "Ship the payment feature",
  previousStageOutput: {
    commitSha: COMMIT_SHA,
    buildId: "build-xyz",
  },
  orgContext: { orgId: "org-test" },
};

function makeCleanCertificate(overrides: Partial<SentinelCertificate> = {}): SentinelCertificate {
  return {
    id: "cert-00000001",
    commitSha: COMMIT_SHA,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    maxSeverity: "LOW",
    findingsSummary: { critical: 0, high: 0, medium: 2, low: 5, info: 3 },
    passed: true,
    ...overrides,
  };
}

function makeCertResponse(cert: SentinelCertificate) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ certificate: cert }),
  };
}

/**
 * FastScanAgent — overrides sleep() to be instant so retry tests run without wall-clock delay.
 */
class FastScanAgent extends ScanGateAgent {
  protected override sleep(_ms: number): Promise<void> {
    return Promise.resolve();
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ScanGateAgent", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-expect-error — replace global fetch for tests
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path: clean certificate → gate passes ───────────────────────────

  it("returns success:true with nextAction 'proceed' when certificate has no HIGH/CRITICAL", async () => {
    fetchMock.mockResolvedValueOnce(makeCertResponse(makeCleanCertificate()));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
  });

  it("output includes certificate and sentinelCertificateId", async () => {
    const cert = makeCleanCertificate({ id: "cert-clean-001" });
    fetchMock.mockResolvedValueOnce(makeCertResponse(cert));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    const result = await agent.execute(mockContext);

    const output = result.output as { certificate: SentinelCertificate; sentinelCertificateId: string; maxSeverity: string };
    expect(output.sentinelCertificateId).toBe("cert-clean-001");
    expect(output.certificate).toBeDefined();
    expect(output.certificate.id).toBe("cert-clean-001");
  });

  it("evidence includes sentinel:certificate-check source", async () => {
    fetchMock.mockResolvedValueOnce(makeCertResponse(makeCleanCertificate()));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    const result = await agent.execute(mockContext);

    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("sentinel:certificate-check");
  });

  // ── Correct repoId / commitSha sent in request ────────────────────────────

  it("SENTINEL request URL includes commitSha from previousStageOutput", async () => {
    fetchMock.mockResolvedValueOnce(makeCertResponse(makeCleanCertificate()));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    await agent.execute(mockContext);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent(COMMIT_SHA));
  });

  it("SENTINEL request URL includes productId", async () => {
    fetchMock.mockResolvedValueOnce(makeCertResponse(makeCleanCertificate()));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    await agent.execute(mockContext);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain(mockContext.productId);
  });

  it("SENTINEL request carries x-org-id header", async () => {
    fetchMock.mockResolvedValueOnce(makeCertResponse(makeCleanCertificate()));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    await agent.execute(mockContext);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org-test");
  });

  it("falls back to 'HEAD' commitSha when previousStageOutput has none", async () => {
    const contextNoCommit: AgentContext = { ...mockContext, previousStageOutput: {} };
    fetchMock.mockResolvedValueOnce(makeCertResponse(makeCleanCertificate()));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    await agent.execute(contextNoCommit);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("HEAD");
  });

  // ── CRITICAL finding → gate blocks ────────────────────────────────────────

  it("returns success:false with nextAction 'fail' when certificate has CRITICAL findings", async () => {
    const critCert = makeCleanCertificate({
      maxSeverity: "CRITICAL",
      findingsSummary: { critical: 2, high: 0, medium: 0, low: 0, info: 0 },
    });
    fetchMock.mockResolvedValueOnce(makeCertResponse(critCert));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(false);
    expect(result.nextAction).toBe("fail");
    expect(result.failureReason).toContain("CRITICAL");
  });

  it("failureReason includes finding counts for CRITICAL/HIGH when blocked", async () => {
    const critCert = makeCleanCertificate({
      id: "cert-blocked",
      maxSeverity: "CRITICAL",
      findingsSummary: { critical: 3, high: 1, medium: 0, low: 0, info: 0 },
    });
    fetchMock.mockResolvedValueOnce(makeCertResponse(critCert));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    const result = await agent.execute(mockContext);

    expect(result.failureReason).toContain("3");
    expect(result.failureReason).toContain("1");
    expect(result.failureReason).toContain("cert-blocked");
  });

  it("returns fail when certificate has HIGH findings (but no CRITICAL)", async () => {
    const highCert = makeCleanCertificate({
      maxSeverity: "HIGH",
      findingsSummary: { critical: 0, high: 4, medium: 0, low: 0, info: 0 },
    });
    fetchMock.mockResolvedValueOnce(makeCertResponse(highCert));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(false);
    expect(result.nextAction).toBe("fail");
  });

  it("emits scan.blocked event when gate is blocked", async () => {
    const redis = makeRedisMock();
    const critCert = makeCleanCertificate({
      maxSeverity: "CRITICAL",
      findingsSummary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
    });
    fetchMock.mockResolvedValueOnce(makeCertResponse(critCert));

    const agent = new FastScanAgent({ redis: redis as any, sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    await agent.execute(mockContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain("scan.blocked");
  });

  // ── Medium/Low findings → gate passes ────────────────────────────────────

  it("allows certificate with only MEDIUM findings (not blocked)", async () => {
    const mediumCert = makeCleanCertificate({
      maxSeverity: "MEDIUM",
      findingsSummary: { critical: 0, high: 0, medium: 10, low: 0, info: 0 },
    });
    fetchMock.mockResolvedValueOnce(makeCertResponse(mediumCert));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
  });

  // ── SENTINEL unreachable → fail-closed ───────────────────────────────────

  it("returns wait_for_human (fail-closed) when SENTINEL is completely unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED"));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 2 });
    const result = await agent.execute(mockContext);

    // Fail-closed: exhausts retries and waits for human
    expect(result.nextAction).toBe("wait_for_human");
  });

  it("evidence includes sentinel:unreachable entries when SENTINEL connection fails", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 2 });
    const result = await agent.execute(mockContext);

    const sources = result.evidence.map((e) => e.source);
    expect(sources).toContain("sentinel:unreachable");
  });

  // ── Certificate not found (404) → retries → wait_for_human ───────────────

  it("returns wait_for_human after exhausting retries when no certificate found", async () => {
    // 404 status — no certificate yet
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 3 });
    const result = await agent.execute(mockContext);

    expect(result.nextAction).toBe("wait_for_human");
    expect(result.pendingDecision).toBeDefined();
    expect(result.pendingDecision!.title).toMatch(/certificate/i);
  });

  it("wait_for_human pendingDecision includes the commitSha and attempt count", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 3 });
    const result = await agent.execute(mockContext);

    expect(result.pendingDecision!.description).toContain(COMMIT_SHA);
    expect(result.pendingDecision!.description).toContain("3");
  });

  // ── Retry on missing certificate, then find one ───────────────────────────

  it("succeeds when certificate appears on second attempt", async () => {
    // First: 404 (not ready); Second: certificate found
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
      .mockResolvedValueOnce(makeCertResponse(makeCleanCertificate()));

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 3 });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ── certificates array format (alternative response shape) ───────────────

  it("accepts certificates array response format", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ certificates: [makeCleanCertificate()] }),
    });

    const agent = new FastScanAgent({ sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    const result = await agent.execute(mockContext);

    expect(result.success).toBe(true);
    expect(result.nextAction).toBe("proceed");
  });

  // ── Event bus emission ────────────────────────────────────────────────────

  it("emits agent.started and agent.completed on clean pass", async () => {
    const redis = makeRedisMock();
    fetchMock.mockResolvedValueOnce(makeCertResponse(makeCleanCertificate()));

    const agent = new FastScanAgent({ redis: redis as any, sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    await agent.execute(mockContext);

    const allArgs = (redis.xadd.mock.calls as string[][]).flatMap((c) => c);
    expect(allArgs).toContain("agent.started");
    expect(allArgs).toContain("agent.completed");
  });

  it("Redis emit failure propagates (not swallowed)", async () => {
    const redis = { xadd: vi.fn().mockRejectedValue(new Error("Redis connection lost")) };
    fetchMock.mockResolvedValueOnce(makeCertResponse(makeCleanCertificate()));

    const agent = new FastScanAgent({ redis: redis as any, sentinelUrl: "http://sentinel-test:8080", maxAttempts: 1 });
    await expect(agent.execute(mockContext)).rejects.toThrow("Redis connection lost");
  });
});

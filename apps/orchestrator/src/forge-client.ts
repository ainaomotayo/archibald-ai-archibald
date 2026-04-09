// ForgeClient — thin HTTP client for the FORGE build API.
// Called by the Orchestrator when the lifecycle reaches the `build` stage.

export interface ForgeSpec {
  id: string;
  projectId: string;
  status: string;
}

export interface ForgeBuild {
  id: string;
  specId: string;
  status: string; // PENDING | IN_PROGRESS | SUCCESS | FAILED
  progress: number;
  outputDir?: string;
  logs?: string[];
}

export class ForgeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  // POST /v1/specs
  async createSpec(
    projectId: string,
    requirements: string,
    components?: unknown[],
  ): Promise<ForgeSpec> {
    const response = await fetch(`${this.baseUrl}/v1/specs`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ projectId, requirements, components }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`FORGE createSpec failed (${response.status}): ${body}`);
    }

    const data = await response.json() as { spec: ForgeSpec } | ForgeSpec;
    // Accept both `{ spec: ... }` envelope and bare object
    return (data as { spec: ForgeSpec }).spec ?? (data as ForgeSpec);
  }

  // POST /v1/builds
  async triggerBuild(specId: string): Promise<ForgeBuild> {
    const response = await fetch(`${this.baseUrl}/v1/builds`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ specId }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`FORGE triggerBuild failed (${response.status}): ${body}`);
    }

    const data = await response.json() as { build: ForgeBuild } | ForgeBuild;
    return (data as { build: ForgeBuild }).build ?? (data as ForgeBuild);
  }

  // GET /v1/builds/:id
  async getBuild(buildId: string): Promise<ForgeBuild> {
    const response = await fetch(`${this.baseUrl}/v1/builds/${buildId}`, {
      method: "GET",
      headers: this.headers(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`FORGE getBuild failed (${response.status}): ${body}`);
    }

    const data = await response.json() as { build: ForgeBuild } | ForgeBuild;
    return (data as { build: ForgeBuild }).build ?? (data as ForgeBuild);
  }

  // Poll GET /v1/builds/:id every intervalMs until SUCCESS or FAILED.
  // Throws on timeout or FAILED status.
  async pollBuildUntilComplete(
    buildId: string,
    opts: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<ForgeBuild> {
    const timeoutMs = opts.timeoutMs ?? 600_000; // 10 minutes
    const intervalMs = opts.intervalMs ?? 5_000;  // 5 seconds
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const build = await this.getBuild(buildId);

      if (build.status === "SUCCESS") {
        return build;
      }

      if (build.status === "FAILED") {
        throw new Error(`FORGE build ${buildId} failed. Logs: ${(build.logs ?? []).join(" | ")}`);
      }

      if (Date.now() + intervalMs > deadline) {
        throw new Error(
          `FORGE build ${buildId} did not complete within ${timeoutMs}ms (last status: ${build.status})`,
        );
      }

      await this.sleep(intervalMs);
    }
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

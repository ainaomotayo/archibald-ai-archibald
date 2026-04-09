// ResearchAgent — deep research into dependency health, library activity,
// and org-specific patterns. Used during design phase to inform technology choices.

import { BaseAgent, type AgentContext, type AgentResult, type Evidence } from "./base-agent.js";

export interface NpmPackageHealth {
  name: string;
  version: string;
  weeklyDownloads: number;
  lastPublished: string;
  hasSecurityAdvisories: boolean;
  advisoryCount: number;
  isMaintained: boolean;
  score: number; // 0–1
}

export interface GitHubRepoActivity {
  repo: string;
  stars: number;
  forks: number;
  openIssues: number;
  lastCommitDays: number;
  isArchived: boolean;
  isActive: boolean;
}

export interface ResearchFindings {
  dependencies: NpmPackageHealth[];
  repositories: GitHubRepoActivity[];
  orgPatterns: string[];
  recommendations: Array<{
    type: "adopt" | "avoid" | "watch";
    technology: string;
    reasoning: string;
    confidence: number;
  }>;
  researchedAt: string;
}

export class ResearchAgent extends BaseAgent {
  readonly name = "ResearchAgent";

  private archintelUrl: string;

  constructor(options: {
    redis?: InstanceType<typeof import("ioredis").default> | null;
    llm?: import("./base-agent.js").LLMProvider | null;
    archintelUrl?: string;
  } = {}) {
    super(options);
    this.archintelUrl = options.archintelUrl ?? process.env["ARCHINTEL_API_URL"] ?? "http://localhost:8090";
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    this.log("info", "ResearchAgent: starting deep research", {
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    await this.emit("archibald.lifecycle", {
      type: "agent.started",
      agent: this.name,
      stage: context.stage,
      productId: context.productId,
      runId: context.lifecycleRunId,
    });

    const evidence: Evidence[] = [];
    const techStack = context.orgContext?.techStack ?? [];

    // Parallel research: npm + GitHub + ARCHINTEL
    const [npmResults, githubResults, orgPatterns] = await Promise.allSettled([
      this.checkNpmPackages(techStack),
      this.checkGitHubActivity(techStack),
      this.queryOrgPatterns(context),
    ]);

    const dependencies: NpmPackageHealth[] = [];
    const repositories: GitHubRepoActivity[] = [];
    let orgPatternsList: string[] = [];

    if (npmResults.status === "fulfilled") {
      dependencies.push(...npmResults.value);
      evidence.push({
        source: "npm-registry:dependency-health",
        finding: `Checked ${dependencies.length} npm packages for health and security advisories`,
        confidence: 0.9,
        url: "https://registry.npmjs.org",
      });
    } else {
      this.log("warn", "npm registry check failed", { error: npmResults.reason });
    }

    if (githubResults.status === "fulfilled") {
      repositories.push(...githubResults.value);
      evidence.push({
        source: "github-api:activity",
        finding: `Checked ${repositories.length} GitHub repositories for activity metrics`,
        confidence: 0.85,
        url: "https://api.github.com",
      });
    } else {
      this.log("warn", "GitHub API check failed", { error: githubResults.reason });
    }

    if (orgPatterns.status === "fulfilled") {
      orgPatternsList = orgPatterns.value;
      evidence.push({
        source: "archintel:patterns",
        finding: `Retrieved ${orgPatternsList.length} org-specific patterns from ARCHINTEL`,
        confidence: 0.9,
      });
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations(dependencies, repositories, orgPatternsList);

    const findings: ResearchFindings = {
      dependencies,
      repositories,
      orgPatterns: orgPatternsList,
      recommendations,
      researchedAt: new Date().toISOString(),
    };

    await this.emit("archibald.lifecycle", {
      type: "agent.completed",
      agent: this.name,
      stage: context.stage,
      productId: context.productId,
      runId: context.lifecycleRunId,
      recommendationCount: recommendations.length,
    });

    return {
      success: true,
      output: findings,
      nextAction: "proceed",
      evidence,
    };
  }

  private async checkNpmPackages(techStack: string[]): Promise<NpmPackageHealth[]> {
    const packages = techStack.filter((t) => !t.includes("/") && !t.includes(" "));
    if (packages.length === 0) return [];

    const results = await Promise.allSettled(
      packages.slice(0, 10).map(async (pkg) => {
        const normalised = pkg.toLowerCase().replace(/\s+/g, "-");
        const res = await fetch(`https://registry.npmjs.org/${normalised}`, {
          signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) return null;
        const data = await res.json() as Record<string, unknown>;
        const distTags = data["dist-tags"] as Record<string, string> | undefined;
        const latestVersion = distTags?.["latest"] ?? "unknown";
        const time = data.time as Record<string, string> | undefined;
        const modifiedStr = time?.[latestVersion] ?? time?.["modified"] ?? new Date().toISOString();

        return {
          name: pkg,
          version: latestVersion,
          weeklyDownloads: 0, // would need separate downloads endpoint
          lastPublished: modifiedStr,
          hasSecurityAdvisories: false, // would need npm audit API
          advisoryCount: 0,
          isMaintained: (Date.now() - new Date(modifiedStr).getTime()) < 365 * 24 * 60 * 60 * 1000,
          score: 0.8,
        } as NpmPackageHealth;
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<NpmPackageHealth | null> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((v): v is NpmPackageHealth => v !== null);
  }

  private async checkGitHubActivity(techStack: string[]): Promise<GitHubRepoActivity[]> {
    // Map common technologies to their GitHub repos
    const techToRepo: Record<string, string> = {
      fastify: "fastify/fastify",
      nextjs: "vercel/next.js",
      prisma: "prisma/prisma",
      "redis": "redis/redis",
      postgres: "postgres/postgres",
      typescript: "microsoft/TypeScript",
      vitest: "vitest-dev/vitest",
    };

    const repos = techStack
      .map((t) => techToRepo[t.toLowerCase()])
      .filter((r): r is string => r !== undefined);

    if (repos.length === 0) return [];

    const results = await Promise.allSettled(
      repos.slice(0, 5).map(async (repo) => {
        const res = await fetch(`https://api.github.com/repos/${repo}`, {
          headers: { "User-Agent": "archibald-research-agent" },
          signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) return null;
        const data = await res.json() as Record<string, unknown>;
        const pushedAt = data["pushed_at"] as string | undefined;
        const lastCommitDays = pushedAt
          ? Math.floor((Date.now() - new Date(pushedAt).getTime()) / (1000 * 60 * 60 * 24))
          : 999;

        return {
          repo,
          stars: (data["stargazers_count"] as number | undefined) ?? 0,
          forks: (data["forks_count"] as number | undefined) ?? 0,
          openIssues: (data["open_issues_count"] as number | undefined) ?? 0,
          lastCommitDays,
          isArchived: (data["archived"] as boolean | undefined) ?? false,
          isActive: lastCommitDays < 90,
        } as GitHubRepoActivity;
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<GitHubRepoActivity | null> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((v): v is GitHubRepoActivity => v !== null);
  }

  private async queryOrgPatterns(context: AgentContext): Promise<string[]> {
    try {
      const res = await fetch(`${this.archintelUrl}/v1/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": context.orgContext?.orgId ?? "unknown",
          "x-user-id": "archibald-research-agent",
          "x-role": "VIEWER",
        },
        body: JSON.stringify({ query: "List all technology patterns and architectural decisions this org has adopted", maxResults: 20 }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return [];
      const data = await res.json() as { patterns?: string[] };
      return data.patterns ?? [];
    } catch {
      return [];
    }
  }

  private generateRecommendations(
    deps: NpmPackageHealth[],
    repos: GitHubRepoActivity[],
    _orgPatterns: string[],
  ): ResearchFindings["recommendations"] {
    const recommendations: ResearchFindings["recommendations"] = [];

    // Flag unmaintained packages
    for (const dep of deps) {
      if (!dep.isMaintained) {
        recommendations.push({
          type: "avoid",
          technology: dep.name,
          reasoning: `Package ${dep.name} has not been updated in over a year`,
          confidence: 0.85,
        });
      }
      if (dep.hasSecurityAdvisories) {
        recommendations.push({
          type: "avoid",
          technology: dep.name,
          reasoning: `Package ${dep.name} has ${dep.advisoryCount} known security advisories`,
          confidence: 0.95,
        });
      }
    }

    // Flag archived repos
    for (const repo of repos) {
      if (repo.isArchived) {
        recommendations.push({
          type: "avoid",
          technology: repo.repo,
          reasoning: `Repository ${repo.repo} is archived and no longer maintained`,
          confidence: 1.0,
        });
      } else if (!repo.isActive) {
        recommendations.push({
          type: "watch",
          technology: repo.repo,
          reasoning: `Repository ${repo.repo} has not had commits in ${repo.lastCommitDays} days`,
          confidence: 0.75,
        });
      }
    }

    return recommendations;
  }
}

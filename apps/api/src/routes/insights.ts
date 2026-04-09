import type { FastifyInstance } from "fastify";
import { Role } from "@archibald/auth";
import { requireRole } from "../middleware/rbac.js";
import { validateParams } from "../middleware/validation.js";
import { commonSchemas } from "../middleware/schemas.js";
import { env } from "../env.js";

export interface InsightsDeps {
  prisma: any;
}

export function buildInsightsRoutes(app: FastifyInstance, deps: InsightsDeps): void {
  // GET /v1/products/:id/insights — Self-evolution insights for one product
  app.get(
    "/v1/products/:id/insights",
    { preHandler: [requireRole(Role.VIEWER), validateParams(commonSchemas.uuidParam)] },
    async (request, reply) => {
      const { id } = (request as any).validatedParams;
      const { orgId } = request.auth;

      const product = await deps.prisma.archibaldProduct?.findFirst({
        where: { id, orgId },
      });

      if (!product) {
        return reply.status(404).send({ error: "Product not found" });
      }

      const runs = await deps.prisma.archibaldLifecycleRun?.findMany({
        where: { productId: id, status: "completed" },
        include: {
          agentExecutions: true,
          stageTransitions: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }) ?? [];

      const totalRuns = runs.length;
      const avgDuration = totalRuns > 0
        ? runs.reduce((acc: number, r: any) => {
            if (r.completedAt && r.createdAt) {
              return acc + (new Date(r.completedAt).getTime() - new Date(r.createdAt).getTime());
            }
            return acc;
          }, 0) / totalRuns
        : 0;

      // Identify stages that frequently loop back
      const loopStages = runs.flatMap((r: any) => r.stageTransitions ?? [])
        .filter((t: any) => t.isLoopback)
        .reduce((acc: Record<string, number>, t: any) => {
          acc[t.fromStage] = (acc[t.fromStage] ?? 0) + 1;
          return acc;
        }, {});

      const insights = await deps.prisma.archibaldInsight?.findMany({
        where: { productId: id, dismissed: false },
        orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
        take: 20,
      }) ?? [];

      return reply.send({
        productId: id,
        productName: product.name,
        metrics: {
          totalLifecycleRuns: totalRuns,
          avgDurationMs: Math.round(avgDuration),
          loopStageFrequency: loopStages,
        },
        insights,
      });
    },
  );

  // GET /v1/ecosystem/insights — Cross-product patterns and anti-patterns
  app.get(
    "/v1/ecosystem/insights",
    { preHandler: [requireRole(Role.VIEWER)] },
    async (request, reply) => {
      const { orgId } = request.auth;

      const insights = await deps.prisma.archibaldInsight?.findMany({
        where: { orgId, dismissed: false, scope: "ecosystem" },
        orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
        take: 50,
      }) ?? [];

      const productCount = await deps.prisma.archibaldProduct?.count({ where: { orgId } }) ?? 0;
      const totalRuns = await deps.prisma.archibaldLifecycleRun?.count({ where: { orgId } }) ?? 0;

      const antiPatterns = insights.filter((i: any) => i.type === "anti_pattern");
      const positivePatterns = insights.filter((i: any) => i.type === "pattern");
      const techRecommendations = insights.filter((i: any) => i.type === "tech_recommendation");

      return reply.send({
        orgId,
        summary: {
          productCount,
          totalLifecycleRuns: totalRuns,
          confidenceScore: totalRuns >= 5 ? Math.min(95, 40 + totalRuns * 2.5) : null,
          confidenceNote: totalRuns < 5 ? "Insufficient data for high-confidence insights. Complete at least 5 lifecycle runs." : null,
        },
        antiPatterns,
        positivePatterns,
        techRecommendations,
        allInsights: insights,
      });
    },
  );

  // GET /v1/ecosystem/health — Health of all 5 solutions
  app.get(
    "/v1/ecosystem/health",
    { preHandler: [requireRole(Role.VIEWER)] },
    async (_request, reply) => {
      const solutions = [
        { name: "SENTINEL", url: `${env.SENTINEL_API_URL}/health`, port: 8080, description: "AI code governance" },
        { name: "ARCHINTEL", url: `${env.ARCHINTEL_API_URL}/health`, port: 8090, description: "Knowledge graph" },
        { name: "PHOENIX", url: `${env.PHOENIX_API_URL}/health`, port: 8100, description: "Self-healing" },
        { name: "FORGE", url: "http://localhost:8110/health", port: 8110, description: "Non-technical interface" },
        { name: "ARCHIBALD", url: "http://localhost:8120/health", port: 8120, description: "Lifecycle orchestrator" },
      ];

      const healthChecks = await Promise.allSettled(
        solutions.map(async (s) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          try {
            const res = await fetch(s.url, { signal: controller.signal });
            clearTimeout(timeoutId);
            return { ...s, status: res.ok ? "healthy" : "degraded", httpStatus: res.status };
          } catch (err) {
            clearTimeout(timeoutId);
            const message = err instanceof Error ? err.message : "unreachable";
            return { ...s, status: "unreachable", error: message };
          }
        }),
      );

      const results = healthChecks.map((r, i) => {
        const solution = solutions[i]!;
        if (r.status === "fulfilled") return r.value;
        return { ...solution, status: "unreachable", error: "Check failed" };
      });

      const healthyCount = results.filter((r) => r.status === "healthy").length;
      const overallStatus = healthyCount === 5 ? "healthy" : healthyCount >= 3 ? "degraded" : "critical";

      return reply.send({
        overallStatus,
        healthyCount,
        totalCount: 5,
        solutions: results,
        checkedAt: new Date().toISOString(),
      });
    },
  );
}

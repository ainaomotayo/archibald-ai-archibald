import type { FastifyInstance } from "fastify";
import { Role } from "@archibald/auth";
import { requireRole } from "../middleware/rbac.js";
import { validateParams, validateQuery } from "../middleware/validation.js";
import { commonSchemas } from "../middleware/schemas.js";
import { z } from "zod";

export interface AgentDeps {
  prisma: any;
}

const executionParam = z.object({ executionId: z.string().uuid() });

export function buildAgentRoutes(app: FastifyInstance, deps: AgentDeps): void {
  // GET /v1/agents — List active agent executions (ADMIN only)
  app.get(
    "/v1/agents",
    { preHandler: [requireRole(Role.ADMIN), validateQuery(commonSchemas.pagination)] },
    async (request, reply) => {
      const { page = 1, limit = 20 } = (request as any).validatedQuery ?? {};
      const skip = (page - 1) * limit;
      const { orgId } = request.auth;

      const [executions, total] = await Promise.all([
        deps.prisma.archibaldAgentExecution?.findMany({
          where: {
            orgId,
            status: { in: ["running", "waiting_for_human", "retrying"] },
          },
          include: {
            lifecycleRun: {
              include: { product: { select: { name: true } } },
            },
          },
          skip,
          take: limit,
          orderBy: { startedAt: "desc" },
        }) ?? [],
        deps.prisma.archibaldAgentExecution?.count({
          where: {
            orgId,
            status: { in: ["running", "waiting_for_human", "retrying"] },
          },
        }) ?? 0,
      ]);

      return reply.send({ executions, total, page, limit });
    },
  );

  // GET /v1/agents/:executionId — Agent execution details (ADMIN only)
  app.get(
    "/v1/agents/:executionId",
    { preHandler: [requireRole(Role.ADMIN), validateParams(executionParam)] },
    async (request, reply) => {
      const { executionId } = (request as any).validatedParams;
      const { orgId } = request.auth;

      const execution = await deps.prisma.archibaldAgentExecution?.findFirst({
        where: { id: executionId, orgId },
        include: {
          lifecycleRun: {
            include: { product: true },
          },
          evidence: true,
          logs: { orderBy: { timestamp: "asc" }, take: 500 },
        },
      });

      if (!execution) {
        return reply.status(404).send({ error: "Agent execution not found" });
      }

      return reply.send(execution);
    },
  );
}

import type { FastifyInstance } from "fastify";
import { Role } from "@archibald/auth";
import { requireRole } from "../middleware/rbac.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import { commonSchemas, decisionSchemas } from "../middleware/schemas.js";
import { z } from "zod";

export interface DecisionDeps {
  prisma: any;
  publish: (stream: string, data: Record<string, unknown>) => Promise<string>;
}

const decisionIdParam = z.object({
  id: z.string().uuid(),
  decisionId: z.string().uuid(),
});

export function buildDecisionRoutes(app: FastifyInstance, deps: DecisionDeps): void {
  // GET /v1/products/:id/decisions — List pending decisions for a product
  app.get(
    "/v1/products/:id/decisions",
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

      const decisions = await deps.prisma.archibaldDecision?.findMany({
        where: { productId: id, status: "pending" },
        orderBy: [
          { urgency: "desc" },
          { createdAt: "asc" },
        ],
      }) ?? [];

      return reply.send({ decisions });
    },
  );

  // POST /v1/products/:id/decisions/:decisionId/approve
  app.post(
    "/v1/products/:id/decisions/:decisionId/approve",
    { preHandler: [requireRole(Role.ENGINEER), validateParams(decisionIdParam), validateBody(decisionSchemas.approve)] },
    async (request, reply) => {
      const { id, decisionId } = (request as any).validatedParams;
      const { comment } = (request as any).validatedBody ?? {};
      const { orgId, userId } = request.auth;

      const decision = await deps.prisma.archibaldDecision?.findFirst({
        where: { id: decisionId, productId: id, orgId, status: "pending" },
      });

      if (!decision) {
        return reply.status(404).send({ error: "Decision not found or already resolved" });
      }

      const updated = await deps.prisma.archibaldDecision?.update({
        where: { id: decisionId },
        data: {
          status: "approved",
          resolvedBy: userId,
          resolvedAt: new Date(),
          comment: comment ?? null,
        },
      }) ?? { ...decision, status: "approved", resolvedBy: userId };

      await deps.publish("archibald.decisions", {
        type: "decision.approved",
        decisionId,
        productId: id,
        orgId,
        runId: decision.runId,
        resolvedBy: userId,
        comment: comment ?? null,
      });

      return reply.send({ decision: updated });
    },
  );

  // POST /v1/products/:id/decisions/:decisionId/reject
  app.post(
    "/v1/products/:id/decisions/:decisionId/reject",
    { preHandler: [requireRole(Role.ENGINEER), validateParams(decisionIdParam), validateBody(decisionSchemas.reject)] },
    async (request, reply) => {
      const { id, decisionId } = (request as any).validatedParams;
      const { justification } = (request as any).validatedBody;
      const { orgId, userId } = request.auth;

      const decision = await deps.prisma.archibaldDecision?.findFirst({
        where: { id: decisionId, productId: id, orgId, status: "pending" },
      });

      if (!decision) {
        return reply.status(404).send({ error: "Decision not found or already resolved" });
      }

      const updated = await deps.prisma.archibaldDecision?.update({
        where: { id: decisionId },
        data: {
          status: "rejected",
          resolvedBy: userId,
          resolvedAt: new Date(),
          justification,
        },
      }) ?? { ...decision, status: "rejected", resolvedBy: userId };

      await deps.publish("archibald.decisions", {
        type: "decision.rejected",
        decisionId,
        productId: id,
        orgId,
        runId: decision.runId,
        resolvedBy: userId,
        justification,
      });

      return reply.send({ decision: updated });
    },
  );
}

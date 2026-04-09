import type { FastifyInstance } from "fastify";
import { Role } from "@archibald/auth";
import { requireRole } from "../middleware/rbac.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.js";
import { productSchemas, commonSchemas } from "../middleware/schemas.js";

export interface ProductDeps {
  prisma: any;
  publish: (stream: string, data: Record<string, unknown>) => Promise<string>;
}

export function buildProductRoutes(app: FastifyInstance, deps: ProductDeps): void {
  // POST /v1/products — Register a product for lifecycle management
  app.post(
    "/v1/products",
    { preHandler: [requireRole(Role.ENGINEER), validateBody(productSchemas.create)] },
    async (request, reply) => {
      const { name, description, owner, techStack } = (request as any).validatedBody;
      const { orgId, userId } = request.auth;

      const existing = await deps.prisma.archibaldProduct?.findFirst({
        where: { orgId, name },
      });
      if (existing) {
        return reply.status(409).send({ error: "A product with this name already exists" });
      }

      const product = await deps.prisma.archibaldProduct?.create({
        data: {
          orgId,
          name,
          description,
          owner,
          techStack: techStack ?? [],
          currentStage: "conception",
          createdBy: userId,
        },
      }) ?? {
        id: crypto.randomUUID(),
        orgId,
        name,
        description,
        owner,
        techStack: techStack ?? [],
        currentStage: "conception",
        createdBy: userId,
        createdAt: new Date().toISOString(),
      };

      await deps.publish("archibald.products", {
        type: "product.registered",
        productId: product.id,
        orgId,
        name,
        owner,
      });

      return reply.status(201).send({ product });
    },
  );

  // GET /v1/products — List products for org
  app.get(
    "/v1/products",
    { preHandler: [requireRole(Role.VIEWER), validateQuery(commonSchemas.pagination)] },
    async (request, reply) => {
      const { page = 1, limit = 20 } = (request as any).validatedQuery ?? {};
      const skip = (page - 1) * limit;
      const { orgId } = request.auth;

      const [products, total] = await Promise.all([
        deps.prisma.archibaldProduct?.findMany({
          where: { orgId },
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
        }) ?? [],
        deps.prisma.archibaldProduct?.count({ where: { orgId } }) ?? 0,
      ]);

      return reply.send({ products, total, page, limit });
    },
  );

  // GET /v1/products/:id — Get product with current lifecycle state
  app.get(
    "/v1/products/:id",
    { preHandler: [requireRole(Role.VIEWER), validateParams(commonSchemas.uuidParam)] },
    async (request, reply) => {
      const { id } = (request as any).validatedParams;
      const { orgId } = request.auth;

      const product = await deps.prisma.archibaldProduct?.findFirst({
        where: { id, orgId },
        include: {
          lifecycleRuns: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!product) {
        return reply.status(404).send({ error: "Product not found" });
      }

      return reply.send(product);
    },
  );

  // GET /v1/products/:id/lifecycle — Current lifecycle state with active agents
  app.get(
    "/v1/products/:id/lifecycle",
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

      const currentRun = await deps.prisma.archibaldLifecycleRun?.findFirst({
        where: { productId: id, status: { in: ["running", "waiting"] } },
        include: {
          agentExecutions: {
            where: { status: { in: ["running", "waiting_for_human"] } },
            orderBy: { startedAt: "desc" },
          },
        },
      });

      const pendingDecisions = await deps.prisma.archibaldDecision?.findMany({
        where: { productId: id, status: "pending" },
        orderBy: { createdAt: "asc" },
      }) ?? [];

      return reply.send({
        productId: id,
        currentStage: product.currentStage,
        activeRun: currentRun ?? null,
        pendingDecisions,
      });
    },
  );

  // GET /v1/products/:id/lifecycle/history — Full stage history
  app.get(
    "/v1/products/:id/lifecycle/history",
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
        where: { productId: id },
        include: {
          stageTransitions: { orderBy: { occurredAt: "asc" } },
          agentExecutions: { orderBy: { startedAt: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      }) ?? [];

      return reply.send({ productId: id, runs });
    },
  );

  // POST /v1/products/:id/lifecycle/start — Start a lifecycle run
  app.post(
    "/v1/products/:id/lifecycle/start",
    { preHandler: [requireRole(Role.ENGINEER), validateParams(commonSchemas.uuidParam), validateBody(productSchemas.startLifecycle)] },
    async (request, reply) => {
      const { id } = (request as any).validatedParams;
      const { requirement, type } = (request as any).validatedBody;
      const { orgId, userId } = request.auth;

      const product = await deps.prisma.archibaldProduct?.findFirst({
        where: { id, orgId },
      });

      if (!product) {
        return reply.status(404).send({ error: "Product not found" });
      }

      // Check no active run already in progress
      const activeRun = await deps.prisma.archibaldLifecycleRun?.findFirst({
        where: { productId: id, status: { in: ["running", "waiting"] } },
      });

      if (activeRun) {
        return reply.status(409).send({
          error: "A lifecycle run is already in progress",
          activeRunId: activeRun.id,
        });
      }

      const run = await deps.prisma.archibaldLifecycleRun?.create({
        data: {
          productId: id,
          orgId,
          requirement,
          type,
          triggeredBy: userId,
          status: "running",
          currentStage: "requirements",
        },
      }) ?? {
        id: crypto.randomUUID(),
        productId: id,
        orgId,
        requirement,
        type,
        triggeredBy: userId,
        status: "running",
        currentStage: "requirements",
        createdAt: new Date().toISOString(),
      };

      // Publish to orchestrator via event bus
      await deps.publish("archibald.lifecycle", {
        type: "lifecycle.start.requested",
        runId: run.id,
        productId: id,
        orgId,
        requirement,
        lifecycleType: type,
        triggeredBy: userId,
      });

      return reply.status(202).send({
        run,
        message: "Lifecycle run started. ARCHIBALD is now processing your requirement.",
      });
    },
  );
}

import Fastify from "fastify";
import { createAuthMiddleware, type AuthMiddlewareDeps } from "./middleware/auth.js";
import { buildProductRoutes, type ProductDeps } from "./routes/products.js";
import { buildDecisionRoutes, type DecisionDeps } from "./routes/decisions.js";
import { buildInsightsRoutes, type InsightsDeps } from "./routes/insights.js";
import { buildAgentRoutes, type AgentDeps } from "./routes/agents.js";

export interface AppDeps {
  auth: AuthMiddlewareDeps;
  products: ProductDeps;
  decisions: DecisionDeps;
  insights: InsightsDeps;
  agents: AgentDeps;
}

export async function buildApp(deps?: AppDeps) {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    trustProxy: true,
  });

  // Health endpoints (no auth required)
  app.get("/health", async () => ({
    status: "ok",
    service: "archibald-api",
    timestamp: new Date().toISOString(),
  }));

  app.get("/ready", async () => ({ status: "ready" }));

  if (deps) {
    // Auth middleware on all /v1/* routes
    app.addHook("onRequest", async (request, reply) => {
      const skipPaths = ["/health", "/ready"];
      if (skipPaths.some((p) => request.url.startsWith(p))) return;
      await createAuthMiddleware(deps.auth)(request, reply);
    });

    // Wire routes
    buildProductRoutes(app, deps.products);
    buildDecisionRoutes(app, deps.decisions);
    buildInsightsRoutes(app, deps.insights);
    buildAgentRoutes(app, deps.agents);
  }

  // Global error handler
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;

    if (statusCode >= 500) {
      app.log.error({ err: error }, "Unhandled error");
    }

    return reply.status(statusCode).send({
      error: message,
      code: error.code ?? "INTERNAL_ERROR",
    });
  });

  return app;
}

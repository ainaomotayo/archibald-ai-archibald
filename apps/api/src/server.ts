import "./env.js";
import { buildApp } from "./app.js";
import { env } from "./env.js";
import IORedis from "ioredis";

const redis = new IORedis.default(env.REDIS_URL);

// Publish helper for event bus
async function publish(stream: string, data: Record<string, unknown>): Promise<string> {
  const fields = Object.entries(data).flatMap(([k, v]) => [
    k,
    typeof v === "string" ? v : JSON.stringify(v),
  ]);
  const id = await redis.xadd(stream, "*", ...fields);
  return id ?? "";
}

const app = await buildApp({
  auth: {
    jwtSecret: env.JWT_SECRET,
    lookupApiKey: async (_hash: string) => {
      // TODO: wire to database API key lookup
      return null;
    },
  },
  products: { prisma: null as any, publish },
  decisions: { prisma: null as any, publish },
  insights: { prisma: null as any },
  agents: { prisma: null as any },
});

await app.listen({ port: env.PORT, host: "0.0.0.0" });

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down gracefully...`);
  await app.close();
  await redis.quit();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyToken, hashApiKey, type AuthPayload } from "@archibald/auth";

// Augment Fastify request type
declare module "fastify" {
  interface FastifyRequest {
    auth: AuthPayload;
  }
}

export interface AuthMiddlewareDeps {
  jwtSecret: string;
  lookupApiKey: (hash: string) => Promise<{ userId: string; orgId: string; role: string } | null>;
}

export function createAuthMiddleware(deps: AuthMiddlewareDeps) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // 1. Try Bearer JWT
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        request.auth = await verifyToken(authHeader.slice(7), deps.jwtSecret);
        return;
      } catch {
        return reply.status(401).send({ error: "Invalid or expired token" });
      }
    }

    // 2. Try API key
    const apiKey = request.headers["x-api-key"] as string | undefined;
    if (apiKey) {
      const hash = hashApiKey(apiKey);
      const result = await deps.lookupApiKey(hash);
      if (!result) return reply.status(401).send({ error: "Invalid API key" });
      request.auth = result;
      return;
    }

    // 3. Internal service headers (service-to-service calls within the ecosystem)
    const orgId = request.headers["x-org-id"] as string | undefined;
    const userId = request.headers["x-user-id"] as string | undefined;
    const role = (request.headers["x-role"] as string) ?? "VIEWER";
    if (orgId && userId) {
      request.auth = { userId, orgId, role };
      return;
    }

    return reply.status(401).send({ error: "Authentication required" });
  };
}

import type { FastifyRequest, FastifyReply } from "fastify";
import { canAccess, Role } from "@archibald/auth";

export function requireRole(requiredRole: Role) {
  return async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.auth) {
      return reply.status(401).send({ error: "Authentication required" });
    }
    if (!canAccess(request.auth.role as Role, requiredRole)) {
      return reply.status(403).send({ error: "Insufficient permissions" });
    }
  };
}

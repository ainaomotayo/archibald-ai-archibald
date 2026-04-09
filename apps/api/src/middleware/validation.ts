import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";

export interface ValidationError {
  code: "VALIDATION_ERROR";
  fields: Array<{ field: string; message: string }>;
}

function formatZodError(error: z.ZodError): ValidationError {
  return {
    code: "VALIDATION_ERROR",
    fields: error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send(formatZodError(result.error));
    }
    (request as unknown as Record<string, unknown>).validatedBody = result.data;
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = schema.safeParse(request.query);
    if (!result.success) {
      return reply.status(400).send(formatZodError(result.error));
    }
    (request as unknown as Record<string, unknown>).validatedQuery = result.data;
  };
}

export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = schema.safeParse(request.params);
    if (!result.success) {
      return reply.status(400).send(formatZodError(result.error));
    }
    (request as unknown as Record<string, unknown>).validatedParams = result.data;
  };
}

import { z } from "zod";

const safeString = z.string().trim().max(10000);
const shortString = z.string().trim().min(1).max(255);

export const commonSchemas = {
  uuidParam: z.object({ id: z.string().uuid() }),
  decisionParam: z.object({ id: z.string().uuid(), decisionId: z.string().uuid() }),
  executionParam: z.object({ executionId: z.string().uuid() }),
  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  }),
};

export const productSchemas = {
  create: z.object({
    name: shortString,
    description: safeString.min(1),
    owner: shortString,
    techStack: z.array(shortString).optional(),
  }).strict(),

  startLifecycle: z.object({
    requirement: safeString.min(10),
    type: z.enum(["feature", "bugfix", "refactor", "new_product"]),
  }).strict(),
};

export const decisionSchemas = {
  reject: z.object({
    justification: safeString.min(1),
  }).strict(),

  approve: z.object({
    comment: safeString.optional(),
  }).strict(),
};

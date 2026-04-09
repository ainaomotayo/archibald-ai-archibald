function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const isTest = process.env.NODE_ENV === "test" || process.env.VITEST;

export const env = {
  NODE_ENV: optional("NODE_ENV", "development"),
  PORT: parseInt(optional("PORT", "8120"), 10),
  DATABASE_URL: isTest ? "postgresql://test:test@localhost:5432/test" : required("DATABASE_URL"),
  REDIS_URL: optional("REDIS_URL", "redis://localhost:6379"),
  JWT_SECRET: isTest ? "test-jwt-secret" : required("JWT_SECRET"),
  SENTINEL_API_URL: optional("SENTINEL_API_URL", "http://localhost:8080"),
  ARCHINTEL_API_URL: optional("ARCHINTEL_API_URL", "http://localhost:8090"),
  PHOENIX_API_URL: optional("PHOENIX_API_URL", "http://localhost:8100"),
  FORGE_API_URL: optional("FORGE_API_URL", "http://localhost:8110"),
  LLM_PROVIDER: optional("LLM_PROVIDER", "claude") as "claude" | "openai" | "azure-openai" | "ollama",
  LLM_API_KEY: process.env.LLM_API_KEY ?? "",
  LOG_LEVEL: optional("LOG_LEVEL", "info"),
} as const;

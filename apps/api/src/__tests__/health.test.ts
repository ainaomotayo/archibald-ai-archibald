import { describe, it, expect, afterAll } from "vitest";
import { buildApp } from "../app.js";

describe("Health endpoints", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  afterAll(async () => {
    await app?.close();
  });

  it("GET /health returns ok", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("archibald-api");
    expect(body.timestamp).toBeDefined();
  });

  it("GET /ready returns ready", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
  });

  it("GET /health shape includes service field", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    const body = res.json();
    expect(typeof body.service).toBe("string");
    expect(body.service).toContain("archibald");
  });
});

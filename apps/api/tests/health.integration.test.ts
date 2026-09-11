import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HealthController } from "../src/modules/health/health.controller";
import type { Database } from "../src/infrastructure/database/connection";
import { AppEnvironmentService } from "../src/infrastructure/security/security.module";
import { createTestApp } from "./helpers/host-fixture";

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

/** A reply double that records the status the controller asked for. */
function fakeReply() {
  const captured = { code: 200 };
  return {
    reply: {
      status(code: number) {
        captured.code = code;
        return this;
      },
    },
    captured,
  };
}

describe("liveness and readiness", () => {
  /**
   * The distinction that matters: liveness restarts a process, readiness takes
   * it out of the load balancer. Making /health touch the database would turn
   * a database blip into a rolling restart of every instance
   * (milestone 11 §16).
   */
  it("liveness answers without consulting a dependency", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      environment: expect.any(String),
      uptimeSeconds: expect.any(Number),
    });
  });

  it("readiness is true when PostgreSQL and Redis both answer", async () => {
    const response = await app.inject({ method: "GET", url: "/api/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      database: { status: "up" },
      redis: { status: "up" },
    });
  });

  it("readiness is false and 503 when the database is unavailable", async () => {
    const controller = new HealthController(
      { db: { execute: () => Promise.reject(new Error("ECONNREFUSED")) } } as unknown as Database,
      { ping: () => Promise.resolve("PONG") } as never,
      { name: "test" } as AppEnvironmentService,
    );

    const { reply, captured } = fakeReply();
    const result = await controller.ready(reply as never);

    expect(captured.code).toBe(503);
    expect(result.status).toBe("not_ready");
    expect(result.database.status).toBe("down");
    expect(result.redis.status).toBe("up");
  });

  it("readiness is false and 503 when Redis is unavailable", async () => {
    const controller = new HealthController(
      { db: { execute: () => Promise.resolve([]) } } as unknown as Database,
      { ping: () => Promise.reject(new Error("ECONNREFUSED")) } as never,
      { name: "test" } as AppEnvironmentService,
    );

    const { reply, captured } = fakeReply();
    const result = await controller.ready(reply as never);

    expect(captured.code).toBe(503);
    expect(result.status).toBe("not_ready");
    expect(result.redis.status).toBe("down");
  });

  /** A probe body must never carry a connection string or a driver message. */
  it("never leaks connection details in the readiness body", async () => {
    const controller = new HealthController(
      {
        db: {
          execute: () =>
            Promise.reject(new Error("connect ECONNREFUSED postgresql://user:hunter2@db:5432")),
        },
      } as unknown as Database,
      { ping: () => Promise.resolve("PONG") } as never,
      { name: "test" } as AppEnvironmentService,
    );

    const { reply } = fakeReply();
    const result = await controller.ready(reply as never);

    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("postgresql://");
    // A driver code, or the generic fallback — never the message.
    expect(result.database.error).toBe("UNAVAILABLE");
  });
});

// The controller writes its own diagnostics; silence keeps the suite readable.
Logger.overrideLogger(false);

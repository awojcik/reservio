import { Controller, Get, Inject, Logger, Res } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { sql } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import type { Redis } from "ioredis";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { REDIS_CONNECTION } from "../../infrastructure/queue/queue.module";
import { AppEnvironmentService } from "../../infrastructure/security/security.module";
import {
  DependencyHealthDto,
  HealthResponseDto,
  ReadinessResponseDto,
} from "./dto/health.dto";

/** A dependency that has not answered in this long is treated as down. */
const PROBE_TIMEOUT_MS = 2_000;

async function probe(
  name: string,
  check: () => Promise<unknown>,
  logger: Logger,
): Promise<DependencyHealthDto> {
  const started = Date.now();

  try {
    await Promise.race([
      check(),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), PROBE_TIMEOUT_MS).unref(),
      ),
    ]);
    return { status: "up", latencyMs: Date.now() - started, error: null };
  } catch (error) {
    /*
     * The detail goes to the logs; the body carries only a driver error code.
     * Never the message — a postgres connection failure spells the whole DSN,
     * password included, into its own message text, and a readiness endpoint
     * is usually the least protected thing a service exposes (§25).
     */
    logger.error({ event: "health.dependency_down", dependency: name, error });

    const raw = (error as { code?: string }).code;
    const code = typeof raw === "string" && /^[A-Z][A-Z0-9_]{1,39}$/.test(raw) ? raw : "UNAVAILABLE";

    return { status: "down", latencyMs: null, error: code };
  }
}

@ApiTags("health")
@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    private readonly environment: AppEnvironmentService,
  ) {}

  /**
   * Liveness. Answers "is this process still running its event loop", and
   * deliberately nothing else.
   *
   * Touching PostgreSQL here would make a database blip look like a dead
   * process, and an orchestrator restarting every instance is the worst thing
   * that can happen during a database blip (milestone 11 §16).
   */
  @Get("health")
  @ApiOperation({
    summary: "Liveness",
    description:
      "Sam proces. Nie odpytuje bazy ani Redisa — restart instancji nie naprawia niedostępnej zależności.",
  })
  @ApiOkResponse({ type: HealthResponseDto })
  check(): HealthResponseDto {
    return {
      status: "ok",
      version: process.env.npm_package_version ?? "0.2.0",
      environment: this.environment.name,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  /**
   * Readiness. Answers "may this instance receive traffic".
   *
   * PostgreSQL and Redis, both cheap: `SELECT 1` and a `PING`. No Stripe and
   * no iCal — a health check that calls a third party makes their outage our
   * outage, and pays for it on every probe (milestone 11 §16).
   */
  @Get("ready")
  @ApiOperation({
    summary: "Readiness",
    description:
      "PostgreSQL i Redis. 503, gdy którakolwiek zależność nie odpowiada — instancja nie powinna wtedy dostawać ruchu.",
  })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ type: ReadinessResponseDto })
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessResponseDto> {
    const [database, redis] = await Promise.all([
      probe("postgres", () => this.database.db.execute(sql`SELECT 1`), this.logger),
      probe("redis", () => this.redis.ping(), this.logger),
    ]);

    const ready = database.status === "up" && redis.status === "up";
    // A body on 503 too: the probe that failed is the whole point of asking.
    if (!ready) reply.status(503);

    return { status: ready ? "ready" : "not_ready", database, redis };
  }
}

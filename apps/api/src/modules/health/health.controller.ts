import { Controller, Get, Inject, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { sql } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { HealthResponseDto } from "./dto/health.dto";

@ApiTags("health")
@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  @Get()
  @ApiOperation({
    summary: "Stan usługi",
    description: "Weryfikuje połączenie z PostgreSQL. Niedostępna baza to 503, nie 200.",
  })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ description: "Baza danych jest nieosiągalna" })
  async check(): Promise<HealthResponseDto> {
    try {
      await this.database.db.execute(sql`SELECT 1`);
      return { status: "ok" };
    } catch (error) {
      // Details go to the logs; the client gets a plain 503 with no internals.
      this.logger.error("database connection error", error as Error);
      throw new ServiceUnavailableException("Baza danych jest nieosiągalna");
    }
  }
}

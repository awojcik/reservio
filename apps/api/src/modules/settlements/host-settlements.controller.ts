import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { desc, eq } from "drizzle-orm";

import { CurrentHost, HostGuard } from "../auth/auth.guards";
import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { Inject } from "@nestjs/common";
import { hostPayouts, type HostRow } from "../../infrastructure/database/schema";
import { HostPaymentsService } from "../payments/host-payments.service";
import {
  HostFinanceSummaryDto,
  HostPayoutDto,
  SettlementDto,
  SettlementsPageDto,
  SettlementsQueryDto,
} from "./dto/settlement.dto";
import { SettlementWorker } from "./settlement.worker";
import { SettlementsService } from "./settlements.service";

/**
 * The Host's finances. Every read is scoped to the Host resolved from the
 * session — one Host can never see another's money (milestone 10 §28).
 */
@ApiTags("host-settlements")
@ApiCookieAuth()
@UseGuards(HostGuard)
@Controller("host")
export class HostSettlementsController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly settlements: SettlementsService,
    private readonly accounts: HostPaymentsService,
    private readonly worker: SettlementWorker,
    private readonly config: ConfigService,
  ) {}

  /** Manual release exists for testing, and only outside production. */
  private get sandbox(): boolean {
    const key = this.config.get<string>("STRIPE_SECRET_KEY") ?? "";
    return this.config.get("NODE_ENV") !== "production" && !key.startsWith("sk_live_");
  }

  @Get("payments/summary")
  @ApiOperation({
    summary: "Podsumowanie finansów gospodarza",
    description:
      "Salda są wyliczane z rozliczeń, nie przechowywane — nie ma osobnej kolumny z saldem, która mogłaby się rozjechać.",
  })
  @ApiOkResponse({ type: HostFinanceSummaryDto })
  async summary(@CurrentHost() host: HostRow): Promise<HostFinanceSummaryDto> {
    const [balance, account, payouts] = await Promise.all([
      this.settlements.summaryFor(host.id),
      this.accounts.status(host.id),
      this.database.db
        .select()
        .from(hostPayouts)
        .where(eq(hostPayouts.hostId, host.id))
        .orderBy(desc(hostPayouts.createdAt))
        .limit(10),
    ]);

    return {
      balance,
      payoutsReady: account.readiness === "READY",
      accountReadiness: account.readiness,
      recentPayouts: payouts.map(toPayoutDto),
    };
  }

  @Get("settlements")
  @ApiOperation({ summary: "Historia rozliczeń" })
  @ApiOkResponse({ type: SettlementsPageDto })
  async list(
    @CurrentHost() host: HostRow,
    @Query() query: SettlementsQueryDto,
  ): Promise<SettlementsPageDto> {
    const rows = await this.settlements.listForHost(
      host.id,
      query.limit ?? 25,
      query.offset ?? 0,
    );

    return {
      items: rows.map((row) => this.toDto(row)),
      total: rows.length,
    };
  }

  @Get("settlements/:id")
  @ApiOperation({ summary: "Pojedyncze rozliczenie" })
  @ApiOkResponse({ type: SettlementDto })
  @ApiNotFoundResponse({ description: "Rozliczenie nie należy do tego gospodarza" })
  async findOne(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<SettlementDto> {
    await this.settlements.ownedById(host.id, id);

    const [row] = (await this.settlements.listForHost(host.id, 100, 0)).filter(
      (candidate) => candidate.settlement.id === id,
    );

    return this.toDto(row);
  }

  /**
   * Sandbox shortcut so the whole money flow can be exercised without waiting
   * a day. Uses the same release command and the same invariants
   * (milestone 10 §27).
   */
  @Post("settlements/:id/release-now")
  @HttpCode(200)
  @ApiOperation({
    summary: "Zwolnij środki teraz (tylko środowisko testowe)",
    description:
      "Pomija wyłącznie oczekiwanie na zegar. Wszystkie pozostałe warunki — status rezerwacji, płatność, brak zwrotu — są sprawdzane normalnie.",
  })
  @ApiOkResponse({ type: SettlementDto })
  @ApiConflictResponse({ description: "SETTLEMENT_NOT_RELEASABLE" })
  async releaseNow(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<SettlementDto> {
    const settlement = await this.settlements.releaseNow(host.id, id);

    // Straight on to the transfer, exactly as the scheduled release would.
    await this.worker.enqueueTransfer(settlement.id);

    return this.findOne(host, id);
  }

  @Get("payouts")
  @ApiOperation({
    summary: "Wypłaty na konto bankowe",
    description:
      "Wypłaty wykonuje dostawca według harmonogramu konta. Rezervio je obserwuje, nie inicjuje.",
  })
  @ApiOkResponse({ type: [HostPayoutDto] })
  async payouts(@CurrentHost() host: HostRow): Promise<HostPayoutDto[]> {
    const rows = await this.database.db
      .select()
      .from(hostPayouts)
      .where(eq(hostPayouts.hostId, host.id))
      .orderBy(desc(hostPayouts.createdAt))
      .limit(50);

    return rows.map(toPayoutDto);
  }

  private toDto(row: Awaited<ReturnType<SettlementsService["listForHost"]>>[number]): SettlementDto {
    const { settlement } = row;

    return {
      id: settlement.id,
      bookingReference: row.reference,
      propertyTitle: row.propertyTitle,
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      grossAmountMinor: settlement.grossAmountMinor,
      platformFeeMinor: settlement.platformFeeMinor,
      hostAmountMinor: settlement.hostAmountMinor,
      currency: settlement.currency,
      status: settlement.status,
      releaseAt: settlement.releaseAt.toISOString(),
      transferredAt: settlement.transferredAt?.toISOString() ?? null,
      transferStatus: row.transferStatus,
      canReleaseNow: this.sandbox && settlement.status === "PENDING",
    };
  }
}

function toPayoutDto(row: typeof hostPayouts.$inferSelect): HostPayoutDto {
  return {
    id: row.id,
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status,
    arrivalAt: row.arrivalAt?.toISOString() ?? null,
    failureMessage: row.failureMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

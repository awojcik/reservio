import { Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentHost, CurrentUser, HostGuard } from "../auth/auth.guards";
import type { SessionUser } from "../auth/sessions.service";
import type { HostRow } from "../../infrastructure/database/schema";
import { HostPaymentStatusDto, OnboardingLinkDto } from "./dto/payment.dto";
import { HostPaymentsService } from "./host-payments.service";

/**
 * Connect, only as far as a Host needs it to be payable. Balances, transfers
 * and payouts are milestone 10 (milestone 08 §32).
 */
@ApiTags("host-payments")
@ApiCookieAuth()
@UseGuards(HostGuard)
@Controller("host/payments")
export class HostPaymentsController {
  constructor(private readonly accounts: HostPaymentsService) {}

  @Post("connect-account")
  @HttpCode(200)
  @ApiOperation({
    summary: "Utworzenie konta rozliczeniowego",
    description: "Idempotentne — powtórzone wywołanie zwraca istniejące konto.",
  })
  @ApiOkResponse({ type: HostPaymentStatusDto })
  async createAccount(
    @CurrentHost() host: HostRow,
    @CurrentUser() user: SessionUser,
  ): Promise<HostPaymentStatusDto> {
    return this.accounts.ensureAccount(host.id, user.email);
  }

  @Post("onboarding-link")
  @HttpCode(200)
  @ApiOperation({
    summary: "Link do konfiguracji płatności",
    description:
      "Konfigurację prowadzi dostawca płatności. Rezervio nie zbiera danych weryfikacyjnych.",
  })
  @ApiOkResponse({ type: OnboardingLinkDto })
  async onboardingLink(
    @CurrentHost() host: HostRow,
    @CurrentUser() user: SessionUser,
  ): Promise<OnboardingLinkDto> {
    return this.accounts.onboardingLink(host.id, user.email);
  }

  @Get("status")
  @ApiOperation({
    summary: "Stan gotowości do przyjmowania płatności",
    description: "Odświeża stan u dostawcy, żeby Host widział skutek konfiguracji od razu.",
  })
  @ApiOkResponse({ type: HostPaymentStatusDto })
  async status(@CurrentHost() host: HostRow): Promise<HostPaymentStatusDto> {
    return this.accounts.refreshStatus(host.id);
  }
}

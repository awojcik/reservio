import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { AdminGuard } from "../auth/auth.guards";
import {
  RateLimit,
  RateLimitGuard,
} from "../../infrastructure/security/rate-limit.guard";
import { AdminActionsService } from "./admin-actions.service";
import { AdminJobsService } from "./admin-jobs.service";
import { AdminReadService } from "./admin-read.service";
import { AdminSearchService } from "./admin-search.service";
import { OperationalIssuesService } from "./operational-issues.service";
import {
  AdminSearchQueryDto,
  AdminSearchResponseDto,
} from "./dto/admin-search.dto";
import {
  CalendarSyncPageDto,
  JobsResponseDto,
  NotificationsPageDto,
  OperationalIssuesPageDto,
  OperationalIssuesQueryDto,
  ReconciliationStatusDto,
} from "./dto/admin-operations.dto";
import {
  AdminBookingDetailDto,
  AdminIntegrationsPageDto,
  AdminBookingsPageDto,
  AdminBookingsQueryDto,
  AdminDashboardDto,
  AdminHostDetailDto,
  AdminPropertyDetailDto,
  AdminStripeStatusDto,
  AdminUserDetailDto,
} from "./dto/admin-views.dto";
import { AdminActionsPageDto, AdminActionsQueryDto } from "./dto/admin-actions.dto";

/**
 * Admin and support reads.
 *
 * Guarded on the server for every route, including the ones the UI does not
 * link to. Hiding a link is not access control (milestone 11 §4, §56).
 */
@ApiTags("admin")
@ApiCookieAuth()
@ApiForbiddenResponse({ description: "ADMIN_FORBIDDEN" })
@UseGuards(AdminGuard, RateLimitGuard)
@Controller("admin")
export class AdminController {
  constructor(
    private readonly read: AdminReadService,
    private readonly searchService: AdminSearchService,
    private readonly issues: OperationalIssuesService,
    private readonly jobs: AdminJobsService,
    private readonly actions: AdminActionsService,
  ) {}

  /**
   * The whole panel's front page, in one round trip.
   *
   * Deliberately not a BI dashboard: what is broken, what happened recently,
   * and whether the last reconciliation ran (milestone 11 §5).
   */
  @Get("dashboard")
  @ApiOperation({
    summary: "Pulpit administracyjny",
    description:
      "Problemy operacyjne, ostatnie rezerwacje, nieudane zadania i stan rekoncyliacji. Jedno żądanie, kilka równoległych zapytań — bez N+1.",
  })
  @ApiOkResponse({ type: AdminDashboardDto })
  async dashboard(): Promise<AdminDashboardDto> {
    const [stripe, issues, recentBookings, failedJobs, audit, mismatches, connectivity] =
      await Promise.all([
        this.read.stripeStatus(),
        this.issues.all(),
        this.read.recentBookings(10),
        this.jobs.failedCounts(),
        this.read.adminActions(25, 0),
        this.actions.openMismatches(),
        this.read.integrations({ limit: 20, offset: 0 }),
      ]);

    const lastReconcile = audit.items.find((item) => item.actionType === "RECONCILE");

    return {
      stripe,
      issueCounts: this.issues.counts(issues),
      // Failures first, then the merge order (newest first) decides the rest.
      topIssues: issues
        .slice()
        .sort((a, b) => Number(b.severity === "FAILED") - Number(a.severity === "FAILED"))
        .slice(0, 10),
      recentBookings,
      failedJobs,
      reconciliation: {
        lastRunAt: lastReconcile?.completedAt ?? lastReconcile?.createdAt ?? null,
        lastRunStatus: lastReconcile?.status ?? null,
        openMismatches: mismatches,
        intervalMinutes: this.actions.reconcileIntervalMinutes,
      },
      recentActions: audit.items.slice(0, 5),
      integrations: connectivity.items,
    };
  }

  @Get("integrations")
  @ApiOperation({
    summary: "Połączenia z PMS i channel managerami",
    description:
      "Stan każdego połączenia, liczby rezerwacji w obie strony i nieudane synchronizacje. Bez danych dostępowych w żadnej postaci.",
  })
  @ApiOkResponse({ type: AdminIntegrationsPageDto })
  integrations(@Query() query: AdminBookingsQueryDto): Promise<AdminIntegrationsPageDto> {
    return this.read.integrations({
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
  }

  /**
   * One box for every identifier support might be handed.
   *
   * Rate limited per operator: the query touches nine tables, and a stuck
   * keystroke should not become a load test (milestone 11 §20).
   */
  @Get("search")
  @RateLimit({ bucket: "admin-search", limit: 30, windowSeconds: 60, scope: "user" })
  @ApiOperation({
    summary: "Globalne wyszukiwanie",
    description:
      "Numer rezerwacji, email, nazwa obiektu albo identyfikator płatności, zwrotu, rozliczenia, przelewu i wypłaty.",
  })
  @ApiOkResponse({ type: AdminSearchResponseDto })
  async search(@Query() query: AdminSearchQueryDto): Promise<AdminSearchResponseDto> {
    const items = await this.searchService.search(query.q, query.limit ?? 20);
    return { items, query: query.q.trim() };
  }

  @Get("bookings")
  @ApiOperation({ summary: "Rezerwacje", description: "Filtrowanie i paginacja po stronie serwera." })
  @ApiOkResponse({ type: AdminBookingsPageDto })
  bookings(@Query() query: AdminBookingsQueryDto): Promise<AdminBookingsPageDto> {
    return this.read.bookings({
      search: query.search,
      status: query.status,
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
    });
  }

  @Get("bookings/:id")
  @ApiOperation({
    summary: "Pełen cykl życia rezerwacji",
    description:
      "Płatność, zwrot, rozliczenie, przelew, wypłata, blokada terminu, powiadomienia i audyt — w jednym miejscu.",
  })
  @ApiOkResponse({ type: AdminBookingDetailDto })
  @ApiNotFoundResponse({ description: "Nie znaleziono rezerwacji" })
  booking(@Param("id", ParseUUIDPipe) id: string): Promise<AdminBookingDetailDto> {
    return this.read.booking(id);
  }

  @Get("users/:id")
  @ApiOperation({
    summary: "Konto użytkownika",
    description: "Bez hasha hasła i bez tokenów sesji — widoczna jest wyłącznie liczba sesji.",
  })
  @ApiOkResponse({ type: AdminUserDetailDto })
  user(@Param("id", ParseUUIDPipe) id: string): Promise<AdminUserDetailDto> {
    return this.read.user(id);
  }

  @Get("hosts/:id")
  @ApiOperation({ summary: "Gospodarz i jego finanse" })
  @ApiOkResponse({ type: AdminHostDetailDto })
  host(@Param("id", ParseUUIDPipe) id: string): Promise<AdminHostDetailDto> {
    return this.read.host(id);
  }

  @Get("properties/:id")
  @ApiOperation({
    summary: "Obiekt",
    description: "Kod do drzwi pozostaje zaszyfrowany — widać wyłącznie, czy został skonfigurowany.",
  })
  @ApiOkResponse({ type: AdminPropertyDetailDto })
  property(@Param("id", ParseUUIDPipe) id: string): Promise<AdminPropertyDetailDto> {
    return this.read.property(id);
  }

  @Get("operations")
  @ApiOperation({
    summary: "Problemy operacyjne",
    description:
      "Read model nad istniejącymi tabelami. Problem znika w chwili, w której znika jego przyczyna — nie ma ręcznie zamykanej listy incydentów.",
  })
  @ApiOkResponse({ type: OperationalIssuesPageDto })
  async operations(
    @Query() query: OperationalIssuesQueryDto,
  ): Promise<OperationalIssuesPageDto> {
    const all = await this.issues.all({ category: query.category });
    const filtered = query.severity
      ? all.filter((issue) => issue.severity === query.severity)
      : all;

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;

    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      counts: this.issues.counts(all),
    };
  }

  @Get("jobs")
  @ApiOperation({
    summary: "Kolejki i nieudane zadania",
    description:
      "Rejestr typów zadań oraz zadania, które wyczerpały ponowienia. Niedostępny Redis jest widoczny, a nie ukryty.",
  })
  @ApiOkResponse({ type: JobsResponseDto })
  jobsOverview(): Promise<JobsResponseDto> {
    return this.jobs.overview();
  }

  @Get("notifications")
  @ApiOperation({ summary: "Dostarczenia powiadomień", description: "Nieudane najpierw." })
  @ApiOkResponse({ type: NotificationsPageDto })
  notifications(@Query() query: AdminBookingsQueryDto): Promise<NotificationsPageDto> {
    return this.read.notifications({
      status: query.status,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
  }

  @Get("ical")
  @ApiOperation({ summary: "Kalendarze zewnętrzne", description: "Najgorsze najpierw." })
  @ApiOkResponse({ type: CalendarSyncPageDto })
  calendars(@Query() query: AdminBookingsQueryDto): Promise<CalendarSyncPageDto> {
    return this.read.calendars({ limit: query.limit ?? 50, offset: query.offset ?? 0 });
  }

  @Get("stripe")
  @ApiOperation({
    summary: "Tryb Stripe",
    description:
      "Rezervio działa wyłącznie w sandboxie. Klucz live zatrzymuje start procesu, więc tryb LIVE nie może się tu pojawić.",
  })
  @ApiOkResponse({ type: AdminStripeStatusDto })
  stripe(): Promise<AdminStripeStatusDto> {
    return this.read.stripeStatus();
  }

  @Get("reconciliation")
  @ApiOperation({
    summary: "Stan rekoncyliacji",
    description: "Ostatni przebieg, co zrobił i ile rozbieżności pozostało nierozwiązanych.",
  })
  @ApiOkResponse({ type: ReconciliationStatusDto })
  async reconciliation(): Promise<ReconciliationStatusDto> {
    const [audit, mismatches] = await Promise.all([
      this.read.adminActions(20, 0),
      this.actions.openMismatches(),
    ]);

    const last = audit.items.find((item) => item.actionType === "RECONCILE");
    const counters = last?.details ?? {};

    return {
      lastRunAt: last?.completedAt ?? last?.createdAt ?? null,
      lastRunBy: last?.adminEmail ?? null,
      lastRunStatus: last?.status ?? null,
      released: countOf(counters.released),
      transfersRepaired: countOf(counters.transfersRepaired),
      transfersRetried: countOf(counters.transfersRetried),
      reversalsRetried: countOf(counters.reversalsRetried),
      payoutsObserved: countOf(counters.payoutsObserved),
      openMismatches: mismatches,
      intervalMinutes: this.actions.reconcileIntervalMinutes,
    };
  }

  @Get("actions")
  @ApiOperation({
    summary: "Audyt akcji administracyjnych",
    description: "Kto, co i kiedy uruchomił. Bez sekretów w metadanych.",
  })
  @ApiOkResponse({ type: AdminActionsPageDto })
  auditLog(@Query() query: AdminActionsQueryDto): Promise<AdminActionsPageDto> {
    return this.read.adminActions(query.limit ?? 50, query.offset ?? 0);
  }
}

/**
 * A counter written by a past reconciliation run.
 *
 * The numbers live in the audit row's metadata rather than in a table of their
 * own: `admin_actions` already records who ran what and when, and a second
 * reconciliation-runs table would be one more thing to keep in step
 * (milestone 11 §33).
 */
function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

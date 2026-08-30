import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";

import { AuthService } from "./auth.service";
import { CurrentUser, SessionGuard } from "./auth.guards";
import { AuthSessionDto, LoginDto, RegisterDto, RegisterHostDto } from "./dto/auth.dto";
import { SessionsService, type SessionUser } from "./sessions.service";

type CookieRequest = FastifyRequest & { cookies?: Record<string, string | undefined> };

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Post("register")
  @ApiOperation({
    summary: "Rejestracja konta",
    description:
      "Tworzy User i sesję. Konto jest wspólne: ten sam User może rezerwować jako Guest i — po dodaniu profilu — wystawiać obiekty jako Host.",
  })
  @ApiCreatedResponse({ type: AuthSessionDto })
  @ApiConflictResponse({ description: "Adres email jest już zajęty" })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionDto> {
    const { user, token } = await this.auth.register(dto);
    this.setSessionCookie(reply, token);
    return this.auth.describe(user);
  }

  @Post("register/host")
  @ApiOperation({
    summary: "Rejestracja User wraz z profilem Host",
    description:
      "Zakłada konto i od razu profil gospodarza. Zwykła rejestracja tworzy sam User — profil Host jest opcjonalny i można go dodać później.",
  })
  @ApiCreatedResponse({ type: AuthSessionDto })
  @ApiConflictResponse({ description: "Adres email jest już zajęty" })
  async registerHost(
    @Body() dto: RegisterHostDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionDto> {
    const { user, token } = await this.auth.registerHost(dto);
    this.setSessionCookie(reply, token);
    return this.auth.describe(user);
  }

  @Post("login")
  @HttpCode(200)
  @ApiOperation({
    summary: "Logowanie",
    description:
      "Nie ujawnia, czy adres email istnieje — nieznane konto i błędne hasło dają tę samą odpowiedź.",
  })
  @ApiOkResponse({ type: AuthSessionDto })
  @ApiUnauthorizedResponse({ description: "Nieprawidłowy email lub hasło" })
  async login(
    @Body() dto: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionDto> {
    const { user, token } = await this.auth.login(dto, request.ip);
    this.setSessionCookie(reply, token);
    return this.auth.describe(user);
  }

  @Post("logout")
  @HttpCode(204)
  @ApiOperation({
    summary: "Wylogowanie",
    description: "Unieważnia sesję w bazie i czyści cookie. Bezpieczne przy ponowieniu.",
  })
  @ApiNoContentResponse()
  async logout(
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(request.cookies?.[this.sessions.cookieName]);
    reply.clearCookie(this.sessions.cookieName, { path: "/" });
  }

  @Get("me")
  @UseGuards(SessionGuard)
  @ApiOperation({
    summary: "Aktualnie zalogowany User",
    description: "Jedyne źródło prawdy o stanie zalogowania dla frontendu.",
  })
  @ApiOkResponse({ type: AuthSessionDto })
  @ApiUnauthorizedResponse({ description: "Brak aktywnej sesji" })
  me(@CurrentUser() user: SessionUser): Promise<AuthSessionDto> {
    return this.auth.describe(user);
  }

  private setSessionCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(this.sessions.cookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // Plain HTTP on localhost would silently drop a Secure cookie.
      secure: process.env.NODE_ENV === "production",
      maxAge: this.sessions.ttlSeconds,
    });
  }
}

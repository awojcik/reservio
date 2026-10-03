import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import type { HostRow, UserRow } from "../../infrastructure/database/schema";
import { HostsService } from "../hosts/hosts.service";
import { UsersService, normaliseEmail } from "../users/users.service";
import type { LoginDto, RegisterDto, RegisterHostDto } from "./dto/auth.dto";
import { LoginRateLimiter } from "./login-rate-limiter";
import { PasswordService } from "./password.service";
import { SessionsService } from "./sessions.service";

const UNIQUE_VIOLATION = "23505";

/**
 * Drizzle wraps driver errors, so the PostgreSQL SQLSTATE lives on `cause`.
 * Checking both keeps this working whichever layer surfaces the error.
 */
function isUniqueViolation(error: unknown): boolean {
  const codes = [
    (error as { code?: string }).code,
    ((error as { cause?: { code?: string } }).cause ?? {}).code,
  ];
  return codes.includes(UNIQUE_VIOLATION);
}

/** Identical for unknown email and wrong password — never confirm an account exists. */
const INVALID_CREDENTIALS = "Nieprawidłowy email lub hasło.";

export type AuthResult = {
  user: UserRow;
  host: HostRow | null;
  token: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly users: UsersService,
    private readonly hosts: HostsService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
    private readonly rateLimiter: LoginRateLimiter,
  ) {}

  /**
   * General sign-up: a User and a session, nothing more.
   *
   * A Host profile is a separate, optional thing somebody may add later — the
   * same account books trips and lists Property (milestone 06 §1, §31).
   */
  async register(dto: RegisterDto): Promise<AuthResult> {
    return this.createAccount(dto, null);
  }

  /**
   * Sign-up that opens a Host profile in the same breath, used by Host
   * onboarding. Kept so existing Host registration keeps working (§5).
   */
  async registerHost(dto: RegisterHostDto): Promise<AuthResult> {
    return this.createAccount(dto, dto.displayName);
  }

  /**
   * User, optional Host and UserSession in one transaction: an account that
   * can sign in but whose Host profile failed to save would be unusable.
   */
  private async createAccount(
    dto: RegisterDto,
    hostDisplayName: string | null,
  ): Promise<AuthResult> {
    // Checked up front so the ordinary "email taken" case never becomes a
    // failed INSERT — a query error would carry the password hash into the
    // logs. The catch below still covers the race between check and insert.
    if (await this.users.findByEmail(dto.email)) {
      throw new ConflictException("Konto z tym adresem email już istnieje.");
    }

    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const result = await this.database.db.transaction(async (tx) => {
        const user = await this.users.create(
          {
            email: dto.email,
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
          },
          tx,
        );
        const host = hostDisplayName
          ? await this.hosts.create({ userId: user.id, displayName: hostDisplayName }, tx)
          : null;
        const token = await this.sessions.create(user.id, tx);
        return { user, host, token };
      });

      this.logger.log({
        event: "auth.registered",
        userId: result.user.id,
        hostId: result.host?.id ?? null,
      });
      return result;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Konto z tym adresem email już istnieje.");
      }
      throw error;
    }
  }

  async login(dto: LoginDto, clientKey: string): Promise<AuthResult> {
    const email = normaliseEmail(dto.email);

    /*
     * The refusal is deliberately indistinguishable from a wrong password. A
     * distinct "too many attempts" reply would confirm that the address exists
     * and is worth attacking (milestone 11 §21).
     */
    if (this.rateLimiter.blocked(email, clientKey)) {
      this.logger.warn({ event: "auth.login.rate_limited" });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const user = await this.users.findByEmail(email);
    const valid = await this.passwords.verifyOrDummy(
      user?.passwordHash ?? null,
      dto.password,
    );

    if (!user || !valid) {
      this.rateLimiter.recordFailure(email, clientKey);
      // The address itself stays out of the line: a log file full of the email
      // addresses somebody tried is a list worth stealing.
      this.logger.warn({ event: "auth.login.failed" });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    this.rateLimiter.reset(email);

    const host = await this.hosts.findByUserId(user.id);
    const token = await this.sessions.create(user.id);

    this.logger.log({ event: "auth.login.succeeded", userId: user.id });
    return { user, host, token };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.sessions.revoke(token);
  }

  /**
   * The one shape the frontend reads to know who is signed in and whether they
   * also happen to be a Host (milestone 06 §7).
   */
  async describe(user: { id: string; email: string }) {
    const [profile, host] = await Promise.all([
      this.users.findById(user.id),
      this.hosts.findByUserId(user.id),
    ]);

    return {
      user: {
        id: user.id,
        email: profile?.email ?? user.email,
        firstName: profile?.firstName ?? null,
        lastName: profile?.lastName ?? null,
        phone: profile?.phone ?? null,
        preferredLocale: profile?.preferredLocale ?? null,
      },
      host: host ? { id: host.id, displayName: host.displayName } : null,
    };
  }
}

import { randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";
import argon2 from "argon2";

/**
 * Argon2id with the OWASP low-memory profile (19 MiB, t=2, p=1). Never a
 * home-grown scheme, and the plain password never leaves this class.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const MIN_PASSWORD_LENGTH = 10;

@Injectable()
export class PasswordService {
  /**
   * A real hash of a throwaway secret, computed once. Verifying against it
   * costs the same as verifying a genuine account, which is what keeps an
   * unknown email from answering measurably faster than a wrong password.
   */
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  /** `null` means "no such User" — still pay the full verification cost. */
  async verifyOrDummy(hash: string | null, password: string): Promise<boolean> {
    if (hash !== null) return this.verify(hash, password);

    this.dummyHash ??= this.hash(randomBytes(24).toString("hex"));
    await this.verify(await this.dummyHash, password);
    return false;
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // A malformed hash must read as "wrong password", never as a 500.
      return false;
    }
  }
}

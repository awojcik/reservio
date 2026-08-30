import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * An iCal import URL usually carries a bearer token in its path, so it is a
 * credential and is encrypted at rest (milestone 03 §19–§20).
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails loudly instead of
 * decrypting to garbage that would then be fetched.
 */
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Prefix so a future key rotation can tell formats apart. */
const VERSION = "v1";

export class IcalUrlCipherMisconfigured extends Error {}

@Injectable()
export class IcalUrlCipher implements OnModuleInit {
  private readonly key: Buffer | null;
  private readonly configError: string | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>("ICAL_URL_ENCRYPTION_KEY")?.trim();

    if (!raw) {
      this.key = null;
      this.configError =
        "ICAL_URL_ENCRYPTION_KEY nie jest ustawiony. Wygeneruj: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"";
      return;
    }

    const decoded = Buffer.from(raw, "base64");
    if (decoded.length !== KEY_BYTES) {
      this.key = null;
      this.configError = `ICAL_URL_ENCRYPTION_KEY musi mieć ${KEY_BYTES} bajtów po zdekodowaniu base64 (ma ${decoded.length}).`;
      return;
    }

    this.key = decoded;
    this.configError = null;
  }

  /**
   * Fail fast at boot rather than at the first sync: a missing key would
   * otherwise surface as a runtime error hours later, on a background job
   * nobody is watching.
   */
  onModuleInit(): void {
    if (this.configError) throw new IcalUrlCipherMisconfigured(this.configError);
  }

  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${VERSION}.${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
  }

  decrypt(payload: string): string {
    const key = this.requireKey();

    const [version, encoded] = payload.split(".", 2);
    if (version !== VERSION || !encoded) {
      throw new IcalUrlCipherMisconfigured("Nieznany format zaszyfrowanego URL.");
    }

    const buffer = Buffer.from(encoded, "base64");
    const iv = buffer.subarray(0, IV_BYTES);
    const tag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buffer.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    // Throws on a wrong key or a tampered payload — which is the point.
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  /**
   * What a Host may see: enough to recognise the feed, never enough to reuse
   * it. Query strings and path tokens are dropped entirely.
   */
  static mask(url: string): string {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const tail = segments.length > 0 ? `/…/${segments[segments.length - 1].slice(0, 4)}…` : "/…";
      return `${parsed.protocol}//${parsed.host}${tail}`;
    } catch {
      return "…";
    }
  }

  private requireKey(): Buffer {
    if (!this.key) throw new IcalUrlCipherMisconfigured(this.configError ?? "Brak klucza.");
    return this.key;
  }
}

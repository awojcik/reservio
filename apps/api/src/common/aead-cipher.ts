import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for the few columns that hold secrets.
 *
 * AES-256-GCM: a tampered ciphertext fails loudly instead of decrypting to
 * plausible garbage — which matters when the plaintext is a door code or a
 * calendar URL that the system would otherwise act on.
 */
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Prefix so a future key rotation can tell formats apart. */
const VERSION = "v1";

export class CipherMisconfigured extends Error {}

export class AeadCipher {
  private readonly key: Buffer | null;
  readonly configError: string | null;

  constructor(
    rawKey: string | undefined,
    /** Named in the error, so a missing key says which one. */
    private readonly envName: string,
  ) {
    const trimmed = rawKey?.trim();

    if (!trimmed) {
      this.key = null;
      this.configError = `${envName} nie jest ustawiony. Wygeneruj: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`;
      return;
    }

    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length !== KEY_BYTES) {
      this.key = null;
      this.configError = `${envName} musi mieć ${KEY_BYTES} bajtów po zdekodowaniu base64 (ma ${decoded.length}).`;
      return;
    }

    this.key = decoded;
    this.configError = null;
  }

  get configured(): boolean {
    return this.key !== null;
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
      throw new CipherMisconfigured(`Nieznany format zaszyfrowanej wartości (${this.envName}).`);
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

  private requireKey(): Buffer {
    if (!this.key) throw new CipherMisconfigured(this.configError ?? "Brak klucza.");
    return this.key;
  }
}

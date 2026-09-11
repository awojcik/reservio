import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AeadCipher, CipherMisconfigured } from "../../common/aead-cipher";

/**
 * An iCal import URL usually carries a bearer token in its path, so it is a
 * credential and is encrypted at rest (milestone 03 §19–§20).
 *
 * The crypto itself lives in `AeadCipher`; this class is the key it uses and
 * the masking rule for showing a Host which feed is which.
 */
export { CipherMisconfigured as IcalUrlCipherMisconfigured };

@Injectable()
export class IcalUrlCipher implements OnModuleInit {
  private readonly cipher: AeadCipher;

  constructor(config: ConfigService) {
    this.cipher = new AeadCipher(
      config.get<string>("ICAL_URL_ENCRYPTION_KEY"),
      "ICAL_URL_ENCRYPTION_KEY",
    );
  }

  /**
   * Fail fast at boot rather than at the first sync: a missing key would
   * otherwise surface as a runtime error hours later, on a background job
   * nobody is watching.
   */
  onModuleInit(): void {
    if (this.cipher.configError) throw new CipherMisconfigured(this.cipher.configError);
  }

  encrypt(plaintext: string): string {
    return this.cipher.encrypt(plaintext);
  }

  decrypt(payload: string): string {
    return this.cipher.decrypt(payload);
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
}

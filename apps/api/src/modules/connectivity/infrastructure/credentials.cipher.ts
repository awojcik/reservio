import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AeadCipher, CipherMisconfigured } from "../../../common/aead-cipher";
import type { ProviderCredentials } from "../domain/inventory-provider";

/**
 * Provider credentials at rest.
 *
 * A Hostaway client secret in a database dump is a working key to somebody's
 * whole property portfolio, so it gets the same treatment as a door code: an
 * AES-256-GCM ciphertext with its own key, decrypted only inside the adapter
 * that is about to make a call, never returned by an API and never logged
 * (milestone 12 §4, §38).
 *
 * Its own key rather than a shared one, so provider credentials can be rotated
 * without touching iCal URLs or access codes.
 */
@Injectable()
export class ProviderCredentialsCipher implements OnModuleInit {
  private readonly cipher: AeadCipher;

  constructor(config: ConfigService) {
    /*
     * Falls back to the iCal key so a checked-out repository works without a
     * fourth secret to generate — the same convenience `STAY_SENSITIVE_DATA_
     * ENCRYPTION_KEY` already has. A deployment that wants independent
     * rotation sets its own.
     */
    this.cipher = new AeadCipher(
      config.get<string>("PROVIDER_CREDENTIALS_ENCRYPTION_KEY") ??
        config.get<string>("ICAL_URL_ENCRYPTION_KEY"),
      "PROVIDER_CREDENTIALS_ENCRYPTION_KEY",
    );
  }

  /** Fail at boot, not at the first sync nobody is watching. */
  onModuleInit(): void {
    if (this.cipher.configError) throw new CipherMisconfigured(this.cipher.configError);
  }

  encrypt(credentials: ProviderCredentials): string {
    return this.cipher.encrypt(JSON.stringify(credentials));
  }

  decrypt(payload: string): ProviderCredentials {
    return JSON.parse(this.cipher.decrypt(payload)) as ProviderCredentials;
  }

  /**
   * What a Host or an operator may see: enough to tell two accounts apart,
   * never enough to reuse one. Only the account id is echoed at all — the
   * secret is not masked, it is simply absent.
   */
  static describe(credentials: ProviderCredentials): Record<string, string> {
    return {
      accountId: credentials.accountId ?? "—",
      apiKey: credentials.apiKey ? `••••${credentials.apiKey.slice(-4)}` : "—",
    };
  }
}

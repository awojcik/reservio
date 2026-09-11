import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AeadCipher, CipherMisconfigured } from "../../common/aead-cipher";

/**
 * Encryption for the access details a Host stores against a Property.
 *
 * A door code in a database dump is a door code in someone's hands, so these
 * columns are ciphertext at rest under their own key — separate from the iCal
 * key so the two can be rotated independently (milestone 09 §10).
 */
@Injectable()
export class StaySecretCipher implements OnModuleInit {
  private readonly cipher: AeadCipher;

  constructor(config: ConfigService) {
    this.cipher = new AeadCipher(
      // Falls back to the iCal key so an existing deployment keeps working
      // without a second secret to distribute on day one.
      config.get<string>("STAY_SENSITIVE_DATA_ENCRYPTION_KEY") ??
        config.get<string>("ICAL_URL_ENCRYPTION_KEY"),
      "STAY_SENSITIVE_DATA_ENCRYPTION_KEY",
    );
  }

  /** Fail at boot, not at the moment a Guest is standing at the door. */
  onModuleInit(): void {
    if (this.cipher.configError) throw new CipherMisconfigured(this.cipher.configError);
  }

  /** Empty input stores nothing rather than encrypting the empty string. */
  encryptOrNull(plaintext: string | null | undefined): string | null {
    const trimmed = plaintext?.trim();
    return trimmed ? this.cipher.encrypt(trimmed) : null;
  }

  decryptOrNull(payload: string | null): string | null {
    return payload === null ? null : this.cipher.decrypt(payload);
  }
}

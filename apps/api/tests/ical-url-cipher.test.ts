import { randomBytes } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import {
  IcalUrlCipher,
  IcalUrlCipherMisconfigured,
} from "../src/modules/calendars/ical-url-cipher";

function cipherWith(key: string | undefined): IcalUrlCipher {
  return new IcalUrlCipher({ get: () => key } as unknown as ConfigService);
}

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");
const URL_WITH_TOKEN = "https://www.airbnb.com/calendar/ical/12345.ics?s=super-secret-token";

describe("iCal URL encryption", () => {
  it("round-trips a URL", () => {
    const cipher = cipherWith(KEY);
    expect(cipher.decrypt(cipher.encrypt(URL_WITH_TOKEN))).toBe(URL_WITH_TOKEN);
  });

  it("stores nothing resembling the plaintext", () => {
    const encrypted = cipherWith(KEY).encrypt(URL_WITH_TOKEN);

    expect(encrypted).not.toContain("airbnb");
    expect(encrypted).not.toContain("super-secret-token");
    expect(encrypted.startsWith("v1.")).toBe(true);
  });

  it("produces a different ciphertext each time", () => {
    const cipher = cipherWith(KEY);
    // A fresh IV per encryption, so identical URLs are not identifiable.
    expect(cipher.encrypt(URL_WITH_TOKEN)).not.toBe(cipher.encrypt(URL_WITH_TOKEN));
  });

  it("fails to decrypt under the wrong key", () => {
    const encrypted = cipherWith(KEY).encrypt(URL_WITH_TOKEN);
    expect(() => cipherWith(OTHER_KEY).decrypt(encrypted)).toThrow();
  });

  it("fails when the ciphertext is tampered with", () => {
    const cipher = cipherWith(KEY);
    const encrypted = cipher.encrypt(URL_WITH_TOKEN);

    const body = Buffer.from(encrypted.slice(3), "base64");
    body[body.length - 1] ^= 0xff;
    const tampered = `v1.${body.toString("base64")}`;

    // GCM authenticates, so this is caught rather than decrypting to garbage
    // that would then be fetched.
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it("fails fast when the key is missing or the wrong length", () => {
    expect(() => cipherWith(undefined).onModuleInit()).toThrow(IcalUrlCipherMisconfigured);
    expect(() =>
      cipherWith(randomBytes(16).toString("base64")).onModuleInit(),
    ).toThrow(IcalUrlCipherMisconfigured);
  });

  it("boots cleanly with a valid key", () => {
    expect(() => cipherWith(KEY).onModuleInit()).not.toThrow();
  });

  it("masks a URL down to something unusable", () => {
    const masked = IcalUrlCipher.mask(URL_WITH_TOKEN);

    expect(masked).toContain("airbnb.com");
    expect(masked).not.toContain("super-secret-token");
    expect(masked).not.toContain("?s=");
  });
});

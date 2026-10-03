import { describe, expect, it } from "vitest";

import {
  UnsafeUrlError,
  assertAllowedUrl,
  isBlockedAddress,
  resolveSafely,
} from "../src/modules/calendars/safe-fetch";

/**
 * SSRF is the sharpest edge in this milestone: the Host chooses a URL and the
 * backend fetches it. No test here makes a real external call (§60).
 */
describe("blocked addresses", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // carrier-grade NAT
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:10.0.0.1", // IPv4-mapped private
  ])("rejects %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"])(
    "allows the public address %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it("refuses anything that is not an IP at all", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});

describe("assertAllowedUrl", () => {
  it.each(["file:///etc/passwd", "ftp://example.com/f.ics", "gopher://example.com", "data:text/calendar,BEGIN"])(
    "rejects the scheme in %s",
    (url) => {
      expect(() => assertAllowedUrl(url)).toThrow(UnsafeUrlError);
    },
  );

  it.each([
    "http://localhost:9000/cal.ics",
    "http://anything.localhost/cal.ics",
    "http://127.0.0.1/cal.ics",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/cal.ics",
    "http://metadata.google.internal/cal.ics",
  ])("rejects %s", (url) => {
    expect(() => assertAllowedUrl(url)).toThrow(UnsafeUrlError);
  });

  it("accepts an ordinary https feed", () => {
    expect(assertAllowedUrl("https://example.com/calendar.ics").hostname).toBe("example.com");
  });

  it("rejects a malformed URL", () => {
    expect(() => assertAllowedUrl("not a url")).toThrow(UnsafeUrlError);
  });

  it("lets the development escape hatch through, but only off production", () => {
    expect(() => assertAllowedUrl("http://127.0.0.1:9999/cal.ics", true)).not.toThrow();

    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      // Even with the flag set, production refuses — the guard is not
      // configurable there.
      expect(() => assertAllowedUrl("http://127.0.0.1:9999/cal.ics", true)).toThrow(
        UnsafeUrlError,
      );
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe("resolveSafely", () => {
  it("rejects a literal private address without touching DNS", async () => {
    await expect(resolveSafely("10.0.0.5")).rejects.toThrow(UnsafeUrlError);
  });

  it("returns a literal public address as-is", async () => {
    await expect(resolveSafely("8.8.8.8")).resolves.toEqual([{ address: "8.8.8.8", family: 4 }]);
  });

  it("rejects a hostname that resolves to loopback", async () => {
    // `localhost` resolves to 127.0.0.1 / ::1 on every machine, which makes it
    // a dependable stand-in for a public name pointed at a private address.
    await expect(resolveSafely("localhost")).rejects.toThrow(UnsafeUrlError);
  });
});

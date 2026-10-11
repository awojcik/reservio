import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import {
  assertUploadedImage,
  detectImageFormat,
} from "../src/modules/properties/host/uploaded-image";
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LABEL,
} from "../src/modules/properties/host/dto/host-image.dto";

/** A real 1×1 PNG, so the signature is not hand-assembled from the same table. */
const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function stored(head: Uint8Array, sizeBytes = 1024) {
  return { head, sizeBytes };
}

describe("detectImageFormat", () => {
  it("recognises the formats a Host may upload", () => {
    expect(detectImageFormat(JPEG)).toBe("image/jpeg");
    expect(detectImageFormat(PNG)).toBe("image/png");
    expect(detectImageFormat(WEBP)).toBe("image/webp");
  });

  it("rejects bytes that are not an image at all", () => {
    expect(detectImageFormat(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // .exe
    expect(detectImageFormat(new Uint8Array(Buffer.from("#!/bin/sh\nrm -rf /")))).toBeNull();
    expect(detectImageFormat(new Uint8Array())).toBeNull();
  });

  /**
   * The four bytes between `RIFF` and `WEBP` are a container length and say
   * nothing about the contents, so a signature that stops at `RIFF` accepts
   * every WAV and AVI ever made.
   */
  it("does not mistake another RIFF container for WebP", () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x08, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(detectImageFormat(wav)).toBeNull();
  });

  it("does not read past what it was given", () => {
    // A truncated WebP header: `RIFF` present, the `WEBP` marker not yet read.
    expect(detectImageFormat(WEBP.slice(0, 8))).toBeNull();
    // A PNG signature one byte short.
    expect(detectImageFormat(PNG.slice(0, 7))).toBeNull();
  });
});

describe("assertUploadedImage", () => {
  it("accepts a real photo and reports its format", () => {
    expect(assertUploadedImage(stored(PNG))).toBe("image/png");
  });

  it("refuses a key nothing was uploaded to", () => {
    expect(() => assertUploadedImage(null)).toThrow(BadRequestException);
    expect(() => assertUploadedImage(null)).toThrow(/Nie znaleziono/);
  });

  it("refuses an empty object", () => {
    expect(() => assertUploadedImage(stored(PNG, 0))).toThrow(/pusty/);
  });

  /**
   * The size limit was already applied to the number the client *declared*
   * when it asked for the URL. A presigned PUT does not enforce that number,
   * so this is the first time the real size is known.
   */
  it("refuses an object larger than the limit, whatever was declared", () => {
    // Against the shared label, so a changed limit cannot leave the sentence
    // promising the old one.
    expect(() => assertUploadedImage(stored(PNG, MAX_IMAGE_BYTES + 1))).toThrow(MAX_IMAGE_LABEL);
    expect(() => assertUploadedImage(stored(PNG, MAX_IMAGE_BYTES))).not.toThrow();
  });

  it("refuses something that is not an image", () => {
    const script = new Uint8Array(Buffer.from("<?php system($_GET[0]); ?>"));
    expect(() => assertUploadedImage(stored(script))).toThrow(/nie jest obrazem/);
  });

  /**
   * Checked in this order on purpose: an oversized object is reported as
   * oversized even when it is also not an image, because that is the mistake
   * the Host is far more likely to have made.
   */
  it("reports size before format", () => {
    const bigAndWrong = stored(new Uint8Array([0x00, 0x01]), MAX_IMAGE_BYTES * 2);
    expect(() => assertUploadedImage(bigAndWrong)).toThrow(MAX_IMAGE_LABEL);
  });
});

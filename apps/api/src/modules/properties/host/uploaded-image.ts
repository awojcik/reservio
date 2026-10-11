import { BadRequestException } from "@nestjs/common";

import type { StoredObjectHead } from "../../storage/object-storage";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_LABEL } from "./dto/host-image.dto";

/**
 * Checking that an uploaded photo is a photo.
 *
 * A Host's browser PUTs the file straight to object storage with a presigned
 * URL, which is what keeps whole photos out of the API — but it also means
 * `contentType` and `sizeBytes` on the upload-url request are claims, checked
 * as claims and never compared with anything. Nothing in the system looked at
 * the bytes. A client could declare `image/jpeg`, upload an executable, and
 * the API would record a PropertyImage pointing at it.
 *
 * Confirm is the first moment the bytes exist and the only one where rejecting
 * them costs nothing: no row has been written yet.
 */

type ImageFormat = (typeof ALLOWED_IMAGE_TYPES)[number];

/** Byte signatures, in the order they appear in the file. */
const SIGNATURES: ReadonlyArray<{ format: ImageFormat; bytes: ReadonlyArray<number | null> }> = [
  { format: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { format: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  {
    // RIFF, four bytes of container length that say nothing about the format,
    // then WEBP. Without the second half, every WAV and AVI file would pass.
    format: "image/webp",
    bytes: [
      0x52, 0x49, 0x46, 0x46,
      null, null, null, null,
      0x57, 0x45, 0x42, 0x50,
    ],
  },
];

/** The format these bytes really are, or `null` if they are not an image we accept. */
export function detectImageFormat(head: Uint8Array): ImageFormat | null {
  for (const { format, bytes } of SIGNATURES) {
    if (head.length < bytes.length) continue;
    if (bytes.every((byte, index) => byte === null || head[index] === byte)) {
      return format;
    }
  }
  return null;
}

/**
 * Throws unless the object is an image we accept, within the size limit.
 *
 * Separate from the service so every branch is testable without a database,
 * a Nest module or a bucket.
 */
export function assertUploadedImage(object: StoredObjectHead | null): ImageFormat {
  if (object === null) {
    throw new BadRequestException("Nie znaleziono wgranego pliku. Spróbuj wgrać zdjęcie ponownie.");
  }

  if (object.sizeBytes === 0) {
    throw new BadRequestException("Wgrany plik jest pusty.");
  }

  /*
   * The declared size was already rejected above the limit when the URL was
   * issued. This is the same limit against the real size, which is the only
   * one that matters: the presigned PUT does not enforce what was declared.
   */
  if (object.sizeBytes > MAX_IMAGE_BYTES) {
    throw new BadRequestException(`Maksymalny rozmiar zdjęcia to ${MAX_IMAGE_LABEL}.`);
  }

  const format = detectImageFormat(object.head);
  if (format === null) {
    throw new BadRequestException("Plik nie jest obrazem JPEG, PNG ani WebP.");
  }

  /*
   * Deliberately not compared with the type declared at upload-url time. A
   * PNG saved as `.jpg` is reported by the browser as `image/jpeg`, and it is
   * still a real photo a Host wants on their Listing; refusing it would be
   * strictness with no one's interest behind it. What matters is that the
   * bytes are one of the three formats, and they are.
   */
  return format;
}

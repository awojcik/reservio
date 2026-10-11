import { ApiError } from "@rezervio/api-client";
import { describe, expect, it } from "vitest";

import { clientErrorMessage } from "@/lib/api-message";
import { MAX_UPLOAD_LABEL } from "@/lib/upload";

/**
 * What a Host is told when the API refuses a photo.
 *
 * The API states the reason precisely — not an image, over the size limit — and the
 * uploader used to replace all of it with "Nie udało się wgrać X", which reads
 * like a network problem and invites re-trying a file that can never work.
 */
describe("clientErrorMessage", () => {
  it("passes on what the API said about a rejected upload", () => {
    const error = new ApiError("Żądanie do API nie powiodło się (400).", 400, {
      statusCode: 400,
      message: "Plik nie jest obrazem JPEG, PNG ani WebP.",
    });

    expect(clientErrorMessage(error)).toBe("Plik nie jest obrazem JPEG, PNG ani WebP.");
  });

  it("joins the several sentences class-validator sends", () => {
    const error = new ApiError("…", 400, {
      message: [
        `Maksymalny rozmiar zdjęcia to ${MAX_UPLOAD_LABEL}.`,
        "Dozwolone formaty to JPEG, PNG i WebP",
      ],
    });

    expect(clientErrorMessage(error)).toMatch(new RegExp(`${MAX_UPLOAD_LABEL}.*JPEG`));
  });

  /**
   * A 500 is about us. Showing its message would hand the Host an internal
   * detail and imply they can fix it.
   */
  it("says nothing about a server fault", () => {
    const error = new ApiError("…", 500, { message: "connect ECONNREFUSED 10.0.0.5:5432" });

    expect(clientErrorMessage(error)).toBeNull();
  });

  it("falls back when there is no usable sentence", () => {
    expect(clientErrorMessage(new ApiError("…", 400, undefined))).toBeNull();
    expect(clientErrorMessage(new ApiError("…", 400, { message: "" }))).toBeNull();
    expect(clientErrorMessage(new ApiError("…", 400, { message: [] }))).toBeNull();
    expect(clientErrorMessage(new ApiError("…", 400, "nie-obiekt"))).toBeNull();
  });

  it("ignores anything that is not an API error", () => {
    expect(clientErrorMessage(new Error("boom"))).toBeNull();
    expect(clientErrorMessage(undefined)).toBeNull();
  });

  /**
   * The offline case: the client raises status 0, and the Host needs the
   * uploader's own wording, not the client's internal sentence.
   */
  it("says nothing when the API was never reached", () => {
    expect(clientErrorMessage(new ApiError("Nie udało się połączyć z API Rezervio.", 0))).toBeNull();
  });
});

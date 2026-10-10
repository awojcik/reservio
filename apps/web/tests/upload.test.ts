import { describe, expect, it } from "vitest";

import { uploadHeaders } from "@/lib/upload";

/**
 * The other half of a contract whose server side lives in
 * `apps/api/tests/storage-presign.test.ts`: the API signs `host;x-amz-acl`,
 * so the browser sends `x-amz-acl` and the file's own Content-Type.
 *
 * Neither half fails in a way anybody would guess from the symptom. Drop the
 * ACL and every photo uploads fine and then answers 403 for ever; add a header
 * the API did not sign and every upload dies with `SignatureDoesNotMatch`,
 * which reads like a credentials problem.
 */
describe("uploadHeaders", () => {
  it("asks object storage to make the photo publicly readable", () => {
    expect(uploadHeaders("image/png")["x-amz-acl"]).toBe("public-read");
  });

  it("declares the file's own type", () => {
    expect(uploadHeaders("image/webp")["content-type"]).toBe("image/webp");
  });

  it("sends nothing the API has not signed", () => {
    // Exactly the signed set, minus `host`, which the browser owns.
    expect(Object.keys(uploadHeaders("image/jpeg")).sort()).toEqual([
      "content-type",
      "x-amz-acl",
    ]);
  });
});

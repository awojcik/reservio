import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import { S3ObjectStorage } from "../src/modules/storage/s3-object-storage";

/**
 * The presigned upload URL, as the browser will receive it.
 *
 * `ImageManager` PUTs the file with one header — Content-Type — and nothing
 * else. Everything the provider needs to verify must therefore be in the URL,
 * and nothing may be in it that the provider does not implement: the query
 * string is part of what the signature covers, so one unexpected parameter
 * turns into `SignatureDoesNotMatch` against DigitalOcean Spaces.
 */
function storageFor(values: Record<string, string>): S3ObjectStorage {
  return new S3ObjectStorage({
    get: (key: string) => values[key],
  } as unknown as ConfigService);
}

const SPACES = {
  S3_ENDPOINT: "https://fra1.digitaloceanspaces.com",
  S3_REGION: "fra1",
  S3_BUCKET: "rezervio-bucket",
  S3_ACCESS_KEY_ID: "DO0000PROBE",
  S3_SECRET_ACCESS_KEY: "secret-for-signing-only",
  S3_FORCE_PATH_STYLE: "false",
  S3_PUBLIC_BASE_URL: "https://rezervio-bucket.fra1.digitaloceanspaces.com",
};

async function presign(values = SPACES) {
  const { uploadUrl } = await storageFor(values).createPresignedUpload({
    objectKey: "properties/abc/photo.jpg",
    contentType: "image/jpeg",
  });
  return new URL(uploadUrl);
}

describe("presigned upload URL", () => {
  it("carries no SDK checksum parameters", async () => {
    const url = await presign();
    const extra = [...url.searchParams.keys()].filter((key) => key.includes("checksum"));

    // `requestChecksumCalculation: "WHEN_REQUIRED"` is what keeps these out.
    // With the SDK default they appear, are signed, and Spaces refuses the
    // upload — reporting a signature problem, which reads like a bad secret.
    expect(extra).toEqual([]);
  });

  it("signs only the host, so Content-Type alone is enough to send", async () => {
    const url = await presign();
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("addresses a Spaces bucket by subdomain, not by path", async () => {
    const url = await presign();
    expect(url.host).toBe("rezervio-bucket.fra1.digitaloceanspaces.com");
    expect(url.pathname).toBe("/properties/abc/photo.jpg");
  });

  it("addresses a MinIO bucket by path, not by subdomain", async () => {
    const url = await presign({
      ...SPACES,
      S3_ENDPOINT: "http://localhost:9000",
      S3_FORCE_PATH_STYLE: "true",
      S3_BUCKET: "rezervio-local",
    });
    expect(url.host).toBe("localhost:9000");
    expect(url.pathname).toBe("/rezervio-local/properties/abc/photo.jpg");
  });

  /**
   * The photo has to be readable by anyone the moment it is uploaded, and the
   * only mechanism that works on every provider is the per-object ACL: this
   * bucket's owner cannot set a bucket policy at all (Spaces refuses
   * PutBucketPolicy even to a Full Access key), and a Listing photo whose URL
   * answers 403 is a broken page.
   *
   * It must arrive as a *query parameter*. Hoisted there by the presigner, the
   * browser sends nothing extra; left in the signed headers, every upload
   * would need `x-amz-acl` added by hand in the uploader — and would fail
   * with a signature error until someone did.
   */
  it("asks for a publicly readable object, via the query and not a header", async () => {
    const url = await presign();

    expect(url.searchParams.get("x-amz-acl")).toBe("public-read");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("expires, because an upload URL is a credential", async () => {
    const url = await presign();
    expect(Number(url.searchParams.get("X-Amz-Expires"))).toBeGreaterThan(0);
  });
});

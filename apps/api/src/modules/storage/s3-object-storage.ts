import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type {
  ObjectStorage,
  PresignedUpload,
  PresignedUploadRequest,
} from "./object-storage";

const UPLOAD_URL_TTL_SECONDS = 600;

@Injectable()
export class S3ObjectStorage implements ObjectStorage, OnModuleInit {
  private readonly logger = new Logger(S3ObjectStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>("S3_ENDPOINT") ?? "http://localhost:9000";
    this.bucket = config.get<string>("S3_BUCKET") ?? "rezervio-local";
    this.publicBaseUrl = (
      config.get<string>("S3_PUBLIC_BASE_URL") ?? `${endpoint}/${this.bucket}`
    ).replace(/\/$/, "");

    this.client = new S3Client({
      endpoint,
      region: config.get<string>("S3_REGION") ?? "us-east-1",
      // MinIO serves buckets as a path segment; Spaces uses a virtual host.
      forcePathStyle: config.get<string>("S3_FORCE_PATH_STYLE") !== "false",
      /*
       * Only checksum what the request actually asks to be checksummed.
       *
       * The SDK's default is `WHEN_SUPPORTED`, which adds
       * `x-amz-sdk-checksum-algorithm` and `x-amz-checksum-crc32` to every
       * PutObject. On a presigned URL those land in the query string, and the
       * query string is part of what the signature covers — so a provider
       * that does not implement them rejects the upload with
       * `SignatureDoesNotMatch`, having computed the signature over a
       * different set of parameters than the SDK signed.
       *
       * DigitalOcean Spaces is such a provider. The error names the signature
       * rather than the checksum, which is why it reads like a wrong secret.
       */
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: config.get<string>("S3_ACCESS_KEY_ID") ?? "rezervio",
        secretAccessKey: config.get<string>("S3_SECRET_ACCESS_KEY") ?? "rezervio-local-only",
      },
    });
  }

  /**
   * A fresh local volume has no bucket, and `pnpm infra:start` must not require
   * clicking around a storage console. Failure is logged, never fatal: the API
   * still serves Search and Listings when object storage is down.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch {
      this.logger.log({ event: "storage.bucket.missing", bucket: this.bucket });
    }

    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      // PropertyImage URLs are public by design — a Listing photo is public
      // content, and signing every read would break caching for no benefit.
      await this.client.send(
        new PutBucketPolicyCommand({
          Bucket: this.bucket,
          Policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { AWS: ["*"] },
                Action: ["s3:GetObject"],
                Resource: [`arn:aws:s3:::${this.bucket}/*`],
              },
            ],
          }),
        }),
      );
      this.logger.log({ event: "storage.bucket.created", bucket: this.bucket });
    } catch (error) {
      this.logger.warn({
        event: "storage.bucket.unavailable",
        bucket: this.bucket,
        reason: (error as Error).message,
      });
    }
  }

  async createPresignedUpload(request: PresignedUploadRequest): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: request.objectKey,
      ContentType: request.contentType,
      /*
       * Public on the object itself, not only through the bucket.
       *
       * A Listing photo is public content — that is why reads are not signed.
       * A bucket-wide policy would cover it, but only on a bucket *this* code
       * created, and a managed provider may refuse to set one at all:
       * DigitalOcean Spaces answers PutBucketPolicy with `AccessDenied` on a
       * Limited Access key and a bare `403` even on a Full Access one, while
       * honouring a per-object ACL perfectly well.
       */
      ACL: "public-read",
    });

    /*
     * The ACL has to travel as a signed *header*, not a query parameter.
     *
     * Left to itself the presigner hoists every `x-amz-*` header into the
     * query string, and Spaces then ignores the ACL outright: measured
     * against the real bucket, a presigned PUT carrying `x-amz-acl` in the
     * query uploads fine and leaves the object private, while the same ACL
     * as a signed header makes it public. Both forms return 200, so the
     * difference is invisible at upload time and only shows up later, as a
     * photo that will not load.
     *
     * `unhoistableHeaders` keeps it in the headers and `signableHeaders` puts
     * it in the signature, which means the uploader MUST send
     * `x-amz-acl: public-read` — see `uploadHeaders()` in the web app, and
     * the test pinning this signed-header set. Sending it or not is not
     * optional: a missing signed header fails the upload outright, which is
     * the behaviour we want over silently private photos.
     *
     * The URL itself is a credential — it is returned to its owner and never
     * logged (domain language §11).
     */
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      unhoistableHeaders: new Set(["x-amz-acl"]),
      signableHeaders: new Set(["x-amz-acl"]),
    });

    return {
      uploadUrl,
      objectKey: request.objectKey,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
  }

  getPublicUrl(objectKey: string): string {
    return `${this.publicBaseUrl}/${objectKey}`;
  }
}

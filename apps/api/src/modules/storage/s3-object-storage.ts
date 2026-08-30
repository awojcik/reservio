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
    });

    // The URL itself is a credential — it is returned to its owner and never
    // logged (domain language §11).
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
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

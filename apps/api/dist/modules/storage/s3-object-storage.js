"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var S3ObjectStorage_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.S3ObjectStorage = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const UPLOAD_URL_TTL_SECONDS = 600;
let S3ObjectStorage = S3ObjectStorage_1 = class S3ObjectStorage {
    logger = new common_1.Logger(S3ObjectStorage_1.name);
    client;
    bucket;
    publicBaseUrl;
    constructor(config) {
        const endpoint = config.get("S3_ENDPOINT") ?? "http://localhost:9000";
        this.bucket = config.get("S3_BUCKET") ?? "rezervio-local";
        this.publicBaseUrl = (config.get("S3_PUBLIC_BASE_URL") ?? `${endpoint}/${this.bucket}`).replace(/\/$/, "");
        this.client = new client_s3_1.S3Client({
            endpoint,
            region: config.get("S3_REGION") ?? "us-east-1",
            forcePathStyle: config.get("S3_FORCE_PATH_STYLE") !== "false",
            requestChecksumCalculation: "WHEN_REQUIRED",
            responseChecksumValidation: "WHEN_REQUIRED",
            credentials: {
                accessKeyId: config.get("S3_ACCESS_KEY_ID") ?? "rezervio",
                secretAccessKey: config.get("S3_SECRET_ACCESS_KEY") ?? "rezervio-local-only",
            },
        });
    }
    async onModuleInit() {
        try {
            await this.client.send(new client_s3_1.HeadBucketCommand({ Bucket: this.bucket }));
            return;
        }
        catch {
            this.logger.log({ event: "storage.bucket.missing", bucket: this.bucket });
        }
        try {
            await this.client.send(new client_s3_1.CreateBucketCommand({ Bucket: this.bucket }));
            await this.client.send(new client_s3_1.PutBucketPolicyCommand({
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
            }));
            this.logger.log({ event: "storage.bucket.created", bucket: this.bucket });
        }
        catch (error) {
            this.logger.warn({
                event: "storage.bucket.unavailable",
                bucket: this.bucket,
                reason: error.message,
            });
        }
    }
    async createPresignedUpload(request) {
        const command = new client_s3_1.PutObjectCommand({
            Bucket: this.bucket,
            Key: request.objectKey,
            ContentType: request.contentType,
        });
        const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(this.client, command, {
            expiresIn: UPLOAD_URL_TTL_SECONDS,
        });
        return {
            uploadUrl,
            objectKey: request.objectKey,
            expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
        };
    }
    async deleteObject(objectKey) {
        await this.client.send(new client_s3_1.DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    }
    getPublicUrl(objectKey) {
        return `${this.publicBaseUrl}/${objectKey}`;
    }
};
exports.S3ObjectStorage = S3ObjectStorage;
exports.S3ObjectStorage = S3ObjectStorage = S3ObjectStorage_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], S3ObjectStorage);
//# sourceMappingURL=s3-object-storage.js.map
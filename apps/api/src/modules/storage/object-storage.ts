/**
 * The domain talks to object storage through this port and nothing else, so
 * MinIO locally and DigitalOcean Spaces in production are the same thing to
 * every caller. Deliberately three methods — no generic storage framework.
 */
export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

export type PresignedUpload = {
  uploadUrl: string;
  objectKey: string;
  expiresInSeconds: number;
};

export type PresignedUploadRequest = {
  objectKey: string;
  contentType: string;
};

export interface ObjectStorage {
  createPresignedUpload(request: PresignedUploadRequest): Promise<PresignedUpload>;
  deleteObject(objectKey: string): Promise<void>;
  getPublicUrl(objectKey: string): string;
}

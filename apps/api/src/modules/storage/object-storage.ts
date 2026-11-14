/**
 * The domain talks to object storage through this port and nothing else, so
 * MinIO locally and DigitalOcean Spaces in production are the same thing to
 * every caller. Deliberately small — no generic storage framework.
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

/**
 * What actually landed under a key — as opposed to what the client said it
 * would upload.
 *
 * `head` is the first few bytes, which is all it takes to tell an image from
 * anything else, and deliberately not the whole object: a whole photo read
 * into the API to check twelve bytes would be the one thing this upload design
 * exists to avoid.
 */
export type StoredObjectHead = {
  sizeBytes: number;
  head: Uint8Array;
};

/**
 * A file the server itself writes — a generated photo variant, never anything
 * a browser sent. Public like every Listing photo, and cached as long as the
 * caller says: only a key that is never rewritten may claim `immutable`.
 */
export type ServerUpload = {
  objectKey: string;
  body: Buffer;
  contentType: string;
  cacheControl: string;
};

export interface ObjectStorage {
  createPresignedUpload(request: PresignedUploadRequest): Promise<PresignedUpload>;
  /** `null` when nothing was ever uploaded under this key. */
  inspectObject(objectKey: string): Promise<StoredObjectHead | null>;
  /** The whole object, or `null` when nothing is stored under this key. */
  getObject(objectKey: string): Promise<Buffer | null>;
  putObject(upload: ServerUpload): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
  getPublicUrl(objectKey: string): string;
}

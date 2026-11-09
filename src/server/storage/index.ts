import { readFileSync } from "node:fs";
import { Storage as GcsClient } from "@google-cloud/storage";

export interface FileStorage {
  /** Short-lived URL the browser PUTs the file to. */
  createUploadUrl(key: string, opts: { mime: string }): Promise<string>;
  /** Short-lived URL that downloads the file as an attachment. */
  createDownloadUrl(key: string, opts: { filename: string }): Promise<string>;
  /** Size in bytes, or null if the object does not exist. */
  stat(key: string): Promise<{ size: number } | null>;
  remove(key: string): Promise<void>;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("File storage is not configured yet.");
    this.name = "StorageNotConfiguredError";
  }
}

const UPLOAD_TTL_MS = 10 * 60 * 1000;
const DOWNLOAD_TTL_MS = 5 * 60 * 1000;

export function createGcsStorage(
  bucketName: string,
  credentials: { client_email: string; private_key: string },
): FileStorage {
  const bucket = new GcsClient({ credentials }).bucket(bucketName);
  return {
    async createUploadUrl(key, { mime }) {
      const [url] = await bucket
        .file(key)
        .getSignedUrl({ version: "v4", action: "write", expires: Date.now() + UPLOAD_TTL_MS, contentType: mime });
      return url;
    },
    async createDownloadUrl(key, { filename }) {
      const safe = filename.replace(/[\r\n"]/g, "_");
      const [url] = await bucket.file(key).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + DOWNLOAD_TTL_MS,
        responseDisposition: `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      });
      return url;
    },
    async stat(key) {
      const [exists] = await bucket.file(key).exists();
      if (!exists) return null;
      const [meta] = await bucket.file(key).getMetadata();
      return { size: Number(meta.size) };
    },
    async remove(key) {
      await bucket.file(key).delete({ ignoreNotFound: true });
    },
  };
}

let cached: FileStorage | undefined;

/** Configured storage, or a clear error. Credentials come from env, never the repo. */
export function getStorage(): FileStorage {
  if (cached) return cached;
  const bucket = process.env.GCS_BUCKET;
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (!bucket || (!json && !file)) throw new StorageNotConfiguredError();
  const raw = json ?? readFileSync(file as string, "utf8");
  const creds = JSON.parse(raw);
  cached = createGcsStorage(bucket, { client_email: creds.client_email, private_key: creds.private_key });
  return cached;
}

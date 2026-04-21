import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_PUBLIC_BASE_URL) {
  throw new Error("Missing Cloudflare R2 configuration.");
}

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

export function publicUrlForKey(key) {
  return `${R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
}

export function mediaKey({ userId, folderId, fileName }) {
  const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return `users/${userId}/folders/${folderId}/${Date.now()}-${cleanName}`;
}

export async function uploadObject({ key, body, contentType }) {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable"
  }));
  return publicUrlForKey(key);
}

export async function getObject(key) {
  return r2.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
}

export async function deleteObject(key) {
  if (!key) return;
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
}

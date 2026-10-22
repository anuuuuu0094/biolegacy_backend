const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const env = require("../config/env");
const ApiError = require("../utils/apiError");

let client;

function requireStorage() {
  if (!env.pdfStorageConfigured) {
    throw new ApiError(503, "PDF storage is not configured yet");
  }
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: env.r2Endpoint || `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.r2AccessKeyId,
        secretAccessKey: env.r2SecretAccessKey,
      },
    });
  }
  return client;
}

async function createUploadUrl(objectKey) {
  const command = new PutObjectCommand({
    Bucket: env.r2BucketName,
    Key: objectKey,
    ContentType: "application/pdf",
  });
  return getSignedUrl(requireStorage(), command, { expiresIn: env.pdfSignedUrlTtlSeconds });
}

async function inspectPdf(objectKey) {
  const storage = requireStorage();
  let head;
  try {
    head = await storage.send(new HeadObjectCommand({ Bucket: env.r2BucketName, Key: objectKey }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
      throw new ApiError(400, "The PDF upload was not found. Please upload the file again.");
    }
    throw error;
  }

  const firstBytes = await storage.send(new GetObjectCommand({
    Bucket: env.r2BucketName,
    Key: objectKey,
    Range: "bytes=0-4",
  }));
  const bytes = await firstBytes.Body.transformToByteArray();
  const signature = Buffer.from(bytes).toString("ascii");
  return {
    size: Number(head.ContentLength || 0),
    contentType: head.ContentType || "",
    validSignature: signature === "%PDF-",
  };
}

function safeContentDisposition(disposition, fileName) {
  const asciiName = String(fileName || "document.pdf")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 150) || "document.pdf";
  return `${disposition}; filename="${asciiName}"`;
}

async function createAccessUrl(objectKey, fileName, download = false) {
  const command = new GetObjectCommand({
    Bucket: env.r2BucketName,
    Key: objectKey,
    ResponseContentType: "application/pdf",
    ResponseContentDisposition: safeContentDisposition(download ? "attachment" : "inline", fileName),
  });
  return getSignedUrl(requireStorage(), command, { expiresIn: env.pdfSignedUrlTtlSeconds });
}

async function remove(objectKey) {
  await requireStorage().send(new DeleteObjectCommand({ Bucket: env.r2BucketName, Key: objectKey }));
}

module.exports = { createUploadUrl, inspectPdf, createAccessUrl, remove };

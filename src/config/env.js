const dotenv = require("dotenv");
const path = require("path");
const crypto = require("crypto");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const nodeEnv = process.env.NODE_ENV || "development";
const developmentAdminPortalAccessKey = "biolegacy-local-admin-access-key";
const developmentAdminPortalSigningKey = "biolegacy-local-admin-signing-key";
const legacyDevelopmentAdminPortalKey = nodeEnv === "production" ? "" : (process.env.ADMIN_PORTAL_KEY || "").trim();
const derivedDevelopmentSigningKey = legacyDevelopmentAdminPortalKey
  ? crypto.createHash("sha256").update(`biolegacy.admin.signing.${legacyDevelopmentAdminPortalKey}`).digest("hex")
  : developmentAdminPortalSigningKey;
const productionFrontendUrl = "https://biolegacy.vercel.app";
const defaultFrontendUrl = nodeEnv === "production"
  ? productionFrontendUrl
  : "http://localhost:3000";
const configuredFrontendUrls = (process.env.FRONTEND_URL || defaultFrontendUrl)
  .split(",")
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const frontendUrls = [...new Set([
  ...configuredFrontendUrls,
  ...(nodeEnv === "production" ? [productionFrontendUrl] : []),
])];
const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const booleanValue = (value, fallback) => {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};
const boundedInteger = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

const env = {
  nodeEnv,
  port: Number(process.env.PORT || 7000),
  frontendUrl: frontendUrls[0],
  frontendUrls,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString("hex"),
  jwtIssuer: (process.env.JWT_ISSUER || "biolegacy-api").trim(),
  jwtAudience: (process.env.JWT_AUDIENCE || "biolegacy-web").trim(),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || "15m",
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL || "30d",
  adminPortalAccessKey: (process.env.ADMIN_PORTAL_ACCESS_KEY || legacyDevelopmentAdminPortalKey || (nodeEnv === "production" ? "" : developmentAdminPortalAccessKey)).trim(),
  adminPortalSigningKey: (process.env.ADMIN_PORTAL_SIGNING_KEY || (nodeEnv === "production" ? "" : derivedDevelopmentSigningKey)).trim(),
  databaseUrl: process.env.DATABASE_URL || process.env.Db_URL,
  dbConnectionTimeoutMs: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 15000),
  dbQueryTimeoutMs: Number(process.env.DB_QUERY_TIMEOUT_MS || 30000),
  dbPoolMax: boundedInteger(process.env.DB_POOL_MAX, nodeEnv === "production" ? 20 : 10, 1, 100),
  dbPoolMin: boundedInteger(process.env.DB_POOL_MIN, nodeEnv === "production" ? 5 : 0, 0, 50),
  dbIdleTimeoutMs: boundedInteger(process.env.DB_IDLE_TIMEOUT_MS, 30000, 1000, 300000),
  dbMaxLifetimeSeconds: boundedInteger(process.env.DB_MAX_LIFETIME_SECONDS, 300, 30, 3600),
  dbPoolMaxWaiting: boundedInteger(process.env.DB_POOL_MAX_WAITING, 500, 10, 5000),
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  appleClientId: process.env.APPLE_CLIENT_ID || "",
  appleRedirectUrl: process.env.APPLE_REDIRECT_URL || "",
  appleTeamId: process.env.APPLE_TEAM_ID || "",
  appleKeyId: process.env.APPLE_KEY_ID || "",
  applePrivateKey: (process.env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  otpProvider: (process.env.OTP_PROVIDER || (process.env.TWO_FACTOR_API_KEY ? "2factor" : "twilio")).trim().toLowerCase(),
  twoFactorApiKey: process.env.TWO_FACTOR_API_KEY || "",
  twoFactorOtpTemplate: process.env.TWO_FACTOR_OTP_TEMPLATE || "",
  twoFactorApiBaseUrl: (process.env.TWO_FACTOR_API_BASE_URL || "https://2factor.in/API/V1").replace(/\/+$/, ""),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioVerifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || "",
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  razorpayApiBaseUrl: process.env.RAZORPAY_API_BASE_URL || "https://api.razorpay.com/v1",
  r2AccountId: process.env.R2_ACCOUNT_ID || "",
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || "",
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  r2BucketName: process.env.R2_BUCKET_NAME || "",
  r2Endpoint: (process.env.R2_ENDPOINT || "").replace(/\/+$/, ""),
  pdfMaxFileSizeMb: Math.max(1, positiveNumber(process.env.PDF_MAX_FILE_SIZE_MB, 25)),
  pdfStorageQuotaMb: Math.max(1, positiveNumber(process.env.PDF_STORAGE_QUOTA_MB, 9000)),
  pdfSignedUrlTtlSeconds: Math.min(3600, Math.max(60, positiveNumber(process.env.PDF_SIGNED_URL_TTL_SECONDS, 600))),
  trustProxyHops: boundedInteger(process.env.TRUST_PROXY_HOPS, nodeEnv === "production" ? 1 : 0, 0, 5),
  redisUrl: (process.env.REDIS_URL || "").trim(),
  rateLimitStore: (process.env.RATE_LIMIT_STORE || (nodeEnv === "production" ? "postgres" : "memory")).trim().toLowerCase(),
  apiRateLimit: boundedInteger(process.env.API_RATE_LIMIT, 1500, 100, 10000),
  anonymousApiRateLimit: boundedInteger(process.env.ANONYMOUS_API_RATE_LIMIT, 20000, 100, 50000),
  authRateLimit: boundedInteger(process.env.AUTH_RATE_LIMIT, 30, 5, 500),
  rateLimitFailOpen: booleanValue(process.env.RATE_LIMIT_FAIL_OPEN, true),
  expirySweepIntervalMs: boundedInteger(process.env.EXPIRY_SWEEP_INTERVAL_MS, 5000, 1000, 60000),
  expirySweepBatchSize: boundedInteger(process.env.EXPIRY_SWEEP_BATCH_SIZE, 100, 1, 1000),
  expirySweepConcurrency: boundedInteger(process.env.EXPIRY_SWEEP_CONCURRENCY, 5, 1, 20),
  httpRequestTimeoutMs: boundedInteger(process.env.HTTP_REQUEST_TIMEOUT_MS, 30000, 5000, 120000),
  shutdownGraceMs: boundedInteger(process.env.SHUTDOWN_GRACE_MS, 15000, 1000, 60000),
  runMigrationsOnStart: booleanValue(process.env.RUN_MIGRATIONS_ON_START, nodeEnv !== "production"),
  db: {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  },
};

env.razorpayConfigured = Boolean(env.razorpayKeyId && env.razorpayKeySecret && env.razorpayWebhookSecret);
env.pdfStorageConfigured = Boolean(
  env.r2AccountId && env.r2AccessKeyId && env.r2SecretAccessKey && env.r2BucketName
);
if (env.dbPoolMin > env.dbPoolMax) throw new Error("DB_POOL_MIN must not exceed DB_POOL_MAX");

if (env.nodeEnv === "production") {
  const missing = [];

  if (!env.databaseUrl && (!env.db.user || !env.db.password || !env.db.host || !env.db.database)) {
    missing.push("DATABASE_URL or DB_* settings");
  }
  if (!process.env.JWT_ACCESS_SECRET && !process.env.JWT_SECRET) {
    missing.push("JWT_ACCESS_SECRET");
  }
  if (!process.env.JWT_REFRESH_SECRET) {
    missing.push("JWT_REFRESH_SECRET");
  }
  if (!env.adminPortalAccessKey) missing.push("ADMIN_PORTAL_ACCESS_KEY");
  if (!env.adminPortalSigningKey) missing.push("ADMIN_PORTAL_SIGNING_KEY");
  if (env.rateLimitStore === "redis" && !env.redisUrl) missing.push("REDIS_URL");

  if (missing.length) {
    throw new Error(`Missing production environment variables: ${missing.join(", ")}`);
  }

  const weakSecret = (value) => value.length < 32 || /replace|change|example|password|secret/i.test(value);
  if (weakSecret(env.jwtAccessSecret)) throw new Error("JWT_ACCESS_SECRET must be a random value of at least 32 characters");
  if (weakSecret(env.jwtRefreshSecret)) throw new Error("JWT_REFRESH_SECRET must be a random value of at least 32 characters");
  if (env.jwtAccessSecret === env.jwtRefreshSecret) throw new Error("JWT access and refresh secrets must be different");
  if (weakSecret(env.adminPortalAccessKey)) throw new Error("ADMIN_PORTAL_ACCESS_KEY must be a random value of at least 32 characters");
  if (weakSecret(env.adminPortalSigningKey)) throw new Error("ADMIN_PORTAL_SIGNING_KEY must be a random value of at least 32 characters");
  if (env.adminPortalAccessKey === env.adminPortalSigningKey) throw new Error("Admin portal access and signing keys must be different");
  if (!env.jwtIssuer || !env.jwtAudience) throw new Error("JWT_ISSUER and JWT_AUDIENCE must not be empty");
  for (const frontendUrl of env.frontendUrls) {
    let parsed;
    try { parsed = new URL(frontendUrl); } catch { throw new Error(`Invalid FRONTEND_URL origin: ${frontendUrl}`); }
    if (parsed.origin !== frontendUrl || parsed.protocol !== "https:") {
      throw new Error(`Production FRONTEND_URL must be an HTTPS origin without a path: ${frontendUrl}`);
    }
  }
  if (!['memory', 'postgres', 'redis'].includes(env.rateLimitStore)) throw new Error("RATE_LIMIT_STORE must be memory, postgres, or redis");
  if (env.rateLimitStore === "memory") {
    throw new Error("Production rate limiting must use a shared postgres or redis store");
  }
  const rotationCommand = /rotate-admin-password\.js$/i.test(process.argv[1] || "");
  if (process.env.NEW_ADMIN_PASSWORD && !rotationCommand) {
    throw new Error("Remove NEW_ADMIN_PASSWORD after completing the one-time password rotation");
  }
}

module.exports = env;

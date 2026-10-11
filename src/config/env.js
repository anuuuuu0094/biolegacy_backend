const dotenv = require("dotenv");
const path = require("path");
const crypto = require("crypto");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 7000),
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString("hex"),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || "15m",
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL || "30d",
  databaseUrl: process.env.DATABASE_URL || process.env.Db_URL,
  dbConnectionTimeoutMs: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 15000),
  dbQueryTimeoutMs: Number(process.env.DB_QUERY_TIMEOUT_MS || 30000),
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  appleClientId: process.env.APPLE_CLIENT_ID || "",
  appleRedirectUrl: process.env.APPLE_REDIRECT_URL || "",
  appleTeamId: process.env.APPLE_TEAM_ID || "",
  appleKeyId: process.env.APPLE_KEY_ID || "",
  applePrivateKey: (process.env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioVerifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || "",
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  razorpayApiBaseUrl: process.env.RAZORPAY_API_BASE_URL || "https://api.razorpay.com/v1",
  db: {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  },
};

env.razorpayConfigured = Boolean(env.razorpayKeyId && env.razorpayKeySecret && env.razorpayWebhookSecret);

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

  if (missing.length) {
    throw new Error(`Missing production environment variables: ${missing.join(", ")}`);
  }
}

module.exports = env;

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const env = require("../config/env");
const PostgresRateLimitStore = require("./postgresRateLimitStore");
const { getRedisClient } = require("../cache/redis");

function sharedStore(scope) {
  if (env.rateLimitStore === "postgres") return { store: new PostgresRateLimitStore(scope) };
  if (env.rateLimitStore === "redis") {
    const client = getRedisClient();
    return {
      store: new RedisStore({
        prefix: `biolegacy:rate-limit:${scope}:`,
        sendCommand: (...args) => client.sendCommand(args),
      }),
    };
  }
  return {};
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function clientIpKey(req) {
  return `ip:${ipKeyGenerator(req.ip || "unknown")}`;
}

function authenticatedClientKey(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return clientIpKey(req);
  try {
    const claims = jwt.verify(header.slice(7), env.jwtAccessSecret, {
      algorithms: ["HS256"],
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    });
    if (claims.tokenType === "access" && typeof claims.sub === "string") return `user:${claims.sub}`;
  } catch {
    // Invalid tokens share the caller's IP bucket.
  }
  return clientIpKey(req);
}

function authIdentityKey(req) {
  const identity = req.body?.email || req.body?.phone || req.body?.refreshToken || req.body?.credential || req.body?.identityToken;
  return identity ? `identity:${digest(String(identity).trim().toLowerCase())}` : clientIpKey(req);
}

function limiter(scope, options) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: env.rateLimitFailOpen,
    ...sharedStore(scope),
    ...options,
  });
}

const apiLimiter = limiter("api", {
  windowMs: 15 * 60 * 1000,
  limit: (req) => req.headers.authorization ? env.apiRateLimit : env.anonymousApiRateLimit,
  keyGenerator: authenticatedClientKey,
  skip: (req) => req.method === "OPTIONS" || req.path.endsWith("/live") || req.path.endsWith("/health"),
});

const authLimiter = limiter("auth", {
  windowMs: 15 * 60 * 1000,
  limit: env.authRateLimit,
  keyGenerator: authIdentityKey,
  message: { success: false, message: "Too many auth attempts. Please try again later." },
});

const paymentLimiter = limiter("payment", {
  windowMs: 10 * 60 * 1000,
  limit: 40,
  keyGenerator: authenticatedClientKey,
  message: { success: false, message: "Too many payment requests. Please wait before trying again." },
});

const phoneOtpSendLimiter = limiter("phone-send", {
  windowMs: 10 * 60 * 1000,
  limit: 3,
  keyGenerator: (req) => `phone:${digest(req.body?.phone || "invalid-phone")}`,
  message: { success: false, message: "Too many codes requested for this number. Please wait before trying again." },
});

const phoneOtpCheckLimiter = limiter("phone-check", {
  windowMs: 10 * 60 * 1000,
  limit: 8,
  keyGenerator: (req) => `phone:${digest(req.body?.phone || "invalid-phone")}`,
  message: { success: false, message: "Too many verification attempts for this number. Please wait before trying again." },
});

const adminGateLimiter = limiter("admin-gate", {
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => `gate:${digest(req.body?.clientKey || clientIpKey(req))}`,
  message: { success: false, message: "Too many attempts. Try again later." },
});

module.exports = { apiLimiter, authLimiter, paymentLimiter, phoneOtpSendLimiter, phoneOtpCheckLimiter, adminGateLimiter };

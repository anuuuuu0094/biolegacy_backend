const rateLimit = require("express-rate-limit");
const env = require("../config/env");
const PostgresRateLimitStore = require("./postgresRateLimitStore");

function sharedStore(scope) {
  return env.rateLimitStore === "postgres" ? { store: new PostgresRateLimitStore(scope) } : {};
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  ...sharedStore("api"),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  ...sharedStore("auth"),
  message: {
    success: false,
    message: "Too many auth attempts. Please try again later.",
  },
});

const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  ...sharedStore("payment"),
  message: { success: false, message: "Too many payment requests. Please wait before trying again." },
});

const phoneOtpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 3,
  keyGenerator: (req) => req.body?.phone || "invalid-phone",
  standardHeaders: true,
  legacyHeaders: false,
  ...sharedStore("phone-send"),
  message: { success: false, message: "Too many codes requested for this number. Please wait before trying again." },
});

const phoneOtpCheckLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  keyGenerator: (req) => req.body?.phone || "invalid-phone",
  standardHeaders: true,
  legacyHeaders: false,
  ...sharedStore("phone-check"),
  message: { success: false, message: "Too many verification attempts for this number. Please wait before trying again." },
});

const adminGateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => req.body.clientKey,
  standardHeaders: true,
  legacyHeaders: false,
  ...sharedStore("admin-gate"),
  message: { success: false, message: "Too many attempts. Try again later." },
});

module.exports = { apiLimiter, authLimiter, paymentLimiter, phoneOtpSendLimiter, phoneOtpCheckLimiter, adminGateLimiter };

const crypto = require("crypto");
const env = require("../config/env");
const ApiError = require("../utils/apiError");

const SIGNATURE_WINDOW_MS = 60_000;

function createAdminPortalSignature(timestamp, email, key = env.adminPortalKey) {
  return crypto
    .createHmac("sha256", key)
    .update(`${timestamp}.${String(email || "").trim().toLowerCase()}`)
    .digest("hex");
}

function signaturesMatch(received, expected) {
  if (!/^[a-f0-9]{64}$/i.test(received || "")) return false;
  return crypto.timingSafeEqual(
    Buffer.from(received.toLowerCase(), "hex"),
    Buffer.from(expected, "hex"),
  );
}

function requireAdminPortalSignature(req, res, next) {
  void res;
  if (!env.adminPortalKey || env.adminPortalKey.length < 32) {
    next(new ApiError(503, "Administrator portal is not configured"));
    return;
  }

  const timestamp = req.get("x-biolegacy-admin-timestamp") || "";
  const signature = req.get("x-biolegacy-admin-signature") || "";
  const timestampNumber = Number(timestamp);
  if (
    !/^\d{13}$/.test(timestamp)
    || !Number.isFinite(timestampNumber)
    || Math.abs(Date.now() - timestampNumber) > SIGNATURE_WINDOW_MS
  ) {
    next(new ApiError(401, "Administrator portal authorization failed"));
    return;
  }

  const expected = createAdminPortalSignature(timestamp, req.body?.email);
  if (!signaturesMatch(signature, expected)) {
    next(new ApiError(401, "Administrator portal authorization failed"));
    return;
  }

  next();
}

module.exports = { createAdminPortalSignature, requireAdminPortalSignature };

const crypto = require("crypto");
const env = require("../config/env");
const ApiError = require("../utils/apiError");

const SIGNATURE_WINDOW_MS = 60_000;

function createAdminPortalSignature(timestamp, email, key = env.adminPortalSigningKey) {
  return crypto
    .createHmac("sha256", key)
    .update(`${timestamp}.${String(email || "").trim().toLowerCase()}`)
    .digest("hex");
}

function createAdminGateAttemptSignature(timestamp, clientKey, key = env.adminPortalSigningKey) {
  return crypto.createHmac("sha256", key).update(`gate.${timestamp}.${clientKey}`).digest("hex");
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
  if (!env.adminPortalSigningKey || env.adminPortalSigningKey.length < 32) {
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

function requireAdminGateAttemptSignature(req, res, next) {
  void res;
  if (!env.adminPortalSigningKey || env.adminPortalSigningKey.length < 32) return next(new ApiError(503, "Administrator portal is not configured"));
  const timestamp = req.get("x-biolegacy-admin-timestamp") || "";
  const signature = req.get("x-biolegacy-admin-signature") || "";
  const timestampNumber = Number(timestamp);
  if (!/^\d{13}$/.test(timestamp) || !Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber) > SIGNATURE_WINDOW_MS) {
    return next(new ApiError(401, "Administrator portal authorization failed"));
  }
  const expected = createAdminGateAttemptSignature(timestamp, req.body?.clientKey);
  if (!signaturesMatch(signature, expected)) return next(new ApiError(401, "Administrator portal authorization failed"));
  next();
}

function adminPortalKeysMatch(received) {
  const left = Buffer.from(String(received || ""), "utf8");
  const right = Buffer.from(env.adminPortalAccessKey, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = {
  createAdminPortalSignature,
  createAdminGateAttemptSignature,
  requireAdminPortalSignature,
  requireAdminGateAttemptSignature,
  adminPortalKeysMatch,
};

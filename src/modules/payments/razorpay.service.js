const crypto = require("crypto");
const env = require("../../config/env");
const ApiError = require("../../utils/apiError");

function assertConfigured(requireWebhook = false) {
  const ready = env.razorpayKeyId && env.razorpayKeySecret && (!requireWebhook || env.razorpayWebhookSecret);
  if (!ready) throw new ApiError(503, "Online payments are not configured yet");
}

function safeEqual(expected, received) {
  const left = Buffer.from(String(expected), "utf8");
  const right = Buffer.from(String(received || ""), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function request(path, { method = "GET", body } = {}) {
  assertConfigured();
  const response = await fetch(`${env.razorpayApiBaseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    ...(body && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const description = payload?.error?.description || "Payment gateway request failed";
    throw new ApiError(502, description);
  }
  return payload;
}

function createOrder(input) {
  return request("/orders", { method: "POST", body: input });
}

function fetchPayment(paymentId) {
  return request(`/payments/${encodeURIComponent(paymentId)}`);
}

function createRefund(paymentId, input) {
  return request(`/payments/${encodeURIComponent(paymentId)}/refund`, { method: "POST", body: input });
}

function verifyCheckoutSignature(orderId, paymentId, signature) {
  assertConfigured();
  const expected = crypto.createHmac("sha256", env.razorpayKeySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqual(expected, signature);
}

function verifyWebhookSignature(rawBody, signature) {
  assertConfigured(true);
  const expected = crypto.createHmac("sha256", env.razorpayWebhookSecret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}

module.exports = { assertConfigured, createOrder, fetchPayment, createRefund, verifyCheckoutSignature, verifyWebhookSignature };

const env = require("../../config/env");
const ApiError = require("../../utils/apiError");

function isConfigured() {
  if (env.otpProvider === "2factor") return Boolean(env.twoFactorApiKey);
  if (env.otpProvider === "twilio") {
    return Boolean(env.twilioAccountSid && env.twilioAuthToken && env.twilioVerifyServiceSid);
  }
  return false;
}

function twoFactorPhone(phone) {
  if (!/^\+91\d{10}$/.test(phone)) {
    throw new ApiError(400, "Mobile verification currently supports Indian numbers only");
  }
  return phone.slice(1);
}

async function readProviderResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function twoFactorSucceeded(payload) {
  const status = String(payload.Status || payload.status || "").toLowerCase();
  return status === "success" || status === "sent";
}

async function sendWithTwoFactor(phone, request) {
  const target = twoFactorPhone(phone);
  const template = env.twoFactorOtpTemplate.trim();
  const templatePath = template ? `/${encodeURIComponent(template)}` : "";
  const url = `${env.twoFactorApiBaseUrl}/${encodeURIComponent(env.twoFactorApiKey)}/SMS/${target}/AUTOGEN${templatePath}`;
  let response;
  try {
    response = await request(url, {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ApiError(502, "Mobile verification service is temporarily unavailable");
  }
  const payload = await readProviderResponse(response);
  if (!response.ok || !twoFactorSucceeded(payload)) {
    if (response.status === 429) throw new ApiError(429, "Too many verification requests. Please try again later");
    throw new ApiError(502, "The verification code could not be sent. Please try again");
  }
  return { sent: true, message: "Verification code sent" };
}

async function verifyWithTwoFactor(phone, code, request) {
  const target = twoFactorPhone(phone);
  const url = `${env.twoFactorApiBaseUrl}/${encodeURIComponent(env.twoFactorApiKey)}/SMS/VERIFY3/${target}/${encodeURIComponent(code)}`;
  let response;
  try {
    response = await request(url, {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ApiError(502, "Mobile verification service is temporarily unavailable");
  }
  const payload = await readProviderResponse(response);
  if (response.status === 429) throw new ApiError(429, "Too many verification attempts. Please try again later");
  if (!response.ok || !twoFactorSucceeded(payload)) {
    throw new ApiError(401, "Invalid or expired verification code");
  }
  return true;
}

function twilioCredentials() {
  return Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString("base64");
}

async function sendWithTwilio(phone, request) {
  const response = await request(
    `https://verify.twilio.com/v2/Services/${encodeURIComponent(env.twilioVerifyServiceSid)}/Verifications`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${twilioCredentials()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: phone, Channel: "sms" }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) {
    throw new ApiError(response.status === 429 ? 429 : 502, "The verification code could not be sent. Please try again");
  }
  return { sent: true, message: "Verification code sent" };
}

async function verifyWithTwilio(phone, code, request) {
  const response = await request(
    `https://verify.twilio.com/v2/Services/${encodeURIComponent(env.twilioVerifyServiceSid)}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${twilioCredentials()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: phone, Code: code }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) {
    if (response.status === 429) throw new ApiError(429, "Too many verification attempts. Please try again later");
    throw new ApiError(401, "Invalid or expired verification code");
  }
  const payload = await readProviderResponse(response);
  if (payload.status !== "approved") throw new ApiError(401, "Invalid or expired verification code");
  return true;
}

async function sendPhoneCode(phone, request = fetch) {
  if (!isConfigured()) throw new ApiError(503, "Phone verification is not configured yet");
  return env.otpProvider === "2factor"
    ? sendWithTwoFactor(phone, request)
    : sendWithTwilio(phone, request);
}

async function verifyPhoneCode(phone, code, request = fetch) {
  if (!isConfigured()) throw new ApiError(503, "Phone verification is not configured yet");
  return env.otpProvider === "2factor"
    ? verifyWithTwoFactor(phone, code, request)
    : verifyWithTwilio(phone, code, request);
}

module.exports = { isConfigured, sendPhoneCode, verifyPhoneCode };

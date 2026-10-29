const MAX_USER_AGENT_LENGTH = 512;
const MOBILE_USER_AGENT = /android|iphone|ipad|ipod|mobile|tablet|silk|kindle|opera mini|opera mobi|windows phone|webos|blackberry/i;

function normalizeHeader(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_USER_AGENT_LENGTH) : "";
}

function classifyDevice(userAgent, mobileHint = "") {
  if (mobileHint.trim() === "?1") return "MOBILE";
  return MOBILE_USER_AGENT.test(userAgent) ? "MOBILE" : "DESKTOP";
}

function getRequestDevice(req) {
  const userAgent = normalizeHeader(
    req.get("x-biolegacy-client-user-agent") || req.get("user-agent") || "",
  );
  const mobileHint = normalizeHeader(
    req.get("x-biolegacy-client-mobile") || req.get("sec-ch-ua-mobile") || "",
  );
  return {
    deviceType: classifyDevice(userAgent, mobileHint),
    userAgent: userAgent || null,
  };
}

module.exports = { classifyDevice, getRequestDevice };

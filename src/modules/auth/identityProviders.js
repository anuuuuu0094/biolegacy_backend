const crypto = require("crypto");
const env = require("../../config/env");
const ApiError = require("../../utils/apiError");

const jwks = new Map();
const PROVIDERS = {
  google: {
    url: "https://www.googleapis.com/oauth2/v3/certs",
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: () => env.googleClientId,
  },
  apple: {
    url: "https://appleid.apple.com/auth/keys",
    issuer: ["https://appleid.apple.com"],
    audience: () => env.appleClientId,
  },
};

function createAppleClientSecret() {
  if (!env.appleTeamId || !env.appleKeyId || !env.applePrivateKey) {
    throw new ApiError(503, "Apple sign-in is not fully configured on the server");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: env.appleKeyId })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: env.appleTeamId,
    iat: now,
    exp: now + 5 * 60,
    aud: "https://appleid.apple.com",
    sub: env.appleClientId,
  })).toString("base64url");
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), {
    key: env.applePrivateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function exchangeAppleAuthorizationCode(code) {
  if (!env.appleClientId || !env.appleRedirectUrl) {
    throw new ApiError(503, "Apple sign-in is not configured");
  }
  const response = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.appleClientId,
      client_secret: createAppleClientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: env.appleRedirectUrl,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new ApiError(401, "Apple could not validate this sign-in attempt");
  const body = await response.json();
  if (!body.id_token) throw new ApiError(401, "Apple did not return a verified identity token");
  return body.id_token;
}

function decodePart(part) {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(401, "The identity provider returned an invalid token");
  }
}

async function getKeys(provider, forceRefresh = false) {
  const cached = jwks.get(provider);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.keys;
  const response = await fetch(PROVIDERS[provider].url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new ApiError(503, "Identity provider verification is temporarily unavailable");
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new ApiError(503, "Identity provider returned invalid signing keys");
  jwks.set(provider, { keys: body.keys, expiresAt: Date.now() + 60 * 60 * 1000 });
  return body.keys;
}

async function verifyIdentityToken(provider, token, nonce) {
  const configuration = PROVIDERS[provider];
  if (!configuration?.audience()) throw new ApiError(503, `${provider} sign-in is not configured`);
  if (typeof token !== "string" || typeof nonce !== "string" || nonce.length < 16) {
    throw new ApiError(400, "A valid identity token and sign-in nonce are required");
  }

  const parts = token.split(".");
  if (parts.length !== 3) throw new ApiError(401, "The identity provider returned an invalid token");
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  const expectedAlgorithm = provider === "apple" ? "ES256" : "RS256";
  const expectedKeyType = provider === "apple" ? "EC" : "RSA";
  if (header.alg !== expectedAlgorithm || typeof header.kid !== "string") {
    throw new ApiError(401, "The identity token uses an unsupported signature");
  }

  let keys = await getKeys(provider);
  let jwk = keys.find((key) => key.kid === header.kid && key.kty === expectedKeyType);
  if (!jwk) {
    keys = await getKeys(provider, true);
    jwk = keys.find((key) => key.kid === header.kid && key.kty === expectedKeyType);
  }
  if (!jwk) throw new ApiError(401, "The identity token signing key is no longer valid");

  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = Buffer.from(parts[2], "base64url");
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const signatureValid = provider === "apple"
    ? crypto.verify("sha256", Buffer.from(signingInput), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)
    : crypto.verify("RSA-SHA256", Buffer.from(signingInput), publicKey, signature);
  if (!signatureValid) {
    throw new ApiError(401, "The identity token signature is invalid");
  }

  const now = Math.floor(Date.now() / 1000);
  const audience = claims.aud;
  const audienceMatches = Array.isArray(audience)
    ? audience.includes(configuration.audience())
    : audience === configuration.audience();
  if (!configuration.issuer.includes(claims.iss) || !audienceMatches ||
      !Number.isFinite(claims.exp) || claims.exp <= now ||
      !Number.isFinite(claims.iat) || claims.iat > now + 60 || claims.nonce !== nonce ||
      typeof claims.sub !== "string" || !claims.sub) {
    throw new ApiError(401, "The identity token is expired or does not match this sign-in session");
  }

  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  if (provider === "google" && !emailVerified) {
    throw new ApiError(401, "Please use a Google account with a verified email address");
  }

  return {
    subject: claims.sub,
    email: typeof claims.email === "string" && claims.email ? claims.email.toLowerCase() : null,
    emailVerified,
    fullName: typeof claims.name === "string" ? claims.name : "",
    avatarUrl: typeof claims.picture === "string" ? claims.picture : null,
  };
}

module.exports = { verifyIdentityToken, exchangeAppleAuthorizationCode };

const jwt = require("jsonwebtoken");
const env = require("../config/env");
const ApiError = require("../utils/apiError");
const pool = require("../db/pool");

async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    throw new ApiError(401, "Authentication required");
  }

  let claims;
  try {
    claims = jwt.verify(token, env.jwtAccessSecret, {
      algorithms: ["HS256"],
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    });
  } catch {
    throw new ApiError(401, "Invalid or expired access token");
  }
  if (claims.tokenType !== "access" || typeof claims.sub !== "string") {
    throw new ApiError(401, "Invalid or expired access token");
  }

  const result = await pool.query("SELECT id, role, status FROM users WHERE id=$1", [claims.sub]);
  const user = result.rows[0];
  if (!user || user.status !== "ACTIVE") {
    throw new ApiError(401, "Account is no longer active");
  }
  req.user = { ...claims, role: user.role };
    next();
}

async function optionalAuthenticate(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return next();
  try {
    const claims = jwt.verify(header.slice(7), env.jwtAccessSecret, {
      algorithms: ["HS256"],
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    });
    if (claims.tokenType !== "access" || typeof claims.sub !== "string") return next();
    const result = await pool.query("SELECT id, role, status FROM users WHERE id=$1", [claims.sub]);
    const user = result.rows[0];
    if (user?.status === "ACTIVE") req.user = { ...claims, role: user.role };
  } catch {
    // Public catalogue requests remain public when an optional token is stale.
  }
  next();
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ApiError(403, "You do not have permission to perform this action");
    }

    next();
  };
}

module.exports = { authenticate, optionalAuthenticate, authorize };

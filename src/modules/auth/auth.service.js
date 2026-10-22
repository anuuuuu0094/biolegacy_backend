const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../../db/pool");
const env = require("../../config/env");
const ApiError = require("../../utils/apiError");
const { verifyIdentityToken, exchangeAppleAuthorizationCode } = require("./identityProviders");
const otpProvider = require("./otpProvider");

function sanitizeUser(user) {
  const result = {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    avatarUrl: user.avatar_url,
    emailVerified: Boolean(user.email_verified),
    phoneVerified: Boolean(user.phone_verified),
  };
  if (Object.prototype.hasOwnProperty.call(user, "created_at")) result.createdAt = user.created_at;
  if (Object.prototype.hasOwnProperty.call(user, "last_login_at")) result.lastLoginAt = user.last_login_at;
  if (Object.prototype.hasOwnProperty.call(user, "password_hash")) result.hasPassword = Boolean(user.password_hash);
  if (Object.prototype.hasOwnProperty.call(user, "auth_providers")) result.authProviders = user.auth_providers || [];
  return result;
}

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      tokenType: "access",
      role: user.role,
      email: user.email,
      name: user.full_name,
    },
    env.jwtAccessSecret,
    {
      expiresIn: env.accessTokenTtl,
      algorithm: "HS256",
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, jti: crypto.randomUUID(), tokenType: "refresh" },
    env.jwtRefreshSecret,
    {
      expiresIn: env.refreshTokenTtl,
      algorithm: "HS256",
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    },
  );
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function persistRefreshToken(userId, refreshToken) {
  const decoded = jwt.decode(refreshToken);
  await pool.query(
    `INSERT INTO refresh_tokens(user_id, token_hash, expires_at)
     VALUES($1, $2, to_timestamp($3))`,
    [userId, hashToken(refreshToken), decoded.exp]
  );
}

async function createSession(user) {
  if (user.status !== "ACTIVE") throw new ApiError(403, "Account is not active");
  const updated = await pool.query("UPDATE users SET last_login_at=NOW() WHERE id=$1 RETURNING *", [user.id]);
  const signedInUser = updated.rows[0] || user;
  const accessToken = signAccessToken(signedInUser);
  const refreshToken = signRefreshToken(signedInUser);
  await persistRefreshToken(signedInUser.id, refreshToken);
  return { user: sanitizeUser(signedInUser), accessToken, refreshToken };
}

async function authenticateWithPassword({ email, password }) {
  if (bcrypt.truncates(password)) throw new ApiError(401, "Invalid email or password");
  const result = await pool.query("SELECT * FROM users WHERE email=$1", [email.toLowerCase()]);
  const user = result.rows[0];

  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    throw new ApiError(401, "Invalid email or password");
  }
  return user;
}

async function login(input) {
  const user = await authenticateWithPassword(input);
  if (user.role === "TEACHER_ADMIN") {
    throw new ApiError(403, "This account cannot sign in here");
  }
  return createSession(user);
}

async function adminLogin(input) {
  const user = await authenticateWithPassword(input);
  if (user.role !== "TEACHER_ADMIN") {
    throw new ApiError(401, "Invalid administrator credentials");
  }
  return createSession(user);
}

async function loginWithIdentity(provider, input) {
  const { identityToken, nonce, displayName, authorizationCode } = input;
  const verifiedToken = provider === "apple"
    ? await exchangeAppleAuthorizationCode(authorizationCode)
    : identityToken;
  const identity = await verifyIdentityToken(provider, verifiedToken, nonce);
  const client = await pool.connect();
  let user;
  try {
    await client.query("BEGIN");
    const linked = await client.query(
      `SELECT u.* FROM auth_identities ai JOIN users u ON u.id=ai.user_id
       WHERE ai.provider=$1 AND ai.provider_subject=$2 FOR UPDATE OF u`,
      [provider, identity.subject]
    );
    user = linked.rows[0];
    if (user?.role === "TEACHER_ADMIN") {
      throw new ApiError(403, "This account cannot sign in here");
    }

    if (!user) {
      if (identity.email && identity.emailVerified) {
        const existing = await client.query("SELECT * FROM users WHERE lower(email)=lower($1) FOR UPDATE", [identity.email]);
        user = existing.rows[0];
        if (user?.role === "TEACHER_ADMIN") {
          throw new ApiError(403, "This account cannot sign in here");
        }
      }
      if (user) {
        await client.query(
          `UPDATE users SET email_verified=email_verified OR $2, avatar_url=COALESCE(avatar_url,$3), updated_at=NOW()
           WHERE id=$1`,
          [user.id, identity.emailVerified, identity.avatarUrl]
        );
        const refreshed = await client.query("SELECT * FROM users WHERE id=$1", [user.id]);
        user = refreshed.rows[0];
      } else {
        const fullName = identity.fullName || displayName?.trim() || `${provider === "apple" ? "Apple" : "Google"} student`;
        const created = await client.query(
          `INSERT INTO users(full_name,email,password_hash,role,status,avatar_url,email_verified)
           VALUES($1,$2,NULL,'STUDENT','ACTIVE',$3,$4) RETURNING *`,
          [fullName, identity.email, identity.avatarUrl, identity.emailVerified]
        );
        user = created.rows[0];
      }
      await client.query(
        "INSERT INTO auth_identities(user_id,provider,provider_subject) VALUES($1,$2,$3)",
        [user.id, provider, identity.subject]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      const retry = await pool.query(
        `SELECT u.* FROM auth_identities ai JOIN users u ON u.id=ai.user_id
         WHERE ai.provider=$1 AND ai.provider_subject=$2`,
        [provider, identity.subject]
      );
      if (retry.rows[0]) user = retry.rows[0];
      else throw new ApiError(409, "This email is already connected to another account");
    } else {
      throw error;
    }
  } finally {
    client.release();
  }
  return createSession(user);
}

async function sendPhoneCode(phone) {
  return otpProvider.sendPhoneCode(phone);
}

async function checkPhoneCode({ phone, code, fullName }) {
  await otpProvider.verifyPhoneCode(phone, code);

  const client = await pool.connect();
  let user;
  try {
    await client.query("BEGIN");
    const linked = await client.query(
      `SELECT u.* FROM auth_identities ai JOIN users u ON u.id=ai.user_id
       WHERE ai.provider='phone' AND ai.provider_subject=$1 FOR UPDATE OF u`,
      [phone]
    );
    user = linked.rows[0];
    if (user?.role === "TEACHER_ADMIN") {
      throw new ApiError(403, "This account cannot sign in here");
    }
    if (!user) {
      const existing = await client.query("SELECT * FROM users WHERE phone=$1 FOR UPDATE", [phone]);
      user = existing.rows[0];
      if (user?.role === "TEACHER_ADMIN") {
        throw new ApiError(403, "This account cannot sign in here");
      }
      if (user) {
        const updated = await client.query("UPDATE users SET phone_verified=true, updated_at=NOW() WHERE id=$1 RETURNING *", [user.id]);
        user = updated.rows[0];
      } else {
        const name = fullName?.trim() || `Student ${phone.slice(-4)}`;
        const created = await client.query(
          `INSERT INTO users(full_name,email,password_hash,phone,role,status,phone_verified)
           VALUES($1,NULL,NULL,$2,'STUDENT','ACTIVE',true) RETURNING *`,
          [name, phone]
        );
        user = created.rows[0];
      }
      await client.query(
        "INSERT INTO auth_identities(user_id,provider,provider_subject) VALUES($1,'phone',$2)",
        [user.id, phone]
      );
    } else {
      const updated = await client.query("UPDATE users SET phone_verified=true, updated_at=NOW() WHERE id=$1 RETURNING *", [user.id]);
      user = updated.rows[0];
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") throw new ApiError(409, "This phone number is already connected to another account");
    throw error;
  } finally {
    client.release();
  }
  return createSession(user);
}

function getProviderSettings() {
  const appleReady = Boolean(env.appleClientId && env.appleRedirectUrl && env.appleTeamId && env.appleKeyId && env.applePrivateKey);
  return {
    googleClientId: env.googleClientId || null,
    appleClientId: appleReady ? env.appleClientId : null,
    appleRedirectUrl: appleReady ? env.appleRedirectUrl : null,
    phoneOtpEnabled: otpProvider.isConfigured(),
  };
}

async function refresh(refreshToken) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, env.jwtRefreshSecret, {
      algorithms: ["HS256"],
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    });
  } catch {
    throw new ApiError(401, "Invalid or expired refresh token");
  }
  if (payload.tokenType !== "refresh" || typeof payload.sub !== "string" || typeof payload.jti !== "string") {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const tokenHash = hashToken(refreshToken);
  const tokenResult = await pool.query(
    `SELECT rt.user_id, u.* FROM refresh_tokens rt
     JOIN users u ON u.id=rt.user_id
     WHERE rt.token_hash=$1 AND rt.revoked_at IS NULL AND rt.expires_at > NOW()`,
    [tokenHash]
  );

  const row = tokenResult.rows[0];
  if (!row || row.user_id !== payload.sub || row.status !== "ACTIVE") {
    throw new ApiError(401, "Refresh token is no longer valid");
  }

  const revoked = await pool.query(
    "UPDATE refresh_tokens SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING id",
    [tokenHash]
  );
  if (!revoked.rowCount) throw new ApiError(401, "Refresh token is no longer valid");

  const user = {
    id: row.user_id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    avatar_url: row.avatar_url,
    email_verified: row.email_verified,
    phone_verified: row.phone_verified,
  };
  const accessToken = signAccessToken(user);
  const nextRefreshToken = signRefreshToken(user);
  await persistRefreshToken(user.id, nextRefreshToken);

  return { user: sanitizeUser(user), accessToken, refreshToken: nextRefreshToken };
}

async function logout(refreshToken) {
  if (!refreshToken) return;
  await pool.query("UPDATE refresh_tokens SET revoked_at=NOW() WHERE token_hash=$1", [
    hashToken(refreshToken),
  ]);
}

async function getMe(userId) {
  const result = await pool.query(
    `SELECT u.*,
       COALESCE(array_agg(ai.provider) FILTER (WHERE ai.provider IS NOT NULL), '{}') AS auth_providers
     FROM users u
     LEFT JOIN auth_identities ai ON ai.user_id=u.id
     WHERE u.id=$1
     GROUP BY u.id`,
    [userId]
  );
  if (!result.rows[0]) throw new ApiError(404, "User not found");
  return sanitizeUser(result.rows[0]);
}

function normalizeOptional(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function normalizePhone(value) {
  const phone = normalizeOptional(value);
  return phone && /^\d{10}$/.test(phone) ? `+91${phone}` : phone;
}

async function updateProfile(userId, input) {
  const email = normalizeOptional(input.email)?.toLowerCase() || null;
  const phone = normalizePhone(input.phone);
  try {
    if (!email) {
      const access = await pool.query(
        `SELECT password_hash,
           EXISTS(SELECT 1 FROM auth_identities WHERE user_id=$1) AS has_identity
         FROM users WHERE id=$1`,
        [userId]
      );
      if (!access.rows[0]) throw new ApiError(404, "User not found");
      if (access.rows[0].password_hash && !access.rows[0].has_identity) {
        throw new ApiError(400, "An email address is required for password sign-in");
      }
    }
    const result = await pool.query(
      `UPDATE users
       SET full_name=$2,
           email=$3,
           phone=$4,
           avatar_url=$5,
           email_verified=CASE WHEN email IS NOT DISTINCT FROM $3 THEN email_verified ELSE false END,
           phone_verified=CASE WHEN phone IS NOT DISTINCT FROM $4 THEN phone_verified ELSE false END,
           updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [userId, input.fullName.trim(), email, phone, normalizeOptional(input.avatarUrl)]
    );
    if (!result.rows[0]) throw new ApiError(404, "User not found");
    return getMe(userId);
  } catch (error) {
    if (error.code === "23505") {
      const field = String(error.constraint || "").includes("phone") ? "phone number" : "email address";
      throw new ApiError(409, `That ${field} is already used by another account`);
    }
    throw error;
  }
}

async function updatePassword(userId, { currentPassword, newPassword }) {
  if (bcrypt.truncates(newPassword) || (currentPassword && bcrypt.truncates(currentPassword))) {
    throw new ApiError(400, "Password must be at most 72 UTF-8 bytes");
  }
  const result = await pool.query("SELECT password_hash FROM users WHERE id=$1", [userId]);
  const user = result.rows[0];
  if (!user) throw new ApiError(404, "User not found");
  if (user.password_hash) {
    if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      throw new ApiError(401, "Current password is incorrect");
    }
    if (await bcrypt.compare(newPassword, user.password_hash)) {
      throw new ApiError(400, "New password must be different from the current password");
    }
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query("UPDATE users SET password_hash=$2, updated_at=NOW() WHERE id=$1", [userId, passwordHash]);
  await pool.query("UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
}

async function logoutAll(userId) {
  await pool.query("UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
}

async function createUser(input) {
  if (bcrypt.truncates(input.password)) throw new ApiError(400, "Password must be at most 72 UTF-8 bytes");
  const passwordHash = await bcrypt.hash(input.password, 12);
  const result = await pool.query(
    `INSERT INTO users(full_name, email, phone, password_hash, role, status)
     VALUES($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.fullName,
      input.email.toLowerCase(),
      input.phone || null,
      passwordHash,
      input.role,
      input.status,
    ]
  );

  return sanitizeUser(result.rows[0]);
}

module.exports = {
  login, adminLogin, loginWithIdentity, sendPhoneCode, checkPhoneCode, getProviderSettings,
  refresh, logout, logoutAll, getMe, updateProfile, updatePassword, createUser, sanitizeUser,
};

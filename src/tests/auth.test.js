const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const app = require("../app");
const pool = require("../db/pool");
const env = require("../config/env");
const authService = require("../modules/auth/auth.service");
const otpProvider = require("../modules/auth/otpProvider");
const adminService = require("../modules/admin/admin.service");
const pdfStorage = require("../services/pdfStorage");
const { createAdminPortalSignature, createAdminGateAttemptSignature } = require("../middleware/adminPortal");
const { classifyDevice } = require("../modules/auth/device");

const TEST_SESSION_ID = "00000000-0000-4000-8000-000000000088";

test("2Factor sends and verifies an OTP without exposing the API key to the client", async () => {
  const previous = {
    otpProvider: env.otpProvider,
    twoFactorApiKey: env.twoFactorApiKey,
    twoFactorOtpTemplate: env.twoFactorOtpTemplate,
    twoFactorApiBaseUrl: env.twoFactorApiBaseUrl,
  };
  env.otpProvider = "2factor";
  env.twoFactorApiKey = "test-api-key";
  env.twoFactorOtpTemplate = "BIOLEGACY_LOGIN";
  env.twoFactorApiBaseUrl = "https://2factor.in/API/V1";
  const requestedUrls = [];
  const request = async (url, options) => {
    requestedUrls.push(url);
    assert.equal(options.method, "POST");
    return new Response(JSON.stringify({ Status: "Success", Details: "OTP Matched" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    assert.deepEqual(await otpProvider.sendPhoneCode("+919876543210", request), {
      sent: true,
      message: "Verification code sent",
    });
    assert.equal(await otpProvider.verifyPhoneCode("+919876543210", "123456", request), true);
    assert.equal(requestedUrls[0], "https://2factor.in/API/V1/test-api-key/SMS/919876543210/AUTOGEN/BIOLEGACY_LOGIN");
    assert.equal(requestedUrls[1], "https://2factor.in/API/V1/test-api-key/SMS/VERIFY3/919876543210/123456");
  } finally {
    Object.assign(env, previous);
  }
});

test("2Factor rejects an invalid or expired OTP", async () => {
  const previous = { otpProvider: env.otpProvider, twoFactorApiKey: env.twoFactorApiKey };
  env.otpProvider = "2factor";
  env.twoFactorApiKey = "test-api-key";
  try {
    await assert.rejects(
      otpProvider.verifyPhoneCode("+919876543210", "000000", async () => new Response(
        JSON.stringify({ Status: "Error", Details: "OTP Mismatch" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
      { statusCode: 401, message: "Invalid or expired verification code" },
    );
  } finally {
    Object.assign(env, previous);
  }
});

test("public password login refuses administrator accounts", async () => {
  const originalQuery = pool.query;
  const passwordHash = await bcrypt.hash("PrivateAdminPassword1!", 4);
  pool.query = async () => ({ rows: [{
    id: "admin-1", email: "admin@example.com", password_hash: passwordHash,
    role: "TEACHER_ADMIN", status: "ACTIVE",
  }] });
  try {
    await assert.rejects(
      authService.login({ email: "admin@example.com", password: "PrivateAdminPassword1!" }),
      { statusCode: 403 },
    );
  } finally {
    pool.query = originalQuery;
  }
});

test("administrator login endpoint requires a signed portal request", async () => {
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@example.com", password: "PrivateAdminPassword1!" }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).success, false);
  } finally {
    server.close();
  }
});

test("a signed administrator login returns an admin session", async () => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const server = app.listen(0);
  const passwordHash = await bcrypt.hash("PrivateAdminPassword1!", 4);
  const admin = {
    id: "00000000-0000-4000-8000-000000000099",
    full_name: "Test Admin",
    email: "admin@example.com",
    phone: null,
    password_hash: passwordHash,
    role: "TEACHER_ADMIN",
    status: "ACTIVE",
    avatar_url: null,
    email_verified: true,
    phone_verified: false,
  };
  pool.query = async (sql) => {
    if (sql.includes("SELECT * FROM users WHERE email")) return { rows: [admin] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  pool.connect = async () => ({
    query: async (sql, params) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("SELECT id FROM users") && sql.includes("FOR UPDATE")) return { rows: [{ id: admin.id }] };
      if (sql.includes("UPDATE users SET last_login_at")) return { rows: [{ ...admin, last_login_at: new Date() }] };
      if (sql.includes("UPDATE refresh_tokens SET revoked_at")) {
        assert.equal(params[1], "MOBILE");
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO refresh_tokens")) {
        assert.equal(params[3], "MOBILE");
        assert.match(params[4], /iPhone/);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
    release() {},
  });
  try {
    const timestamp = String(Date.now());
    const signature = createAdminPortalSignature(timestamp, admin.email);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BioLegacy-Admin-Timestamp": timestamp,
        "X-BioLegacy-Admin-Signature": signature,
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      },
      body: JSON.stringify({ email: admin.email, password: "PrivateAdminPassword1!" }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = await response.json();
    assert.equal(payload.data.user.role, "TEACHER_ADMIN");
    assert.ok(payload.data.accessToken);
    assert.ok(payload.data.refreshToken);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    server.close();
  }
});

test("device classification separates mobile and desktop session slots", () => {
  assert.equal(classifyDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile"), "MOBILE");
  assert.equal(classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "MOBILE");
  assert.equal(classifyDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "DESKTOP");
  assert.equal(classifyDevice("Mozilla/5.0 (X11; Linux x86_64)", "?1"), "MOBILE");
});

test("refresh rotation keeps the same session and rejects reuse of the previous token", async () => {
  const originalConnect = pool.connect;
  const userId = "00000000-0000-4000-8000-000000000077";
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const initialToken = jwt.sign(
    { sub: userId, sid: TEST_SESSION_ID, jti: "initial-refresh", tokenType: "refresh" },
    env.jwtRefreshSecret,
    { expiresIn: "1h", issuer: env.jwtIssuer, audience: env.jwtAudience },
  );
  let currentHash = hash(initialToken);
  pool.connect = async () => ({
    query: async (sql, params) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("SELECT rt.id AS session_id")) {
        if (params[1] !== currentHash) return { rows: [], rowCount: 0 };
        return { rows: [{
          session_id: TEST_SESSION_ID,
          user_id: userId,
          full_name: "Student",
          email: "student@example.com",
          phone: null,
          role: "STUDENT",
          status: "ACTIVE",
          avatar_url: null,
          email_verified: true,
          phone_verified: false,
        }] };
      }
      if (sql.includes("SET token_hash=$2")) {
        assert.equal(params[0], TEST_SESSION_ID);
        assert.equal(params[3], currentHash);
        currentHash = params[1];
        return { rows: [{ id: TEST_SESSION_ID }], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  });
  try {
    const rotated = await authService.refresh(initialToken);
    assert.equal(jwt.decode(rotated.accessToken).sid, TEST_SESSION_ID);
    assert.equal(jwt.decode(rotated.refreshToken).sid, TEST_SESSION_ID);
    assert.notEqual(rotated.refreshToken, initialToken);
    await assert.rejects(authService.refresh(initialToken), { statusCode: 401 });
  } finally {
    pool.connect = originalConnect;
  }
});

test("access-token middleware rejects a revoked or replaced session immediately", async () => {
  const originalQuery = pool.query;
  const server = app.listen(0);
  pool.query = async (sql) => {
    assert.match(sql, /JOIN refresh_tokens/);
    return { rows: [] };
  };
  try {
    const token = jwt.sign(
      { sub: "student-1", sid: TEST_SESSION_ID, role: "STUDENT", tokenType: "access" },
      env.jwtAccessSecret,
      { expiresIn: "15m", issuer: env.jwtIssuer, audience: env.jwtAudience },
    );
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/student/me/learning`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).message, "Session is no longer active");
  } finally {
    pool.query = originalQuery;
    server.close();
  }
});

test("administrator gateway requires a signed request and the configured high-entropy key", async () => {
  const server = app.listen(0);
  const clientKey = "a".repeat(64);
  const timestamp = String(Date.now());
  const signature = createAdminGateAttemptSignature(timestamp, clientKey);
  const request = (accessKey, requestSignature = signature) => fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/admin/gate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BioLegacy-Admin-Timestamp": timestamp,
      "X-BioLegacy-Admin-Signature": requestSignature,
    },
    body: JSON.stringify({ accessKey, clientKey }),
  });
  try {
    assert.notEqual(env.adminPortalAccessKey, env.adminPortalSigningKey);
    const signatureFromAccessKey = createAdminGateAttemptSignature(timestamp, clientKey, env.adminPortalAccessKey);
    assert.equal((await request(env.adminPortalAccessKey, signatureFromAccessKey)).status, 401);
    assert.equal((await request("x".repeat(32))).status, 401);
    assert.equal((await request(env.adminPortalAccessKey)).status, 200);
  } finally {
    server.close();
  }
});

test("access-token middleware rejects a correctly signed token for the wrong context", async () => {
  const originalQuery = pool.query;
  const server = app.listen(0);
  let databaseReached = false;
  pool.query = async () => {
    databaseReached = true;
    return { rows: [] };
  };
  try {
    const wrongContextToken = jwt.sign(
      { sub: "student-1", tokenType: "refresh", jti: "wrong-context" },
      env.jwtAccessSecret,
      { expiresIn: "15m", issuer: env.jwtIssuer, audience: env.jwtAudience },
    );
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/student/me/learning`, {
      headers: { Authorization: `Bearer ${wrongContextToken}` },
    });
    assert.equal(response.status, 401);
    assert.equal(databaseReached, false);
  } finally {
    pool.query = originalQuery;
    server.close();
  }
});

test("refresh rejects tokens with the wrong audience before database access", async () => {
  const originalQuery = pool.query;
  let databaseReached = false;
  pool.query = async () => {
    databaseReached = true;
    return { rows: [] };
  };
  try {
    const token = jwt.sign(
      { sub: "student-1", jti: "wrong-audience", tokenType: "refresh" },
      env.jwtRefreshSecret,
      { expiresIn: "1h", issuer: env.jwtIssuer, audience: "another-application" },
    );
    await assert.rejects(authService.refresh(token), { statusCode: 401 });
    assert.equal(databaseReached, false);
  } finally {
    pool.query = originalQuery;
  }
});

test("password creation rejects values that bcrypt would silently truncate", async () => {
  await assert.rejects(
    authService.createUser({ password: "😀".repeat(19) }),
    { statusCode: 400, message: "Password must be at most 72 UTF-8 bytes" },
  );
});

test("suspended accounts cannot use an existing access token", async () => {
  const originalQuery = pool.query;
  const server = app.listen(0);
  pool.query = async () => ({ rows: [{ id: "student-1", role: "STUDENT", status: "SUSPENDED" }] });
  try {
    const token = jwt.sign(
      { sub: "student-1", sid: TEST_SESSION_ID, role: "STUDENT", tokenType: "access" },
      env.jwtAccessSecret,
      { expiresIn: "15m", issuer: env.jwtIssuer, audience: env.jwtAudience },
    );
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/student/me/learning`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).success, false);
  } finally {
    pool.query = originalQuery;
    server.close();
  }
});

test("suspended accounts cannot refresh a token", async () => {
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (sql) => {
      if (["BEGIN", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("SELECT rt.id AS session_id")) {
        return { rows: [{ session_id: TEST_SESSION_ID, user_id: "student-1", status: "SUSPENDED" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  });
  try {
    const token = jwt.sign(
      { sub: "student-1", sid: TEST_SESSION_ID, jti: "test-session", tokenType: "refresh" },
      env.jwtRefreshSecret,
      { expiresIn: "1h", issuer: env.jwtIssuer, audience: env.jwtAudience },
    );
    await assert.rejects(authService.refresh(token), { statusCode: 401 });
  } finally {
    pool.connect = originalConnect;
  }
});

test("private PDF management and access routes reject unauthenticated callers", async () => {
  const server = app.listen(0);
  const id = "00000000-0000-4000-8000-000000000001";
  try {
    const [adminResponse, studentResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${server.address().port}/api/v1/admin/courses/${id}/materials`),
      fetch(`http://127.0.0.1:${server.address().port}/api/v1/student/materials/${id}/access`),
    ]);
    assert.equal(adminResponse.status, 401);
    assert.equal(studentResponse.status, 401);
  } finally {
    server.close();
  }
});

test("PDF completion rejects an object whose stored size differs from the declared upload", async () => {
  const originalQuery = pool.query;
  const originalInspectPdf = pdfStorage.inspectPdf;
  const originalRemove = pdfStorage.remove;
  const materialId = "00000000-0000-4000-8000-000000000021";
  let removedKey = "";
  pool.query = async (sql, params) => {
    if (sql.includes("SELECT * FROM learning_materials")) {
      return { rows: [{
        id: materialId,
        course_id: "00000000-0000-4000-8000-000000000022",
        object_key: "courses/course/pdf/material/notes.pdf",
        size_bytes: "100",
      }] };
    }
    if (sql.includes("upload_status='FAILED'")) {
      assert.deepEqual(params, [materialId]);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  pdfStorage.inspectPdf = async () => ({
    size: 101,
    contentType: "application/pdf",
    validSignature: true,
  });
  pdfStorage.remove = async (objectKey) => { removedKey = objectKey; };
  try {
    await assert.rejects(
      adminService.completeMaterialUpload(materialId, {
        title: "Biology notes",
        description: "",
        moduleId: null,
        sortOrder: 0,
        downloadable: true,
        published: true,
      }, "00000000-0000-4000-8000-000000000023"),
      { statusCode: 400, message: "The uploaded PDF size does not match the selected file" },
    );
    assert.equal(removedKey, "courses/course/pdf/material/notes.pdf");
  } finally {
    pool.query = originalQuery;
    pdfStorage.inspectPdf = originalInspectPdf;
    pdfStorage.remove = originalRemove;
  }
});

test("PDF completion rejects a non-PDF storage content type", async () => {
  const originalQuery = pool.query;
  const originalInspectPdf = pdfStorage.inspectPdf;
  const originalRemove = pdfStorage.remove;
  const materialId = "00000000-0000-4000-8000-000000000024";
  let removed = false;
  pool.query = async (sql) => {
    if (sql.includes("SELECT * FROM learning_materials")) {
      return { rows: [{
        id: materialId,
        course_id: "00000000-0000-4000-8000-000000000025",
        object_key: "courses/course/pdf/material/not-pdf.pdf",
        size_bytes: "100",
      }] };
    }
    if (sql.includes("upload_status='FAILED'")) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  };
  pdfStorage.inspectPdf = async () => ({
    size: 100,
    contentType: "text/html",
    validSignature: true,
  });
  pdfStorage.remove = async () => { removed = true; };
  try {
    await assert.rejects(
      adminService.completeMaterialUpload(materialId, {
        title: "Biology notes",
        description: "",
        moduleId: null,
        sortOrder: 0,
        downloadable: true,
        published: true,
      }, "00000000-0000-4000-8000-000000000026"),
      { statusCode: 400, message: "The uploaded file is not a valid PDF" },
    );
    assert.equal(removed, true);
  } finally {
    pool.query = originalQuery;
    pdfStorage.inspectPdf = originalInspectPdf;
    pdfStorage.remove = originalRemove;
  }
});

test("an active administrator can assign a course through the API", async () => {
  const originalQuery = pool.query;
  const studentId = "00000000-0000-4000-8000-000000000001";
  const courseId = "00000000-0000-4000-8000-000000000002";
  const adminId = "00000000-0000-4000-8000-000000000003";
  const server = app.listen(0);
  pool.query = async (sql) => {
    if (sql.includes("JOIN refresh_tokens")) return { rows: [{ id: adminId, role: "TEACHER_ADMIN", status: "ACTIVE" }] };
    if (sql.includes("SELECT id FROM users")) return { rows: [{ id: studentId }] };
    if (sql.includes("SELECT id FROM courses")) return { rows: [{ id: courseId }] };
    if (sql.includes("INSERT INTO enrollments")) return { rows: [{ id: "00000000-0000-4000-8000-000000000004" }] };
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  try {
    const token = jwt.sign(
      { sub: adminId, sid: TEST_SESSION_ID, role: "TEACHER_ADMIN", tokenType: "access" },
      env.jwtAccessSecret,
      { expiresIn: "15m", issuer: env.jwtIssuer, audience: env.jwtAudience },
    );
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/admin/students/${studentId}/enrollments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, status: "ACTIVE" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.courseId, courseId);
  } finally {
    pool.query = originalQuery;
    server.close();
  }
});

test("payment creation and admin refund routes reject unauthenticated callers", async () => {
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    const payment = await fetch(`${base}/payments/create-order`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: "00000000-0000-4000-8000-000000000001", amount: 1 }),
    });
    const refund = await fetch(`${base}/admin/commerce/payments/00000000-0000-4000-8000-000000000001/refund`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "unauthorized test", accessAction: "KEEP" }),
    });
    assert.equal(payment.status, 401);
    assert.equal(refund.status, 401);
  } finally {
    server.close();
  }
});

test("an authenticated user can update only supported profile fields", async () => {
  const originalQuery = pool.query;
  const userId = "00000000-0000-4000-8000-000000000010";
  const server = app.listen(0);
  pool.query = async (sql, params) => {
    if (sql.includes("JOIN refresh_tokens")) {
      return { rows: [{ id: userId, role: "STUDENT", status: "ACTIVE" }] };
    }
    if (sql.includes("UPDATE users") && sql.includes("full_name=$2")) {
      assert.deepEqual(params, [userId, "Updated Student", "student@example.com", "+919876543210", "https://example.com/avatar.jpg"]);
      return { rows: [{
        id: userId, full_name: params[1], email: params[2], phone: params[3],
        avatar_url: params[4], role: "STUDENT", status: "ACTIVE",
        email_verified: false, phone_verified: false,
      }] };
    }
    if (sql.includes("SELECT u.*") && sql.includes("auth_providers")) {
      return { rows: [{
        id: userId, full_name: "Updated Student", email: "student@example.com",
        phone: "+919876543210", avatar_url: "https://example.com/avatar.jpg",
        role: "STUDENT", status: "ACTIVE", email_verified: false,
        phone_verified: false, password_hash: null, auth_providers: ["google"],
      }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  try {
    const token = jwt.sign(
      { sub: userId, sid: TEST_SESSION_ID, role: "STUDENT", tokenType: "access" },
      env.jwtAccessSecret,
      { expiresIn: "15m", issuer: env.jwtIssuer, audience: env.jwtAudience },
    );
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/me`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: " Updated Student ", email: "Student@Example.com",
        phone: "+91 98765 43210", avatarUrl: "https://example.com/avatar.jpg",
        role: "TEACHER_ADMIN", status: "SUSPENDED",
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.fullName, "Updated Student");
    assert.equal(payload.data.phone, "+919876543210");
    assert.equal(payload.data.role, "STUDENT");
  } finally {
    pool.query = originalQuery;
    server.close();
  }
});

test("profile updates reject unsafe avatar protocols before reaching the database", async () => {
  const originalQuery = pool.query;
  const userId = "00000000-0000-4000-8000-000000000011";
  const server = app.listen(0);
  pool.query = async (sql) => {
    if (sql.includes("JOIN refresh_tokens")) {
      return { rows: [{ id: userId, role: "STUDENT", status: "ACTIVE" }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  try {
    const token = jwt.sign(
      { sub: userId, sid: TEST_SESSION_ID, role: "STUDENT", tokenType: "access" },
      env.jwtAccessSecret,
      { expiresIn: "15m", issuer: env.jwtIssuer, audience: env.jwtAudience },
    );
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/me`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "Student", email: "student@example.com", phone: null, avatarUrl: "javascript:alert(1)" }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).success, false);
  } finally {
    pool.query = originalQuery;
    server.close();
  }
});

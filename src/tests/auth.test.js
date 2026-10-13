const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = require("../app");
const pool = require("../db/pool");
const env = require("../config/env");
const authService = require("../modules/auth/auth.service");
const { createAdminPortalSignature } = require("../middleware/adminPortal");

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
    if (sql.includes("UPDATE users SET last_login_at")) return { rows: [{ ...admin, last_login_at: new Date() }] };
    if (sql.includes("INSERT INTO refresh_tokens")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  try {
    const timestamp = String(Date.now());
    const signature = createAdminPortalSignature(timestamp, admin.email);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BioLegacy-Admin-Timestamp": timestamp,
        "X-BioLegacy-Admin-Signature": signature,
      },
      body: JSON.stringify({ email: admin.email, password: "PrivateAdminPassword1!" }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.user.role, "TEACHER_ADMIN");
    assert.ok(payload.data.accessToken);
    assert.ok(payload.data.refreshToken);
  } finally {
    pool.query = originalQuery;
    server.close();
  }
});

test("suspended accounts cannot use an existing access token", async () => {
  const originalQuery = pool.query;
  const server = app.listen(0);
  pool.query = async () => ({ rows: [{ id: "student-1", role: "STUDENT", status: "SUSPENDED" }] });
  try {
    const token = jwt.sign({ sub: "student-1", role: "STUDENT" }, env.jwtAccessSecret, { expiresIn: "15m" });
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
  const originalQuery = pool.query;
  pool.query = async () => ({ rows: [{ user_id: "student-1", status: "SUSPENDED" }] });
  try {
    const token = jwt.sign({ sub: "student-1", jti: "test-session" }, env.jwtRefreshSecret, { expiresIn: "1h" });
    await assert.rejects(authService.refresh(token), { statusCode: 401 });
  } finally {
    pool.query = originalQuery;
  }
});

test("an active administrator can assign a course through the API", async () => {
  const originalQuery = pool.query;
  const studentId = "00000000-0000-4000-8000-000000000001";
  const courseId = "00000000-0000-4000-8000-000000000002";
  const adminId = "00000000-0000-4000-8000-000000000003";
  const server = app.listen(0);
  pool.query = async (sql) => {
    if (sql.includes("SELECT id, role, status FROM users")) return { rows: [{ id: adminId, role: "TEACHER_ADMIN", status: "ACTIVE" }] };
    if (sql.includes("SELECT id FROM users")) return { rows: [{ id: studentId }] };
    if (sql.includes("SELECT id FROM courses")) return { rows: [{ id: courseId }] };
    if (sql.includes("INSERT INTO enrollments")) return { rows: [{ id: "00000000-0000-4000-8000-000000000004" }] };
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  try {
    const token = jwt.sign({ sub: adminId, role: "TEACHER_ADMIN" }, env.jwtAccessSecret, { expiresIn: "15m" });
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
    if (sql.includes("SELECT id, role, status FROM users")) {
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
    const token = jwt.sign({ sub: userId, role: "STUDENT" }, env.jwtAccessSecret, { expiresIn: "15m" });
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
    if (sql.includes("SELECT id, role, status FROM users")) {
      return { rows: [{ id: userId, role: "STUDENT", status: "ACTIVE" }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  try {
    const token = jwt.sign({ sub: userId, role: "STUDENT" }, env.jwtAccessSecret, { expiresIn: "15m" });
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

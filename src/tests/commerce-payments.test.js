const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const env = require("../config/env");
const razorpay = require("../modules/payments/razorpay.service");
const paymentService = require("../modules/payments/payment.service");
const { accessWindow } = require("../modules/commerce/access.service");
const { computeDiscount } = require("../modules/commerce/coupon.service");
const pool = require("../db/pool");
const orderService = require("../modules/commerce/order.service");

function accessFixture({ tests, series = [], grants = [], directGrants = [] }) {
  return {
    async query(sql, params) {
      if (sql.includes("FROM tests t WHERE")) {
        const [testId] = params;
        return { rows: tests[testId] ? [{ ...tests[testId], id: testId, has_direct_product: directGrants.some((grant) => grant.testId === testId) }] : [] };
      }
      if (sql.includes("ag.test_id")) {
        const [userId, testId] = params;
        const grant = directGrants.find((item) => item.userId === userId && item.testId === testId && (!item.expiresAt || item.expiresAt > new Date()));
        return { rows: grant ? [{ product_id: grant.productId, expires_at: grant.expiresAt || null }] : [] };
      }
      if (sql.includes("FROM test_series_tests")) {
        const [testId, userId, examType] = params;
        const rows = series.filter((item) => item.testIds.includes(testId) && item.examType === examType).map((item) => {
          const grant = grants.find((candidate) => candidate.userId === userId && candidate.seriesId === item.id && (!candidate.expiresAt || candidate.expiresAt > new Date()));
          return { id: item.id, access_type: item.accessType || "PAID", course_id: null, product_id: grant?.productId || null, expires_at: grant?.expiresAt || null, has_active_product: true };
        });
        return { rows };
      }
      if (sql.includes("test_eligible_users") || sql.includes("FROM enrollments")) return { rows: [] };
      throw new Error(`Unexpected access query: ${sql}`);
    },
  };
}

test("Razorpay checkout and webhook signatures use the expected HMAC inputs", () => {
  const previous = { keyId: env.razorpayKeyId, secret: env.razorpayKeySecret, webhook: env.razorpayWebhookSecret };
  env.razorpayKeyId = "rzp_test_unit";
  env.razorpayKeySecret = "unit-secret";
  env.razorpayWebhookSecret = "webhook-secret";
  try {
    const checkout = crypto.createHmac("sha256", env.razorpayKeySecret).update("order_1|pay_1").digest("hex");
    assert.equal(razorpay.verifyCheckoutSignature("order_1", "pay_1", checkout), true);
    assert.equal(razorpay.verifyCheckoutSignature("order_1", "pay_2", checkout), false);
    const body = Buffer.from('{"event":"payment.captured"}');
    const webhook = crypto.createHmac("sha256", env.razorpayWebhookSecret).update(body).digest("hex");
    assert.equal(razorpay.verifyWebhookSignature(body, webhook), true);
    assert.equal(razorpay.verifyWebhookSignature(Buffer.from("tampered"), webhook), false);
  } finally {
    env.razorpayKeyId = previous.keyId;
    env.razorpayKeySecret = previous.secret;
    env.razorpayWebhookSecret = previous.webhook;
  }
});

test("captured payment validation rejects order, amount, currency and status tampering", () => {
  const order = { razorpay_order_id: "order_1", final_amount_minor: 49900, currency: "INR" };
  const valid = { order_id: "order_1", amount: 49900, currency: "INR", status: "captured" };
  assert.doesNotThrow(() => paymentService._internals.assertPaymentMatches(order, valid));
  for (const changed of [
    { ...valid, order_id: "order_2" },
    { ...valid, amount: 100 },
    { ...valid, currency: "USD" },
    { ...valid, status: "authorized" },
  ]) assert.throws(() => paymentService._internals.assertPaymentMatches(order, changed));
});

test("coupon math stays in minor units and never creates a negative order", () => {
  assert.equal(computeDiscount({ discount_type: "PERCENT", discount_value: 10, max_discount_minor: null }, 999), 99);
  assert.equal(computeDiscount({ discount_type: "PERCENT", discount_value: 50, max_discount_minor: 200 }, 999), 200);
  assert.equal(computeDiscount({ discount_type: "FIXED", discount_value: 125, max_discount_minor: null }, 20000), 12500);
  assert.equal(computeDiscount({ discount_type: "FIXED", discount_value: 999, max_discount_minor: null }, 5000), 5000);
});

test("access windows support lifetime, duration and fixed-date products", () => {
  const paidAt = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(accessWindow({ accessType: "LIFETIME" }, paidAt).expiresAt, null);
  assert.equal(accessWindow({ accessType: "DURATION", durationDays: 30 }, paidAt).expiresAt.toISOString(), "2026-01-31T00:00:00.000Z");
  const fixed = accessWindow({ accessType: "FIXED_DATE", accessStartsAt: "2026-02-01T00:00:00.000Z", accessEndsAt: "2026-03-01T00:00:00.000Z" }, paidAt);
  assert.equal(fixed.startsAt.toISOString(), "2026-02-01T00:00:00.000Z");
  assert.equal(fixed.expiresAt.toISOString(), "2026-03-01T00:00:00.000Z");
});

test("central test access accepts free, individual and included-series grants but rejects unrelated tests", async () => {
  const access = require("../modules/commerce/access.service");
  const freeClient = { query: async () => ({ rows: [{ id: "test-free", is_free: true }] }) };
  assert.deepEqual(await access.canAccessTest(null, "test-free", freeClient), { allowed: true, source: "FREE", expiresAt: null });

  const directClient = { query: async (sql) => {
    if (sql.includes("FROM tests t WHERE")) return { rows: [{ id: "test-1", is_free: false, has_direct_product: true }] };
    if (sql.includes("ag.test_id")) return { rows: [{ product_id: "individual-product", expires_at: null }] };
    throw new Error(`Unexpected direct-access query: ${sql}`);
  } };
  assert.equal((await access.canAccessTest("user-1", "test-1", directClient)).source, "TEST");

  const seriesClient = { query: async (sql) => {
    if (sql.includes("FROM tests t WHERE")) return { rows: [{ id: "test-2", is_free: false, has_direct_product: false }] };
    if (sql.includes("ag.test_id")) return { rows: [] };
    if (sql.includes("FROM test_series_tests")) return { rows: [{ id: "neet-series", access_type: "PAID", product_id: "neet-product", expires_at: null, has_active_product: true }] };
    throw new Error(`Unexpected series-access query: ${sql}`);
  } };
  const included = await access.canAccessTest("user-1", "test-2", seriesClient);
  assert.equal(included.allowed, true);
  assert.equal(included.source, "TEST_SERIES");

  const lockedClient = { query: async (sql) => {
    if (sql.includes("FROM tests t WHERE")) return { rows: [{ id: "nursing-test", is_free: false, has_direct_product: false }] };
    if (sql.includes("ag.test_id") || sql.includes("test_eligible_users")) return { rows: [] };
    if (sql.includes("FROM test_series_tests")) return { rows: [{ id: "nursing-series", access_type: "PAID", product_id: null, course_id: null, has_active_product: true }] };
    throw new Error(`Unexpected locked-access query: ${sql}`);
  } };
  assert.deepEqual(await access.canAccessTest("neet-buyer", "nursing-test", lockedClient), { allowed: false, reason: "PAYMENT_REQUIRED" });
});

test("scenarios A-E: complete, exam-specific, subject-series and individual purchases unlock only included tests", async () => {
  const access = require("../modules/commerce/access.service");
  const tests = {
    "neet-physics-1": { is_free: false, exam_type: "NEET" },
    "neet-chemistry-1": { is_free: false, exam_type: "NEET" },
    "bsc-anatomy-1": { is_free: false, exam_type: "BSC_NURSING" },
    "bsc-nursing-1": { is_free: false, exam_type: "BSC_NURSING" },
    "bsc-nursing-extra": { is_free: false, exam_type: "BSC_NURSING" },
    "individual-test": { is_free: false, exam_type: "NEET" },
  };
  const client = accessFixture({
    tests,
    series: [
      { id: "neet-complete", examType: "NEET", testIds: ["neet-physics-1", "neet-chemistry-1"] },
      { id: "neet-physics", examType: "NEET", testIds: ["neet-physics-1"] },
      { id: "bsc-complete", examType: "BSC_NURSING", testIds: ["bsc-anatomy-1", "bsc-nursing-1"] },
      // A bad cross-exam mapping is deliberately present; the resolver must ignore it.
      { id: "neet-accidental", examType: "NEET", testIds: ["bsc-nursing-extra"] },
    ],
    grants: [
      { userId: "neet-complete-buyer", seriesId: "neet-complete", productId: "product-neet-complete" },
      { userId: "physics-buyer", seriesId: "neet-physics", productId: "product-neet-physics" },
      { userId: "bsc-buyer", seriesId: "bsc-complete", productId: "product-bsc-complete" },
      { userId: "cross-exam-buyer", seriesId: "neet-accidental", productId: "product-neet-accidental" },
    ],
    directGrants: [{ userId: "individual-buyer", testId: "individual-test", productId: "product-individual" }],
  });

  for (const testId of ["neet-physics-1", "neet-chemistry-1"]) {
    assert.equal((await access.canAccessTest("neet-complete-buyer", testId, client)).source, "TEST_SERIES");
  }
  for (const testId of ["bsc-anatomy-1", "bsc-nursing-1"]) {
    assert.equal((await access.canAccessTest("bsc-buyer", testId, client)).source, "TEST_SERIES");
  }
  assert.equal((await access.canAccessTest("bsc-buyer", "bsc-nursing-extra", client)).allowed, false);
  assert.equal((await access.canAccessTest("bsc-buyer", "neet-physics-1", client)).allowed, false);
  assert.equal((await access.canAccessTest("physics-buyer", "neet-physics-1", client)).source, "TEST_SERIES");
  assert.equal((await access.canAccessTest("physics-buyer", "neet-chemistry-1", client)).allowed, false);
  assert.equal((await access.canAccessTest("individual-buyer", "individual-test", client)).source, "TEST");
  assert.equal((await access.canAccessTest("individual-buyer", "neet-physics-1", client)).allowed, false);
  assert.equal((await access.canAccessTest("cross-exam-buyer", "bsc-nursing-extra", client)).allowed, false);
});

test("scenarios F, K and L: free access works while unauthorized and expired series access are rejected", async () => {
  const access = require("../modules/commerce/access.service");
  const client = accessFixture({
    tests: {
      free: { is_free: true, exam_type: "NEET" },
      protected: { is_free: false, exam_type: "NEET" },
      expired: { is_free: false, exam_type: "NEET" },
    },
    series: [{ id: "expiring-series", examType: "NEET", testIds: ["expired"] }],
    grants: [{ userId: "expired-buyer", seriesId: "expiring-series", productId: "expired-product", expiresAt: new Date(Date.now() - 1000) }],
  });
  assert.equal((await access.canAccessTest(null, "free", client)).source, "FREE");
  assert.deepEqual(await access.canAccessTest("outsider", "protected", client), { allowed: false, reason: "PAYMENT_REQUIRED" });
  assert.deepEqual(await access.canAccessTest("expired-buyer", "expired", client), { allowed: false, reason: "PAYMENT_REQUIRED" });
});

test("scenario J: order creation ignores a caller-supplied amount and sends the database price to Razorpay", async () => {
  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  const originalCreateOrder = razorpay.createOrder;
  const productId = "00000000-0000-4000-8000-000000000101";
  const userId = "00000000-0000-4000-8000-000000000102";
  const orderId = "00000000-0000-4000-8000-000000000103";
  const seriesId = "00000000-0000-4000-8000-000000000104";
  let gatewayInput;
  const orderRow = {
    id: orderId, order_number: "BL-UNIT-1", user_id: userId, product_id: productId, status: "PENDING",
    currency: "INR", subtotal_minor: 99900, discount_minor: 0, final_amount_minor: 99900,
    razorpay_order_id: null, product_snapshot: { title: "NEET Complete Test Series" }, pricing_snapshot: {},
    expires_at: new Date(Date.now() + 600000), paid_at: null, created_at: new Date(),
  };
  const client = { release() {}, query: async (sql) => {
    if (["BEGIN","COMMIT","ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.includes("FROM products WHERE id=")) return { rows: [{ id: productId, slug: "neet-complete", type: "TEST_SERIES", title: "NEET Complete Test Series", description: "", exam_type: "NEET", currency: "INR", price_minor: 99900, compare_at_price_minor: null, status: "ACTIVE", access_type: "DURATION", duration_days: 365, access_starts_at: null, access_ends_at: null, metadata: {} }] };
    if (sql.includes("FROM product_items WHERE")) return { rows: [{ id: "item-1", product_id: productId, target_type: "TEST_SERIES", course_id: null, test_series_id: seriesId, test_id: null, sort_order: 0 }] };
    if (sql.includes("SELECT 1 FROM access_grants")) return { rows: [] };
    if (sql.includes("SELECT * FROM orders")) return { rows: [] };
    if (sql.includes("INSERT INTO orders")) return { rows: [orderRow] };
    throw new Error(`Unexpected checkout query: ${sql}`);
  } };
  pool.connect = async () => client;
  pool.query = async (sql) => {
    if (sql.includes("UPDATE orders SET razorpay_order_id")) return { rows: [{ ...orderRow, razorpay_order_id: "order_gateway_1" }] };
    throw new Error(`Unexpected pool query: ${sql}`);
  };
  razorpay.createOrder = async (input) => { gatewayInput = input; return { id: "order_gateway_1" }; };
  try {
    const result = await orderService.create(userId, { productId, amount: 1, productType: "COURSE" });
    assert.equal(gatewayInput.amount, 99900);
    assert.equal(result.checkout.amount, 99900);
    assert.equal(result.order.productId, productId);
  } finally {
    pool.connect = originalConnect;
    pool.query = originalQuery;
    razorpay.createOrder = originalCreateOrder;
  }
});

test("scenario I: a processed Razorpay webhook redelivery is acknowledged without reprocessing", async () => {
  const previousSecret = env.razorpayWebhookSecret;
  const previousKeyId = env.razorpayKeyId;
  const previousKeySecret = env.razorpayKeySecret;
  const originalQuery = pool.query;
  env.razorpayKeyId = "rzp_test_unit";
  env.razorpayKeySecret = "unit-secret";
  env.razorpayWebhookSecret = "webhook-secret";
  const body = Buffer.from(JSON.stringify({ event: "payment.captured", payload: {} }));
  const signature = crypto.createHmac("sha256", env.razorpayWebhookSecret).update(body).digest("hex");
  const queries = [];
  pool.query = async (sql) => {
    queries.push(sql);
    if (sql.includes("INSERT INTO payment_webhook_events")) return { rows: [] };
    if (sql.includes("SELECT status FROM payment_webhook_events")) return { rows: [{ status: "PROCESSED" }] };
    throw new Error(`Duplicate webhook should not execute: ${sql}`);
  };
  try {
    assert.deepEqual(await paymentService.processWebhook(body, signature, "event-duplicate"), { duplicate: true });
    assert.equal(queries.length, 2);
  } finally {
    pool.query = originalQuery;
    env.razorpayWebhookSecret = previousSecret;
    env.razorpayKeyId = previousKeyId;
    env.razorpayKeySecret = previousKeySecret;
  }
});

test("scenario G: a failed payment records failure and never grants access", async () => {
  const originalConnect = pool.connect;
  const calls = [];
  const client = { release() {}, query: async (sql) => {
    calls.push(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.includes("SELECT * FROM orders WHERE razorpay_order_id")) return { rows: [{ id: "order-failed", user_id: "user-1", status: "PENDING", final_amount_minor: 99900, currency: "INR" }] };
    if (sql.includes("UPDATE orders SET status='FAILED'")) return { rows: [] };
    if (sql.includes("UPDATE coupon_redemptions")) return { rows: [] };
    if (sql.includes("INSERT INTO payments")) return { rows: [] };
    throw new Error(`Unexpected failed-payment query: ${sql}`);
  } };
  pool.connect = async () => client;
  try {
    const outcome = await paymentService._internals.handleVerifiedPayload({
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay-failed", order_id: "order-gateway-failed", amount: 99900, currency: "INR" } } },
    });
    assert.equal(outcome, "PROCESSED");
    assert.equal(calls.some((sql) => sql.includes("access_grants")), false);
  } finally {
    pool.connect = originalConnect;
  }
});

test("scenario H: cancelling an open order releases its coupon and grants no access", async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql) => {
    calls.push(sql);
    if (sql.includes("UPDATE orders SET status='CANCELLED'")) return { rows: [{ id: "order-1", status: "CANCELLED" }] };
    if (sql.includes("UPDATE coupon_redemptions SET status='RELEASED'")) return { rows: [] };
    throw new Error(`Unexpected cancellation query: ${sql}`);
  };
  try {
    assert.equal((await paymentService.cancel("user-1", "order-1")).status, "CANCELLED");
    assert.equal(calls.length, 2);
    assert.equal(calls.some((sql) => sql.includes("access_grants")), false);
  } finally {
    pool.query = originalQuery;
  }
});

test("scenario L: checkout rejects an active product whose fixed access period has expired", async () => {
  const products = require("../modules/commerce/product.service");
  const client = { query: async (sql) => {
    if (sql.includes("FROM products WHERE")) return { rows: [{
      id: "product-expired", slug: "expired", type: "TEST_SERIES", title: "Expired series", description: "", exam_type: "NEET",
      currency: "INR", price_minor: 10000, compare_at_price_minor: null, status: "ACTIVE", access_type: "FIXED_DATE",
      duration_days: null, access_starts_at: null, access_ends_at: new Date(Date.now() - 1000), metadata: {},
    }] };
    if (sql.includes("FROM product_items")) return { rows: [{ id: "item-expired", product_id: "product-expired", target_type: "TEST_SERIES", course_id: null, test_series_id: "series-expired", test_id: null, sort_order: 0 }] };
    throw new Error(`Unexpected expired-product query: ${sql}`);
  } };
  await assert.rejects(products.getForCheckout(client, "product-expired"), /access period has ended/);
});

test("scenario M: processed refunds follow KEEP and REVOKE access policy", async () => {
  const originalConnect = pool.connect;
  async function runPolicy(accessAction) {
    const calls = [];
    const suffix = accessAction.toLowerCase();
    const client = { release() {}, query: async (sql) => {
      calls.push(sql);
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("SELECT * FROM payments")) return { rows: [{ id: `payment-${suffix}`, order_id: `order-${suffix}`, amount_minor: 1000 }] };
      if (sql.includes("SELECT * FROM orders")) return { rows: [{ id: `order-${suffix}` }] };
      if (sql.includes("INSERT INTO refunds")) return { rows: [{ access_action: accessAction, requested_by: "admin-1", reason: "Requested refund" }] };
      if (sql.includes("SELECT COALESCE(SUM(amount_minor)")) return { rows: [{ total: 1000 }] };
      if (sql.includes("UPDATE payments") || sql.includes("UPDATE orders") || sql.includes("UPDATE access_grants") || sql.includes("UPDATE enrollments")) return { rows: [] };
      throw new Error(`Unexpected refund query: ${sql}`);
    } };
    pool.connect = async () => client;
    await paymentService.applyRefund({ id: `refund-${suffix}`, payment_id: `gateway-payment-${suffix}`, amount: 1000, status: "processed" });
    return calls;
  }
  try {
    const keepCalls = await runPolicy("KEEP");
    assert.equal(keepCalls.some((sql) => sql.includes("UPDATE access_grants")), false);
    const revokeCalls = await runPolicy("REVOKE");
    assert.equal(revokeCalls.some((sql) => sql.includes("UPDATE access_grants") && sql.includes("status='REVOKED'")), true);
    assert.equal(revokeCalls.some((sql) => sql.includes("UPDATE enrollments") && sql.includes("status='CANCELLED'")), true);
  } finally {
    pool.connect = originalConnect;
  }
});

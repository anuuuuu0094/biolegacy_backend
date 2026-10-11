const pool = require("../../db/pool");

function activeSql(alias = "ag") {
  return `${alias}.status='ACTIVE' AND ${alias}.starts_at<=NOW() AND (${alias}.expires_at IS NULL OR ${alias}.expires_at>NOW())`;
}

function accessWindow(product, paidAt = new Date()) {
  const paid = new Date(paidAt);
  if (product.accessType === "DURATION") {
    return { startsAt: paid, expiresAt: new Date(paid.getTime() + product.durationDays * 86400000) };
  }
  if (product.accessType === "FIXED_DATE") {
    return { startsAt: product.accessStartsAt ? new Date(product.accessStartsAt) : paid, expiresAt: new Date(product.accessEndsAt) };
  }
  return { startsAt: paid, expiresAt: null };
}

async function productAccess(userId, productId, client = pool) {
  const result = await client.query(
    `SELECT MIN(ag.expires_at) AS expires_at,
       COUNT(DISTINCT pi.id) FILTER (WHERE ag.id IS NOT NULL)::int AS active_items,
       (SELECT COUNT(*)::int FROM product_items WHERE product_id=$2) AS required_items
     FROM product_items pi
     LEFT JOIN access_grants ag ON ag.product_id=pi.product_id AND ag.user_id=$1 AND ${activeSql("ag")}
       AND ((pi.course_id IS NOT NULL AND ag.course_id=pi.course_id)
         OR (pi.test_series_id IS NOT NULL AND ag.test_series_id=pi.test_series_id)
         OR (pi.test_id IS NOT NULL AND ag.test_id=pi.test_id))
     WHERE pi.product_id=$2`,
    [userId, productId]
  );
  const row = result.rows[0];
  return { active: row.required_items > 0 && row.active_items === row.required_items, expiresAt: row.expires_at || null };
}

async function targetAccess(client, userId, item) {
  if (item.targetType === "COURSE") {
    const result = await client.query(
      `SELECT 1 FROM access_grants ag WHERE ag.user_id=$1 AND ag.course_id=$2 AND ${activeSql("ag")}
       UNION ALL SELECT 1 FROM enrollments e WHERE e.student_id=$1 AND e.course_id=$2 AND e.status IN ('ACTIVE','COMPLETED') AND e.source_type='MANUAL' LIMIT 1`,
      [userId, item.courseId]
    );
    return Boolean(result.rows[0]);
  }
  if (item.targetType === "TEST_SERIES") {
    const result = await client.query(`SELECT 1 FROM access_grants ag WHERE ag.user_id=$1 AND ag.test_series_id=$2 AND ${activeSql("ag")} LIMIT 1`, [userId, item.testSeriesId]);
    return Boolean(result.rows[0]);
  }
  const result = await client.query(
    `SELECT 1 FROM access_grants ag WHERE ag.user_id=$1 AND ag.test_id=$2 AND ${activeSql("ag")}
     UNION ALL
     SELECT 1 FROM access_grants ag JOIN test_series_tests tst ON tst.series_id=ag.test_series_id AND tst.is_active=true
      WHERE ag.user_id=$1 AND tst.test_id=$2 AND ${activeSql("ag")} LIMIT 1`,
    [userId, item.testId]
  );
  return Boolean(result.rows[0]);
}

async function hasAllProductTargets(client, userId, product) {
  const decisions = await Promise.all(product.items.map((item) => targetAccess(client, userId, item)));
  return decisions.length > 0 && decisions.every(Boolean);
}

async function grantOrderAccess(client, order, product) {
  const window = accessWindow(product, order.paid_at || new Date());
  const grants = [];
  for (const item of product.items) {
    const targetColumn = item.targetType === "COURSE" ? "course_id" : item.targetType === "TEST_SERIES" ? "test_series_id" : "test_id";
    const targetId = item.courseId || item.testSeriesId || item.testId;
    const inserted = await client.query(
      `INSERT INTO access_grants(user_id,product_id,source_order_id,target_type,${targetColumn},starts_at,expires_at,metadata)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8
       WHERE NOT EXISTS (SELECT 1 FROM access_grants WHERE source_order_id=$3 AND ${targetColumn}=$5)
       RETURNING id`,
      [order.user_id, product.id, order.id, item.targetType, targetId, window.startsAt, window.expiresAt, { productItemId: item.id }]
    );
    let grantId = inserted.rows[0]?.id;
    if (!grantId) {
      grantId = (await client.query(`SELECT id FROM access_grants WHERE source_order_id=$1 AND ${targetColumn}=$2`, [order.id, targetId])).rows[0].id;
    }
    grants.push(grantId);
    if (item.targetType === "COURSE") {
      await client.query(
        `INSERT INTO enrollments(student_id,course_id,status,source_type,source_order_id,access_grant_id)
         VALUES($1,$2,'ACTIVE','PURCHASE',$3,$4)
         ON CONFLICT(student_id,course_id) DO UPDATE SET status='ACTIVE',source_type='PURCHASE',source_order_id=EXCLUDED.source_order_id,access_grant_id=EXCLUDED.access_grant_id,updated_at=NOW()`,
        [order.user_id, item.courseId, order.id, grantId]
      );
    }
  }
  return grants;
}

async function canAccessTest(userId, testId, client = pool) {
  const testResult = await client.query(
    `SELECT t.id,t.is_free,t.exam_type,t.lifecycle_status,t.starts_at,t.ends_at,t.series_id,
       EXISTS(SELECT 1 FROM product_items pi JOIN products p ON p.id=pi.product_id AND p.status='ACTIVE' WHERE pi.test_id=t.id) AS has_direct_product
     FROM tests t WHERE t.id=$1`, [testId]
  );
  const test = testResult.rows[0];
  if (!test) return { allowed: false, reason: "TEST_NOT_FOUND" };
  if (test.is_free) return { allowed: true, source: "FREE", expiresAt: null };
  if (!userId) return { allowed: false, reason: "AUTHENTICATION_REQUIRED" };

  const direct = await client.query(
    `SELECT ag.product_id,ag.expires_at FROM access_grants ag WHERE ag.user_id=$1 AND ag.test_id=$2 AND ${activeSql("ag")} ORDER BY ag.expires_at NULLS FIRST LIMIT 1`,
    [userId, testId]
  );
  if (direct.rows[0]) return { allowed: true, source: "TEST", productId: direct.rows[0].product_id, expiresAt: direct.rows[0].expires_at };

  const series = await client.query(
    `SELECT ts.id,ts.access_type,ts.course_id,ag.product_id,ag.expires_at,
       EXISTS(SELECT 1 FROM product_items pi JOIN products p ON p.id=pi.product_id AND p.status='ACTIVE' WHERE pi.test_series_id=ts.id) AS has_active_product
     FROM test_series_tests tst JOIN test_series ts ON ts.id=tst.series_id
     LEFT JOIN access_grants ag ON ag.test_series_id=ts.id AND ag.user_id=$2 AND ${activeSql("ag")}
     WHERE tst.test_id=$1 AND tst.is_active=true AND ts.exam_type=$3
       AND ts.lifecycle_status='PUBLISHED' AND ts.published=true
     ORDER BY ag.created_at DESC NULLS LAST`,
    [testId, userId, test.exam_type]
  );
  const owned = series.rows.find((row) => row.product_id);
  if (owned) return { allowed: true, source: "TEST_SERIES", productId: owned.product_id, testSeriesId: owned.id, expiresAt: owned.expires_at };

  const publicSeries = series.rows.find((row) => row.access_type === "PUBLIC");
  if (publicSeries) return { allowed: true, source: "FREE", testSeriesId: publicSeries.id, expiresAt: null };

  const explicit = await client.query("SELECT 1 FROM test_eligible_users WHERE test_id=$1 AND user_id=$2", [testId, userId]);
  if (explicit.rows[0]) return { allowed: true, source: "SELECTED_USER", expiresAt: null };

  for (const row of series.rows) {
    if (row.course_id) {
      const enrollment = await client.query("SELECT 1 FROM enrollments WHERE student_id=$1 AND course_id=$2 AND status IN ('ACTIVE','COMPLETED')", [userId, row.course_id]);
      if (enrollment.rows[0]) return { allowed: true, source: "COURSE_ENROLLMENT", testSeriesId: row.id, expiresAt: null };
    }
  }

  const legacy = series.rows.find((row) => row.access_type === "AUTHENTICATED" && !row.has_active_product);
  if (legacy && !test.has_direct_product) return { allowed: true, source: "LEGACY_AUTHENTICATED", testSeriesId: legacy.id, expiresAt: null };
  return { allowed: false, reason: "PAYMENT_REQUIRED" };
}

async function revokeOrderAccess(client, orderId, actorId, reason) {
  await client.query(
    `UPDATE access_grants SET status='REVOKED',revoked_at=NOW(),revoked_by=$2,revoke_reason=$3,updated_at=NOW()
     WHERE source_order_id=$1 AND status='ACTIVE'`, [orderId, actorId, reason]
  );
  await client.query(
    `UPDATE enrollments SET status='CANCELLED',updated_at=NOW()
     WHERE source_order_id=$1 AND source_type='PURCHASE'`, [orderId]
  );
}

module.exports = { activeSql, accessWindow, productAccess, hasAllProductTargets, grantOrderAccess, canAccessTest, revokeOrderAccess };

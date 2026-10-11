const ApiError = require("../../utils/apiError");

function computeDiscount(coupon, subtotalMinor) {
  let discountMinor = coupon.discount_type === "PERCENT"
    ? Math.floor(subtotalMinor * Number(coupon.discount_value) / 100)
    : Math.round(Number(coupon.discount_value) * 100);
  if (coupon.max_discount_minor != null) discountMinor = Math.min(discountMinor, Number(coupon.max_discount_minor));
  return Math.max(0, Math.min(subtotalMinor, discountMinor));
}

async function ensureScope(client, couponId, table, column, value, message) {
  const count = await client.query(`SELECT COUNT(*)::int AS total FROM ${table} WHERE coupon_id=$1`, [couponId]);
  if (!count.rows[0].total) return;
  const match = await client.query(`SELECT 1 FROM ${table} WHERE coupon_id=$1 AND ${column}=$2`, [couponId, value]);
  if (!match.rows[0]) throw new ApiError(400, message);
}

async function calculate(client, code, product, userId, subtotalMinor) {
  if (!code) return { coupon: null, discountMinor: 0 };
  const result = await client.query("SELECT * FROM coupons WHERE lower(code)=lower($1) FOR UPDATE", [code]);
  const coupon = result.rows[0];
  if (!coupon || coupon.status !== "ACTIVE") throw new ApiError(400, "Coupon is invalid or inactive");
  const now = new Date();
  if (coupon.starts_at && now < new Date(coupon.starts_at)) throw new ApiError(400, "Coupon is not active yet");
  if (coupon.expires_at && now >= new Date(coupon.expires_at)) throw new ApiError(400, "Coupon has expired");
  if (subtotalMinor < Number(coupon.minimum_amount_minor)) throw new ApiError(400, "Order does not meet the coupon minimum amount");

  await ensureScope(client, coupon.id, "coupon_products", "product_id", product.id, "Coupon does not apply to this product");
  await ensureScope(client, coupon.id, "coupon_product_types", "product_type", product.type, "Coupon does not apply to this product type");
  await ensureScope(client, coupon.id, "coupon_exam_types", "exam_type", product.examType, "Coupon does not apply to this exam");
  await ensureScope(client, coupon.id, "coupon_allowed_users", "user_id", userId, "Coupon is not available for this account");

  const usage = await client.query(
    `SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE user_id=$2)::int AS user_total
     FROM coupon_redemptions WHERE coupon_id=$1 AND status IN ('RESERVED','REDEEMED')`, [coupon.id, userId]
  );
  if (coupon.usage_limit && usage.rows[0].total >= coupon.usage_limit) throw new ApiError(400, "Coupon usage limit has been reached");
  if (usage.rows[0].user_total >= coupon.per_user_limit) throw new ApiError(400, "You have already used this coupon");

  const discountMinor = computeDiscount(coupon, subtotalMinor);
  return { coupon, discountMinor };
}

module.exports = { calculate, computeDiscount };

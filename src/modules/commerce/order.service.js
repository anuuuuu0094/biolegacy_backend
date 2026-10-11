const crypto = require("crypto");
const pool = require("../../db/pool");
const ApiError = require("../../utils/apiError");
const env = require("../../config/env");
const products = require("./product.service");
const coupons = require("./coupon.service");
const access = require("./access.service");
const razorpay = require("../payments/razorpay.service");

function orderNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `BL-${stamp}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
}

function mapOrder(row) {
  return {
    id: row.id, orderNumber: row.order_number, userId: row.user_id, productId: row.product_id,
    status: row.status, currency: row.currency, subtotalMinor: Number(row.subtotal_minor),
    discountMinor: Number(row.discount_minor), finalAmountMinor: Number(row.final_amount_minor),
    razorpayOrderId: row.razorpay_order_id, product: row.product_snapshot,
    pricing: row.pricing_snapshot, paidAt: row.paid_at, createdAt: row.created_at,
  };
}

async function create(userId, input) {
  const client = await pool.connect();
  let order;
  let product;
  try {
    await client.query("BEGIN");
    product = await products.getForCheckout(client, input.productId);
    if (await access.hasAllProductTargets(client, userId, product)) {
      await client.query("ROLLBACK");
      return { alreadyPurchased: true, access: await access.productAccess(userId, product.id), product };
    }

    let existing = await client.query(
      "SELECT * FROM orders WHERE user_id=$1 AND product_id=$2 AND status IN ('CREATED','PENDING') ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [userId, product.id]
    );
    if (existing.rows[0]?.expires_at && new Date(existing.rows[0].expires_at) <= new Date()) {
      await client.query("UPDATE orders SET status='CANCELLED',updated_at=NOW() WHERE id=$1", [existing.rows[0].id]);
      await client.query("UPDATE coupon_redemptions SET status='RELEASED' WHERE order_id=$1 AND status='RESERVED'", [existing.rows[0].id]);
      existing = { rows: [] };
    }
    if (existing.rows[0]) {
      await client.query("COMMIT");
      const row = existing.rows[0];
      if (!row.razorpay_order_id) throw new ApiError(409, "Checkout is being prepared. Please try again shortly.");
      return { alreadyPurchased: false, order: mapOrder(row), checkout: checkoutData(row) };
    }

    const subtotal = product.priceMinor;
    const discount = await coupons.calculate(client, input.couponCode, product, userId, subtotal);
    const finalAmount = subtotal - discount.discountMinor;
    const snapshot = {
      id: product.id, slug: product.slug, type: product.type, title: product.title,
      examType: product.examType, accessType: product.accessType, durationDays: product.durationDays,
      accessStartsAt: product.accessStartsAt, accessEndsAt: product.accessEndsAt, items: product.items,
    };
    const pricing = { subtotalMinor: subtotal, discountMinor: discount.discountMinor, finalAmountMinor: finalAmount, couponCode: discount.coupon?.code || null };
    const created = await client.query(
      `INSERT INTO orders(order_number,user_id,product_id,status,currency,subtotal_minor,discount_minor,final_amount_minor,coupon_id,product_snapshot,pricing_snapshot,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()+INTERVAL '30 minutes') RETURNING *`,
      [orderNumber(), userId, product.id, finalAmount === 0 ? "PAID" : "PENDING", product.currency, subtotal, discount.discountMinor, finalAmount, discount.coupon?.id || null, snapshot, pricing]
    );
    order = created.rows[0];
    if (discount.coupon) {
      await client.query("INSERT INTO coupon_redemptions(coupon_id,user_id,order_id,discount_minor,status) VALUES($1,$2,$3,$4,$5)", [discount.coupon.id, userId, order.id, discount.discountMinor, finalAmount === 0 ? "REDEEMED" : "RESERVED"]);
    }
    if (finalAmount === 0) {
      const paid = (await client.query("UPDATE orders SET paid_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [order.id])).rows[0];
      await access.grantOrderAccess(client, paid, product);
      await client.query("COMMIT");
      return { alreadyPurchased: false, free: true, order: mapOrder(paid), accessGranted: true };
    }
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* already closed */ }
    if (error.code === "23505") throw new ApiError(409, "A checkout for this product already exists. Please retry.");
    throw error;
  } finally {
    client.release();
  }

  try {
    const gatewayOrder = await razorpay.createOrder({
      amount: Number(order.final_amount_minor), currency: order.currency,
      receipt: order.order_number.slice(0, 40),
      notes: { internal_order_id: order.id, product_id: order.product_id, user_id: order.user_id },
    });
    const updated = await pool.query("UPDATE orders SET razorpay_order_id=$1,updated_at=NOW() WHERE id=$2 AND status='PENDING' RETURNING *", [gatewayOrder.id, order.id]);
    if (!updated.rows[0]) throw new ApiError(409, "Order state changed before checkout was ready");
    return { alreadyPurchased: false, order: mapOrder(updated.rows[0]), checkout: checkoutData(updated.rows[0]) };
  } catch (error) {
    await pool.query("UPDATE orders SET status='FAILED',updated_at=NOW() WHERE id=$1 AND status='PENDING'", [order.id]);
    await pool.query("UPDATE coupon_redemptions SET status='RELEASED' WHERE order_id=$1 AND status='RESERVED'", [order.id]);
    throw error;
  }
}

function checkoutData(row) {
  return {
    keyId: env.razorpayKeyId, orderId: row.razorpay_order_id,
    amount: Number(row.final_amount_minor), currency: row.currency,
    name: "BioLegacy", description: row.product_snapshot?.title || "BioLegacy purchase",
  };
}

async function listForUser(userId) {
  const result = await pool.query("SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC", [userId]);
  return result.rows.map(mapOrder);
}

async function getForUser(userId, id) {
  const result = await pool.query("SELECT * FROM orders WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!result.rows[0]) throw new ApiError(404, "Order not found");
  return mapOrder(result.rows[0]);
}

module.exports = { create, mapOrder, listForUser, getForUser, checkoutData };

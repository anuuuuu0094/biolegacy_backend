const crypto = require("crypto");
const pool = require("../../db/pool");
const ApiError = require("../../utils/apiError");
const access = require("../commerce/access.service");
const razorpay = require("./razorpay.service");

function normalizedProduct(order) {
  const snapshot = order.product_snapshot || {};
  return {
    id: order.product_id,
    accessType: snapshot.accessType || "LIFETIME",
    durationDays: snapshot.durationDays || null,
    accessStartsAt: snapshot.accessStartsAt || null,
    accessEndsAt: snapshot.accessEndsAt || null,
    items: Array.isArray(snapshot.items) ? snapshot.items : [],
  };
}

function assertPaymentMatches(order, gatewayPayment) {
  if (gatewayPayment.order_id !== order.razorpay_order_id) throw new ApiError(400, "Payment does not belong to this order");
  if (Number(gatewayPayment.amount) !== Number(order.final_amount_minor)) throw new ApiError(400, "Payment amount does not match the order");
  if (String(gatewayPayment.currency).toUpperCase() !== String(order.currency).toUpperCase()) throw new ApiError(400, "Payment currency does not match the order");
  if (gatewayPayment.status !== "captured") throw new ApiError(409, "Payment is not captured yet");
}

async function finalizeCapturedPayment(gatewayPayment, source, expectedUserId = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT * FROM orders WHERE razorpay_order_id=$1 FOR UPDATE", [gatewayPayment.order_id]);
    const order = found.rows[0];
    if (!order) throw new ApiError(404, "Payment order was not found");
    if (expectedUserId && order.user_id !== expectedUserId) throw new ApiError(403, "This payment order belongs to another account");
    assertPaymentMatches(order, gatewayPayment);

    const payment = await client.query(
      `INSERT INTO payments(order_id,user_id,gateway,gateway_order_id,gateway_payment_id,amount_minor,currency,status,payment_method,gateway_payload,paid_at)
       VALUES($1,$2,'RAZORPAY',$3,$4,$5,$6,'CAPTURED',$7,$8,to_timestamp($9))
       ON CONFLICT(gateway,gateway_payment_id) WHERE gateway_payment_id IS NOT NULL
       DO UPDATE SET status='CAPTURED',payment_method=EXCLUDED.payment_method,gateway_payload=EXCLUDED.gateway_payload,paid_at=EXCLUDED.paid_at,updated_at=NOW()
       RETURNING *`,
      [order.id, order.user_id, order.razorpay_order_id, gatewayPayment.id, gatewayPayment.amount, gatewayPayment.currency, gatewayPayment.method || null, { ...gatewayPayment, source }, gatewayPayment.created_at || Math.floor(Date.now()/1000)]
    );
    if (payment.rows[0].order_id !== order.id) throw new ApiError(409, "Payment was already assigned to another order");

    let paidOrder = order;
    if (!["REFUNDED","PARTIALLY_REFUNDED"].includes(order.status)) {
      paidOrder = (await client.query("UPDATE orders SET status='PAID',paid_at=COALESCE(paid_at,NOW()),updated_at=NOW() WHERE id=$1 RETURNING *", [order.id])).rows[0];
      await client.query("UPDATE coupon_redemptions SET status='REDEEMED',redeemed_at=COALESCE(redeemed_at,NOW()) WHERE order_id=$1 AND status='RESERVED'", [order.id]);
      await access.grantOrderAccess(client, paidOrder, normalizedProduct(paidOrder));
    }
    await client.query("COMMIT");
    return { orderId: order.id, orderNumber: order.order_number, status: paidOrder.status, accessGranted: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function verify(userId, input) {
  const order = await pool.query("SELECT razorpay_order_id,user_id FROM orders WHERE razorpay_order_id=$1", [input.razorpayOrderId]);
  if (!order.rows[0] || order.rows[0].user_id !== userId) throw new ApiError(404, "Payment order not found");
  if (!razorpay.verifyCheckoutSignature(order.rows[0].razorpay_order_id, input.razorpayPaymentId, input.razorpaySignature)) {
    throw new ApiError(400, "Invalid payment signature");
  }
  const gatewayPayment = await razorpay.fetchPayment(input.razorpayPaymentId);
  return finalizeCapturedPayment(gatewayPayment, "VERIFY_API", userId);
}

async function cancel(userId, orderId) {
  const result = await pool.query(
    `UPDATE orders SET status='CANCELLED',updated_at=NOW()
     WHERE id=$1 AND user_id=$2 AND status IN ('CREATED','PENDING') RETURNING id,status`, [orderId,userId]
  );
  if (!result.rows[0]) throw new ApiError(409, "Order cannot be cancelled");
  await pool.query("UPDATE coupon_redemptions SET status='RELEASED' WHERE order_id=$1 AND status='RESERVED'", [orderId]);
  return result.rows[0];
}

async function markFailed(gatewayPayment) {
  if (!gatewayPayment?.order_id) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = (await client.query("SELECT * FROM orders WHERE razorpay_order_id=$1 FOR UPDATE", [gatewayPayment.order_id])).rows[0];
    if (!order || ["PAID","REFUNDED","PARTIALLY_REFUNDED"].includes(order.status)) { await client.query("COMMIT"); return; }
    await client.query("UPDATE orders SET status='FAILED',updated_at=NOW() WHERE id=$1", [order.id]);
    await client.query("UPDATE coupon_redemptions SET status='RELEASED' WHERE order_id=$1 AND status='RESERVED'", [order.id]);
    if (gatewayPayment.id) {
      await client.query(
        `INSERT INTO payments(order_id,user_id,gateway,gateway_order_id,gateway_payment_id,amount_minor,currency,status,payment_method,gateway_payload)
         VALUES($1,$2,'RAZORPAY',$3,$4,$5,$6,'FAILED',$7,$8)
         ON CONFLICT(gateway,gateway_payment_id) WHERE gateway_payment_id IS NOT NULL DO NOTHING`,
        [order.id,order.user_id,gatewayPayment.order_id,gatewayPayment.id,gatewayPayment.amount || order.final_amount_minor,gatewayPayment.currency || order.currency,gatewayPayment.method || null,gatewayPayment]
      );
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function applyRefund(refundEntity) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const payment = (await client.query("SELECT * FROM payments WHERE gateway_payment_id=$1 FOR UPDATE", [refundEntity.payment_id])).rows[0];
    if (!payment) { await client.query("COMMIT"); return; }
    const order = (await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [payment.order_id])).rows[0];
    const local = await client.query(
      `INSERT INTO refunds(order_id,payment_id,gateway_refund_id,amount_minor,status,reason,access_action,requested_by,gateway_payload,processed_at)
       VALUES($1,$2,$3,$4,'PROCESSED','Razorpay refund','KEEP',NULL,$5,NOW())
       ON CONFLICT(gateway_refund_id) DO UPDATE SET status='PROCESSED',gateway_payload=EXCLUDED.gateway_payload,processed_at=NOW(),updated_at=NOW()
       RETURNING *`, [order.id,payment.id,refundEntity.id,refundEntity.amount,refundEntity]
    );
    const totals = await client.query("SELECT COALESCE(SUM(amount_minor),0)::bigint AS total FROM refunds WHERE payment_id=$1 AND status='PROCESSED'", [payment.id]);
    const full = Number(totals.rows[0].total) >= Number(payment.amount_minor);
    await client.query("UPDATE payments SET status=$2,updated_at=NOW() WHERE id=$1", [payment.id,full?"REFUNDED":"PARTIALLY_REFUNDED"]);
    await client.query("UPDATE orders SET status=$2,updated_at=NOW() WHERE id=$1", [order.id,full?"REFUNDED":"PARTIALLY_REFUNDED"]);
    if (local.rows[0].access_action === "REVOKE") await access.revokeOrderAccess(client,order.id,local.rows[0].requested_by,local.rows[0].reason);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function handleVerifiedPayload(payload) {
  const payment = payload.payload?.payment?.entity;
  const refund = payload.payload?.refund?.entity;
  if (["payment.captured","order.paid"].includes(payload.event) && payment) {
    await finalizeCapturedPayment(payment,"WEBHOOK");
    return "PROCESSED";
  }
  if (payload.event === "payment.failed" && payment) {
    await markFailed(payment);
    return "PROCESSED";
  }
  if (["refund.processed","refund.created"].includes(payload.event) && refund && refund.status === "processed") {
    await applyRefund(refund);
    return "PROCESSED";
  }
  return "IGNORED";
}

async function processWebhook(rawBody, signature, eventId) {
  if (!Buffer.isBuffer(rawBody) || !razorpay.verifyWebhookSignature(rawBody, signature)) throw new ApiError(400, "Invalid webhook signature");
  let payload;
  try { payload = JSON.parse(rawBody.toString("utf8")); } catch { throw new ApiError(400, "Invalid webhook payload"); }
  const stableEventId = eventId || crypto.createHash("sha256").update(rawBody).digest("hex");
  const inserted = await pool.query(
    `INSERT INTO payment_webhook_events(gateway,gateway_event_id,event_type,payload,attempts)
     VALUES('RAZORPAY',$1,$2,$3,1) ON CONFLICT(gateway,gateway_event_id) DO NOTHING RETURNING id`,
    [stableEventId,payload.event || "unknown",payload]
  );
  if (!inserted.rows[0]) {
    const existing = await pool.query("SELECT status FROM payment_webhook_events WHERE gateway='RAZORPAY' AND gateway_event_id=$1", [stableEventId]);
    if (existing.rows[0]?.status === "PROCESSED" || existing.rows[0]?.status === "IGNORED") return { duplicate: true };
    await pool.query("UPDATE payment_webhook_events SET attempts=attempts+1,status='RECEIVED',last_error=NULL WHERE gateway='RAZORPAY' AND gateway_event_id=$1", [stableEventId]);
  }
  try {
    const outcome = await handleVerifiedPayload(payload);
    if (outcome === "IGNORED") {
      await pool.query("UPDATE payment_webhook_events SET status='IGNORED',processed_at=NOW() WHERE gateway='RAZORPAY' AND gateway_event_id=$1", [stableEventId]);
      return { ignored: true };
    }
    await pool.query("UPDATE payment_webhook_events SET status='PROCESSED',processed_at=NOW() WHERE gateway='RAZORPAY' AND gateway_event_id=$1", [stableEventId]);
    return { processed: true };
  } catch (error) {
    await pool.query("UPDATE payment_webhook_events SET status='FAILED',last_error=$2 WHERE gateway='RAZORPAY' AND gateway_event_id=$1", [stableEventId,String(error.message).slice(0,2000)]);
    throw error;
  }
}

async function reconcileFailedEvents(limit = 25) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const events = await pool.query(
    `SELECT gateway_event_id,payload FROM payment_webhook_events
     WHERE gateway='RAZORPAY' AND status='FAILED' ORDER BY received_at LIMIT $1`, [safeLimit]
  );
  const summary = { selected: events.rowCount, processed: 0, ignored: 0, failed: 0 };
  for (const event of events.rows) {
    try {
      await pool.query("UPDATE payment_webhook_events SET attempts=attempts+1,last_error=NULL WHERE gateway='RAZORPAY' AND gateway_event_id=$1", [event.gateway_event_id]);
      const outcome = await handleVerifiedPayload(event.payload);
      await pool.query("UPDATE payment_webhook_events SET status=$2,processed_at=NOW() WHERE gateway='RAZORPAY' AND gateway_event_id=$1", [event.gateway_event_id,outcome]);
      if (outcome === "PROCESSED") summary.processed += 1; else summary.ignored += 1;
    } catch (error) {
      summary.failed += 1;
      await pool.query("UPDATE payment_webhook_events SET status='FAILED',last_error=$2 WHERE gateway='RAZORPAY' AND gateway_event_id=$1", [event.gateway_event_id,String(error.message).slice(0,2000)]);
    }
  }
  return summary;
}

module.exports = { verify, cancel, finalizeCapturedPayment, processWebhook, applyRefund, reconcileFailedEvents, _internals: { assertPaymentMatches, handleVerifiedPayload } };

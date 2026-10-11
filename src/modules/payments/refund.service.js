const pool = require("../../db/pool");
const ApiError = require("../../utils/apiError");
const razorpay = require("./razorpay.service");
const paymentService = require("./payment.service");

async function createRefund(actorId, paymentId, input) {
  const client = await pool.connect();
  let refund;
  let payment;
  try {
    await client.query("BEGIN");
    payment = (await client.query("SELECT * FROM payments WHERE id=$1 FOR UPDATE", [paymentId])).rows[0];
    if (!payment || !["CAPTURED","PARTIALLY_REFUNDED"].includes(payment.status)) throw new ApiError(409, "Payment is not refundable");
    const total = await client.query("SELECT COALESCE(SUM(amount_minor),0)::bigint AS total FROM refunds WHERE payment_id=$1 AND status IN ('CREATED','PENDING','PROCESSED')", [paymentId]);
    const remaining = Number(payment.amount_minor) - Number(total.rows[0].total);
    const amount = input.amountMinor == null ? remaining : input.amountMinor;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) throw new ApiError(400, "Refund amount exceeds the refundable balance");
    refund = (await client.query(
      `INSERT INTO refunds(order_id,payment_id,amount_minor,status,reason,access_action,requested_by)
       VALUES($1,$2,$3,'PENDING',$4,$5,$6) RETURNING *`,
      [payment.order_id,payment.id,amount,input.reason,input.accessAction,actorId]
    )).rows[0];
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }

  try {
    const gateway = await razorpay.createRefund(payment.gateway_payment_id, {
      amount: Number(refund.amount_minor),
      notes: { internal_refund_id: refund.id, internal_order_id: refund.order_id, reason: refund.reason.slice(0,200) },
      receipt: refund.id.replaceAll("-", "").slice(0,40),
    });
    await pool.query("UPDATE refunds SET gateway_refund_id=$1,status=$2,gateway_payload=$3,updated_at=NOW() WHERE id=$4", [gateway.id,gateway.status === "processed" ? "PROCESSED" : "PENDING",gateway,refund.id]);
    if (gateway.status === "processed") await paymentService.applyRefund(gateway);
    return { id: refund.id, gatewayRefundId: gateway.id, amountMinor: Number(refund.amount_minor), status: gateway.status, accessAction: refund.access_action };
  } catch (error) {
    await pool.query("UPDATE refunds SET status='FAILED',updated_at=NOW() WHERE id=$1 AND gateway_refund_id IS NULL", [refund.id]);
    throw error;
  }
}

module.exports = { createRefund };

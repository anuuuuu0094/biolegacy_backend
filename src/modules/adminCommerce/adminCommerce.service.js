const pool = require("../../db/pool");
const ApiError = require("../../utils/apiError");
const audit = require("../../utils/audit");
const { mapProduct, itemsFor } = require("../commerce/product.service");

function targetColumn(type) {
  return type === "COURSE" ? "course_id" : type === "TEST_SERIES" ? "test_series_id" : "test_id";
}

async function validateProductTargets(client, input) {
  const definitions = {
    COURSE: { table: "courses", examColumn: null },
    TEST_SERIES: { table: "test_series", examColumn: "exam_type" },
    TEST: { table: "tests", examColumn: "exam_type" },
  };
  for (const [targetType, definition] of Object.entries(definitions)) {
    const ids = input.items.filter((item) => item.targetType === targetType).map((item) => item.targetId);
    if (!ids.length) continue;
    const fields = definition.examColumn ? `id,${definition.examColumn}` : "id";
    const result = await client.query(`SELECT ${fields} FROM ${definition.table} WHERE id=ANY($1::uuid[])`, [ids]);
    if (result.rowCount !== new Set(ids).size) throw new ApiError(400, `One or more ${targetType} product targets do not exist`);
    if (input.type !== "BUNDLE" && definition.examColumn) {
      const mismatch = result.rows.find((row) => row[definition.examColumn] !== input.examType);
      if (mismatch) throw new ApiError(400, "Product exam type must match its test content");
    }
  }
}

async function listProducts() {
  const result = await pool.query("SELECT * FROM products ORDER BY updated_at DESC");
  const grouped = await itemsFor(result.rows.map((row)=>row.id));
  return result.rows.map((row)=>mapProduct(row,grouped.get(row.id)||[]));
}

async function saveProduct(input, actorId, id = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await validateProductTargets(client, input);
    let row;
    const values = [input.slug,input.type,input.title,input.description,input.examType,input.currency,input.priceMinor,input.compareAtPriceMinor,input.status,input.accessType,input.durationDays,input.accessStartsAt,input.accessEndsAt,input.metadata];
    if (id) {
      row = (await client.query(
        `UPDATE products SET slug=$1,type=$2,title=$3,description=$4,exam_type=$5,currency=$6,price_minor=$7,compare_at_price_minor=$8,status=$9,access_type=$10,duration_days=$11,access_starts_at=$12,access_ends_at=$13,metadata=$14,updated_at=NOW() WHERE id=$15 RETURNING *`,
        [...values,id]
      )).rows[0];
      if (!row) throw new ApiError(404,"Product not found");
    } else {
      row = (await client.query(
        `INSERT INTO products(slug,type,title,description,exam_type,currency,price_minor,compare_at_price_minor,status,access_type,duration_days,access_starts_at,access_ends_at,metadata,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [...values,actorId]
      )).rows[0];
    }
    await client.query("DELETE FROM product_items WHERE product_id=$1",[row.id]);
    for (const item of input.items) {
      const column = targetColumn(item.targetType);
      await client.query(`INSERT INTO product_items(product_id,target_type,${column},sort_order) VALUES($1,$2,$3,$4)`,[row.id,item.targetType,item.targetId,item.sortOrder]);
    }
    await client.query("COMMIT");
    await audit(actorId,id?"UPDATE":"CREATE","product",row.id,{type:row.type,status:row.status});
    const grouped = await itemsFor([row.id]);
    return mapProduct(row,grouped.get(row.id)||[]);
  } catch(error){await client.query("ROLLBACK");if(error.code==="23505")throw new ApiError(409,"Product slug or target is already configured");throw error;}finally{client.release();}
}

async function listCoupons() {
  const result = await pool.query(`SELECT c.*,
    COALESCE((SELECT array_agg(product_id) FROM coupon_products WHERE coupon_id=c.id),'{}') product_ids,
    COALESCE((SELECT array_agg(product_type) FROM coupon_product_types WHERE coupon_id=c.id),'{}') product_types,
    COALESCE((SELECT array_agg(exam_type) FROM coupon_exam_types WHERE coupon_id=c.id),'{}') exam_types,
    COALESCE((SELECT array_agg(user_id) FROM coupon_allowed_users WHERE coupon_id=c.id),'{}') allowed_user_ids
    FROM coupons c ORDER BY c.updated_at DESC`);
  return result.rows.map((row)=>({id:row.id,code:row.code,description:row.description,discountType:row.discount_type,discountValue:Number(row.discount_value),maxDiscountMinor:row.max_discount_minor==null?null:Number(row.max_discount_minor),minimumAmountMinor:Number(row.minimum_amount_minor),usageLimit:row.usage_limit,perUserLimit:row.per_user_limit,startsAt:row.starts_at,expiresAt:row.expires_at,status:row.status,productIds:row.product_ids,productTypes:row.product_types,examTypes:row.exam_types,allowedUserIds:row.allowed_user_ids}));
}

async function saveCoupon(input, actorId, id = null) {
  const client=await pool.connect();
  try{
    await client.query("BEGIN");let row;const values=[input.code,input.description||null,input.discountType,input.discountValue,input.maxDiscountMinor,input.minimumAmountMinor,input.usageLimit,input.perUserLimit,input.startsAt,input.expiresAt,input.status];
    if(id){row=(await client.query(`UPDATE coupons SET code=$1,description=$2,discount_type=$3,discount_value=$4,max_discount_minor=$5,minimum_amount_minor=$6,usage_limit=$7,per_user_limit=$8,starts_at=$9,expires_at=$10,status=$11,updated_at=NOW() WHERE id=$12 RETURNING *`,[...values,id])).rows[0];if(!row)throw new ApiError(404,"Coupon not found");}
    else row=(await client.query(`INSERT INTO coupons(code,description,discount_type,discount_value,max_discount_minor,minimum_amount_minor,usage_limit,per_user_limit,starts_at,expires_at,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[...values,actorId])).rows[0];
    for(const table of ["coupon_products","coupon_product_types","coupon_exam_types","coupon_allowed_users"])await client.query(`DELETE FROM ${table} WHERE coupon_id=$1`,[row.id]);
    for(const value of input.productIds)await client.query("INSERT INTO coupon_products(coupon_id,product_id) VALUES($1,$2)",[row.id,value]);
    for(const value of input.productTypes)await client.query("INSERT INTO coupon_product_types(coupon_id,product_type) VALUES($1,$2)",[row.id,value]);
    for(const value of input.examTypes)await client.query("INSERT INTO coupon_exam_types(coupon_id,exam_type) VALUES($1,$2)",[row.id,value]);
    for(const value of input.allowedUserIds)await client.query("INSERT INTO coupon_allowed_users(coupon_id,user_id) VALUES($1,$2)",[row.id,value]);
    await client.query("COMMIT");await audit(actorId,id?"UPDATE":"CREATE","coupon",row.id,{code:row.code});return (await listCoupons()).find((item)=>item.id===row.id);
  }catch(error){await client.query("ROLLBACK");if(error.code==="23505")throw new ApiError(409,"Coupon code already exists");throw error;}finally{client.release();}
}

async function listOrders() {
  const result=await pool.query(`SELECT o.*,u.full_name,u.email,p.title AS product_title,p.type AS product_type FROM orders o JOIN users u ON u.id=o.user_id JOIN products p ON p.id=o.product_id ORDER BY o.created_at DESC LIMIT 500`);
  return result.rows.map((r)=>({id:r.id,orderNumber:r.order_number,userId:r.user_id,userName:r.full_name,userEmail:r.email,productId:r.product_id,productTitle:r.product_title,productType:r.product_type,status:r.status,currency:r.currency,finalAmountMinor:Number(r.final_amount_minor),discountMinor:Number(r.discount_minor),razorpayOrderId:r.razorpay_order_id,paidAt:r.paid_at,createdAt:r.created_at}));
}

async function listPayments() {
  const result=await pool.query(`SELECT p.*,o.order_number,u.full_name FROM payments p JOIN orders o ON o.id=p.order_id JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 500`);
  return result.rows.map((r)=>({id:r.id,orderId:r.order_id,orderNumber:r.order_number,userName:r.full_name,gatewayPaymentId:r.gateway_payment_id,amountMinor:Number(r.amount_minor),currency:r.currency,status:r.status,method:r.payment_method,paidAt:r.paid_at,createdAt:r.created_at}));
}

async function analytics() {
  const summary=await pool.query(`SELECT COALESCE(SUM(o.final_amount_minor) FILTER(WHERE o.status IN ('PAID','PARTIALLY_REFUNDED')),0)::bigint AS revenue_minor,COUNT(*) FILTER(WHERE o.status IN ('PAID','PARTIALLY_REFUNDED'))::int AS successful_orders,COUNT(*) FILTER(WHERE o.status='FAILED')::int AS failed_orders,COALESCE((SELECT SUM(amount_minor) FROM refunds WHERE status='PROCESSED'),0)::bigint AS refunded_minor FROM orders o`);
  const byType=await pool.query(`SELECT p.type,p.exam_type,COUNT(*)::int AS sales,COALESCE(SUM(o.final_amount_minor),0)::bigint AS revenue_minor FROM orders o JOIN products p ON p.id=o.product_id WHERE o.status IN ('PAID','PARTIALLY_REFUNDED') GROUP BY p.type,p.exam_type ORDER BY revenue_minor DESC`);
  const top=await pool.query(`SELECT p.id,p.title,p.type,p.exam_type,COUNT(*)::int AS sales,SUM(o.final_amount_minor)::bigint AS revenue_minor FROM orders o JOIN products p ON p.id=o.product_id WHERE o.status IN ('PAID','PARTIALLY_REFUNDED') GROUP BY p.id ORDER BY revenue_minor DESC LIMIT 20`);
  return {summary:{revenueMinor:Number(summary.rows[0].revenue_minor),successfulOrders:summary.rows[0].successful_orders,failedOrders:summary.rows[0].failed_orders,refundedMinor:Number(summary.rows[0].refunded_minor)},byType:byType.rows.map(r=>({...r,revenue_minor:Number(r.revenue_minor)})),topProducts:top.rows.map(r=>({...r,revenue_minor:Number(r.revenue_minor)}))};
}

module.exports={listProducts,saveProduct,listCoupons,saveCoupon,listOrders,listPayments,analytics};

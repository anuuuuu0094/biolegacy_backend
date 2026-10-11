const pool = require("../../db/pool");
const ApiError = require("../../utils/apiError");

function mapProduct(row, items = []) {
  return {
    id: row.id, slug: row.slug, type: row.type, title: row.title, description: row.description,
    examType: row.exam_type, currency: row.currency, priceMinor: Number(row.price_minor),
    compareAtPriceMinor: row.compare_at_price_minor == null ? null : Number(row.compare_at_price_minor),
    status: row.status, accessType: row.access_type, durationDays: row.duration_days,
    accessStartsAt: row.access_starts_at, accessEndsAt: row.access_ends_at,
    metadata: row.metadata || {}, items,
  };
}

function mapItem(row) {
  return {
    id: row.id, targetType: row.target_type, courseId: row.course_id,
    testSeriesId: row.test_series_id, testId: row.test_id, sortOrder: row.sort_order,
  };
}

async function itemsFor(productIds, client = pool) {
  if (!productIds.length) return new Map();
  const result = await client.query("SELECT * FROM product_items WHERE product_id=ANY($1::uuid[]) ORDER BY sort_order,created_at", [productIds]);
  const grouped = new Map(productIds.map((id) => [id, []]));
  for (const row of result.rows) grouped.get(row.product_id)?.push(mapItem(row));
  return grouped;
}

async function listActive(query = {}, userId = null) {
  const params = [];
  const filters = ["p.status='ACTIVE'"];
  if (query.type) { params.push(query.type); filters.push(`p.type=$${params.length}`); }
  if (query.examType) { params.push(query.examType); filters.push(`p.exam_type=$${params.length}`); }
  const result = await pool.query(`SELECT p.* FROM products p WHERE ${filters.join(" AND ")} ORDER BY p.updated_at DESC`, params);
  const grouped = await itemsFor(result.rows.map((row) => row.id));
  const products = result.rows.map((row) => mapProduct(row, grouped.get(row.id) || []));
  if (!userId) return products.map((product) => ({ ...product, access: { active: false } }));
  const access = require("./access.service");
  return Promise.all(products.map(async (product) => ({ ...product, access: await access.productAccess(userId, product.id) })));
}

async function getActive(identifier, userId = null) {
  const result = await pool.query("SELECT * FROM products WHERE (id::text=$1 OR slug=$1) AND status='ACTIVE'", [identifier]);
  if (!result.rows[0]) throw new ApiError(404, "Product not found");
  const grouped = await itemsFor([result.rows[0].id]);
  const product = mapProduct(result.rows[0], grouped.get(result.rows[0].id) || []);
  if (!userId) return { ...product, access: { active: false } };
  const access = require("./access.service");
  return { ...product, access: await access.productAccess(userId, product.id) };
}

async function getForCheckout(client, id) {
  const result = await client.query("SELECT * FROM products WHERE id=$1 AND status='ACTIVE' FOR SHARE", [id]);
  if (!result.rows[0]) throw new ApiError(404, "Product is not available for purchase");
  const grouped = await itemsFor([id], client);
  const product = mapProduct(result.rows[0], grouped.get(id) || []);
  if (!product.items.length) throw new ApiError(409, "Product has no configured access items");
  if (product.accessType === "FIXED_DATE" && new Date(product.accessEndsAt) <= new Date()) {
    throw new ApiError(409, "Product access period has ended");
  }
  return product;
}

module.exports = { mapProduct, mapItem, itemsFor, listActive, getActive, getForCheckout };

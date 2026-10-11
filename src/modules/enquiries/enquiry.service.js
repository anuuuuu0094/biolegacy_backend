const pool = require("../../db/pool");
const ApiError = require("../../utils/apiError");
const { getPagination, pageMeta } = require("../../utils/pagination");
const audit = require("../../utils/audit");

function map(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    course: row.course_interest,
    targetExamYear: row.target_exam_year,
    city: row.city,
    message: row.message,
    leadStatus: row.lead_status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function create(input) {
  const result = await pool.query(
    `INSERT INTO enquiries(name, phone, email, course_interest, target_exam_year, city, message)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      input.name,
      input.phone,
      input.email || null,
      input.course,
      input.targetExamYear || null,
      input.city || null,
      input.message || null,
    ]
  );
  return map(result.rows[0]);
}

async function list(query = {}) {
  const { page, limit, offset } = getPagination(query);
  const params = [];
  const filters = [];

  if (query.status) {
    params.push(query.status);
    filters.push(`lead_status=$${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    filters.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR course_interest ILIKE $${params.length})`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM enquiries ${where}`, params);
  params.push(limit, offset);
  const rows = await pool.query(
    `SELECT * FROM enquiries ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { data: rows.rows.map(map), meta: pageMeta(count.rows[0].total, page, limit) };
}

async function update(id, input, actorId) {
  const result = await pool.query(
    `UPDATE enquiries SET lead_status=$1, notes=$2, assigned_to_id=$3, updated_at=NOW()
     WHERE id=$4 RETURNING *`,
    [input.leadStatus, input.notes || null, actorId, id]
  );
  if (!result.rows[0]) throw new ApiError(404, "Enquiry not found");
  await audit(actorId, "UPDATE", "enquiry", id, { leadStatus: input.leadStatus });
  return map(result.rows[0]);
}

module.exports = { create, list, update };

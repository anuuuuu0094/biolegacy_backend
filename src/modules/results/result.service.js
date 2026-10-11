const pool = require("../../db/pool");
const ApiError = require("../../utils/apiError");
const audit = require("../../utils/audit");

function map(row) {
  return {
    id: row.id,
    name: row.student_name,
    studentName: row.student_name,
    exam: row.exam_name,
    examName: row.exam_name,
    year: row.exam_year,
    rankORcollege: row.achievement,
    achievement: row.achievement,
    image: row.image_url,
    imageUrl: row.image_url,
    published: row.published,
    sortOrder: row.sort_order,
  };
}

async function list(includeDrafts = false) {
  const result = await pool.query(
    `SELECT * FROM result_highlights ${includeDrafts ? "" : "WHERE published=true"}
     ORDER BY sort_order ASC, exam_year DESC, created_at DESC`
  );
  return result.rows.map(map);
}

async function create(input, actorId) {
  const result = await pool.query(
    `INSERT INTO result_highlights(student_name, exam_name, exam_year, achievement, image_url, published, sort_order, created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      input.studentName,
      input.examName,
      input.examYear,
      input.achievement,
      input.imageUrl || null,
      input.published,
      input.sortOrder,
      actorId,
    ]
  );
  await audit(actorId, "CREATE", "result_highlight", result.rows[0].id, { studentName: input.studentName });
  return map(result.rows[0]);
}

async function update(id, input, actorId) {
  const result = await pool.query(
    `UPDATE result_highlights SET student_name=$1, exam_name=$2, exam_year=$3, achievement=$4,
     image_url=$5, published=$6, sort_order=$7, updated_at=NOW()
     WHERE id=$8 RETURNING *`,
    [
      input.studentName,
      input.examName,
      input.examYear,
      input.achievement,
      input.imageUrl || null,
      input.published,
      input.sortOrder,
      id,
    ]
  );
  if (!result.rows[0]) throw new ApiError(404, "Result not found");
  await audit(actorId, "UPDATE", "result_highlight", id, { studentName: input.studentName });
  return map(result.rows[0]);
}

async function remove(id, actorId) {
  const result = await pool.query(
    "UPDATE result_highlights SET published=false, updated_at=NOW() WHERE id=$1 RETURNING id",
    [id]
  );
  if (!result.rows[0]) throw new ApiError(404, "Result not found");
  await audit(actorId, "ARCHIVE", "result_highlight", id);
}

module.exports = { list, create, update, remove };

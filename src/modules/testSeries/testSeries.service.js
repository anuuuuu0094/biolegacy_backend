const pool = require("../../db/pool");
const ApiError = require("../../utils/apiError");
const audit = require("../../utils/audit");

function map(row) {
  return {
    id: row.id,
    courseId: row.course_id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    audience: row.audience,
    tests: row.tests_count ? `${row.tests_count} tests` : row.access_label,
    testsCount: row.tests_count,
    analytics: row.analytics,
    accessLabel: row.access_label,
    label: row.is_featured ? "Featured" : row.access_label,
    isFeatured: row.is_featured,
    published: row.published,
    content: row.content || {},
  };
}

async function list(includeDrafts = false) {
  const result = await pool.query(
    `SELECT * FROM test_series ${includeDrafts ? "" : "WHERE published=true"}
     ORDER BY is_featured DESC, updated_at DESC`
  );
  return result.rows.map(map);
}

async function create(input, actorId) {
  const result = await pool.query(
    `INSERT INTO test_series(course_id, slug, title, description, audience, tests_count, analytics, access_label, is_featured, published, content, created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      input.courseId || null,
      input.slug,
      input.title,
      input.description,
      input.audience || null,
      input.testsCount,
      input.analytics || null,
      input.accessLabel || null,
      input.isFeatured,
      input.published,
      input.content,
      actorId,
    ]
  );
  await audit(actorId, "CREATE", "test_series", result.rows[0].id, { slug: input.slug });
  return map(result.rows[0]);
}

async function update(slug, input, actorId) {
  const result = await pool.query(
    `UPDATE test_series SET course_id=$1, slug=$2, title=$3, description=$4, audience=$5,
     tests_count=$6, analytics=$7, access_label=$8, is_featured=$9, published=$10,
     content=$11, updated_at=NOW() WHERE slug=$12 RETURNING *`,
    [
      input.courseId || null,
      input.slug,
      input.title,
      input.description,
      input.audience || null,
      input.testsCount,
      input.analytics || null,
      input.accessLabel || null,
      input.isFeatured,
      input.published,
      input.content,
      slug,
    ]
  );
  if (!result.rows[0]) throw new ApiError(404, "Test series not found");
  await audit(actorId, "UPDATE", "test_series", result.rows[0].id, { slug: input.slug });
  return map(result.rows[0]);
}

async function remove(slug, actorId) {
  const result = await pool.query(
    "UPDATE test_series SET published=false, updated_at=NOW() WHERE slug=$1 RETURNING id",
    [slug]
  );
  if (!result.rows[0]) throw new ApiError(404, "Test series not found");
  await audit(actorId, "ARCHIVE", "test_series", result.rows[0].id, { slug });
}

module.exports = { list, create, update, remove };

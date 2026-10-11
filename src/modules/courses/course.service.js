const pool = require("../../db/pool");
const ApiError = require("../../utils/apiError");
const { getPagination, pageMeta } = require("../../utils/pagination");
const audit = require("../../utils/audit");
const mapCourse = require("./course.mapper");

const courseFields = `
  id, slug, title, short_title, category, target_exam_year, short_desc, long_desc,
  duration, total_hours, mode, center, image, total_fees, registration_fee,
  total_seats, available_seats, batch_status, enrollment_open, is_popular,
  is_featured, published, content, seo, created_at, updated_at
`;

async function list(query = {}, includeDrafts = false) {
  const { page, limit, offset } = getPagination(query);
  const params = [];
  const filters = [];

  if (!includeDrafts) filters.push("published=true");
  if (query.category) {
    params.push(query.category);
    filters.push(`category=$${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    filters.push(`(title ILIKE $${params.length} OR short_desc ILIKE $${params.length})`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM courses ${where}`, params);
  params.push(limit, offset);
  const dataResult = await pool.query(
    `SELECT ${courseFields} FROM courses ${where}
     ORDER BY is_featured DESC, updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    data: dataResult.rows.map(mapCourse),
    meta: pageMeta(countResult.rows[0].total, page, limit),
  };
}

async function getBySlug(slug, includeDrafts = false) {
  const result = await pool.query(
    `SELECT ${courseFields} FROM courses WHERE slug=$1 ${includeDrafts ? "" : "AND published=true"}`,
    [slug]
  );

  if (!result.rows[0]) throw new ApiError(404, "Course not found");
  return mapCourse(result.rows[0]);
}

async function create(input, actorId) {
  const result = await pool.query(
    `INSERT INTO courses(
      slug, title, short_title, category, target_exam_year, short_desc, long_desc,
      duration, total_hours, mode, center, image, total_fees, registration_fee,
      total_seats, available_seats, batch_status, enrollment_open, is_popular,
      is_featured, published, content, seo, created_by
    )
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
    RETURNING ${courseFields}`,
    [
      input.slug,
      input.title,
      input.shortTitle,
      input.category,
      input.targetExamYear,
      input.shortDesc,
      input.longDesc,
      input.duration,
      input.totalHours,
      input.mode,
      input.center,
      input.image,
      input.totalFees,
      input.registrationFee,
      input.totalSeats,
      input.availableSeats,
      input.batchStatus,
      input.enrollmentOpen,
      input.isPopular,
      input.isFeatured,
      input.published,
      input.content,
      input.seo,
      actorId,
    ]
  );

  await audit(actorId, "CREATE", "course", result.rows[0].id, { slug: input.slug });
  return mapCourse(result.rows[0]);
}

async function update(slug, input, actorId) {
  const result = await pool.query(
    `UPDATE courses SET
      slug=$1, title=$2, short_title=$3, category=$4, target_exam_year=$5,
      short_desc=$6, long_desc=$7, duration=$8, total_hours=$9, mode=$10,
      center=$11, image=$12, total_fees=$13, registration_fee=$14,
      total_seats=$15, available_seats=$16, batch_status=$17,
      enrollment_open=$18, is_popular=$19, is_featured=$20, published=$21,
      content=$22, seo=$23, updated_at=NOW()
    WHERE slug=$24
    RETURNING ${courseFields}`,
    [
      input.slug,
      input.title,
      input.shortTitle,
      input.category,
      input.targetExamYear,
      input.shortDesc,
      input.longDesc,
      input.duration,
      input.totalHours,
      input.mode,
      input.center,
      input.image,
      input.totalFees,
      input.registrationFee,
      input.totalSeats,
      input.availableSeats,
      input.batchStatus,
      input.enrollmentOpen,
      input.isPopular,
      input.isFeatured,
      input.published,
      input.content,
      input.seo,
      slug,
    ]
  );

  if (!result.rows[0]) throw new ApiError(404, "Course not found");
  await audit(actorId, "UPDATE", "course", result.rows[0].id, { slug: input.slug });
  return mapCourse(result.rows[0]);
}

async function remove(slug, actorId) {
  const result = await pool.query(
    `UPDATE courses SET published=false, enrollment_open=false, batch_status='archived', updated_at=NOW()
     WHERE slug=$1 RETURNING id`,
    [slug]
  );
  if (!result.rows[0]) throw new ApiError(404, "Course not found");
  await audit(actorId, "ARCHIVE", "course", result.rows[0].id, { slug });
}

async function destroy(slug, actorId) {
  const client = await pool.connect();
  let course;

  try {
    await client.query("BEGIN");

    const courseResult = await client.query(
      "SELECT id, slug, title FROM courses WHERE slug=$1 FOR UPDATE",
      [slug]
    );
    course = courseResult.rows[0];
    if (!course) throw new ApiError(404, "Course not found");

    const dependencyResult = await client.query(
      `SELECT
        (SELECT COUNT(*)::int FROM enrollments WHERE course_id=$1) AS enrollments,
        (SELECT COUNT(*)::int FROM test_series WHERE course_id=$1) AS test_series`,
      [course.id]
    );
    const dependencies = dependencyResult.rows[0];
    const blockers = [];

    if (dependencies.enrollments > 0) {
      blockers.push(`${dependencies.enrollments} enrollment${dependencies.enrollments === 1 ? "" : "s"}`);
    }
    if (dependencies.test_series > 0) {
      blockers.push(`${dependencies.test_series} linked test series`);
    }

    if (blockers.length) {
      throw new ApiError(
        409,
        `Permanent deletion blocked because this course has ${blockers.join(" and ")}. Archive it instead, or remove those dependencies first.`,
        { enrollments: dependencies.enrollments, testSeries: dependencies.test_series }
      );
    }

    await client.query("DELETE FROM courses WHERE id=$1", [course.id]);
    await client.query(
      `INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
       VALUES($1, 'DELETE_PERMANENTLY', 'course', $2, $3)`,
      [actorId || null, String(course.id), { slug: course.slug, title: course.title }]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

}

module.exports = { list, getBySlug, create, update, remove, destroy };

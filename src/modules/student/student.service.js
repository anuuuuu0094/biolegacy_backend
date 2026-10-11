const pool = require("../../db/pool");

async function getLearning(userId) {
  const result = await pool.query(
    `SELECT e.id AS enrollment_id, e.status AS enrollment_status, c.id AS course_id, c.slug,
       c.title, c.short_title, c.image, lm.id AS module_id, lm.title AS module_title,
       lm.description AS module_description, lm.video_url, lm.sort_order
     FROM enrollments e
     JOIN courses c ON c.id=e.course_id
     LEFT JOIN learning_modules lm ON lm.course_id=c.id AND lm.published=true
     WHERE e.student_id=$1 AND e.status IN ('ACTIVE','COMPLETED')
       AND (e.source_type='MANUAL' OR EXISTS (
         SELECT 1 FROM access_grants ag WHERE ag.id=e.access_grant_id AND ag.status='ACTIVE'
           AND ag.starts_at<=NOW() AND (ag.expires_at IS NULL OR ag.expires_at>NOW())
       ))
     ORDER BY c.title ASC, lm.sort_order ASC, lm.created_at ASC`,
    [userId]
  );

  const courses = new Map();
  for (const row of result.rows) {
    if (!courses.has(row.course_id)) {
      courses.set(row.course_id, {
        enrollmentId: row.enrollment_id,
        enrollmentStatus: row.enrollment_status,
        id: row.course_id,
        slug: row.slug,
        title: row.title,
        shortTitle: row.short_title,
        image: row.image,
        modules: [],
      });
    }
    if (row.module_id) {
      courses.get(row.course_id).modules.push({
        id: row.module_id,
        title: row.module_title,
        description: row.module_description,
        videoUrl: row.video_url,
        sortOrder: row.sort_order,
      });
    }
  }
  return [...courses.values()];
}

module.exports = { getLearning };

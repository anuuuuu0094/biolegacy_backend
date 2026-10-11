const pool = require("../../db/pool");
const { getPagination, pageMeta } = require("../../utils/pagination");
const audit = require("../../utils/audit");
const ApiError = require("../../utils/apiError");

async function dashboard() {
  const [
    courses,
    publishedCourses,
    enquiries,
    newEnquiries,
    blogs,
    results,
    testSeries,
    students,
    verifiedPhones,
    verifiedEmails,
    recentEnquiries,
    auditLogs,
  ] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS total FROM courses"),
    pool.query("SELECT COUNT(*)::int AS total FROM courses WHERE published=true"),
    pool.query("SELECT COUNT(*)::int AS total FROM enquiries"),
    pool.query("SELECT COUNT(*)::int AS total FROM enquiries WHERE lead_status='NEW'"),
    pool.query("SELECT COUNT(*)::int AS total FROM blog_posts"),
    pool.query("SELECT COUNT(*)::int AS total FROM result_highlights"),
    pool.query("SELECT COUNT(*)::int AS total FROM test_series"),
    pool.query("SELECT COUNT(*)::int AS total FROM users WHERE role='STUDENT'"),
    pool.query("SELECT COUNT(*)::int AS total FROM users WHERE role='STUDENT' AND phone_verified=true"),
    pool.query("SELECT COUNT(*)::int AS total FROM users WHERE role='STUDENT' AND email_verified=true"),
    pool.query(
      `SELECT id, name, phone, course_interest, lead_status, created_at
       FROM enquiries ORDER BY created_at DESC LIMIT 8`
    ),
    pool.query(
      `SELECT action, entity_type, entity_id, created_at
       FROM audit_logs ORDER BY created_at DESC LIMIT 8`
    ),
  ]);

  return {
    stats: {
      courses: courses.rows[0].total,
      publishedCourses: publishedCourses.rows[0].total,
      enquiries: enquiries.rows[0].total,
      newEnquiries: newEnquiries.rows[0].total,
      blogs: blogs.rows[0].total,
      results: results.rows[0].total,
      testSeries: testSeries.rows[0].total,
      students: students.rows[0].total,
      verifiedPhones: verifiedPhones.rows[0].total,
      verifiedEmails: verifiedEmails.rows[0].total,
    },
    recentEnquiries: recentEnquiries.rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      course: row.course_interest,
      leadStatus: row.lead_status,
      createdAt: row.created_at,
    })),
    auditLogs: auditLogs.rows.map((row) => ({
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      createdAt: row.created_at,
    })),
  };
}

async function listStudents(query = {}) {
  const { page, limit, offset } = getPagination(query);
  const params = [];
  const filters = ["u.role='STUDENT'"];
  if (query.status) {
    params.push(query.status);
    filters.push(`u.status=$${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    filters.push(`(u.full_name ILIKE $${params.length} OR COALESCE(u.email,'') ILIKE $${params.length} OR COALESCE(u.phone,'') ILIKE $${params.length})`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM users u ${where}`, params);
  params.push(limit, offset);
  const result = await pool.query(
    `SELECT u.id,u.full_name,u.email,u.phone,u.status,u.email_verified,u.phone_verified,
       u.last_login_at,u.created_at,
       COALESCE(array_agg(ai.provider) FILTER (WHERE ai.provider IS NOT NULL),'{}') AS auth_providers
     FROM users u LEFT JOIN auth_identities ai ON ai.user_id=u.id
     ${where}
     GROUP BY u.id ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    data: result.rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      status: row.status,
      emailVerified: row.email_verified,
      phoneVerified: row.phone_verified,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      providers: row.auth_providers,
    })),
    meta: pageMeta(count.rows[0].total, page, limit),
  };
}

async function updateStudentStatus(id, status, actorId) {
  const result = await pool.query(
    `UPDATE users SET status=$1,updated_at=NOW()
     WHERE id=$2 AND role='STUDENT'
     RETURNING id,full_name,email,phone,status,email_verified,phone_verified,last_login_at,created_at`,
    [status, id]
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "Student account not found");
  }
  if (status !== "ACTIVE") {
    await pool.query("UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL", [id]);
  }
  await audit(actorId, "UPDATE_STATUS", "student_account", id, { status });
  const row = result.rows[0];
  return {
    id: row.id, fullName: row.full_name, email: row.email, phone: row.phone,
    status: row.status, emailVerified: row.email_verified, phoneVerified: row.phone_verified,
    lastLoginAt: row.last_login_at, createdAt: row.created_at,
  };
}

async function listEnrollments(studentId) {
  const student = await pool.query("SELECT id FROM users WHERE id=$1 AND role='STUDENT'", [studentId]);
  if (!student.rows[0]) throw new ApiError(404, "Student account not found");
  const result = await pool.query(
    `SELECT e.id, e.course_id, c.title AS course_title, e.status, e.enrolled_at
     FROM enrollments e JOIN courses c ON c.id=e.course_id
     WHERE e.student_id=$1 ORDER BY e.enrolled_at DESC`, [studentId]
  );
  return result.rows.map((row) => ({ id: row.id, courseId: row.course_id, courseTitle: row.course_title, status: row.status, enrolledAt: row.enrolled_at }));
}

async function saveEnrollment(studentId, input, actorId) {
  const student = await pool.query("SELECT id FROM users WHERE id=$1 AND role='STUDENT'", [studentId]);
  if (!student.rows[0]) throw new ApiError(404, "Student account not found");
  const course = await pool.query("SELECT id FROM courses WHERE id=$1", [input.courseId]);
  if (!course.rows[0]) throw new ApiError(404, "Course not found");
  const result = await pool.query(
    `INSERT INTO enrollments(student_id,course_id,status,source_type) VALUES($1,$2,$3,'MANUAL')
     ON CONFLICT (student_id,course_id) DO UPDATE SET status=EXCLUDED.status,source_type='MANUAL',source_order_id=NULL,access_grant_id=NULL,updated_at=NOW()
     RETURNING id`, [studentId, input.courseId, input.status]
  );
  await audit(actorId, "UPSERT", "enrollment", result.rows[0].id, { studentId, courseId: input.courseId, status: input.status });
  return { id: result.rows[0].id, studentId, courseId: input.courseId, status: input.status };
}

function mapModule(row) {
  return { id: row.id, courseId: row.course_id, title: row.title, description: row.description,
    videoUrl: row.video_url, sortOrder: row.sort_order, published: row.published };
}

async function listModules(courseId) {
  const course = await pool.query("SELECT id FROM courses WHERE id=$1", [courseId]);
  if (!course.rows[0]) throw new ApiError(404, "Course not found");
  const result = await pool.query("SELECT * FROM learning_modules WHERE course_id=$1 ORDER BY sort_order,created_at", [courseId]);
  return result.rows.map(mapModule);
}

async function createModule(courseId, input, actorId) {
  const course = await pool.query("SELECT id FROM courses WHERE id=$1", [courseId]);
  if (!course.rows[0]) throw new ApiError(404, "Course not found");
  const result = await pool.query(
    `INSERT INTO learning_modules(course_id,title,description,video_url,sort_order,published)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [courseId, input.title, input.description || null, input.videoUrl || null, input.sortOrder, input.published]
  );
  await audit(actorId, "CREATE", "learning_module", result.rows[0].id, { courseId });
  return mapModule(result.rows[0]);
}

async function updateModule(id, input, actorId) {
  const result = await pool.query(
    `UPDATE learning_modules SET title=$1,description=$2,video_url=$3,sort_order=$4,published=$5,updated_at=NOW()
     WHERE id=$6 RETURNING *`,
    [input.title, input.description || null, input.videoUrl || null, input.sortOrder, input.published, id]
  );
  if (!result.rows[0]) throw new ApiError(404, "Learning module not found");
  await audit(actorId, "UPDATE", "learning_module", id);
  return mapModule(result.rows[0]);
}

async function archiveModule(id, actorId) {
  const result = await pool.query("UPDATE learning_modules SET published=false,updated_at=NOW() WHERE id=$1 RETURNING id", [id]);
  if (!result.rows[0]) throw new ApiError(404, "Learning module not found");
  await audit(actorId, "ARCHIVE", "learning_module", id);
}

module.exports = { dashboard, listStudents, updateStudentStatus, listEnrollments, saveEnrollment, listModules, createModule, updateModule, archiveModule };

const pool = require("../../db/pool");
const { getPagination, pageMeta } = require("../../utils/pagination");
const audit = require("../../utils/audit");
const ApiError = require("../../utils/apiError");
const crypto = require("crypto");
const env = require("../../config/env");
const pdfStorage = require("../../services/pdfStorage");

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

function mapMaterial(row) {
  return {
    id: row.id,
    courseId: row.course_id,
    moduleId: row.module_id,
    moduleTitle: row.module_title || null,
    title: row.title,
    description: row.description,
    fileName: row.original_file_name,
    sizeBytes: Number(row.size_bytes),
    uploadStatus: row.upload_status,
    downloadable: row.downloadable,
    published: row.published,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertCourse(courseId) {
  const course = await pool.query("SELECT id FROM courses WHERE id=$1", [courseId]);
  if (!course.rows[0]) throw new ApiError(404, "Course not found");
}

async function assertModule(courseId, moduleId) {
  if (!moduleId) return;
  const module = await pool.query("SELECT id FROM learning_modules WHERE id=$1 AND course_id=$2", [moduleId, courseId]);
  if (!module.rows[0]) throw new ApiError(400, "The selected module does not belong to this course");
}

async function listMaterials(courseId) {
  await assertCourse(courseId);
  const result = await pool.query(
    `SELECT m.*, lm.title AS module_title
     FROM learning_materials m
     LEFT JOIN learning_modules lm ON lm.id=m.module_id
     WHERE m.course_id=$1
     ORDER BY m.sort_order,m.created_at`,
    [courseId]
  );
  return result.rows.map(mapMaterial);
}

function cleanFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, " ").slice(0, 255);
}

async function startMaterialUpload(courseId, input, actorId) {
  await assertCourse(courseId);
  const maxBytes = env.pdfMaxFileSizeMb * 1024 * 1024;
  if (input.fileSize > maxBytes) {
    throw new ApiError(400, `PDF files must be ${env.pdfMaxFileSizeMb} MB or smaller`);
  }
  const id = crypto.randomUUID();
  const fileName = cleanFileName(input.fileName);
  const objectKey = `courses/${courseId}/pdf/${id}/${fileName}`;
  const defaultTitle = fileName.replace(/\.pdf$/i, "").trim() || "Course PDF";
  const quotaBytes = env.pdfStorageQuotaMb * 1024 * 1024;
  const db = await pool.connect();
  let inserted;
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('biolegacy_pdf_storage_quota'))");
    const usage = await db.query(
      "SELECT COALESCE(SUM(size_bytes),0)::bigint AS used FROM learning_materials WHERE upload_status IN ('PENDING','READY')"
    );
    if (Number(usage.rows[0].used) + input.fileSize > quotaBytes) {
      throw new ApiError(409, `PDF storage limit reached (${env.pdfStorageQuotaMb} MB application quota)`);
    }
    inserted = await db.query(
      `INSERT INTO learning_materials
        (id,course_id,title,object_key,original_file_name,mime_type,size_bytes,upload_status,created_by)
       VALUES($1,$2,$3,$4,$5,'application/pdf',$6,'PENDING',$7) RETURNING *`,
      [id, courseId, defaultTitle, objectKey, fileName, input.fileSize, actorId]
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
  try {
    const uploadUrl = await pdfStorage.createUploadUrl(objectKey);
    await audit(actorId, "START_UPLOAD", "learning_material", id, { courseId, fileName, sizeBytes: input.fileSize });
    return {
      material: mapMaterial(inserted.rows[0]),
      uploadUrl,
      headers: { "Content-Type": "application/pdf" },
      expiresInSeconds: env.pdfSignedUrlTtlSeconds,
    };
  } catch (error) {
    await pool.query("DELETE FROM learning_materials WHERE id=$1", [id]);
    throw error;
  }
}

async function completeMaterialUpload(id, input, actorId) {
  const existing = await pool.query("SELECT * FROM learning_materials WHERE id=$1", [id]);
  const material = existing.rows[0];
  if (!material) throw new ApiError(404, "PDF material not found");
  await assertModule(material.course_id, input.moduleId);

  const inspection = await pdfStorage.inspectPdf(material.object_key);
  const maxBytes = env.pdfMaxFileSizeMb * 1024 * 1024;
  const expectedSize = Number(material.size_bytes);
  const hasValidContentType = inspection.contentType.toLowerCase().split(";", 1)[0].trim() === "application/pdf";
  const sizeMismatch = inspection.size !== expectedSize;
  if (!inspection.validSignature || !hasValidContentType || inspection.size < 5 || inspection.size > maxBytes || sizeMismatch) {
    await pdfStorage.remove(material.object_key);
    await pool.query("UPDATE learning_materials SET upload_status='FAILED',published=false,updated_at=NOW() WHERE id=$1", [id]);
    let message = "The uploaded file is not a valid PDF";
    if (inspection.size > maxBytes) message = `PDF files must be ${env.pdfMaxFileSizeMb} MB or smaller`;
    else if (sizeMismatch) message = "The uploaded PDF size does not match the selected file";
    throw new ApiError(400, message);
  }

  const result = await pool.query(
    `UPDATE learning_materials SET title=$1,description=$2,module_id=$3,sort_order=$4,
       downloadable=$5,published=$6,size_bytes=$7,mime_type='application/pdf',upload_status='READY',updated_at=NOW()
     WHERE id=$8 RETURNING *`,
    [input.title, input.description || null, input.moduleId || null, input.sortOrder,
      input.downloadable, input.published, inspection.size, id]
  );
  await audit(actorId, "COMPLETE_UPLOAD", "learning_material", id, { courseId: material.course_id, sizeBytes: inspection.size });
  return mapMaterial(result.rows[0]);
}

async function updateMaterial(id, input, actorId) {
  const existing = await pool.query("SELECT course_id FROM learning_materials WHERE id=$1", [id]);
  if (!existing.rows[0]) throw new ApiError(404, "PDF material not found");
  await assertModule(existing.rows[0].course_id, input.moduleId);
  const result = await pool.query(
    `UPDATE learning_materials SET title=$1,description=$2,module_id=$3,sort_order=$4,
       downloadable=$5,published=CASE WHEN upload_status='READY' THEN $6 ELSE false END,updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [input.title, input.description || null, input.moduleId || null, input.sortOrder,
      input.downloadable, input.published, id]
  );
  await audit(actorId, "UPDATE", "learning_material", id);
  return mapMaterial(result.rows[0]);
}

async function archiveMaterial(id, actorId) {
  const result = await pool.query("UPDATE learning_materials SET published=false,updated_at=NOW() WHERE id=$1 RETURNING id", [id]);
  if (!result.rows[0]) throw new ApiError(404, "PDF material not found");
  await audit(actorId, "ARCHIVE", "learning_material", id);
}

async function deleteMaterial(id, actorId) {
  const existing = await pool.query("SELECT object_key FROM learning_materials WHERE id=$1", [id]);
  if (!existing.rows[0]) throw new ApiError(404, "PDF material not found");
  await pdfStorage.remove(existing.rows[0].object_key);
  await pool.query("DELETE FROM learning_materials WHERE id=$1", [id]);
  await audit(actorId, "DELETE", "learning_material", id);
}

module.exports = {
  dashboard, listStudents, updateStudentStatus, listEnrollments, saveEnrollment,
  listModules, createModule, updateModule, archiveModule, listMaterials,
  startMaterialUpload, completeMaterialUpload, updateMaterial, archiveMaterial, deleteMaterial,
};

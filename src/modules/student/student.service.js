const pool = require("../../db/pool");
const env = require("../../config/env");
const ApiError = require("../../utils/apiError");
const pdfStorage = require("../../services/pdfStorage");

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
        materials: [],
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

  const courseIds = [...courses.keys()];
  if (courseIds.length) {
    const materials = await pool.query(
      `SELECT m.id,m.course_id,m.module_id,m.title,m.description,m.original_file_name,
         m.size_bytes,m.downloadable,m.sort_order
       FROM learning_materials m
       LEFT JOIN learning_modules lm ON lm.id=m.module_id
       WHERE m.course_id=ANY($1::uuid[]) AND m.published=true AND m.upload_status='READY'
         AND (m.module_id IS NULL OR lm.published=true)
       ORDER BY m.sort_order,m.created_at`,
      [courseIds]
    );
    for (const row of materials.rows) {
      courses.get(row.course_id)?.materials.push({
        id: row.id,
        moduleId: row.module_id,
        title: row.title,
        description: row.description,
        fileName: row.original_file_name,
        sizeBytes: Number(row.size_bytes),
        downloadable: row.downloadable,
        sortOrder: row.sort_order,
      });
    }
  }
  return [...courses.values()];
}

async function getMaterialAccess(userId, materialId, download = false) {
  const result = await pool.query(
    `SELECT m.id,m.object_key,m.original_file_name,m.downloadable
     FROM learning_materials m
     LEFT JOIN learning_modules lm ON lm.id=m.module_id
     JOIN enrollments e ON e.course_id=m.course_id AND e.student_id=$1
     WHERE m.id=$2 AND m.published=true AND m.upload_status='READY'
       AND (m.module_id IS NULL OR lm.published=true)
       AND e.status IN ('ACTIVE','COMPLETED')
       AND (e.source_type='MANUAL' OR EXISTS (
         SELECT 1 FROM access_grants ag WHERE ag.id=e.access_grant_id AND ag.status='ACTIVE'
           AND ag.starts_at<=NOW() AND (ag.expires_at IS NULL OR ag.expires_at>NOW())
       ))`,
    [userId, materialId]
  );
  const material = result.rows[0];
  if (!material) throw new ApiError(404, "PDF material not found or access has expired");
  if (download && !material.downloadable) throw new ApiError(403, "Downloads are disabled for this PDF");
  const url = await pdfStorage.createAccessUrl(material.object_key, material.original_file_name, Boolean(download));
  return {
    url,
    expiresAt: new Date(Date.now() + env.pdfSignedUrlTtlSeconds * 1000).toISOString(),
    download: Boolean(download),
  };
}

module.exports = { getLearning, getMaterialAccess };

function mapCourse(row) {
  const content = row.content || {};
  const seo = row.seo || {};

  return {
    ...content,
    id: row.id,
    slug: row.slug,
    title: row.title,
    shortTitle: row.short_title,
    category: row.category,
    targetExamYear: row.target_exam_year,
    shortDesc: row.short_desc,
    longDesc: row.long_desc,
    duration: row.duration,
    totalHours: row.total_hours,
    mode: row.mode,
    center: row.center,
    image: row.image,
    totalFees: row.total_fees,
    registrationFee: row.registration_fee,
    totalSeats: row.total_seats,
    availableSeats: row.available_seats,
    batchStatus: row.batch_status,
    enrollmentOpen: row.enrollment_open,
    isPopular: row.is_popular,
    isFeatured: row.is_featured,
    published: row.published,
    metaTitle: seo.metaTitle,
    metaDesc: seo.metaDesc,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = mapCourse;

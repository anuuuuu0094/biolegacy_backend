const bcrypt = require("bcryptjs");
const pool = require("../db/pool");
const migrate = require("../db/migrate");

const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@biolegacy.in";
const adminPassword = process.env.SEED_ADMIN_PASSWORD;

const courses = [
  {
    slug: "droppers-batch-2026",
    title: "NEET 2026 Droppers Batch",
    shortTitle: "Droppers Batch",
    category: "dropper",
    targetExamYear: 2026,
    shortDesc: "Designed for repeaters with full syllabus rebuild and test strategy.",
    longDesc:
      "A focused one-year NEET program for repeaters with structured classes, practice sheets, mentorship, and full-length mocks.",
    duration: "1 Year Intensive",
    totalHours: "1400+ Hours",
    mode: "Offline",
    center: "Deokali Bypass, Ayodhya",
    image: "/student.png",
    totalFees: "55000",
    registrationFee: "1000",
    totalSeats: 50,
    availableSeats: 18,
    batchStatus: "closed",
    enrollmentOpen: false,
    isPopular: true,
    isFeatured: true,
    content: {
      highlights: [
        "Personal mentor assigned to every student",
        "40 full-length mock tests",
        "Daily practice sheets",
        "Previous year paper analysis",
      ],
      subjects: ["Physics", "Chemistry", "Botany", "Zoology"],
      eligibility: "Students preparing again for NEET 2026",
      syllabus: "Full NCERT Class 11 and 12 plus NEET PYQs",
      batchStartDate: "April 20, 2026",
      enrollmentDeadline: "April 15, 2026",
      batchTimings: ["Morning Batch: 7:00 AM - 1:00 PM"],
      features: ["Full syllabus fast track", "Daily practice", "Personal mentorship"],
      faculty: [],
      previousResults: [],
      faqs: [],
      installmentOptions: [],
      studyMaterialDetails: ["Printed theory modules", "Chapter-wise DPP sheets"],
      testSeriesCount: 40,
      testSeriesDetails: "Daily chapter tests, weekly unit tests, and full NEET mocks",
      admissionProcess: ["Submit enquiry", "Counselling call", "Seat confirmation", "Fee payment"],
      admissionFormLink: "/contact",
      scholarshipAvailable: true,
      scholarshipNote: "Merit based scholarship available",
    },
    seo: {
      metaTitle: "NEET 2026 Droppers Batch | BioLegacy",
      metaDesc: "Join BioLegacy's NEET 2026 Droppers Batch with mentorship and full test practice.",
    },
  },
  {
    slug: "bsc-nursing-2026",
    title: "B.Sc Nursing Entrance Batch 2026",
    shortTitle: "B.Sc Nursing",
    category: "nursing",
    targetExamYear: 2026,
    shortDesc: "Complete preparation for B.Sc Nursing entrance exams with Biology-focused learning.",
    longDesc:
      "A complete entrance preparation batch for B.Sc Nursing aspirants with tests, notes, and doubt support.",
    duration: "10 Months",
    totalHours: "850+ Hours",
    mode: "Offline",
    center: "Deokali Bypass, Ayodhya",
    image: "/images/courses/bsc-nursing.jpg",
    totalFees: "38000",
    registrationFee: "1000",
    totalSeats: 60,
    availableSeats: 24,
    batchStatus: "closed",
    enrollmentOpen: false,
    isPopular: true,
    isFeatured: false,
    content: {
      highlights: ["Complete Biology coverage", "Weekly mock tests", "Previous year questions"],
      subjects: ["Biology", "Physics", "Chemistry", "General Knowledge"],
      eligibility: "Class 12 PCB students",
      batchStartDate: "April 10, 2026",
      enrollmentDeadline: "April 5, 2026",
      testSeriesCount: 25,
      admissionFormLink: "/contact",
      faculty: [],
      previousResults: [],
      faqs: [],
      installmentOptions: [],
      studyMaterialDetails: ["Theory modules", "Question bank", "Revision notes"],
    },
    seo: {},
  },
];

async function seed() {
  if (!adminPassword || adminPassword.length < 16) {
    throw new Error("Set SEED_ADMIN_PASSWORD to a unique password of at least 16 characters before seeding");
  }
  await migrate();

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const admin = await pool.query(
    `INSERT INTO users(full_name, email, password_hash, role, status)
     VALUES($1,$2,$3,'TEACHER_ADMIN','ACTIVE')
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    ["BioLegacy Teacher Admin", adminEmail, passwordHash]
  );
  const adminId = admin.rows[0]?.id || (await pool.query("SELECT id FROM users WHERE email=$1", [adminEmail])).rows[0]?.id;
  if (!adminId) throw new Error("Could not resolve the seed administrator");

  for (const course of courses) {
    await pool.query(
      `INSERT INTO courses(
        slug,title,short_title,category,target_exam_year,short_desc,long_desc,duration,total_hours,
        mode,center,image,total_fees,registration_fee,total_seats,available_seats,batch_status,
        enrollment_open,is_popular,is_featured,published,content,seo,created_by
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true,$21,$22,$23)
      ON CONFLICT (slug) DO NOTHING`,
      [
        course.slug,
        course.title,
        course.shortTitle,
        course.category,
        course.targetExamYear,
        course.shortDesc,
        course.longDesc,
        course.duration,
        course.totalHours,
        course.mode,
        course.center,
        course.image,
        course.totalFees,
        course.registrationFee,
        course.totalSeats,
        course.availableSeats,
        course.batchStatus,
        course.enrollmentOpen,
        course.isPopular,
        course.isFeatured,
        course.content,
        course.seo,
        adminId,
      ]
    );
  }

  await pool.query(
    `INSERT INTO blog_posts(slug,title,summary,content,cover_image,published,published_at,created_by)
     VALUES($1,$2,$3,$4,$5,true,NOW(),$6)
     ON CONFLICT (slug) DO NOTHING`,
    [
      "neet-2026-preparation-strategy",
      "NEET 2026 Preparation Strategy",
      "Complete roadmap to crack NEET with smart study planning.",
      "Focus on NCERT, repeated revision, and full-length mock analysis. BioLegacy teachers use weekly feedback to keep students on track.",
      "/images/blog/blog1.jpg",
      adminId,
    ]
  );

  await pool.query(
    `INSERT INTO result_highlights(student_name, exam_name, exam_year, achievement, image_url, sort_order, created_by)
     VALUES($1,$2,$3,$4,$5,0,$6)
     ON CONFLICT DO NOTHING`,
    ["Aanchal Verma", "NEET", 2025, "ASMC Kaushambi (MBBS)", "/RankerPhotos/Aanchal.png", adminId]
  );

  await pool.query(
    `INSERT INTO test_series(slug,title,description,audience,tests_count,analytics,access_label,is_featured,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,true,$8)
     ON CONFLICT (slug) DO NOTHING`,
    [
      "neet-rank-booster",
      "NEET Rank Booster",
      "Full syllabus mock program with ranking, revision alerts, and topic analytics.",
      "Droppers and full-year NEET aspirants",
      30,
      "AIR-style ranking, topic accuracy, revision alerts",
      "Most Popular",
      adminId,
    ]
  );

  console.log(`Seed complete. Admin: ${adminEmail}`);
  await pool.end();
}

seed().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});

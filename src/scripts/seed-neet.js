const pool = require("../db/pool");
const migrate = require("../db/migrate");

const questions = [
  [
    "PHY-MOTION-001",
    "The slope of a velocity-time graph represents:",
    "Physics",
    "Kinematics",
    "Motion in a Straight Line",
    "EASY",
    ["Displacement", "Acceleration", "Speed", "Momentum"],
    1,
    "Acceleration is the rate of change of velocity, so it is the slope of a velocity-time graph.",
  ],
  [
    "PHY-UNIT-002",
    "Which quantity has the dimensional formula ML²T⁻²?",
    "Physics",
    "Units and Measurements",
    "Dimensions",
    "MEDIUM",
    ["Force", "Energy", "Pressure", "Power"],
    1,
    "Work and energy equal force multiplied by distance: ML²T⁻².",
  ],
  [
    "PHY-ELEC-003",
    "Two equal resistors R connected in parallel have equivalent resistance:",
    "Physics",
    "Current Electricity",
    "Resistance",
    "EASY",
    ["2R", "R", "R/2", "R/4"],
    2,
    "For equal parallel resistors, 1/Req = 2/R, hence Req = R/2.",
  ],
  [
    "PHY-OPT-004",
    "The SI unit of power of a lens is:",
    "Physics",
    "Ray Optics",
    "Lenses",
    "MEDIUM",
    ["metre", "dioptre", "watt", "tesla"],
    1,
    "Lens power is measured in dioptres, equal to inverse metres.",
  ],
  [
    "CHEM-ATOM-001",
    "The maximum number of electrons in the n=3 shell is:",
    "Chemistry",
    "Structure of Atom",
    "Electronic Configuration",
    "EASY",
    ["8", "18", "32", "9"],
    1,
    "The shell capacity is 2n²; for n=3 this equals 18.",
  ],
  [
    "CHEM-BOND-002",
    "The shape of methane according to VSEPR theory is:",
    "Chemistry",
    "Chemical Bonding",
    "Molecular Geometry",
    "EASY",
    ["Square planar", "Trigonal planar", "Tetrahedral", "Linear"],
    2,
    "Four bonding pairs around carbon arrange tetrahedrally.",
  ],
  [
    "CHEM-EQ-003",
    "A catalyst changes which of the following?",
    "Chemistry",
    "Equilibrium",
    "Chemical Equilibrium",
    "MEDIUM",
    [
      "Equilibrium constant",
      "Activation energy",
      "Reaction enthalpy",
      "Final equilibrium composition",
    ],
    1,
    "A catalyst lowers activation energy equally for forward and reverse reactions.",
  ],
  [
    "CHEM-ORG-004",
    "The functional group in ethanol is:",
    "Chemistry",
    "Organic Chemistry",
    "Alcohols",
    "EASY",
    ["Carboxyl", "Hydroxyl", "Aldehyde", "Amino"],
    1,
    "Ethanol contains the hydroxyl (–OH) functional group.",
  ],
  [
    "BIO-CELL-001",
    "The powerhouse of the cell is:",
    "Biology",
    "Cell: The Unit of Life",
    "Cell Organelles",
    "EASY",
    ["Golgi apparatus", "Mitochondrion", "Lysosome", "Nucleus"],
    1,
    "Mitochondria generate most cellular ATP through aerobic respiration.",
  ],
  [
    "BIO-GEN-002",
    "DNA replication is described as:",
    "Biology",
    "Molecular Basis of Inheritance",
    "DNA Replication",
    "MEDIUM",
    ["Conservative", "Semiconservative", "Dispersive only", "Random"],
    1,
    "Each daughter DNA molecule contains one parental and one newly synthesised strand.",
  ],
  [
    "BIO-HUM-003",
    "Insulin is secreted by which pancreatic cells?",
    "Biology",
    "Chemical Coordination",
    "Endocrine System",
    "EASY",
    ["Alpha cells", "Beta cells", "Delta cells", "Acinar cells"],
    1,
    "Beta cells of the islets of Langerhans secrete insulin.",
  ],
  [
    "BIO-ECO-004",
    "The pyramid of energy in an ecosystem is always:",
    "Biology",
    "Ecosystem",
    "Ecological Pyramids",
    "MEDIUM",
    ["Inverted", "Spindle shaped", "Upright", "Horizontal"],
    2,
    "Energy is lost at each trophic transfer, so its pyramid is always upright.",
  ],
];

const tests = [
  {
    code: "NEET-DEMO-CHAPTER",
    name: "NEET Chapter Diagnostic",
    minutes: 45,
    questionCodes: [
      "PHY-MOTION-001",
      "PHY-UNIT-002",
      "CHEM-ATOM-001",
      "CHEM-BOND-002",
      "BIO-CELL-001",
      "BIO-GEN-002",
    ],
  },
  {
    code: "NEET-DEMO-MIXED",
    name: "NEET Mixed Practice Test",
    minutes: 60,
    questionCodes: [
      "PHY-ELEC-003",
      "PHY-OPT-004",
      "CHEM-EQ-003",
      "CHEM-ORG-004",
      "BIO-HUM-003",
      "BIO-ECO-004",
    ],
  },
  {
    code: "NEET-DEMO-FULL",
    name: "NEET Full Syllabus Demo",
    minutes: 90,
    questionCodes: questions.map((q) => q[0]),
  },
];

async function seedNeet() {
  if (process.env.NODE_ENV === "production")
    throw new Error("The NEET demo seed is development-only");
  await migrate();
  const admin = (
    await pool.query(
      "SELECT id FROM users WHERE role='TEACHER_ADMIN' ORDER BY created_at LIMIT 1",
    )
  ).rows[0];
  if (!admin)
    throw new Error("Run npm run db:seed first so an administrator exists");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const series = await client.query(
      `INSERT INTO test_series(slug,title,short_name,description,audience,category,exam_type,target_exam,language,difficulty,author_name,lifecycle_status,access_type,instructions,eligibility,published,is_featured,created_by) VALUES('neet-rank-booster','NEET Rank Booster','Rank Booster','A production-style NEET practice series with chapter diagnostics, mixed practice and a full-syllabus mock.','NEET aspirants','NEET','NEET','NEET','English','MIXED','BioLegacy Faculty','PUBLISHED','AUTHENTICATED',$1,'{}',true,true,$2) ON CONFLICT(slug) DO UPDATE SET lifecycle_status='PUBLISHED',published=true,updated_at=NOW() RETURNING id`,
      [
        {
          general: [
            "Read each question carefully.",
            "The server timer is authoritative.",
            "Submit before time expires.",
          ],
          scoring: "Correct +4, incorrect -1, unanswered 0",
        },
        admin.id,
      ],
    );
    const seriesId = series.rows[0].id;
    const ids = {};
    for (const [
      code,
      text,
      subject,
      chapter,
      topic,
      difficulty,
      options,
      correctIndex,
      explanation,
    ] of questions) {
      const q = await client.query(
        `INSERT INTO questions(code,question_text,subject,chapter,topic,difficulty,question_type,marks,negative_marks,explanation,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,'SINGLE_CORRECT',4,1,$7,'ACTIVE',$8,$8) ON CONFLICT(code) DO UPDATE SET question_text=EXCLUDED.question_text,subject=EXCLUDED.subject,chapter=EXCLUDED.chapter,topic=EXCLUDED.topic,difficulty=EXCLUDED.difficulty,explanation=EXCLUDED.explanation,status='ACTIVE',updated_at=NOW() RETURNING id`,
        [
          code,
          text,
          subject,
          chapter,
          topic,
          difficulty,
          explanation,
          admin.id,
        ],
      );
      ids[code] = q.rows[0].id;
      await client.query("DELETE FROM question_options WHERE question_id=$1", [
        q.rows[0].id,
      ]);
      for (let index = 0; index < options.length; index += 1)
        await client.query(
          "INSERT INTO question_options(question_id,option_text,is_correct,sort_order) VALUES($1,$2,$3,$4)",
          [q.rows[0].id, options[index], index === correctIndex, index],
        );
    }
    for (const item of tests) {
      const test = await client.query(
        `INSERT INTO tests(series_id,code,name,description,total_questions,total_marks,duration_minutes,passing_marks,correct_marks,incorrect_marks,unanswered_marks,max_attempts,lifecycle_status,published_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,4,-1,0,3,'PUBLISHED',NOW(),$9) ON CONFLICT(code) DO UPDATE SET series_id=EXCLUDED.series_id,name=EXCLUDED.name,description=EXCLUDED.description,total_questions=EXCLUDED.total_questions,total_marks=EXCLUDED.total_marks,duration_minutes=EXCLUDED.duration_minutes,lifecycle_status='PUBLISHED',updated_at=NOW() RETURNING id`,
        [
          seriesId,
          item.code,
          item.name,
          "Balanced Physics, Chemistry and Biology practice with server-side evaluation.",
          item.questionCodes.length,
          item.questionCodes.length * 4,
          item.minutes,
          Math.ceil(item.questionCodes.length * 4 * 0.4),
          admin.id,
        ],
      );
      const testId = test.rows[0].id;
      await client.query("DELETE FROM test_questions WHERE test_id=$1", [
        testId,
      ]);
      await client.query("DELETE FROM test_sections WHERE test_id=$1", [
        testId,
      ]);
      const sections = {};
      for (const [index, subject] of [
        "Physics",
        "Chemistry",
        "Biology",
      ].entries()) {
        const s = await client.query(
          "INSERT INTO test_sections(test_id,name,subject,sort_order) VALUES($1,$2,$2,$3) RETURNING id",
          [testId, subject, index],
        );
        sections[subject] = s.rows[0].id;
      }
      for (let index = 0; index < item.questionCodes.length; index += 1) {
        const code = item.questionCodes[index];
        const subject = questions.find((q) => q[0] === code)[2];
        await client.query(
          "INSERT INTO test_questions(test_id,question_id,section_id,sort_order) VALUES($1,$2,$3,$4)",
          [testId, ids[code], sections[subject], index],
        );
      }
    }
    await client.query(
      "UPDATE test_series SET tests_count=$2,updated_at=NOW() WHERE id=$1",
      [seriesId, tests.length],
    );
    await client.query("COMMIT");
    console.log(
      `NEET demo seed complete: ${questions.length} questions, ${tests.length} tests.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
seedNeet().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});

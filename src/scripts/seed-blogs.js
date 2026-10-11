const pool = require("../db/pool");
const migrate = require("../db/migrate");

const posts = [
  {
    slug: "how-to-build-a-neet-revision-plan",
    title: "How to Build a NEET Revision Plan You Can Actually Follow",
    summary: "Turn a large syllabus into a practical weekly revision routine with realistic targets and regular testing.",
    category: "Study Strategy",
    content: `A revision plan works when it tells you what to do today, not only what you hope to finish this month.

Start by listing chapters as strong, developing, or weak. Give weak chapters more time, but keep a short revision slot for strong chapters so they stay fresh.

For each week, choose three outcomes: one Biology block, one Physics or Chemistry block, and one mixed question practice block. Keep one half day free for unfinished work and error review.

After every test, record only the mistakes that can change your next attempt: a missed NCERT fact, a formula error, a rushed calculation, or a question you misunderstood. Review this notebook before the next test.

Consistency beats an overfilled timetable. A plan you complete at eighty percent is more useful than a perfect plan you abandon after two days.`,
  },
  {
    slug: "ncert-biology-reading-method-for-neet",
    title: "A Better Way to Read NCERT Biology for NEET",
    summary: "Use active reading, diagrams, and targeted questions to make NCERT Biology easier to remember under exam pressure.",
    category: "Biology",
    content: `NCERT Biology needs more than repeated reading. The goal is to notice exact statements, connect diagrams to the text, and test recall before looking at the answer.

Read one short section at a time. Close the book and write three things you remember: the definition, the process, and one exception or example. Then compare your notes with the paragraph.

Treat every labelled diagram as a question. Cover the labels, redraw the structure quickly, and explain its function in your own words. This makes visual memory useful in assertion and statement questions.

When a line feels minor, ask whether it contains a number, a named example, a comparison, or an exception. These details often become direct questions.

Finish each chapter with a small set of NCERT based questions, then return to the same chapter after three days. Spaced recall is what moves information from short term familiarity to reliable exam memory.`,
  },
  {
    slug: "mock-test-analysis-that-improves-your-score",
    title: "Mock Test Analysis: Turn Every Test Into a Better Score",
    summary: "A mock test becomes useful only after you identify why marks were lost and decide what changes before the next attempt.",
    category: "Test Practice",
    content: `Your score is the starting point of test analysis, not the conclusion. The useful question is why each mark was gained or lost.

Divide incorrect and unattempted questions into four groups: concept gap, memory gap, calculation mistake, and time or reading mistake. Do not put every error under “careless mistake”; that label does not tell you what to fix.

For concept gaps, revise the source material and solve a small targeted set of questions. For memory gaps, add the fact to a recall list. For calculation mistakes, slow down and write the step that you usually skip.

Also review correct answers that took too long. They show where your method needs practice even though the answer was right.

Before your next mock, choose one process goal such as reading assertion questions twice or leaving difficult numerical questions for the second round. One deliberate change at a time makes progress measurable.`,
  },
  {
    slug: "class-11-neet-foundation-study-routine",
    title: "Class 11 NEET Foundation: A Study Routine That Protects Your Basics",
    summary: "Build Class 11 fundamentals without burning out by balancing school work, NCERT, questions, and recovery time.",
    category: "Foundation",
    content: `Class 11 is where many NEET preparation gaps begin, usually because students try to move too fast through new concepts.

On most days, keep two focused academic blocks after school: one for the day’s classroom topic and one for question practice. Biology can include NCERT recall, while Physics and Chemistry should include worked examples before timed questions.

Use weekends for consolidation. Revisit the week’s chapters, solve a mixed practice set, and make a short list of doubts before the next class.

Avoid comparing study hours with other students. Track output instead: pages revised, questions understood, and doubts resolved.

Good foundation work feels steady. The aim is not to finish early; it is to understand well enough that Class 12 revision becomes faster and less stressful.`,
  },
];

async function seedBlogs() {
  await migrate();
  const author = await pool.query("SELECT id FROM users WHERE role='TEACHER_ADMIN' ORDER BY created_at ASC LIMIT 1");
  const authorId = author.rows[0]?.id || null;

  for (const post of posts) {
    await pool.query(
      `INSERT INTO blog_posts(slug,title,summary,content,category,published,published_at,created_by)
       VALUES($1,$2,$3,$4,$5,true,NOW(),$6)
       ON CONFLICT (slug) DO NOTHING`,
      [post.slug, post.title, post.summary, post.content, post.category, authorId]
    );
  }

  console.log(`Blog seed complete. ${posts.length} starter posts checked.`);
  await pool.end();
}

seedBlogs().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});

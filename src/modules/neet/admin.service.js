const pool = require("../../db/pool");
const ApiError = require("../../utils/apiError");
const audit = require("../../utils/audit");
const { getPagination, pageMeta } = require("../../utils/pagination");
const { cleanText } = require("./content");
const { selectQuestions } = require("./engines/blueprintEngine");

function mapSeries(row) {
  return {
    id: row.id, courseId: row.course_id, slug: row.slug, title: row.title, shortName: row.short_name,
    description: row.description, thumbnailUrl: row.thumbnail_url, bannerUrl: row.banner_url, category: row.category,
    examType: row.exam_type, targetClass: row.target_class, targetExam: row.target_exam, language: row.language,
    tags: row.tags || [], difficulty: row.difficulty, authorName: row.author_name, lifecycleStatus: row.lifecycle_status,
    displayOrder: row.display_order, accessType: row.access_type, price: Number(row.price), accessDurationDays: row.access_duration_days,
    startsAt: row.starts_at, endsAt: row.ends_at, instructions: row.instructions || {}, eligibility: row.eligibility || {},
    testsCount: Number(row.real_tests_count ?? row.tests_count ?? 0), published: row.published,
  };
}

function mapTest(row) {
  return {
    id: row.id, seriesId: row.series_id, seriesTitle: row.series_title, code: row.code, name: row.name, examType: row.exam_type, isFree: Boolean(row.is_free),
    description: row.description, instructions: row.instructions || {}, selectionMode: row.selection_mode,
    blueprint: row.blueprint || {}, totalQuestions: row.total_questions, totalMarks: Number(row.total_marks),
    durationMinutes: row.duration_minutes, passingMarks: Number(row.passing_marks), correctMarks: Number(row.correct_marks),
    incorrectMarks: Number(row.incorrect_marks), unansweredMarks: Number(row.unanswered_marks), maxAttempts: row.max_attempts,
    resultVisibility: row.result_visibility, explanationVisibility: row.explanation_visibility, answerKeyVisibility: row.answer_key_visibility,
    rankingEnabled: row.ranking_enabled, leaderboardEnabled: row.leaderboard_enabled, shuffleQuestions: row.shuffle_questions,
    shuffleOptions: row.shuffle_options, shuffleSections: row.shuffle_sections, resumeEnabled: row.resume_enabled,
    pauseEnabled: row.pause_enabled, startsAt: row.starts_at, endsAt: row.ends_at, timezone: row.timezone,
    eligibility: row.eligibility || {}, integritySettings: row.integrity_settings || {}, lifecycleStatus: row.lifecycle_status,
    resultReleasedAt: row.result_released_at, publishedAt: row.published_at, version: row.version,
    assignedQuestions: Number(row.assigned_questions || 0), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function listSeries() {
  const result = await pool.query(`SELECT ts.*, COUNT(t.id)::int AS real_tests_count FROM test_series ts LEFT JOIN test_series_tests tst ON tst.series_id=ts.id AND tst.is_active=true LEFT JOIN tests t ON t.id=tst.test_id AND t.lifecycle_status<>'ARCHIVED' GROUP BY ts.id ORDER BY ts.display_order,ts.updated_at DESC`);
  return result.rows.map(mapSeries);
}

async function getSeries(id) {
  const result = await pool.query(`SELECT ts.*,COUNT(t.id)::int AS real_tests_count FROM test_series ts LEFT JOIN test_series_tests tst ON tst.series_id=ts.id AND tst.is_active=true LEFT JOIN tests t ON t.id=tst.test_id AND t.lifecycle_status<>'ARCHIVED' WHERE ts.id=$1 GROUP BY ts.id`, [id]);
  if (!result.rows[0]) throw new ApiError(404, "Test series not found");
  return mapSeries(result.rows[0]);
}

async function createSeries(input, actorId) {
  const published = input.lifecycleStatus === "PUBLISHED";
  const result = await pool.query(
    `INSERT INTO test_series(course_id,slug,title,short_name,description,thumbnail_url,banner_url,category,exam_type,target_class,target_exam,language,tags,difficulty,author_name,lifecycle_status,display_order,access_type,price,access_duration_days,starts_at,ends_at,instructions,eligibility,published,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
    [input.courseId || null,input.slug,input.title,input.shortName || null,cleanText(input.description),input.thumbnailUrl || null,input.bannerUrl || null,input.category,input.examType,input.targetClass || null,input.targetExam,input.language,input.tags,input.difficulty,input.authorName || null,input.lifecycleStatus,input.displayOrder,input.accessType,input.price,input.accessDurationDays || null,input.startsAt || null,input.endsAt || null,input.instructions,input.eligibility,published,actorId]
  );
  await audit(actorId, "CREATE", "test_series", result.rows[0].id, { slug: input.slug });
  return mapSeries(result.rows[0]);
}

async function updateSeries(id, input, actorId) {
  const published = input.lifecycleStatus === "PUBLISHED";
  const result = await pool.query(
    `UPDATE test_series SET course_id=$1,slug=$2,title=$3,short_name=$4,description=$5,thumbnail_url=$6,banner_url=$7,category=$8,exam_type=$9,target_class=$10,target_exam=$11,language=$12,tags=$13,difficulty=$14,author_name=$15,lifecycle_status=$16,display_order=$17,access_type=$18,price=$19,access_duration_days=$20,starts_at=$21,ends_at=$22,instructions=$23,eligibility=$24,published=$25,updated_at=NOW() WHERE id=$26 RETURNING *`,
    [input.courseId || null,input.slug,input.title,input.shortName || null,cleanText(input.description),input.thumbnailUrl || null,input.bannerUrl || null,input.category,input.examType,input.targetClass || null,input.targetExam,input.language,input.tags,input.difficulty,input.authorName || null,input.lifecycleStatus,input.displayOrder,input.accessType,input.price,input.accessDurationDays || null,input.startsAt || null,input.endsAt || null,input.instructions,input.eligibility,published,id]
  );
  if (!result.rows[0]) throw new ApiError(404, "Test series not found");
  await audit(actorId, "UPDATE", "test_series", id, { slug: input.slug });
  return mapSeries(result.rows[0]);
}

async function archiveSeries(id, actorId) {
  const active = await pool.query("SELECT COUNT(*)::int AS total FROM test_attempts ta JOIN test_series_tests tst ON tst.test_id=ta.test_id AND tst.is_active=true WHERE tst.series_id=$1 AND ta.status='ACTIVE'", [id]);
  if (active.rows[0].total) throw new ApiError(409, "A series with active attempts cannot be archived");
  const result = await pool.query("UPDATE test_series SET lifecycle_status='ARCHIVED',published=false,updated_at=NOW() WHERE id=$1 RETURNING id", [id]);
  if (!result.rows[0]) throw new ApiError(404, "Test series not found");
  await audit(actorId, "ARCHIVE", "test_series", id);
}

async function listTests(seriesId) {
  const params = [];
  const where = seriesId ? (params.push(seriesId), "WHERE EXISTS(SELECT 1 FROM test_series_tests filter_tst WHERE filter_tst.test_id=t.id AND filter_tst.series_id=$1 AND filter_tst.is_active=true)") : "";
  const result = await pool.query(`SELECT t.*,ts.title AS series_title,COUNT(tq.question_id)::int AS assigned_questions FROM tests t JOIN test_series ts ON ts.id=t.series_id LEFT JOIN test_questions tq ON tq.test_id=t.id ${where} GROUP BY t.id,ts.title ORDER BY t.updated_at DESC`, params);
  return result.rows.map(mapTest);
}

async function getTest(id) {
  const result = await pool.query(`SELECT t.*,ts.title AS series_title,COUNT(tq.question_id)::int AS assigned_questions FROM tests t JOIN test_series ts ON ts.id=t.series_id LEFT JOIN test_questions tq ON tq.test_id=t.id WHERE t.id=$1 GROUP BY t.id,ts.title`, [id]);
  if (!result.rows[0]) throw new ApiError(404, "Test not found");
  const sections = await pool.query("SELECT id,name,subject,instructions,question_limit,sort_order FROM test_sections WHERE test_id=$1 ORDER BY sort_order", [id]);
  const eligible = await pool.query("SELECT user_id FROM test_eligible_users WHERE test_id=$1 ORDER BY user_id", [id]);
  return { ...mapTest(result.rows[0]), sections: sections.rows.map((row) => ({ id: row.id, name: row.name, subject: row.subject, instructions: row.instructions, questionLimit: row.question_limit, sortOrder: row.sort_order })), eligibleUserIds: eligible.rows.map((row)=>row.user_id) };
}

const testColumns = `series_id,code,name,exam_type,is_free,description,instructions,selection_mode,blueprint,total_questions,total_marks,duration_minutes,passing_marks,correct_marks,incorrect_marks,unanswered_marks,max_attempts,result_visibility,explanation_visibility,answer_key_visibility,ranking_enabled,leaderboard_enabled,shuffle_questions,shuffle_options,shuffle_sections,resume_enabled,pause_enabled,starts_at,ends_at,timezone,eligibility,integrity_settings,lifecycle_status`;
function testValues(input) {
  return [input.seriesId,input.code,input.name,input.examType,input.isFree,cleanText(input.description) || "",input.instructions,input.selectionMode,input.blueprint,input.totalQuestions,input.totalMarks,input.durationMinutes,input.passingMarks,input.correctMarks,input.incorrectMarks,input.unansweredMarks,input.maxAttempts,input.resultVisibility,input.explanationVisibility,input.answerKeyVisibility,input.rankingEnabled,input.leaderboardEnabled,input.shuffleQuestions,input.shuffleOptions,input.shuffleSections,input.resumeEnabled,input.pauseEnabled,input.startsAt || null,input.endsAt || null,input.timezone,input.eligibility,input.integritySettings,input.lifecycleStatus];
}

async function assertSeriesExamType(seriesId, examType) {
  const series = (await pool.query("SELECT exam_type FROM test_series WHERE id=$1", [seriesId])).rows[0];
  if (!series) throw new ApiError(404, "Test series not found");
  if (series.exam_type !== examType) throw new ApiError(400, "Test exam type must match the test series exam type");
}

async function createTest(input, actorId) {
  await assertSeriesExamType(input.seriesId, input.examType);
  const values = testValues({ ...input, lifecycleStatus: "DRAFT" });
  const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
  const result = await pool.query(`INSERT INTO tests(${testColumns},created_by) VALUES(${placeholders},$${values.length + 1}) RETURNING *`, [...values, actorId]);
  await pool.query("INSERT INTO test_series_tests(series_id,test_id,sort_order,is_active) VALUES($1,$2,0,true) ON CONFLICT(series_id,test_id) DO UPDATE SET is_active=true",[input.seriesId,result.rows[0].id]);
  await audit(actorId, "CREATE", "test", result.rows[0].id, { code: input.code });
  return mapTest(result.rows[0]);
}

async function updateTest(id, input, actorId) {
  await assertSeriesExamType(input.seriesId, input.examType);
  const existing = await pool.query("SELECT lifecycle_status FROM tests WHERE id=$1", [id]);
  if (!existing.rows[0]) throw new ApiError(404, "Test not found");
  if (existing.rows[0].lifecycle_status === "ARCHIVED") throw new ApiError(409, "Archived tests cannot be edited");
  const values = testValues({ ...input, lifecycleStatus: existing.rows[0].lifecycle_status });
  const assignments = testColumns.split(",").map((column, index) => `${column}=$${index + 1}`).join(",");
  const result = await pool.query(`UPDATE tests SET ${assignments},version=version+1,updated_at=NOW() WHERE id=$${values.length + 1} RETURNING *`, [...values, id]);
  await pool.query("INSERT INTO test_series_tests(series_id,test_id,sort_order,is_active) VALUES($1,$2,0,true) ON CONFLICT(series_id,test_id) DO UPDATE SET is_active=true",[input.seriesId,id]);
  await audit(actorId, "UPDATE", "test", id, { code: input.code });
  return mapTest(result.rows[0]);
}

async function replaceSections(testId, sections, actorId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exists = await client.query("SELECT id FROM tests WHERE id=$1 FOR UPDATE", [testId]);
    if (!exists.rows[0]) throw new ApiError(404, "Test not found");
    await client.query("DELETE FROM test_sections WHERE test_id=$1", [testId]);
    for (const section of sections) {
      await client.query("INSERT INTO test_sections(test_id,name,subject,instructions,question_limit,sort_order) VALUES($1,$2,$3,$4,$5,$6)", [testId,section.name,section.subject,cleanText(section.instructions),section.questionLimit,section.sortOrder]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  await audit(actorId, "REPLACE", "test_sections", testId, { count: sections.length });
  return getTest(testId);
}

async function getSeriesMembership(seriesId) {
  const exists=await pool.query("SELECT id,title FROM test_series WHERE id=$1",[seriesId]);if(!exists.rows[0])throw new ApiError(404,"Test series not found");
  const [groups,members]=await Promise.all([
    pool.query("SELECT id,code,title,sort_order FROM test_series_groups WHERE series_id=$1 ORDER BY sort_order,title",[seriesId]),
    pool.query(`SELECT tst.test_id,tst.group_id,g.code AS group_code,tst.sort_order,tst.is_active,t.code,t.name,t.exam_type FROM test_series_tests tst JOIN tests t ON t.id=tst.test_id LEFT JOIN test_series_groups g ON g.id=tst.group_id WHERE tst.series_id=$1 ORDER BY g.sort_order NULLS LAST,tst.sort_order,t.name`,[seriesId]),
  ]);
  return {series:exists.rows[0],groups:groups.rows.map(r=>({id:r.id,code:r.code,title:r.title,sortOrder:r.sort_order})),tests:members.rows.map(r=>({testId:r.test_id,code:r.code,name:r.name,examType:r.exam_type,groupId:r.group_id,groupCode:r.group_code,sortOrder:r.sort_order,isActive:r.is_active}))};
}

async function replaceSeriesMembership(seriesId,input,actorId){
  const client=await pool.connect();
  try{await client.query("BEGIN");const series=(await client.query("SELECT id,exam_type FROM test_series WHERE id=$1 FOR UPDATE",[seriesId])).rows[0];if(!series)throw new ApiError(404,"Test series not found");
    const testIds=input.tests.map(x=>x.testId);if(testIds.length){const valid=await client.query("SELECT id,exam_type FROM tests WHERE id=ANY($1::uuid[])",[testIds]);if(valid.rowCount!==testIds.length)throw new ApiError(400,"One or more tests do not exist");const mismatched=valid.rows.filter(t=>t.exam_type!==series.exam_type);if(mismatched.length)throw new ApiError(400,"Test exam type must match the test series exam type",mismatched.map(t=>t.id));}
    await client.query("DELETE FROM test_series_tests WHERE series_id=$1",[seriesId]);await client.query("DELETE FROM test_series_groups WHERE series_id=$1",[seriesId]);const groupIds=new Map();
    for(const group of input.groups){const saved=await client.query("INSERT INTO test_series_groups(series_id,code,title,sort_order) VALUES($1,$2,$3,$4) RETURNING id",[seriesId,group.code,group.title,group.sortOrder]);groupIds.set(group.code,saved.rows[0].id);}
    for(const item of input.tests){if(item.groupCode&&!groupIds.has(item.groupCode))throw new ApiError(400,`Unknown group code: ${item.groupCode}`);await client.query("INSERT INTO test_series_tests(series_id,test_id,group_id,sort_order,is_active) VALUES($1,$2,$3,$4,$5)",[seriesId,item.testId,item.groupCode?groupIds.get(item.groupCode):null,item.sortOrder,item.isActive]);}
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  await audit(actorId,"REPLACE","test_series_membership",seriesId,{tests:input.tests.length,groups:input.groups.length});return getSeriesMembership(seriesId);
}

function mapQuestion(row, options = []) {
  return { id: row.id, code: row.code, questionText: row.question_text, subject: row.subject, chapter: row.chapter, topic: row.topic, subtopic: row.subtopic, difficulty: row.difficulty, questionType: row.question_type, marks: Number(row.marks), negativeMarks: Number(row.negative_marks), explanation: row.explanation, hint: row.hint, solution: row.solution, sourceReference: row.source_reference, tags: row.tags || [], language: row.language, imageUrl: row.image_url, status: row.status, options };
}

async function listQuestions(query = {}) {
  const { page, limit, offset } = getPagination(query);
  const params = [];
  const filters = [];
  for (const [key, column] of [["subject","q.subject"],["difficulty","q.difficulty"],["status","q.status"],["chapter","q.chapter"]]) if (query[key]) { params.push(query[key]); filters.push(`${column}=$${params.length}`); }
  if (query.search) { params.push(`%${query.search}%`); filters.push(`(q.code ILIKE $${params.length} OR q.question_text ILIKE $${params.length} OR COALESCE(q.topic,'') ILIKE $${params.length})`); }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM questions q ${where}`, params);
  params.push(limit, offset);
  const result = await pool.query(`SELECT q.* FROM questions q ${where} ORDER BY q.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const ids = result.rows.map((row) => row.id);
  const options = ids.length ? await pool.query("SELECT * FROM question_options WHERE question_id=ANY($1::uuid[]) ORDER BY sort_order", [ids]) : { rows: [] };
  return { data: result.rows.map((row) => mapQuestion(row, options.rows.filter((option) => option.question_id === row.id).map((option) => ({ id: option.id, optionText: option.option_text, imageUrl: option.image_url, isCorrect: option.is_correct, sortOrder: option.sort_order })))), meta: pageMeta(count.rows[0].total, page, limit) };
}

async function writeQuestion(client, input, actorId, id) {
  let row;
  const values = [input.code,cleanText(input.questionText),input.subject,input.chapter || null,input.topic || null,input.subtopic || null,input.difficulty,input.questionType,input.marks,input.negativeMarks,cleanText(input.explanation),cleanText(input.hint),cleanText(input.solution,30000),cleanText(input.sourceReference,500),input.tags,input.language,input.imageUrl || null,input.status,actorId];
  if (id) {
    const result = await client.query(`UPDATE questions SET code=$1,question_text=$2,subject=$3,chapter=$4,topic=$5,subtopic=$6,difficulty=$7,question_type=$8,marks=$9,negative_marks=$10,explanation=$11,hint=$12,solution=$13,source_reference=$14,tags=$15,language=$16,image_url=$17,status=$18,updated_by=$19,updated_at=NOW() WHERE id=$20 RETURNING *`, [...values,id]);
    if (!result.rows[0]) throw new ApiError(404, "Question not found");
    row = result.rows[0];
    await client.query("DELETE FROM question_options WHERE question_id=$1", [id]);
  } else {
    const result = await client.query(`INSERT INTO questions(code,question_text,subject,chapter,topic,subtopic,difficulty,question_type,marks,negative_marks,explanation,hint,solution,source_reference,tags,language,image_url,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19) RETURNING *`, values);
    row = result.rows[0];
  }
  const savedOptions = [];
  for (const option of input.options) {
    const result = await client.query("INSERT INTO question_options(question_id,option_text,image_url,is_correct,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING *", [row.id,cleanText(option.optionText,5000),option.imageUrl || null,option.isCorrect,option.sortOrder]);
    savedOptions.push({ id: result.rows[0].id, optionText: result.rows[0].option_text, imageUrl: result.rows[0].image_url, isCorrect: result.rows[0].is_correct, sortOrder: result.rows[0].sort_order });
  }
  return mapQuestion(row, savedOptions);
}

async function saveQuestion(input, actorId, id) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await writeQuestion(client,input,actorId,id); await client.query("COMMIT"); await audit(actorId,id ? "UPDATE" : "CREATE","question",result.id,{ code: input.code }); return result; }
  catch (error) { await client.query("ROLLBACK"); if (error.code === "23505") throw new ApiError(409,"Question code or option order already exists"); throw error; }
  finally { client.release(); }
}

async function importQuestions(items, actorId) {
  const duplicateCodes = items.map((item) => item.code).filter((code,index,all) => all.indexOf(code) !== index);
  if (duplicateCodes.length) throw new ApiError(400,"Import contains duplicate question codes",[...new Set(duplicateCodes)]);
  const existing = await pool.query("SELECT code FROM questions WHERE code=ANY($1::text[])", [items.map((item) => item.code)]);
  if (existing.rowCount) throw new ApiError(409,"Some question codes already exist",existing.rows.map((row) => row.code));
  const client = await pool.connect();
  try { await client.query("BEGIN"); const saved=[]; for (const item of items) saved.push(await writeQuestion(client,item,actorId)); await client.query("COMMIT"); await audit(actorId,"IMPORT","questions",null,{ count:saved.length }); return { imported:saved.length, questions:saved }; }
  catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function archiveQuestion(id, actorId) {
  const result = await pool.query("UPDATE questions SET status='ARCHIVED',updated_by=$2,updated_at=NOW() WHERE id=$1 RETURNING id", [id,actorId]);
  if (!result.rows[0]) throw new ApiError(404,"Question not found");
  await audit(actorId,"ARCHIVE","question",id);
}

async function assignQuestions(testId, questionIds, actorId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const test = await client.query("SELECT id FROM tests WHERE id=$1 FOR UPDATE", [testId]);
    if (!test.rows[0]) throw new ApiError(404,"Test not found");
    const questions = await client.query("SELECT id,marks FROM questions WHERE id=ANY($1::uuid[]) AND status='ACTIVE'", [questionIds]);
    if (questions.rowCount !== questionIds.length) throw new ApiError(400,"One or more selected questions are unavailable");
    await client.query("DELETE FROM test_questions WHERE test_id=$1", [testId]);
    for (let index=0; index<questionIds.length; index+=1) await client.query(`INSERT INTO test_questions(test_id,question_id,section_id,sort_order) SELECT $1,$2,(SELECT ts.id FROM test_sections ts JOIN questions q ON q.id=$2 WHERE ts.test_id=$1 AND lower(ts.subject)=lower(q.subject) ORDER BY ts.sort_order LIMIT 1),$3`,[testId,questionIds[index],index]);
    const totals = await client.query("SELECT COUNT(*)::int AS count,COALESCE(SUM(q.marks),0) AS marks FROM test_questions tq JOIN questions q ON q.id=tq.question_id WHERE tq.test_id=$1",[testId]);
    await client.query("UPDATE tests SET total_questions=$2,total_marks=$3,updated_at=NOW(),version=version+1 WHERE id=$1",[testId,totals.rows[0].count,totals.rows[0].marks]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  await audit(actorId,"ASSIGN","test_questions",testId,{ count:questionIds.length });
  return getTest(testId);
}

async function generateFromBlueprint(testId, actorId, suppliedSeed) {
  const test = await pool.query("SELECT blueprint FROM tests WHERE id=$1",[testId]);
  if (!test.rows[0]) throw new ApiError(404,"Test not found");
  const candidates = await pool.query("SELECT id,subject,chapter,topic,difficulty,question_type,status FROM questions WHERE status='ACTIVE'");
  let selected;
  try { selected = selectQuestions(candidates.rows,test.rows[0].blueprint,suppliedSeed || test.rows[0].blueprint.seed || testId); }
  catch (error) { if (error.code?.startsWith("BLUEPRINT_")) throw new ApiError(422,error.message,error.details); throw error; }
  return assignQuestions(testId,selected.map((item)=>item.id),actorId);
}

async function transitionTest(id, action, actorId) {
  if(action==="RELEASE_RESULTS") {
    const released=await pool.query("UPDATE tests SET result_released_at=NOW(),updated_at=NOW() WHERE id=$1 AND lifecycle_status IN ('PUBLISHED','CLOSED') RETURNING *",[id]);
    if(!released.rows[0]) throw new ApiError(409,"Results can only be released for a published or closed test");
    await audit(actorId,"RELEASE_RESULTS","test",id);
    return mapTest(released.rows[0]);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM tests WHERE id=$1 FOR UPDATE",[id]);
    const test=current.rows[0]; if(!test) throw new ApiError(404,"Test not found");
    const transitions={ DRAFT:["PUBLISH","ARCHIVE"],SCHEDULED:["PUBLISH","UNPUBLISH","ARCHIVE"],PUBLISHED:["UNPUBLISH","CLOSE"],CLOSED:["ARCHIVE"],ARCHIVED:[] };
    if(!transitions[test.lifecycle_status].includes(action)) throw new ApiError(409,`Cannot ${action.toLowerCase()} a ${test.lifecycle_status.toLowerCase()} test`);
    let next={PUBLISH:(test.starts_at && new Date(test.starts_at)>new Date())?"SCHEDULED":"PUBLISHED",UNPUBLISH:"DRAFT",CLOSE:"CLOSED",ARCHIVE:"ARCHIVED"}[action];
    if(action==="PUBLISH") {
      const validation=await client.query(`SELECT COUNT(DISTINCT tq.question_id)::int AS questions,(SELECT COUNT(*)::int FROM test_sections WHERE test_id=$1) AS sections,COUNT(DISTINCT q.id) FILTER (WHERE qc.correct_count=0 OR (q.question_type='SINGLE_CORRECT' AND qc.correct_count<>1))::int AS invalid FROM test_questions tq JOIN questions q ON q.id=tq.question_id LEFT JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE qo.is_correct)::int AS correct_count FROM question_options qo WHERE qo.question_id=q.id) qc ON true WHERE tq.test_id=$1`,[id]);
      const row=validation.rows[0]; const errors=[];
      if(!row.questions) errors.push("At least one active question must be assigned");
      if(!row.sections) errors.push("At least one section is required");
      if(row.invalid) errors.push(`${row.invalid} question(s) have invalid correct answers`);
      if(test.duration_minutes<=0) errors.push("Duration must be greater than zero");
      if(test.ends_at && test.starts_at && new Date(test.ends_at)<=new Date(test.starts_at)) errors.push("Schedule is invalid");
      if(errors.length) throw new ApiError(422,"Test cannot be published",errors);
    }
    const result=await client.query("UPDATE tests SET lifecycle_status=$2,published_at=CASE WHEN $2 IN ('PUBLISHED','SCHEDULED') THEN COALESCE(published_at,NOW()) ELSE published_at END,updated_at=NOW() WHERE id=$1 RETURNING *",[id,next]);
    await client.query("COMMIT"); await audit(actorId,action,"test",id,{ from:test.lifecycle_status,to:next }); return mapTest(result.rows[0]);
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

module.exports={ listSeries,getSeries,createSeries,updateSeries,archiveSeries,listTests,getTest,createTest,updateTest,replaceSections,getSeriesMembership,replaceSeriesMembership,listQuestions,saveQuestion,importQuestions,archiveQuestion,assignQuestions,generateFromBlueprint,transitionTest };

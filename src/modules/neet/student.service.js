const crypto=require("crypto");
const pool=require("../../db/pool");
const ApiError=require("../../utils/apiError");
const {evaluateEligibility}=require("./engines/eligibilityEngine");
const {evaluateAttempt}=require("./engines/scoringEngine");
const accessService=require("../commerce/access.service");

function publicSeries(row) {
  return { id:row.id,slug:row.slug,title:row.title,shortName:row.short_name,description:row.description,thumbnailUrl:row.thumbnail_url,bannerUrl:row.banner_url,category:row.category,examType:row.exam_type,targetClass:row.target_class,targetExam:row.target_exam,language:row.language,tags:row.tags||[],difficulty:row.difficulty,authorName:row.author_name,accessType:row.access_type,price:Number(row.price),startsAt:row.starts_at,endsAt:row.ends_at,instructions:row.instructions||{},testsCount:Number(row.tests_count||0),totalQuestions:Number(row.total_questions||0),totalDuration:Number(row.total_duration||0) };
}

async function listPublishedSeries() {
  const result=await pool.query(`SELECT ts.*,COUNT(t.id)::int AS tests_count,COALESCE(SUM(t.total_questions),0)::int AS total_questions,COALESCE(SUM(t.duration_minutes),0)::int AS total_duration FROM test_series ts LEFT JOIN test_series_tests tst ON tst.series_id=ts.id AND tst.is_active=true LEFT JOIN tests t ON t.id=tst.test_id AND t.lifecycle_status IN ('PUBLISHED','SCHEDULED','CLOSED') WHERE ts.lifecycle_status='PUBLISHED' AND ts.published=true AND (ts.starts_at IS NULL OR ts.starts_at<=NOW()) AND (ts.ends_at IS NULL OR ts.ends_at>NOW()) GROUP BY ts.id ORDER BY ts.display_order,ts.updated_at DESC`);
  return result.rows.map(publicSeries);
}

function availability(test,row,userId,access) {
  if(test.starts_at && new Date(test.starts_at)>new Date()) return "UPCOMING";
  if(test.ends_at && new Date(test.ends_at)<=new Date()) return "CLOSED";
  if(!access?.allowed) return access?.reason==="PAYMENT_REQUIRED" ? "PURCHASE_REQUIRED" : "LOCKED";
  if(row.active_attempt_id) return "IN_PROGRESS";
  if(test.max_attempts && Number(row.attempt_count)>=test.max_attempts) return "NO_ATTEMPTS_LEFT";
  if(row.latest_result_id) return "COMPLETED";
  return test.lifecycle_status==="PUBLISHED" ? "AVAILABLE" : "LOCKED";
}

async function getSeriesBySlug(slug,userId) {
  const seriesResult=await pool.query(`SELECT ts.*,COUNT(t.id)::int AS tests_count,COALESCE(SUM(t.total_questions),0)::int AS total_questions,COALESCE(SUM(t.duration_minutes),0)::int AS total_duration FROM test_series ts LEFT JOIN test_series_tests tst ON tst.series_id=ts.id AND tst.is_active=true LEFT JOIN tests t ON t.id=tst.test_id AND t.lifecycle_status IN ('PUBLISHED','SCHEDULED','CLOSED') WHERE ts.slug=$1 AND ts.lifecycle_status='PUBLISHED' AND ts.published=true GROUP BY ts.id`,[slug]);
  if(!seriesResult.rows[0]) throw new ApiError(404,"Test series not found");
  const series=seriesResult.rows[0];
  const tests=await pool.query(`SELECT t.*,ts.access_type,tsg.title AS group_title,COALESCE(a.attempt_count,0)::int AS attempt_count,a.active_attempt_id,a.latest_result_id,a.latest_attempt_id,a.latest_score
    FROM test_series_tests tst JOIN tests t ON t.id=tst.test_id JOIN test_series ts ON ts.id=tst.series_id LEFT JOIN test_series_groups tsg ON tsg.id=tst.group_id
    LEFT JOIN LATERAL (SELECT
      (SELECT COUNT(*)::int FROM test_attempts ta WHERE ta.test_id=t.id AND ta.user_id=$2) AS attempt_count,
      (SELECT ta.id FROM test_attempts ta WHERE ta.test_id=t.id AND ta.user_id=$2 AND ta.status='ACTIVE' ORDER BY ta.started_at DESC LIMIT 1) AS active_attempt_id,
      (SELECT tr.id FROM test_results tr WHERE tr.test_id=t.id AND tr.user_id=$2 ORDER BY tr.generated_at DESC LIMIT 1) AS latest_result_id,
      (SELECT tr.attempt_id FROM test_results tr WHERE tr.test_id=t.id AND tr.user_id=$2 ORDER BY tr.generated_at DESC LIMIT 1) AS latest_attempt_id,
      (SELECT tr.score FROM test_results tr WHERE tr.test_id=t.id AND tr.user_id=$2 ORDER BY tr.generated_at DESC LIMIT 1) AS latest_score) a ON true
    WHERE tst.series_id=$1 AND tst.is_active=true AND t.lifecycle_status IN ('PUBLISHED','SCHEDULED','CLOSED') ORDER BY tsg.sort_order NULLS LAST,tst.sort_order,t.starts_at NULLS FIRST,t.created_at`,[series.id,userId||null]);
  const accessDecisions=await Promise.all(tests.rows.map((row)=>accessService.canAccessTest(userId,row.id)));
  const productResult=await pool.query(`SELECT p.* FROM products p JOIN product_items pi ON pi.product_id=p.id WHERE pi.test_series_id=$1 AND p.status='ACTIVE' ORDER BY p.updated_at DESC LIMIT 1`,[series.id]);
  const product=productResult.rows[0]?{id:productResult.rows[0].id,slug:productResult.rows[0].slug,title:productResult.rows[0].title,currency:productResult.rows[0].currency,priceMinor:Number(productResult.rows[0].price_minor),compareAtPriceMinor:productResult.rows[0].compare_at_price_minor==null?null:Number(productResult.rows[0].compare_at_price_minor),accessType:productResult.rows[0].access_type,durationDays:productResult.rows[0].duration_days}:null;
  const productAccess=product&&userId?await accessService.productAccess(userId,product.id):{active:false};
  const completed=tests.rows.filter((row)=>row.latest_result_id).length;
  return {...publicSeries(series),product,access:productAccess,completedTests:completed,progress:tests.rowCount?Math.round(completed/tests.rowCount*100):0,tests:tests.rows.map((row,index)=>({id:row.id,groupTitle:row.group_title,code:row.code,name:row.name,description:row.description,totalQuestions:row.total_questions,totalMarks:Number(row.total_marks),durationMinutes:row.duration_minutes,passingMarks:Number(row.passing_marks),maxAttempts:row.max_attempts,startsAt:row.starts_at,endsAt:row.ends_at,status:availability(row,row,userId,accessDecisions[index]),access:accessDecisions[index],attemptCount:row.attempt_count,activeAttemptId:row.active_attempt_id,resultId:row.latest_result_id,resultAttemptId:row.latest_attempt_id,score:row.latest_score==null?null:Number(row.latest_score)}))};
}

async function getTestDetails(id,userId) {
  const result=await pool.query(`SELECT t.*,ts.title AS series_title,ts.slug AS series_slug,ts.access_type,ts.course_id
    FROM tests t JOIN LATERAL (
      SELECT mapped.title,mapped.slug,mapped.access_type,mapped.course_id
      FROM test_series_tests tst JOIN test_series mapped ON mapped.id=tst.series_id
      WHERE tst.test_id=t.id AND tst.is_active=true AND mapped.lifecycle_status='PUBLISHED' AND mapped.published=true
      ORDER BY (mapped.id=t.series_id) DESC,tst.sort_order LIMIT 1
    ) ts ON true WHERE t.id=$1`,[id]);
  const test=result.rows[0]; if(!test) throw new ApiError(404,"Test not found");
  let attempts=0,active=null,latest=null,enrollment=null,explicit=false;
  if(userId) {
    const data=await Promise.all([
      pool.query("SELECT COUNT(*)::int AS total,(SELECT id FROM test_attempts WHERE test_id=$1 AND user_id=$2 AND status='ACTIVE' ORDER BY started_at DESC LIMIT 1) AS active FROM test_attempts WHERE test_id=$1 AND user_id=$2",[id,userId]),
      pool.query("SELECT tr.id,tr.score,tr.percentage FROM test_results tr JOIN test_attempts ta ON ta.id=tr.attempt_id WHERE ta.test_id=$1 AND ta.user_id=$2 ORDER BY tr.generated_at DESC LIMIT 1",[id,userId]),
      test.course_id?pool.query("SELECT status FROM enrollments WHERE course_id=$1 AND student_id=$2",[test.course_id,userId]):Promise.resolve({rows:[]}),
      pool.query("SELECT 1 FROM test_eligible_users WHERE test_id=$1 AND user_id=$2",[id,userId]),
    ]);
    attempts=data[0].rows[0].total; active=data[0].rows[0].active; latest=data[1].rows[0]||null; enrollment=data[2].rows[0]||null; explicit=Boolean(data[3].rows[0]);
  }
  const check=evaluateEligibility({test:{lifecycleStatus:test.lifecycle_status,startsAt:test.starts_at,endsAt:test.ends_at,maxAttempts:test.max_attempts,eligibility:{...test.eligibility,...(test.course_id?{courseId:test.course_id}:{})}},user:userId?{id:userId}:null,enrollment,attempts,explicitlyEligible:explicit});
  const access=await accessService.canAccessTest(userId,id);
  const reasons=[...check.reasons,...(!access.allowed&&access.reason&&!check.reasons.includes(access.reason)?[access.reason]:[])];
  const productResult=await pool.query(`SELECT p.id,p.slug,p.title,p.currency,p.price_minor,p.compare_at_price_minor,p.access_type,p.duration_days FROM products p JOIN product_items pi ON pi.product_id=p.id LEFT JOIN test_series_tests tst ON pi.test_series_id=tst.series_id WHERE p.status='ACTIVE' AND (pi.test_id=$1 OR tst.test_id=$1) ORDER BY CASE WHEN pi.test_id=$1 THEN 0 ELSE 1 END,p.price_minor LIMIT 1`,[id]);
  const p=productResult.rows[0];const product=p?{id:p.id,slug:p.slug,title:p.title,currency:p.currency,priceMinor:Number(p.price_minor),compareAtPriceMinor:p.compare_at_price_minor==null?null:Number(p.compare_at_price_minor),accessType:p.access_type,durationDays:p.duration_days}:null;
  return {id:test.id,seriesId:test.series_id,seriesTitle:test.series_title,seriesSlug:test.series_slug,code:test.code,name:test.name,description:test.description,instructions:test.instructions,totalQuestions:test.total_questions,totalMarks:Number(test.total_marks),durationMinutes:test.duration_minutes,passingMarks:Number(test.passing_marks),maxAttempts:test.max_attempts,resultVisibility:test.result_visibility,leaderboardEnabled:test.leaderboard_enabled,startsAt:test.starts_at,endsAt:test.ends_at,attemptsUsed:attempts,activeAttemptId:active,latestResult:latest?{id:latest.id,score:Number(latest.score),percentage:Number(latest.percentage)}:null,access,product,eligible:reasons.length===0,reasons};
}

function shuffle(items) {
  const result=[...items];
  for(let i=result.length-1;i>0;i-=1){const j=crypto.randomInt(i+1);[result[i],result[j]]=[result[j],result[i]];}
  return result;
}

function safeQuestion(row) {
  const snapshot=row.snapshot||{};
  const order=Array.isArray(row.option_order)?row.option_order:[];
  const options=(snapshot.options||[]).filter((item)=>order.includes(item.id)).sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id)).map(({id,optionText,imageUrl})=>({id,optionText,imageUrl}));
  return {id:row.id,number:row.sort_order+1,sectionName:row.section_name,subject:row.subject,questionText:snapshot.questionText,imageUrl:snapshot.imageUrl,questionType:row.question_type,options,selectedOptionIds:row.selected_option_ids||[],visited:Boolean(row.visited),markedForReview:Boolean(row.marked_for_review)};
}

async function hydrateAttempt(attemptId,userId) {
  const result=await pool.query("SELECT ta.*,t.name AS test_name FROM test_attempts ta JOIN tests t ON t.id=ta.test_id WHERE ta.id=$1 AND ta.user_id=$2",[attemptId,userId]);
  let attempt=result.rows[0]; if(!attempt) throw new ApiError(404,"Attempt not found");
  const entitlement=await accessService.canAccessTest(userId,attempt.test_id);if(!entitlement.allowed)throw new ApiError(403,"Test access is no longer active",[entitlement.reason]);
  if(attempt.status==="ACTIVE" && new Date(attempt.expires_at)<=new Date()) { await submitAttempt(attemptId,userId,[],true); attempt=(await pool.query("SELECT ta.*,t.name AS test_name FROM test_attempts ta JOIN tests t ON t.id=ta.test_id WHERE ta.id=$1",[attemptId])).rows[0]; }
  const questions=await pool.query(`SELECT aq.*,aa.selected_option_ids,aa.visited,aa.marked_for_review FROM attempt_questions aq LEFT JOIN attempt_answers aa ON aa.attempt_id=aq.attempt_id AND aa.attempt_question_id=aq.id WHERE aq.attempt_id=$1 ORDER BY aq.sort_order`,[attemptId]);
  return {id:attempt.id,testId:attempt.test_id,testName:attempt.test_name,attemptNumber:attempt.attempt_number,status:attempt.status,startedAt:attempt.started_at,expiresAt:attempt.expires_at,serverTime:new Date().toISOString(),submittedAt:attempt.submitted_at,questions:questions.rows.map(safeQuestion)};
}

async function startAttempt(testId,userId) {
  const client=await pool.connect(); let attemptId;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[userId]);
    const found=await client.query(`SELECT t.*,ts.lifecycle_status AS series_status,ts.access_type,ts.course_id
      FROM tests t JOIN LATERAL (
        SELECT mapped.lifecycle_status,mapped.access_type,mapped.course_id
        FROM test_series_tests tst JOIN test_series mapped ON mapped.id=tst.series_id
        WHERE tst.test_id=t.id AND tst.is_active=true AND mapped.lifecycle_status='PUBLISHED' AND mapped.published=true
        ORDER BY (mapped.id=t.series_id) DESC,tst.sort_order LIMIT 1
      ) ts ON true WHERE t.id=$1 FOR UPDATE OF t`,[testId]);
    const test=found.rows[0]; if(!test) throw new ApiError(404,"Test not found");
    const active=await client.query("SELECT * FROM test_attempts WHERE test_id=$1 AND user_id=$2 AND status='ACTIVE' FOR UPDATE",[testId,userId]);
    if(active.rows[0] && new Date(active.rows[0].expires_at)>new Date()) {
      if(!test.resume_enabled) throw new ApiError(409,"This test cannot be resumed and an active attempt already exists");
      attemptId=active.rows[0].id; await client.query("COMMIT"); return hydrateAttempt(attemptId,userId);
    }
    if(active.rows[0]) await finalizeWithClient(client,active.rows[0],true);
    const count=await client.query("SELECT COUNT(*)::int AS total FROM test_attempts WHERE test_id=$1 AND user_id=$2",[testId,userId]);
    const enrollment=test.course_id?(await client.query("SELECT status FROM enrollments WHERE course_id=$1 AND student_id=$2",[test.course_id,userId])).rows[0]:null;
    const explicit=Boolean((await client.query("SELECT 1 FROM test_eligible_users WHERE test_id=$1 AND user_id=$2",[testId,userId])).rows[0]);
    const eligibility=evaluateEligibility({test:{lifecycleStatus:test.lifecycle_status,startsAt:test.starts_at,endsAt:test.ends_at,maxAttempts:test.max_attempts,eligibility:{...test.eligibility,...(test.course_id?{courseId:test.course_id}:{})}},user:{id:userId},enrollment,attempts:count.rows[0].total,explicitlyEligible:explicit});
    if(!eligibility.eligible) throw new ApiError(403,"You cannot start this test",eligibility.reasons);
    const entitlement=await accessService.canAccessTest(userId,testId,client);
    if(!entitlement.allowed) throw new ApiError(403,"Purchase or active access is required",[entitlement.reason]);
    const bank=await client.query(`SELECT tq.sort_order,tq.marks AS override_marks,tq.incorrect_marks AS override_incorrect,ts.name AS section_name,q.*,json_agg(json_build_object('id',qo.id,'optionText',qo.option_text,'imageUrl',qo.image_url,'isCorrect',qo.is_correct) ORDER BY qo.sort_order) AS options FROM test_questions tq JOIN questions q ON q.id=tq.question_id LEFT JOIN test_sections ts ON ts.id=tq.section_id JOIN question_options qo ON qo.question_id=q.id WHERE tq.test_id=$1 AND q.status='ACTIVE' GROUP BY tq.sort_order,tq.marks,tq.incorrect_marks,ts.name,q.id ORDER BY tq.sort_order`,[testId]);
    if(!bank.rowCount) throw new ApiError(409,"This test has no available questions");
    let questions=test.shuffle_questions?shuffle(bank.rows):bank.rows;
    const snapshot={testId:test.id,name:test.name,code:test.code,version:test.version,durationMinutes:test.duration_minutes,resultVisibility:test.result_visibility,explanationVisibility:test.explanation_visibility,answerKeyVisibility:test.answer_key_visibility,leaderboardEnabled:test.leaderboard_enabled,integritySettings:test.integrity_settings};
    const created=await client.query("INSERT INTO test_attempts(test_id,user_id,attempt_number,expires_at,test_snapshot) VALUES($1,$2,$3,NOW()+($4::text||' minutes')::interval,$5) RETURNING id",[testId,userId,count.rows[0].total+1,test.duration_minutes,snapshot]);
    attemptId=created.rows[0].id;
    for(let index=0;index<questions.length;index+=1){
      const q=questions[index];
      const opts=test.shuffle_options?shuffle(q.options):q.options;
      const qSnapshot={questionText:q.question_text,imageUrl:q.image_url,explanation:q.explanation,solution:q.solution,hint:q.hint,options:q.options.map((o)=>({id:o.id,optionText:o.optionText,imageUrl:o.imageUrl})),correctOptionIds:q.options.filter((o)=>o.isCorrect).map((o)=>o.id)};
      await client.query(`INSERT INTO attempt_questions(attempt_id,source_question_id,section_name,subject,chapter,topic,difficulty,question_type,snapshot,sort_order,option_order,marks,incorrect_marks,unanswered_marks) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[attemptId,q.id,q.section_name,q.subject,q.chapter,q.topic,q.difficulty,q.question_type,qSnapshot,index,JSON.stringify(opts.map((o)=>o.id)),q.override_marks??q.marks??test.correct_marks,q.override_incorrect??-Number(q.negative_marks??Math.abs(test.incorrect_marks)),test.unanswered_marks]);
    }
    await client.query("COMMIT");
  } catch(error){await client.query("ROLLBACK"); if(error.code==="40001"||error.code==="23505") throw new ApiError(409,"A test attempt was started in another request. Open the active attempt."); throw error;} finally{client.release();}
  return hydrateAttempt(attemptId,userId);
}

async function upsertAnswerWithClient(client,attempt,answer) {
  const question=await client.query("SELECT option_order FROM attempt_questions WHERE id=$1 AND attempt_id=$2",[answer.attemptQuestionId,attempt.id]);
  if(!question.rows[0]) throw new ApiError(400,"Question does not belong to this attempt");
  const valid=new Set(question.rows[0].option_order.map(String));
  if(answer.selectedOptionIds.some((id)=>!valid.has(String(id)))) throw new ApiError(400,"One or more selected options are invalid");
  await client.query(`INSERT INTO attempt_answers(attempt_id,attempt_question_id,selected_option_ids,visited,marked_for_review,answered_at,time_spent_seconds) VALUES($1,$2,$3,$4,$5,CASE WHEN jsonb_array_length($3::jsonb)>0 THEN NOW() END,$6) ON CONFLICT(attempt_id,attempt_question_id) DO UPDATE SET selected_option_ids=EXCLUDED.selected_option_ids,visited=EXCLUDED.visited,marked_for_review=EXCLUDED.marked_for_review,answered_at=CASE WHEN jsonb_array_length(EXCLUDED.selected_option_ids)>0 THEN NOW() END,time_spent_seconds=GREATEST(attempt_answers.time_spent_seconds,EXCLUDED.time_spent_seconds),updated_at=NOW()`,[attempt.id,answer.attemptQuestionId,JSON.stringify(answer.selectedOptionIds),answer.visited,answer.markedForReview,answer.timeSpentSeconds]);
}

async function saveAnswer(attemptId,userId,answer) {
  const client=await pool.connect();
  try{await client.query("BEGIN");const found=await client.query("SELECT * FROM test_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE",[attemptId,userId]);const attempt=found.rows[0];if(!attempt)throw new ApiError(404,"Attempt not found");const entitlement=await accessService.canAccessTest(userId,attempt.test_id,client);if(!entitlement.allowed)throw new ApiError(403,"Test access is no longer active",[entitlement.reason]);if(attempt.status!=="ACTIVE")throw new ApiError(409,"This attempt is no longer active");if(new Date(attempt.expires_at)<=new Date())throw new ApiError(409,"Time has expired. Submit the attempt to see the result.");await upsertAnswerWithClient(client,attempt,answer);await client.query("COMMIT");return {saved:true,savedAt:new Date().toISOString(),attemptQuestionId:answer.attemptQuestionId};}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

function visibilityAllowed(mode,test,now=new Date()) { if(mode==="NEVER") return false; if(mode==="MANUAL_RELEASE") return Boolean(test.result_released_at); if(mode==="AFTER_TEST_END") return Boolean(test.ends_at&&new Date(test.ends_at)<=now)||Boolean(test.result_released_at); return true; }

async function finalizeWithClient(client,attempt,autoSubmitted) {
  const existing=await client.query("SELECT id FROM test_results WHERE attempt_id=$1",[attempt.id]);
  if(existing.rows[0]) return existing.rows[0].id;
  const rows=await client.query(`SELECT aq.*,aa.selected_option_ids FROM attempt_questions aq LEFT JOIN attempt_answers aa ON aa.attempt_id=aq.attempt_id AND aa.attempt_question_id=aq.id WHERE aq.attempt_id=$1 ORDER BY aq.sort_order`,[attempt.id]);
  const evaluated=evaluateAttempt(rows.rows.map((row)=>({attemptQuestionId:row.id,subject:row.subject,topic:row.topic,difficulty:row.difficulty,marks:row.marks,incorrectMarks:row.incorrect_marks,unansweredMarks:row.unanswered_marks,correctOptionIds:row.snapshot.correctOptionIds,selectedOptionIds:row.selected_option_ids||[]})));
  const submittedAt=new Date(); const timeTaken=Math.max(0,Math.min(Math.floor((submittedAt-new Date(attempt.started_at))/1000),Math.floor((new Date(attempt.expires_at)-new Date(attempt.started_at))/1000)));
  await client.query(`UPDATE test_attempts SET status=$2,submitted_at=$3,auto_submitted=$4,score=$5,max_score=$6,percentage=$7,accuracy=$8,correct_count=$9,incorrect_count=$10,unanswered_count=$11,time_taken_seconds=$12,updated_at=NOW() WHERE id=$1`,[attempt.id,autoSubmitted?"EXPIRED":"SUBMITTED",submittedAt,autoSubmitted,evaluated.score,evaluated.maxScore,evaluated.percentage,evaluated.accuracy,evaluated.correct,evaluated.incorrect,evaluated.unanswered,timeTaken]);
  const result=await client.query(`INSERT INTO test_results(attempt_id,test_id,user_id,score,max_score,percentage,accuracy,correct_count,incorrect_count,unanswered_count,attempted_count,breakdown) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,[attempt.id,attempt.test_id,attempt.user_id,evaluated.score,evaluated.maxScore,evaluated.percentage,evaluated.accuracy,evaluated.correct,evaluated.incorrect,evaluated.unanswered,evaluated.attempted,evaluated.breakdown]);
  for(const qr of evaluated.questionResults) await client.query("INSERT INTO question_results(result_id,attempt_question_id,outcome,awarded_marks,selected_option_ids) VALUES($1,$2,$3,$4,$5)",[result.rows[0].id,qr.attemptQuestionId,qr.outcome,qr.awardedMarks,JSON.stringify(qr.selectedOptionIds)]);
  await client.query(`WITH ranked AS (SELECT tr.id,ROW_NUMBER() OVER(ORDER BY tr.score DESC,tr.accuracy DESC,ta.time_taken_seconds ASC,ta.submitted_at ASC,ta.id ASC)::int AS position FROM test_results tr JOIN test_attempts ta ON ta.id=tr.attempt_id WHERE tr.test_id=$1) UPDATE test_results tr SET rank=ranked.position FROM ranked WHERE tr.id=ranked.id`,[attempt.test_id]);
  return result.rows[0].id;
}

async function submitAttempt(attemptId,userId,answers=[],forceAuto=false) {
  const client=await pool.connect(); let resultId;
  try{await client.query("BEGIN");const found=await client.query("SELECT * FROM test_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE",[attemptId,userId]);const attempt=found.rows[0];if(!attempt)throw new ApiError(404,"Attempt not found");if(!forceAuto){const entitlement=await accessService.canAccessTest(userId,attempt.test_id,client);if(!entitlement.allowed)throw new ApiError(403,"Test access is no longer active",[entitlement.reason]);}const existing=await client.query("SELECT id FROM test_results WHERE attempt_id=$1",[attemptId]);if(existing.rows[0]){resultId=existing.rows[0].id;await client.query("COMMIT");return getResult(attemptId,userId);}if(attempt.status!=="ACTIVE")throw new ApiError(409,"Attempt cannot be submitted");for(const answer of answers)await upsertAnswerWithClient(client,attempt,answer);const auto=forceAuto||new Date(attempt.expires_at)<=new Date();resultId=await finalizeWithClient(client,attempt,auto);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return getResult(attemptId,userId);
}

async function getResult(attemptId,userId) {
  const result=await pool.query(`SELECT tr.*,ta.attempt_number,ta.started_at,ta.expires_at,ta.submitted_at,ta.time_taken_seconds,ta.auto_submitted,ta.test_snapshot,t.name AS test_name,t.ends_at,t.result_released_at,t.result_visibility,t.answer_key_visibility,t.explanation_visibility,t.leaderboard_enabled FROM test_results tr JOIN test_attempts ta ON ta.id=tr.attempt_id JOIN tests t ON t.id=tr.test_id WHERE tr.attempt_id=$1 AND tr.user_id=$2`,[attemptId,userId]);
  const row=result.rows[0];if(!row)throw new ApiError(404,"Result is not available");const entitlement=await accessService.canAccessTest(userId,row.test_id);if(!entitlement.allowed)throw new ApiError(403,"Test access is no longer active",[entitlement.reason]);
  if(!visibilityAllowed(row.result_visibility,row)) throw new ApiError(403,"Result has not been released yet");
  return {id:row.id,attemptId,attemptNumber:row.attempt_number,testId:row.test_id,testName:row.test_name,score:Number(row.score),maxScore:Number(row.max_score),percentage:Number(row.percentage),accuracy:Number(row.accuracy),correct:row.correct_count,incorrect:row.incorrect_count,unanswered:row.unanswered_count,attempted:row.attempted_count,totalQuestions:row.correct_count+row.incorrect_count+row.unanswered_count,rank:row.test_snapshot.leaderboardEnabled?row.rank:null,startedAt:row.started_at,submittedAt:row.submitted_at,timeTakenSeconds:row.time_taken_seconds,autoSubmitted:row.auto_submitted,breakdown:row.breakdown,reviewAvailable:visibilityAllowed(row.answer_key_visibility,row)};
}

async function getReview(attemptId,userId) {
  const header=await pool.query(`SELECT t.id AS test_id,t.answer_key_visibility,t.explanation_visibility,t.ends_at,t.result_released_at FROM test_attempts ta JOIN tests t ON t.id=ta.test_id WHERE ta.id=$1 AND ta.user_id=$2 AND ta.status IN ('SUBMITTED','EXPIRED')`,[attemptId,userId]);
  const test=header.rows[0];if(!test)throw new ApiError(404,"Submitted attempt not found");const entitlement=await accessService.canAccessTest(userId,test.test_id);if(!entitlement.allowed)throw new ApiError(403,"Test access is no longer active",[entitlement.reason]);const showAnswer=visibilityAllowed(test.answer_key_visibility,test);const showExplanation=visibilityAllowed(test.explanation_visibility,test);if(!showAnswer&&!showExplanation)throw new ApiError(403,"Answer review has not been released yet");
  const rows=await pool.query(`SELECT aq.*,qr.outcome,qr.awarded_marks,qr.selected_option_ids FROM attempt_questions aq JOIN question_results qr ON qr.attempt_question_id=aq.id JOIN test_results tr ON tr.id=qr.result_id WHERE aq.attempt_id=$1 AND tr.user_id=$2 ORDER BY aq.sort_order`,[attemptId,userId]);
  return rows.rows.map((row)=>({id:row.id,number:row.sort_order+1,subject:row.subject,topic:row.topic,difficulty:row.difficulty,questionText:row.snapshot.questionText,imageUrl:row.snapshot.imageUrl,options:row.snapshot.options,selectedOptionIds:row.selected_option_ids,outcome:row.outcome,awardedMarks:Number(row.awarded_marks),...(showAnswer?{correctOptionIds:row.snapshot.correctOptionIds}:{}),...(showExplanation?{explanation:row.snapshot.explanation,solution:row.snapshot.solution}:{} )}));
}

async function leaderboard(testId) {
  const enabled=await pool.query("SELECT leaderboard_enabled FROM tests WHERE id=$1",[testId]);if(!enabled.rows[0])throw new ApiError(404,"Test not found");if(!enabled.rows[0].leaderboard_enabled)throw new ApiError(403,"Leaderboard is disabled");
  const result=await pool.query(`SELECT tr.rank,u.full_name,tr.score,tr.max_score,tr.percentage,tr.accuracy,ta.time_taken_seconds,ta.attempt_number FROM test_results tr JOIN users u ON u.id=tr.user_id JOIN test_attempts ta ON ta.id=tr.attempt_id WHERE tr.test_id=$1 ORDER BY tr.rank LIMIT 100`,[testId]);
  return result.rows.map((row)=>({rank:row.rank,studentName:row.full_name.split(" ").map((part,index)=>index?`${part[0]}.`:part).join(" "),score:Number(row.score),maxScore:Number(row.max_score),percentage:Number(row.percentage),accuracy:Number(row.accuracy),timeTakenSeconds:row.time_taken_seconds,attemptNumber:row.attempt_number}));
}

async function recordEvent(attemptId,userId,event) { const result=await pool.query(`UPDATE test_attempts SET suspicious_events=suspicious_events||$3::jsonb WHERE id=$1 AND user_id=$2 AND status='ACTIVE' RETURNING id`,[attemptId,userId,JSON.stringify([{...event,receivedAt:new Date().toISOString()}])]);if(!result.rows[0])throw new ApiError(404,"Active attempt not found");return {recorded:true}; }

async function expireDueAttempts() {
  const due=await pool.query("SELECT id,user_id FROM test_attempts WHERE status='ACTIVE' AND expires_at<=NOW() ORDER BY expires_at LIMIT 100");
  for(const row of due.rows){try{await submitAttempt(row.id,row.user_id,[],true);}catch(error){console.error("Could not auto-submit expired attempt",{attemptId:row.id,message:error.message});}}
  return due.rowCount;
}

module.exports={listPublishedSeries,getSeriesBySlug,getTestDetails,startAttempt,hydrateAttempt,saveAnswer,submitAttempt,getResult,getReview,leaderboard,recordEvent,expireDueAttempts};

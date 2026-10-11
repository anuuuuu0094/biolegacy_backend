const pool=require("../db/pool");
const service=require("../modules/neet/student.service");

async function cleanup(userId){
  if(!userId)return;
  const attempts=await pool.query("SELECT id FROM test_attempts WHERE user_id=$1",[userId]);
  const ids=attempts.rows.map((row)=>row.id);
  if(ids.length){
    await pool.query("DELETE FROM question_results WHERE result_id IN (SELECT id FROM test_results WHERE user_id=$1)",[userId]);
    await pool.query("DELETE FROM test_results WHERE user_id=$1",[userId]);
    await pool.query("DELETE FROM attempt_answers WHERE attempt_id=ANY($1::uuid[])",[ids]);
    await pool.query("DELETE FROM attempt_questions WHERE attempt_id=ANY($1::uuid[])",[ids]);
    await pool.query("DELETE FROM test_attempts WHERE user_id=$1",[userId]);
  }
  await pool.query("DELETE FROM users WHERE id=$1",[userId]);
}

async function run(){
  if(process.env.NODE_ENV==="production")throw new Error("The E2E smoke test is development-only");
  let userId;
  try{
    const user=await pool.query("INSERT INTO users(full_name,email,role,status,email_verified) VALUES($1,$2,'STUDENT','ACTIVE',true) RETURNING id",["NEET E2E Smoke Student",`neet-smoke-${Date.now()}@example.invalid`]);
    userId=user.rows[0].id;
    const test=(await pool.query("SELECT id FROM tests WHERE lifecycle_status='PUBLISHED' ORDER BY created_at LIMIT 1")).rows[0];
    if(!test)throw new Error("No published test is available. Run npm run db:seed-neet first.");
    const attempt=await service.startAttempt(test.id,userId);
    if(attempt.status!=="ACTIVE"||!attempt.questions.length)throw new Error("Attempt did not start with questions");
    const internal=await pool.query("SELECT snapshot FROM attempt_questions WHERE id=$1",[attempt.questions[0].id]);
    const correctOptionId=internal.rows[0].snapshot.correctOptionIds[0];
    await service.saveAnswer(attempt.id,userId,{attemptQuestionId:attempt.questions[0].id,selectedOptionIds:[correctOptionId],visited:true,markedForReview:false,timeSpentSeconds:2});
    const result=await service.submitAttempt(attempt.id,userId,[]);
    if(result.correct!==1||result.score<=0)throw new Error(`Unexpected score: ${result.score}`);
    const duplicate=await service.submitAttempt(attempt.id,userId,[]);
    if(duplicate.id!==result.id)throw new Error("Duplicate submit was not idempotent");
    console.log(`NEET E2E smoke passed: attempt started, answer saved, score ${result.score}, duplicate submit reused result.`);
  }finally{
    await cleanup(userId);
    await pool.end();
  }
}
run().catch((error)=>{console.error(error);process.exitCode=1;});

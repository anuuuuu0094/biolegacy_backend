function uniqueSorted(values = []) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function sameAnswer(left, right) {
  const a = uniqueSorted(left);
  const b = uniqueSorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function emptyBucket() {
  return { marks: 0, maxMarks: 0, correct: 0, incorrect: 0, unanswered: 0, attempted: 0, accuracy: 0 };
}

function addToBucket(bucket, outcome, marks, maxMarks) {
  bucket.marks += marks;
  bucket.maxMarks += maxMarks;
  if (outcome === "CORRECT") bucket.correct += 1;
  if (outcome === "INCORRECT") bucket.incorrect += 1;
  if (outcome === "UNANSWERED") bucket.unanswered += 1;
  if (outcome !== "UNANSWERED") bucket.attempted += 1;
  bucket.accuracy = bucket.attempted ? Number(((bucket.correct / bucket.attempted) * 100).toFixed(3)) : 0;
}

function evaluateAttempt(questions) {
  const breakdown = { subjects: {}, topics: {}, difficulties: {} };
  const questionResults = [];
  let score = 0;
  let maxScore = 0;
  let correct = 0;
  let incorrect = 0;
  let unanswered = 0;

  for (const question of questions) {
    const selected = uniqueSorted(question.selectedOptionIds);
    const expected = uniqueSorted(question.correctOptionIds);
    let outcome;
    let awardedMarks;
    if (!selected.length) {
      outcome = "UNANSWERED";
      awardedMarks = Number(question.unansweredMarks || 0);
      unanswered += 1;
    } else if (sameAnswer(selected, expected)) {
      outcome = "CORRECT";
      awardedMarks = Number(question.marks || 0);
      correct += 1;
    } else {
      outcome = "INCORRECT";
      awardedMarks = Number(question.incorrectMarks || 0);
      incorrect += 1;
    }
    const questionMax = Number(question.marks || 0);
    score += awardedMarks;
    maxScore += questionMax;
    questionResults.push({
      attemptQuestionId: question.attemptQuestionId,
      outcome,
      awardedMarks,
      selectedOptionIds: selected,
    });

    for (const [group, key] of [
      [breakdown.subjects, question.subject || "Uncategorised"],
      [breakdown.topics, question.topic || "Uncategorised"],
      [breakdown.difficulties, question.difficulty || "MEDIUM"],
    ]) {
      group[key] ||= emptyBucket();
      addToBucket(group[key], outcome, awardedMarks, questionMax);
    }
  }

  const attempted = correct + incorrect;
  return {
    score: Number(score.toFixed(2)),
    maxScore: Number(maxScore.toFixed(2)),
    percentage: maxScore ? Number(((score / maxScore) * 100).toFixed(3)) : 0,
    accuracy: attempted ? Number(((correct / attempted) * 100).toFixed(3)) : 0,
    correct,
    incorrect,
    unanswered,
    attempted,
    breakdown,
    questionResults,
  };
}

module.exports = { evaluateAttempt, sameAnswer };

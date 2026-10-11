function compareResults(a, b) {
  return Number(b.score) - Number(a.score)
    || Number(b.accuracy) - Number(a.accuracy)
    || Number(a.timeTakenSeconds) - Number(b.timeTakenSeconds)
    || new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
    || String(a.attemptId).localeCompare(String(b.attemptId));
}

function rankResults(results) {
  return [...results].sort(compareResults).map((result, index) => ({ ...result, rank: index + 1 }));
}

module.exports = { compareResults, rankResults };

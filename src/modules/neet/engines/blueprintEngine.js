const crypto = require("crypto");

function seededRandom(seed) {
  let state = crypto.createHash("sha256").update(String(seed || crypto.randomUUID())).digest().readUInt32LE(0);
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function selectQuestions(candidates, blueprint = {}, seed) {
  const random = seededRandom(seed);
  const active = candidates.filter((item) => item.status === "ACTIVE");
  const selected = [];
  const used = new Set();
  const errors = [];
  const subjectRules = Array.isArray(blueprint.subjects) ? blueprint.subjects : [];

  function take(pool, count, label) {
    const available = shuffle(pool.filter((item) => !used.has(item.id)), random);
    if (available.length < count) {
      errors.push({ constraint: label, required: count, available: available.length });
      return;
    }
    available.slice(0, count).forEach((item) => { used.add(item.id); selected.push(item); });
  }

  for (const rule of subjectRules) {
    const subjectPool = active.filter((item) => item.subject === rule.subject);
    const chapterRules = Array.isArray(rule.chapters) ? rule.chapters : [];
    for (const chapter of chapterRules) {
      take(subjectPool.filter((item) => item.chapter === chapter.chapter), Number(chapter.count || 0), `${rule.subject}/${chapter.chapter}`);
    }
    const difficulty = rule.difficulty || {};
    for (const level of ["EASY", "MEDIUM", "HARD"]) {
      const required = Number(difficulty[level] || 0);
      if (required) take(subjectPool.filter((item) => item.difficulty === level), required, `${rule.subject}/${level}`);
    }
    const already = selected.filter((item) => item.subject === rule.subject).length;
    const remaining = Math.max(0, Number(rule.count || 0) - already);
    if (remaining) take(subjectPool, remaining, `${rule.subject}/total`);
  }

  const total = Number(blueprint.totalQuestions || subjectRules.reduce((sum, rule) => sum + Number(rule.count || 0), 0));
  if (!subjectRules.length && total) take(active, total, "totalQuestions");
  if (errors.length) {
    const error = new Error("The question bank cannot satisfy this blueprint");
    error.code = "BLUEPRINT_UNSATISFIED";
    error.details = errors;
    throw error;
  }
  if (total && selected.length !== total) {
    const error = new Error("Blueprint totals are inconsistent");
    error.code = "BLUEPRINT_INVALID";
    error.details = [{ constraint: "totalQuestions", required: total, selected: selected.length }];
    throw error;
  }
  return shuffle(selected, random);
}

module.exports = { selectQuestions };

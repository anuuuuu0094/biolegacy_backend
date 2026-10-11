function evaluateEligibility({ test, user, enrollment, attempts, explicitlyEligible, now = new Date() }) {
  const reasons = [];
  if (!user) reasons.push("AUTHENTICATION_REQUIRED");
  if (test.lifecycleStatus !== "PUBLISHED") reasons.push("NOT_PUBLISHED");
  if (test.startsAt && now < new Date(test.startsAt)) reasons.push("UPCOMING");
  if (test.endsAt && now >= new Date(test.endsAt)) reasons.push("CLOSED");
  if (test.maxAttempts && attempts >= test.maxAttempts) reasons.push("NO_ATTEMPTS_LEFT");
  const rules = test.eligibility || {};
  if (rules.courseId && enrollment?.status !== "ACTIVE" && enrollment?.status !== "COMPLETED") reasons.push("ENROLLMENT_REQUIRED");
  if (rules.selectedUsersOnly && !explicitlyEligible) reasons.push("NOT_SELECTED");
  if (rules.minimumPreviousScore != null && Number(rules.previousScore || 0) < Number(rules.minimumPreviousScore)) reasons.push("PREREQUISITE_NOT_MET");
  return { eligible: reasons.length === 0, reasons };
}

module.exports = { evaluateEligibility };

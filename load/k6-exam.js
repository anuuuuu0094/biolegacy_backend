import http from "k6/http";
import { check, fail, sleep } from "k6";
import { SharedArray } from "k6/data";

const baseUrl = (__ENV.BASE_URL || "http://localhost:7000/api/v1").replace(/\/+$/, "");
const testId = __ENV.TEST_ID;
const usersFile = __ENV.USERS_FILE;
const viaBff = (__ENV.VIA_BFF || "false").toLowerCase() === "true";
const accessCookie = __ENV.ACCESS_COOKIE || "__Host-biolegacy_access";
const baseOrigin = (baseUrl.match(/^https?:\/\/[^/]+/) || [""])[0];

if (!testId) throw new Error("TEST_ID is required");
if (!usersFile) throw new Error("USERS_FILE is required");

const users = new SharedArray("staging users", () => JSON.parse(open(usersFile)));
if (users.length < 1000) throw new Error(`USERS_FILE must contain at least 1000 unique users; found ${users.length}`);

export const options = {
  scenarios: {
    active_exam: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "3m", target: 1000 },
        { duration: "8m", target: 1000 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
    "http_req_duration{name:save-answer}": ["p(95)<750"],
    checks: ["rate>0.99"],
  },
};

let attempt;

function requestOptions(token, name) {
  const authHeaders = viaBff
    ? { Cookie: `${accessCookie}=${token}`, Origin: baseOrigin, "Sec-Fetch-Site": "same-origin" }
    : { Authorization: `Bearer ${token}` };
  return {
    headers: { ...authHeaders, "Content-Type": "application/json" },
    tags: { name },
    timeout: "30s",
  };
}

export default function () {
  const user = users[(__VU - 1) % users.length];
  if (!user?.token) fail(`Missing token for VU ${__VU}`);

  if (!attempt) {
    const started = http.post(`${baseUrl}/tests/${testId}/start`, "{}", requestOptions(user.token, "start-attempt"));
    const valid = check(started, { "attempt started": (response) => response.status === 200 || response.status === 201 });
    if (!valid) fail(`Could not start attempt: ${started.status} ${started.body}`);
    attempt = started.json("data");
    if (!attempt?.questions?.length) fail("Start response did not contain questions");
  }

  const question = attempt.questions[__ITER % attempt.questions.length];
  const selectedOptionIds = question.options.length ? [question.options[__ITER % question.options.length].id] : [];
  const payload = JSON.stringify({
    attemptQuestionId: question.id,
    selectedOptionIds,
    visited: true,
    markedForReview: __ITER % 17 === 0,
    timeSpentSeconds: 30 + (__ITER % 90),
  });
  const saved = http.put(`${baseUrl}/attempts/${attempt.id}/answer`, payload, requestOptions(user.token, "save-answer"));
  check(saved, { "answer saved": (response) => response.status === 200 });
  sleep(2 + Math.random() * 4);
}

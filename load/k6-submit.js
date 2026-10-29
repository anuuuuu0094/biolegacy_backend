import http from "k6/http";
import { check, fail } from "k6";
import { SharedArray } from "k6/data";

const baseUrl = (__ENV.BASE_URL || "http://localhost:7000/api/v1").replace(/\/+$/, "");
const submissionsFile = __ENV.SUBMISSIONS_FILE;
const viaBff = (__ENV.VIA_BFF || "false").toLowerCase() === "true";
const accessCookie = __ENV.ACCESS_COOKIE || "__Host-biolegacy_access";
const baseOrigin = (baseUrl.match(/^https?:\/\/[^/]+/) || [""])[0];
if (!submissionsFile) throw new Error("SUBMISSIONS_FILE is required");

const submissions = new SharedArray("staging submissions", () => JSON.parse(open(submissionsFile)));
if (submissions.length < 1000) throw new Error(`SUBMISSIONS_FILE must contain at least 1000 attempts; found ${submissions.length}`);

export const options = {
  scenarios: {
    submit_burst: {
      executor: "per-vu-iterations",
      vus: 1000,
      iterations: 1,
      maxDuration: "2m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<3000"],
    checks: ["rate>0.99"],
  },
};

export default function () {
  const fixture = submissions[__VU - 1];
  if (!fixture?.token || !fixture?.attemptId || !Array.isArray(fixture.answers)) {
    fail(`Invalid submission fixture for VU ${__VU}`);
  }
  const response = http.post(
    `${baseUrl}/attempts/${fixture.attemptId}/submit`,
    JSON.stringify({ answers: fixture.answers }),
    {
      headers: {
        ...(viaBff
          ? { Cookie: `${accessCookie}=${fixture.token}`, Origin: baseOrigin, "Sec-Fetch-Site": "same-origin" }
          : { Authorization: `Bearer ${fixture.token}` }),
        "Content-Type": "application/json",
      },
      tags: { name: "submit-attempt" },
      timeout: "30s",
    },
  );
  check(response, { "attempt submitted": (result) => result.status === 200 });
}

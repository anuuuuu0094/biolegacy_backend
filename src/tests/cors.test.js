const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../app");
const env = require("../config/env");

test("CORS preflight allows a configured frontend origin", async () => {
  const originalOrigins = env.frontendUrls;
  const frontendOrigin = "https://biolegacy.vercel.app";
  const server = app.listen(0);
  env.frontendUrls = [frontendOrigin];
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/test-series/neet-rank-booster`,
      {
        method: "OPTIONS",
        headers: {
          Origin: frontendOrigin,
          "Access-Control-Request-Method": "GET",
        },
      }
    );
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), frontendOrigin);
  } finally {
    env.frontendUrls = originalOrigins;
    server.close();
  }
});

test("CORS preflight does not approve an unknown origin", async () => {
  const originalOrigins = env.frontendUrls;
  const server = app.listen(0);
  env.frontendUrls = ["https://biolegacy.vercel.app"];
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/test-series/neet-rank-booster`,
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.invalid",
          "Access-Control-Request-Method": "GET",
        },
      }
    );
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    env.frontendUrls = originalOrigins;
    server.close();
  }
});

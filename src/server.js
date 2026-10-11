const app = require("./app");
const env = require("./config/env");
const migrate = require("./db/migrate");
const { expireDueAttempts } = require("./modules/neet/student.service");

const retryableConnectionErrors = new Set([
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

function isConnectionError(error) {
  return retryableConnectionErrors.has(error.code)
    || /connection.*(?:timed? ?out|terminated)|terminated unexpectedly/i.test(error.message || "")
    || (error.cause && isConnectionError(error.cause))
    || (Array.isArray(error.errors) && error.errors.some(isConnectionError));
}

async function migrateWithRetry() {
  const delays = [2000, 5000];

  for (let attempt = 0; ; attempt += 1) {
    try {
      await migrate();
      return;
    } catch (error) {
      if (!isConnectionError(error) || attempt >= delays.length) {
        throw error;
      }

      console.warn(`Database connection failed (${error.code || "network error"}); retrying in ${delays[attempt] / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

async function start() {
  await migrateWithRetry();

  app.listen(env.port, () => {
    console.log(`BioLegacy API running on port ${env.port}`);
  });

  let expirySweepRunning = false;
  const expiryTimer = setInterval(async () => {
    if (expirySweepRunning) return;
    expirySweepRunning = true;
    try {
      await expireDueAttempts();
    } catch (error) {
      console.error("Expired-attempt sweep failed", {
        code: error.code,
        message: error.message,
      });
    } finally {
      expirySweepRunning = false;
    }
  }, 30_000);
  expiryTimer.unref();
}

start().catch((error) => {
  console.error("Failed to start API", error);
  process.exit(1);
});

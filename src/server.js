const env = require("./config/env");
const pool = require("./db/pool");
const migrate = require("./db/migrate");
const { connectRedis, closeRedis } = require("./cache/redis");

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
      if (!isConnectionError(error) || attempt >= delays.length) throw error;
      console.warn(`Database connection failed (${error.code || "network error"}); retrying in ${delays[attempt] / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

async function warmDatabasePool() {
  if (env.dbPoolMin === 0) return;
  const connections = await Promise.allSettled(
    Array.from({ length: env.dbPoolMin }, () => pool.connect()),
  );
  for (const result of connections) {
    if (result.status === "fulfilled") result.value.release();
  }
  const failed = connections.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  console.log(`PostgreSQL pool warmed with ${env.dbPoolMin} connections`);
}

async function start() {
  await connectRedis();
  if (env.runMigrationsOnStart) await migrateWithRetry();
  await warmDatabasePool();

  // Redis must be connected before rate-limit stores initialize with the app.
  const app = require("./app");
  const { expireDueAttempts } = require("./modules/neet/student.service");
  const server = app.listen(env.port, () => {
    console.log(`BioLegacy API running on port ${env.port}`);
  });

  server.requestTimeout = env.httpRequestTimeoutMs;
  server.headersTimeout = Math.min(15000, env.httpRequestTimeoutMs);
  server.keepAliveTimeout = 5000;

  let expirySweepRunning = false;
  const runExpirySweep = async () => {
    if (expirySweepRunning) return;
    expirySweepRunning = true;
    try {
      await expireDueAttempts(env.expirySweepBatchSize, env.expirySweepConcurrency);
    } catch (error) {
      console.error("Expired-attempt sweep failed", { code: error.code, message: error.message });
    } finally {
      expirySweepRunning = false;
    }
  };
  const expiryTimer = setInterval(runExpirySweep, env.expirySweepIntervalMs);
  expiryTimer.unref();

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(expiryTimer);
    console.log(`Received ${signal}; draining HTTP connections`);

    const forceTimer = setTimeout(() => {
      console.error("Graceful shutdown timed out");
      process.exit(1);
    }, env.shutdownGraceMs);
    forceTimer.unref();

    server.close(async (error) => {
      try {
        await Promise.allSettled([pool.end(), closeRedis()]);
        clearTimeout(forceTimer);
        process.exit(error ? 1 : 0);
      } catch (closeError) {
        console.error("Shutdown failed", closeError);
        process.exit(1);
      }
    });
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

start().catch(async (error) => {
  console.error("Failed to start API", error);
  await Promise.allSettled([pool.end(), closeRedis()]);
  process.exit(1);
});

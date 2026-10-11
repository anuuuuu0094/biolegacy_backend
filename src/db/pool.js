const { Pool } = require("pg");
const env = require("../config/env");

// Hosted PostgreSQL providers (including Render) require TLS. Keep local
// development databases on their usual non-TLS connection unless configured
// with a remote host.
const databaseHost = env.databaseUrl
  ? new URL(env.databaseUrl).hostname
  : env.db.host;
const useSsl = Boolean(databaseHost && !["localhost", "127.0.0.1", "::1"].includes(databaseHost));
const connectionOptions = {
  connectionTimeoutMillis: env.dbConnectionTimeoutMs,
  query_timeout: env.dbQueryTimeoutMs,
  keepAlive: true,
};

const pool = new Pool(
  env.databaseUrl
    ? {
        connectionString: env.databaseUrl,
        ...connectionOptions,
        ...(useSsl && { ssl: { rejectUnauthorized: true } }),
      }
    : {
        ...connectionOptions,
        user: env.db.user,
        password: env.db.password,
        host: env.db.host,
        database: env.db.database,
        port: env.db.port,
        ...(useSsl && { ssl: { rejectUnauthorized: true } }),
      }
);

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL error", error);
});

module.exports = pool;

const fs = require("fs");
const path = require("path");
const pool = require("./pool");

async function migrate() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  const migrationsPath = path.join(__dirname, "migrations");
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('biolegacy_schema_migrations'))");
    await client.query(sql);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    if (!fs.existsSync(migrationsPath)) return;
    const files = fs.readdirSync(migrationsPath).filter((name) => name.endsWith(".sql")).sort();
    for (const name of files) {
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]);
      if (existing.rowCount) continue;
      const migrationSql = fs.readFileSync(path.join(migrationsPath, name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(migrationSql);
        await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext('biolegacy_schema_migrations'))"); } catch { /* connection may have failed */ }
    client.release();
  }
}

module.exports = migrate;

const pool = require("../../db/pool");
const ApiError = require("../../utils/apiError");
const audit = require("../../utils/audit");

async function getPublic() {
  const result = await pool.query("SELECT value FROM site_settings WHERE setting_key='public'");
  if (!result.rows[0]) throw new ApiError(503, "Website settings have not been initialized");
  return result.rows[0].value;
}

async function updatePublic(value, actorId) {
  const result = await pool.query(
    `UPDATE site_settings SET value=$1, updated_at=NOW()
     WHERE setting_key='public' RETURNING value`,
    [value]
  );
  if (!result.rows[0]) throw new ApiError(503, "Website settings have not been initialized");
  await audit(actorId, "UPDATE", "site_settings", "public");
  return result.rows[0].value;
}

module.exports = { getPublic, updatePublic };

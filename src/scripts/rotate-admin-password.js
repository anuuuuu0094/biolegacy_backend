const bcrypt = require("bcryptjs");
const pool = require("../db/pool");

async function rotateAdminPassword() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@biolegacy.in";
  const password = process.env.NEW_ADMIN_PASSWORD;
  if (!password || password.length < 16) {
    throw new Error("Set NEW_ADMIN_PASSWORD to a unique password of at least 16 characters");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    "UPDATE users SET password_hash=$1, updated_at=NOW() WHERE email=$2 AND role='TEACHER_ADMIN' RETURNING id",
    [passwordHash, email]
  );
  if (!result.rows[0]) throw new Error("Administrator account not found");
  await pool.query("UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL", [result.rows[0].id]);
  console.log(`Administrator password rotated for ${email}. Existing refresh sessions were revoked.`);
}

rotateAdminPassword()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => pool.end());

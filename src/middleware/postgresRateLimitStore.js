const crypto = require("crypto");
const pool = require("../db/pool");

class PostgresRateLimitStore {
  constructor(scope) {
    this.scope = scope;
    this.localKeys = false;
    this.windowMs = 60_000;
    this.operations = 0;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  hash(key) {
    return crypto.createHash("sha256").update(String(key)).digest("hex");
  }

  windowEnd(now = Date.now()) {
    return new Date((Math.floor(now / this.windowMs) + 1) * this.windowMs);
  }

  async increment(key) {
    const clientKeyHash = this.hash(key);
    const resetTime = this.windowEnd();
    const result = await pool.query(
      `INSERT INTO request_rate_limits(scope,client_key_hash,window_ends_at,hit_count)
       VALUES($1,$2,$3,1)
       ON CONFLICT(scope,client_key_hash,window_ends_at)
       DO UPDATE SET hit_count=request_rate_limits.hit_count+1
       RETURNING hit_count`,
      [this.scope, clientKeyHash, resetTime]
    );

    this.operations += 1;
    if (this.operations % 1000 === 0) {
      pool.query("DELETE FROM request_rate_limits WHERE window_ends_at < NOW()-INTERVAL '1 day'")
        .catch(() => undefined);
    }

    return { totalHits: Number(result.rows[0].hit_count), resetTime };
  }

  async decrement(key) {
    await pool.query(
      `UPDATE request_rate_limits SET hit_count=GREATEST(0,hit_count-1)
       WHERE scope=$1 AND client_key_hash=$2 AND window_ends_at=$3`,
      [this.scope, this.hash(key), this.windowEnd()]
    );
  }

  async resetKey(key) {
    await pool.query(
      "DELETE FROM request_rate_limits WHERE scope=$1 AND client_key_hash=$2",
      [this.scope, this.hash(key)]
    );
  }

  async resetAll() {
    await pool.query("DELETE FROM request_rate_limits WHERE scope=$1", [this.scope]);
  }
}

module.exports = PostgresRateLimitStore;

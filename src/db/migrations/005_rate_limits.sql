CREATE TABLE IF NOT EXISTS request_rate_limits (
  scope TEXT NOT NULL,
  client_key_hash TEXT NOT NULL,
  window_ends_at TIMESTAMPTZ NOT NULL,
  hit_count INT NOT NULL DEFAULT 1 CHECK (hit_count >= 0),
  PRIMARY KEY(scope, client_key_hash, window_ends_at)
);

CREATE INDEX IF NOT EXISTS request_rate_limits_expiry_idx
  ON request_rate_limits(window_ends_at);

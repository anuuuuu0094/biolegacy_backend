-- Tokens created before session-bound JWTs were introduced cannot be checked
-- reliably. Revoke them once so every future access token is tied to a row.
UPDATE refresh_tokens
SET revoked_at = NOW()
WHERE revoked_at IS NULL;

-- PostgreSQL is the final concurrency guard: even simultaneous login requests
-- cannot leave two active desktop or two active mobile sessions for one user.
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_one_active_device_type_idx
  ON refresh_tokens(user_id, device_type)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS refresh_tokens_active_session_idx
  ON refresh_tokens(id, user_id, expires_at)
  WHERE revoked_at IS NULL;

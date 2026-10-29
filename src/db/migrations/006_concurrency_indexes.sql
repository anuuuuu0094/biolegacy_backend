CREATE INDEX IF NOT EXISTS test_attempts_due_idx
  ON test_attempts(expires_at)
  WHERE status='ACTIVE';

CREATE INDEX IF NOT EXISTS test_results_leaderboard_idx
  ON test_results(test_id, score DESC, accuracy DESC);

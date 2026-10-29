# 1,000-concurrent-user production runbook

The code is designed to support a 1,000-user exam workload, but capacity is an
end-to-end property of the API instances, PostgreSQL plan, Redis plan, network,
and workload. A staging load test is required before announcing a guaranteed
capacity.

## Required production topology

- Run at least two API instances in the same region as PostgreSQL and Redis.
- The browser sends authenticated traffic through the Next.js BFF route. Ensure
  the frontend hosting plan also has enough function concurrency; backend-only
  load results do not prove end-to-end capacity.
- Use a managed Redis/Valkey service for rate limits: `RATE_LIMIT_STORE=redis`.
- Start with `DB_POOL_MAX=20` per API instance. Ensure all instance pools plus
  migration/admin headroom remain below PostgreSQL `max_connections`.
- Keep `RUN_MIGRATIONS_ON_START=false`; run `npm run db:migrate` once as the
  protected release command before rolling out API instances.
- Route liveness probes to `/api/v1/live` and readiness probes to
  `/api/v1/health`. Readiness includes the current pool totals and queue depth.
- Use rolling deploys and allow at least `SHUTDOWN_GRACE_MS=15000` so in-flight
  answer saves and submissions can drain.

Recommended starting environment:

```env
RATE_LIMIT_STORE=redis
REDIS_URL=redis://default:strong-password@private-redis-host:6379
DB_POOL_MAX=20
DB_POOL_MIN=5
DB_POOL_MAX_WAITING=500
DB_CONNECTION_TIMEOUT_MS=15000
DB_QUERY_TIMEOUT_MS=30000
EXPIRY_SWEEP_INTERVAL_MS=5000
EXPIRY_SWEEP_BATCH_SIZE=100
EXPIRY_SWEEP_CONCURRENCY=5
API_RATE_LIMIT=1500
ANONYMOUS_API_RATE_LIMIT=20000
RATE_LIMIT_FAIL_OPEN=true
RUN_MIGRATIONS_ON_START=false
```

Do not copy the example Redis credentials. Use the provider's private URL and
secret management.

## Staging load test

Never point the load test at production. Create 1,000 staging student accounts
with valid access to one representative 180-question test. Put their access
tokens in a JSON file that is not committed:

```json
[
  { "token": "access-token-1" },
  { "token": "access-token-2" }
]
```

Generate fresh access tokens immediately before the run (the default access
token lifetime is 15 minutes). Install k6 locally, then run:

```powershell
$env:BASE_URL="https://staging-api.example.com/api/v1"
$env:TEST_ID="00000000-0000-4000-8000-000000000000"
$env:USERS_FILE="C:\secure\biolegacy-load-users.json"
k6 run load/k6-exam.js
```

First test the backend directly as above. Then repeat through the deployed BFF:

```powershell
$env:BASE_URL="https://staging.example.com/api/backend"
$env:VIA_BFF="true"
$env:ACCESS_COOKIE="__Host-biolegacy_access"
k6 run load/k6-exam.js
```

Only use staging tokens and staging URLs. The BFF run measures frontend function
concurrency and the extra network hop as well as backend capacity.

The script ramps to 1,000 virtual users, starts/resumes an attempt per user, and
saves realistic answers. Its pass criteria are:

- HTTP failure rate below 1%.
- p95 for all requests below 1 second.
- p95 for answer saves below 750 ms.
- No unexpected `429`, `500`, or database connection-timeout responses.
- PostgreSQL CPU and active connections retain at least 20% headroom.
- Redis operations have no sustained error or reconnect loop.
- `/api/v1/health` reports a database wait queue that returns to zero after the
  start burst.

Run a separate controlled submit burst after the active-exam test. Create a
private JSON array containing 1,000 objects with `token`, `attemptId`, and the
complete validated `answers` array, then run:

```powershell
$env:SUBMISSIONS_FILE="C:\secure\biolegacy-submissions.json"
k6 run load/k6-submit.js
```

This is an intentionally severe near-simultaneous burst. Also test a realistic
60-second submission window by lowering VUs or using staged execution before
choosing final infrastructure sizes.

## Operational alerts

Alert when any of these conditions persist for more than two minutes:

- 5xx response rate above 1%.
- p95 answer-save latency above 750 ms.
- PostgreSQL pool `waiting` above 100 on an instance.
- PostgreSQL connections above 80% of the provider limit.
- Redis is disconnected or rate-limit store errors are logged.
- expired active attempts continue growing across worker sweeps.

Scale API instances only after checking the PostgreSQL connection budget. If the
database is the bottleneck, raising the instance count or pool size can make the
outage worse; tune slow queries or increase database capacity first.

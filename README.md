# BioLegacy Backend

The production NEET test-series module is documented in [docs/neet-test-series.md](docs/neet-test-series.md).

Commerce, Razorpay, product access, refunds, and deployment are documented in [docs/commerce-payments.md](docs/commerce-payments.md).

Private course PDFs, Cloudflare R2 setup, security, and the upload lifecycle are documented in [docs/pdf-learning-materials.md](docs/pdf-learning-materials.md).

Standalone Express and PostgreSQL API for BioLegacy.

## Responsibilities

- Teacher-admin authentication with access and refresh tokens.
- Public content APIs for courses, blogs, results, and test series.
- Enquiry capture and teacher-admin lead management.
- PostgreSQL schema migration, seed data, audit logs, rate limiting, CORS, Helmet, validation, and centralized errors.

## Commands

```bash
npm run dev
npm run db:seed
npm test
npm run payments:reconcile
```

## Environment

```bash
PORT=7000
FRONTEND_URL=http://localhost:3000
DATABASE_URL=postgresql://user:password@host:5432/biolegacy
DB_CONNECTION_TIMEOUT_MS=15000
DB_QUERY_TIMEOUT_MS=30000
TRUST_PROXY_HOPS=1
RATE_LIMIT_STORE=postgres
RUN_MIGRATIONS_ON_START=false
JWT_ACCESS_SECRET=replace-with-long-secret
JWT_REFRESH_SECRET=replace-with-another-long-secret
JWT_ISSUER=biolegacy-api
JWT_AUDIENCE=biolegacy-web
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=30d
ADMIN_PORTAL_ACCESS_KEY=replace-with-at-least-32-random-characters
ADMIN_PORTAL_SIGNING_KEY=replace-with-a-different-32-character-random-secret
OTP_PROVIDER=2factor
TWO_FACTOR_API_KEY=replace-with-server-only-api-key
TWO_FACTOR_OTP_TEMPLATE=
TWO_FACTOR_API_BASE_URL=https://2factor.in/API/V1
RAZORPAY_KEY_ID=rzp_test_replace_me
RAZORPAY_KEY_SECRET=replace-me
RAZORPAY_WEBHOOK_SECRET=replace-me
R2_ACCOUNT_ID=replace-me
R2_ACCESS_KEY_ID=replace-me
R2_SECRET_ACCESS_KEY=replace-me
R2_BUCKET_NAME=biolegacy-pdfs
PDF_MAX_FILE_SIZE_MB=25
PDF_STORAGE_QUOTA_MB=9000
PDF_SIGNED_URL_TTL_SECONDS=600
```

In production, set `FRONTEND_URL=https://biolegacy.vercel.app`. Multiple exact
origins can be supplied as a comma-separated list when preview or custom domains
also need API access.

Seeding requires an explicitly chosen administrator password (at least 16 characters):

```bash
SEED_ADMIN_EMAIL=admin@biolegacy.in
SEED_ADMIN_PASSWORD=your-unique-long-password
```

To rotate an existing administrator password, set `NEW_ADMIN_PASSWORD` in the ignored `.env` file and run `npm run auth:rotate-admin`. The command revokes existing refresh sessions. Remove the temporary value after storing the password in your password manager.

The API requires separate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values in production. Tokens are also bound to `JWT_ISSUER`, `JWT_AUDIENCE`, and an access/refresh token type. The development server generates an ephemeral secret for any missing value, so sessions will end on restart until both are configured.

Production uses a PostgreSQL-backed, hashed-key rate-limit store so limits are shared across instances. Run `npm run db:migrate` before starting a production release; keep `RUN_MIGRATIONS_ON_START=false` so the runtime database identity does not need schema-changing privileges. `TRUST_PROXY_HOPS` must match the hosting proxy path (one hop for the current Render setup), rather than blindly trusting every forwarded address.

## Phone OTP with 2Factor

The backend uses 2Factor's managed OTP generation and verification endpoints. Keep `TWO_FACTOR_API_KEY` only in `biolegacy_backend/.env` locally and in the Render backend environment in production. Do not add it to the frontend or use a `NEXT_PUBLIC_` prefix.

`TWO_FACTOR_OTP_TEMPLATE` may remain empty while using the account's default OTP template. Once a custom DLT-approved template is available, set its exact 2Factor template name and restart the backend. The current account is configured for Indian `+91` numbers only.

## Private administrator sign-in

Administrator accounts cannot sign in through the public password endpoint. The private frontend gateway sends a short-lived HMAC-signed request to `POST /api/v1/auth/admin/login`; unsigned or stale requests are rejected before credentials reach the database.

Set distinct, random `ADMIN_PORTAL_ACCESS_KEY` and `ADMIN_PORTAL_SIGNING_KEY` values of at least 32 characters in Render, and use the same pair in Vercel. The access key is entered by administrators; the signing key must remain server-only and must never be shared with users. Never expose either value with a `NEXT_PUBLIC_` prefix. Local development has separate development-only fallbacks; production has none.

Administrators can assign courses to students and manage video learning modules from `/admin/learning` in the frontend. Only active and completed enrollments grant access to learning modules.

# BioLegacy Backend

The production NEET test-series module is documented in [docs/neet-test-series.md](docs/neet-test-series.md).

Commerce, Razorpay, product access, refunds, and deployment are documented in [docs/commerce-payments.md](docs/commerce-payments.md).

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
JWT_ACCESS_SECRET=replace-with-long-secret
JWT_REFRESH_SECRET=replace-with-another-long-secret
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=30d
RAZORPAY_KEY_ID=rzp_test_replace_me
RAZORPAY_KEY_SECRET=replace-me
RAZORPAY_WEBHOOK_SECRET=replace-me
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

The API requires separate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values in production. The development server generates an ephemeral secret for any missing value, so sessions will end on restart until both are configured.

Administrators can assign courses to students and manage video learning modules from `/admin/learning` in the frontend. Only active and completed enrollments grant access to learning modules.

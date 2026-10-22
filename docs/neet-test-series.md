# NEET Test Series

The NEET module extends the existing Express/PostgreSQL API and Next.js App Router application. It uses the existing JWT access/refresh sessions and the existing `TEACHER_ADMIN` and `STUDENT` roles.

## Setup

```bash
cd biolegacy_backend
npm run db:migrate
npm run db:seed-neet       # development only; adds 12 questions and 3 tests
npm test
npm run smoke:neet-e2e

cd ../biolegacy_frontend/biolegacy
npm run lint
npm run build
```

No new secrets are required. The backend continues to use `DATABASE_URL`, JWT secrets, `FRONTEND_URL`, and the existing authentication-provider variables. Timestamps are stored as `TIMESTAMPTZ`; the API treats them as UTC and the Next.js UI converts them for display.

## Data model

- `test_series`: series metadata, schedule, access, instructions, and eligibility.
- `tests`: versioned exam configuration, timer, scoring, visibility, randomization, schedule, and blueprint.
- `test_sections`: configurable subject/section structure.
- `questions` / `question_options`: reusable categorized question bank. Correct flags are admin-only.
- `test_questions`: manual or generated test assignment.
- `test_eligible_users`: optional explicit student access.
- `test_attempts`: lifecycle, authoritative `started_at` / `expires_at`, configuration snapshot, and summary.
- `attempt_questions`: immutable question, option, answer-key, order, and scoring snapshot.
- `attempt_answers`: autosaved response, visit/review status, and time spent.
- `test_results` / `question_results`: idempotent persisted evaluation and analytics breakdown.

Published academic records are archived instead of hard-deleted. Attempts reference immutable snapshots, so later question or test edits do not change history.

## Admin workflow

Open `/admin/test-management` after an administrator sign-in.

1. Create a series and configure schedule/access.
2. Create a test; Physics, Chemistry, and Biology sections are supplied by default and can be edited with labeled form fields.
3. Add questions with the detailed form. The JSON bulk importer remains available only as an optional advanced tool.
4. Select questions and assign them to a manual test, or configure a blueprint and choose **Generate**.
5. Preview the test, then publish. Publishing is rejected when duration, sections, questions, answer keys, or schedule are invalid.
6. Review attempts and analytics. Use manual release for visibility modes configured as `MANUAL_RELEASE`.

Question import is transactional. Its payload is `{ "questions": [...] }`; every question requires a unique `code`, text, subject, difficulty, scoring values, and two or more options. A `SINGLE_CORRECT` question requires exactly one option with `isCorrect: true`. Any validation or duplicate-code failure rolls back the complete batch.

## Student workflow

`/test-series` → series detail → test detail → start/resume → `/attempts/:id` → result/review.

The server checks publication, schedule, enrollment, selected-user rules, previous-score rules, attempt limits, and existing active attempts. Starting is serialized per user and creates one server-side attempt with a fixed question set. The browser renders remaining time from `expiresAt - serverTime`; changing the device clock or refreshing cannot extend it. A 30-second backend sweep finalizes expired attempts, and every protected attempt query also enforces expiry.

Answers save after a short debounce, on navigation/review actions, and again atomically with final submission. A failed autosave remains in local React state and the final submit includes all current answers. Submission locks the attempt and reuses an existing result on duplicate calls.

## Engines

- Blueprint engine: seeded deterministic shuffle, hard subject/chapter/difficulty filters, no duplicates, and detailed unsatisfied-constraint errors.
- Eligibility engine: authentication, lifecycle, schedule, attempts, enrollment, selected users, and prerequisite score.
- Scoring engine: one authoritative `+correct / incorrect / unanswered` evaluation with subject/topic/difficulty aggregation.
- Ranking engine: score descending, accuracy descending, time ascending, submission time ascending, then attempt ID.
- Expiry engine: server timestamps plus an automatic expired-attempt sweep.

Correct option IDs never appear in student attempt payloads. They are stored only in the server-side attempt snapshot and are returned by review APIs only after the configured release rule permits it.

## API summary

Admin prefix: `/api/v1/admin/test-management`

- Series: `GET/POST /series`, `GET/PUT/DELETE /series/:id`
- Tests: `GET/POST /tests`, `GET/PUT /tests/:id`
- Sections/questions: `PUT /tests/:id/sections`, `PUT /tests/:id/questions`
- Blueprint/publishing: `POST /tests/:id/generate`, `POST /tests/:id/transition`
- Preview/eligibility: `GET /tests/:id/preview`, `PUT /tests/:id/eligible-users`
- Question bank: `GET/POST /questions`, `PUT/DELETE /questions/:id`, `POST /questions/import`
- Operations: `GET /attempts`, `GET /attempts/:id`, `GET /tests/:id/analytics`, `GET /series/:id/analytics`

Student/public:

- `GET /test-series`, `GET /test-series/:slug`, `GET /tests/:id`
- `POST /tests/:id/start`, `GET /tests/:id/leaderboard`
- `GET /attempts/:id`, `PUT /attempts/:id/answer`, `POST /attempts/:id/submit`
- `GET /attempts/:id/result`, `GET /attempts/:id/review`, `POST /attempts/:id/events`

All admin endpoints enforce `TEACHER_ADMIN`; attempt endpoints enforce `STUDENT` and ownership. Joi validates bodies and route IDs. The global limiter, Helmet, safe API envelopes, and centralized error handler remain in effect.

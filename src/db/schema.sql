CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('TEACHER_ADMIN', 'STUDENT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('ACTIVE', 'PENDING', 'SUSPENDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM ('NEW', 'CONTACTED', 'COUNSELED', 'ENROLLED', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'STUDENT',
  status user_status NOT NULL DEFAULT 'PENDING',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Federated and phone-only accounts do not always have a local password or email.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS auth_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple', 'phone')),
  provider_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS auth_identities_user_idx ON auth_identities(user_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_type TEXT NOT NULL DEFAULT 'DESKTOP' CHECK (device_type IN ('DESKTOP', 'MOBILE')),
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep existing installations compatible; migration 007 revokes legacy sessions
-- before enforcing one active session per device category.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'DESKTOP';
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
DO $$ BEGIN
  ALTER TABLE refresh_tokens
    ADD CONSTRAINT refresh_tokens_device_type_check
    CHECK (device_type IN ('DESKTOP', 'MOBILE'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  short_title TEXT NOT NULL,
  category TEXT NOT NULL,
  target_exam_year INT,
  short_desc TEXT NOT NULL,
  long_desc TEXT NOT NULL,
  duration TEXT NOT NULL,
  total_hours TEXT,
  mode TEXT NOT NULL,
  center TEXT,
  image TEXT,
  total_fees TEXT,
  registration_fee TEXT,
  total_seats INT DEFAULT 0,
  available_seats INT DEFAULT 0,
  batch_status TEXT DEFAULT 'draft',
  enrollment_open BOOLEAN NOT NULL DEFAULT false,
  is_popular BOOLEAN NOT NULL DEFAULT false,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  published BOOLEAN NOT NULL DEFAULT true,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  seo JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS courses_public_idx ON courses (published, is_featured, category);
CREATE INDEX IF NOT EXISTS courses_content_gin_idx ON courses USING GIN (content);

CREATE TABLE IF NOT EXISTS test_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  audience TEXT,
  tests_count INT NOT NULL DEFAULT 0,
  analytics TEXT,
  access_label TEXT,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  published BOOLEAN NOT NULL DEFAULT true,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  course_interest TEXT NOT NULL,
  target_exam_year INT,
  city TEXT,
  message TEXT,
  lead_status lead_status NOT NULL DEFAULT 'NEW',
  assigned_to_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS enquiries_status_created_idx ON enquiries (lead_status, created_at DESC);
CREATE INDEX IF NOT EXISTS enquiries_phone_idx ON enquiries (phone);

CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  cover_image TEXT,
  published BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Guides';
CREATE INDEX IF NOT EXISTS blog_posts_public_category_idx ON blog_posts (published, category, published_at DESC);

CREATE TABLE IF NOT EXISTS result_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_name TEXT NOT NULL,
  exam_name TEXT NOT NULL,
  exam_year INT NOT NULL,
  achievement TEXT NOT NULL,
  image_url TEXT,
  published BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learning_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  video_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learning_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id UUID REFERENCES learning_modules(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  object_key TEXT NOT NULL UNIQUE,
  original_file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes BIGINT NOT NULL,
  upload_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (upload_status IN ('PENDING', 'READY', 'FAILED')),
  downloadable BOOLEAN NOT NULL DEFAULT true,
  published BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS learning_materials_course_idx
  ON learning_materials(course_id, published, sort_order);
CREATE INDEX IF NOT EXISTS learning_materials_module_idx
  ON learning_materials(module_id, published, sort_order);

-- These tables are additive. They do not alter or remove existing production data.
CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, course_id)
);
CREATE INDEX IF NOT EXISTS enrollments_student_status_idx ON enrollments(student_id, status);

CREATE TABLE IF NOT EXISTS site_settings (
  setting_key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert defaults only for a new installation. Existing production settings are preserved.
INSERT INTO site_settings(setting_key, value)
VALUES ('public', $$
{
  "primaryPhone": "+91 7272816609",
  "primaryWhatsapp": "+917272816609",
  "primaryEmail": "admissions@biolegacy.in",
  "address": "Deokali Bypass, Ayodhya, Uttar Pradesh",
  "mapEmbedUrl": "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3562.237607471591!2d82.16820998033027!3d26.768694906293586!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x399a097f7503388f%3A0xf29838363f3d0603!2sBIO%20LEGACY%20INSTITUTE%20%7C%20Best%20For%20NEET-UG(MBBS)%20%2FB.Sc%20Nurshing%20%2F%20Foundation%20%2BAcademic%20(11th%20%26%2012th)!5e0!3m2!1sen!2sus!4v1772022421962!5m2!1sen!2sus",
  "mainNavigation": [
    {"label":"Home","href":"/"},
    {"label":"Courses","href":"/courses"},
    {"label":"Test Series","href":"/test-series"},
    {"label":"Results","href":"/results"},
    {"label":"Blog","href":"/blog"},
    {"label":"About","href":"/about"},
    {"label":"Contact","href":"/contact"}
  ],
  "quickLinks": [
    {"title":"Admission Counselling","desc":"Talk to our team before choosing your NEET batch.","href":"/contact"},
    {"title":"Explore Test Series","desc":"Understand practice flow, mocks, analytics, and rankings.","href":"/test-series"},
    {"title":"Student Portal","desc":"See how enrolled students will access classes and tests.","href":"/student-portal"}
  ],
  "studentPortalHighlights": [
    "My batches and live classroom schedule",
    "Recorded lectures, notes, and assignments",
    "Test series attempts and rank analytics",
    "Doubt tracking and counseling support",
    "Fee status and admission documents"
  ]
}
$$::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NEET test-series domain. These migrations are additive and deliberately keep
-- the original public test_series columns working for existing clients.
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS short_name TEXT;
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'NEET';
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS exam_type TEXT NOT NULL DEFAULT 'NEET';
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS target_class TEXT;
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS target_exam TEXT NOT NULL DEFAULT 'NEET';
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'English';
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'MIXED';
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS author_name TEXT;
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS access_type TEXT NOT NULL DEFAULT 'AUTHENTICATED';
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS access_duration_days INT;
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS instructions JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS eligibility JSONB NOT NULL DEFAULT '{}'::jsonb;
UPDATE test_series SET lifecycle_status='PUBLISHED' WHERE published=true AND lifecycle_status='DRAFT';
CREATE INDEX IF NOT EXISTS test_series_lifecycle_idx ON test_series(lifecycle_status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES test_series(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions JSONB NOT NULL DEFAULT '{}'::jsonb,
  selection_mode TEXT NOT NULL DEFAULT 'MANUAL' CHECK (selection_mode IN ('MANUAL','BLUEPRINT')),
  blueprint JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_questions INT NOT NULL DEFAULT 0 CHECK (total_questions >= 0),
  total_marks NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_marks >= 0),
  duration_minutes INT NOT NULL DEFAULT 180 CHECK (duration_minutes > 0),
  passing_marks NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (passing_marks >= 0),
  correct_marks NUMERIC(10,2) NOT NULL DEFAULT 4,
  incorrect_marks NUMERIC(10,2) NOT NULL DEFAULT -1,
  unanswered_marks NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_attempts INT CHECK (max_attempts IS NULL OR max_attempts > 0),
  result_visibility TEXT NOT NULL DEFAULT 'IMMEDIATE' CHECK (result_visibility IN ('IMMEDIATE','AFTER_SUBMISSION','AFTER_TEST_END','MANUAL_RELEASE')),
  explanation_visibility TEXT NOT NULL DEFAULT 'AFTER_TEST_END' CHECK (explanation_visibility IN ('IMMEDIATE','AFTER_TEST_END','MANUAL_RELEASE','NEVER')),
  answer_key_visibility TEXT NOT NULL DEFAULT 'AFTER_TEST_END' CHECK (answer_key_visibility IN ('IMMEDIATE','AFTER_SUBMISSION','AFTER_TEST_END','MANUAL_RELEASE','NEVER')),
  ranking_enabled BOOLEAN NOT NULL DEFAULT true,
  leaderboard_enabled BOOLEAN NOT NULL DEFAULT true,
  shuffle_questions BOOLEAN NOT NULL DEFAULT true,
  shuffle_options BOOLEAN NOT NULL DEFAULT false,
  shuffle_sections BOOLEAN NOT NULL DEFAULT false,
  resume_enabled BOOLEAN NOT NULL DEFAULT true,
  pause_enabled BOOLEAN NOT NULL DEFAULT false,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  eligibility JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  lifecycle_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status IN ('DRAFT','SCHEDULED','PUBLISHED','CLOSED','ARCHIVED')),
  result_released_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CHECK (passing_marks <= total_marks OR total_marks = 0)
);
CREATE INDEX IF NOT EXISTS tests_series_status_idx ON tests(series_id, lifecycle_status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS test_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  instructions TEXT,
  question_limit INT CHECK (question_limit IS NULL OR question_limit > 0),
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE(test_id, name)
);
CREATE INDEX IF NOT EXISTS test_sections_test_idx ON test_sections(test_id, sort_order);

CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  question_text TEXT NOT NULL,
  subject TEXT NOT NULL,
  chapter TEXT,
  topic TEXT,
  subtopic TEXT,
  difficulty TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (difficulty IN ('EASY','MEDIUM','HARD')),
  question_type TEXT NOT NULL DEFAULT 'SINGLE_CORRECT' CHECK (question_type IN ('SINGLE_CORRECT','MULTIPLE_CORRECT')),
  marks NUMERIC(10,2) NOT NULL DEFAULT 4,
  negative_marks NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (negative_marks >= 0),
  explanation TEXT,
  hint TEXT,
  solution TEXT,
  source_reference TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  language TEXT NOT NULL DEFAULT 'English',
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS questions_bank_idx ON questions(status, subject, difficulty, chapter, topic);
CREATE INDEX IF NOT EXISTS questions_tags_gin_idx ON questions USING GIN(tags);

CREATE TABLE IF NOT EXISTS question_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  image_url TEXT,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE(question_id, sort_order)
);
CREATE INDEX IF NOT EXISTS question_options_question_idx ON question_options(question_id, sort_order);

CREATE TABLE IF NOT EXISTS test_questions (
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  section_id UUID REFERENCES test_sections(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  marks NUMERIC(10,2),
  incorrect_marks NUMERIC(10,2),
  required BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY(test_id, question_id)
);
CREATE INDEX IF NOT EXISTS test_questions_order_idx ON test_questions(test_id, sort_order);

CREATE TABLE IF NOT EXISTS test_eligible_users (
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(test_id, user_id)
);

CREATE TABLE IF NOT EXISTS test_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attempt_number INT NOT NULL CHECK (attempt_number > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUBMITTED','EXPIRED','ABANDONED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  auto_submitted BOOLEAN NOT NULL DEFAULT false,
  test_snapshot JSONB NOT NULL,
  score NUMERIC(10,2),
  max_score NUMERIC(10,2),
  percentage NUMERIC(8,3),
  accuracy NUMERIC(8,3),
  correct_count INT,
  incorrect_count INT,
  unanswered_count INT,
  time_taken_seconds INT,
  suspicious_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(test_id, user_id, attempt_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS test_attempts_one_active_idx ON test_attempts(test_id, user_id) WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS test_attempts_user_idx ON test_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS test_attempts_test_status_idx ON test_attempts(test_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS test_attempts_due_idx ON test_attempts(expires_at) WHERE status='ACTIVE';

CREATE TABLE IF NOT EXISTS attempt_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES test_attempts(id) ON DELETE RESTRICT,
  source_question_id UUID REFERENCES questions(id) ON DELETE SET NULL,
  section_name TEXT,
  subject TEXT NOT NULL,
  chapter TEXT,
  topic TEXT,
  difficulty TEXT NOT NULL,
  question_type TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  sort_order INT NOT NULL,
  option_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  marks NUMERIC(10,2) NOT NULL,
  incorrect_marks NUMERIC(10,2) NOT NULL,
  unanswered_marks NUMERIC(10,2) NOT NULL DEFAULT 0,
  UNIQUE(attempt_id, sort_order),
  UNIQUE(attempt_id, id)
);
CREATE INDEX IF NOT EXISTS attempt_questions_attempt_idx ON attempt_questions(attempt_id, sort_order);

CREATE TABLE IF NOT EXISTS attempt_answers (
  attempt_id UUID NOT NULL REFERENCES test_attempts(id) ON DELETE RESTRICT,
  attempt_question_id UUID NOT NULL REFERENCES attempt_questions(id) ON DELETE RESTRICT,
  selected_option_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  visited BOOLEAN NOT NULL DEFAULT true,
  marked_for_review BOOLEAN NOT NULL DEFAULT false,
  answered_at TIMESTAMPTZ,
  time_spent_seconds INT NOT NULL DEFAULT 0 CHECK (time_spent_seconds >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(attempt_id, attempt_question_id)
);

CREATE TABLE IF NOT EXISTS test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL UNIQUE REFERENCES test_attempts(id) ON DELETE RESTRICT,
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  score NUMERIC(10,2) NOT NULL,
  max_score NUMERIC(10,2) NOT NULL,
  percentage NUMERIC(8,3) NOT NULL,
  accuracy NUMERIC(8,3) NOT NULL,
  correct_count INT NOT NULL,
  incorrect_count INT NOT NULL,
  unanswered_count INT NOT NULL,
  attempted_count INT NOT NULL,
  rank INT,
  breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS test_results_rank_idx ON test_results(test_id, score DESC, accuracy DESC, generated_at ASC);
CREATE INDEX IF NOT EXISTS test_results_leaderboard_idx ON test_results(test_id, score DESC, accuracy DESC);
CREATE INDEX IF NOT EXISTS test_results_user_idx ON test_results(user_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS question_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id UUID NOT NULL REFERENCES test_results(id) ON DELETE RESTRICT,
  attempt_question_id UUID NOT NULL REFERENCES attempt_questions(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('CORRECT','INCORRECT','UNANSWERED','BONUS')),
  awarded_marks NUMERIC(10,2) NOT NULL,
  selected_option_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE(result_id, attempt_question_id)
);
CREATE INDEX IF NOT EXISTS question_results_result_idx ON question_results(result_id);

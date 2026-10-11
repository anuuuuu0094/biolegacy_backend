CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('COURSE','TEST_SERIES','TEST','BUNDLE')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  exam_type TEXT NOT NULL DEFAULT 'OTHER',
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (char_length(currency)=3),
  price_minor BIGINT NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  compare_at_price_minor BIGINT CHECK (compare_at_price_minor IS NULL OR compare_at_price_minor >= price_minor),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','ARCHIVED')),
  access_type TEXT NOT NULL DEFAULT 'LIFETIME' CHECK (access_type IN ('LIFETIME','DURATION','FIXED_DATE')),
  duration_days INT CHECK (duration_days IS NULL OR duration_days > 0),
  access_starts_at TIMESTAMPTZ,
  access_ends_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (access_type <> 'DURATION' OR duration_days IS NOT NULL),
  CHECK (access_type <> 'FIXED_DATE' OR access_ends_at IS NOT NULL),
  CHECK (access_ends_at IS NULL OR access_starts_at IS NULL OR access_ends_at > access_starts_at)
);
CREATE INDEX IF NOT EXISTS products_catalog_idx ON products(status,type,exam_type,updated_at DESC);

CREATE TABLE IF NOT EXISTS product_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('COURSE','TEST_SERIES','TEST')),
  course_id UUID REFERENCES courses(id) ON DELETE RESTRICT,
  test_series_id UUID REFERENCES test_series(id) ON DELETE RESTRICT,
  test_id UUID REFERENCES tests(id) ON DELETE RESTRICT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(course_id,test_series_id,test_id)=1),
  CHECK ((target_type='COURSE' AND course_id IS NOT NULL) OR
         (target_type='TEST_SERIES' AND test_series_id IS NOT NULL) OR
         (target_type='TEST' AND test_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS product_items_course_uq ON product_items(product_id,course_id) WHERE course_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_items_series_uq ON product_items(product_id,test_series_id) WHERE test_series_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_items_test_uq ON product_items(product_id,test_id) WHERE test_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  description TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('PERCENT','FIXED')),
  discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value > 0),
  max_discount_minor BIGINT CHECK (max_discount_minor IS NULL OR max_discount_minor > 0),
  minimum_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (minimum_amount_minor >= 0),
  usage_limit INT CHECK (usage_limit IS NULL OR usage_limit > 0),
  per_user_limit INT NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (discount_type <> 'PERCENT' OR discount_value <= 100),
  CHECK (expires_at IS NULL OR starts_at IS NULL OR expires_at > starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_ci_uq ON coupons(lower(code));

CREATE TABLE IF NOT EXISTS coupon_products (
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY(coupon_id,product_id)
);
CREATE TABLE IF NOT EXISTS coupon_product_types (
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL CHECK (product_type IN ('COURSE','TEST_SERIES','TEST','BUNDLE')),
  PRIMARY KEY(coupon_id,product_type)
);
CREATE TABLE IF NOT EXISTS coupon_exam_types (
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  exam_type TEXT NOT NULL,
  PRIMARY KEY(coupon_id,exam_type)
);
CREATE TABLE IF NOT EXISTS coupon_allowed_users (
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(coupon_id,user_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','PENDING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
  currency TEXT NOT NULL CHECK (char_length(currency)=3),
  subtotal_minor BIGINT NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  final_amount_minor BIGINT NOT NULL CHECK (final_amount_minor >= 0),
  coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
  razorpay_order_id TEXT UNIQUE,
  product_snapshot JSONB NOT NULL,
  pricing_snapshot JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (discount_minor <= subtotal_minor),
  CHECK (final_amount_minor = subtotal_minor - discount_minor)
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_open_product_idx ON orders(user_id,product_id) WHERE status IN ('CREATED','PENDING');

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  gateway TEXT NOT NULL DEFAULT 'RAZORPAY',
  gateway_order_id TEXT NOT NULL,
  gateway_payment_id TEXT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (char_length(currency)=3),
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','AUTHORIZED','CAPTURED','FAILED','REFUNDED','PARTIALLY_REFUNDED')),
  payment_method TEXT,
  gateway_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payments_gateway_payment_uq ON payments(gateway,gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway TEXT NOT NULL DEFAULT 'RAZORPAY',
  gateway_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','PROCESSED','FAILED','IGNORED')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE(gateway,gateway_event_id)
);

CREATE TABLE IF NOT EXISTS access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  source_order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
  target_type TEXT NOT NULL CHECK (target_type IN ('COURSE','TEST_SERIES','TEST')),
  course_id UUID REFERENCES courses(id) ON DELETE RESTRICT,
  test_series_id UUID REFERENCES test_series(id) ON DELETE RESTRICT,
  test_id UUID REFERENCES tests(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(course_id,test_series_id,test_id)=1),
  CHECK ((target_type='COURSE' AND course_id IS NOT NULL) OR
         (target_type='TEST_SERIES' AND test_series_id IS NOT NULL) OR
         (target_type='TEST' AND test_id IS NOT NULL)),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS access_grants_user_active_idx ON access_grants(user_id,status,expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS access_grants_order_course_uq ON access_grants(source_order_id,course_id) WHERE source_order_id IS NOT NULL AND course_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS access_grants_order_series_uq ON access_grants(source_order_id,test_series_id) WHERE source_order_id IS NOT NULL AND test_series_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS access_grants_order_test_uq ON access_grants(source_order_id,test_id) WHERE source_order_id IS NOT NULL AND test_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  discount_minor BIGINT NOT NULL CHECK (discount_minor >= 0),
  status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','REDEEMED','RELEASED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS coupon_redemptions_usage_idx ON coupon_redemptions(coupon_id,status,user_id);

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  gateway_refund_id TEXT UNIQUE,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','PENDING','PROCESSED','FAILED')),
  reason TEXT NOT NULL,
  access_action TEXT NOT NULL DEFAULT 'KEEP' CHECK (access_action IN ('KEEP','REVOKE')),
  requested_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  gateway_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS refunds_payment_idx ON refunds(payment_id,created_at DESC);

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS source_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS access_grant_id UUID REFERENCES access_grants(id) ON DELETE SET NULL;

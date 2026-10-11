ALTER TABLE tests ADD COLUMN IF NOT EXISTS exam_type TEXT;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT false;

UPDATE tests t
SET exam_type=ts.exam_type
FROM test_series ts
WHERE ts.id=t.series_id AND t.exam_type IS NULL;
UPDATE tests SET exam_type='OTHER' WHERE exam_type IS NULL;
ALTER TABLE tests ALTER COLUMN exam_type SET NOT NULL;
ALTER TABLE tests ALTER COLUMN exam_type SET DEFAULT 'OTHER';

CREATE TABLE IF NOT EXISTS test_series_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES test_series(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(series_id,code)
);

CREATE TABLE IF NOT EXISTS test_series_tests (
  series_id UUID NOT NULL REFERENCES test_series(id) ON DELETE CASCADE,
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE RESTRICT,
  group_id UUID REFERENCES test_series_groups(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(series_id,test_id)
);
CREATE INDEX IF NOT EXISTS test_series_tests_test_idx ON test_series_tests(test_id,series_id) WHERE is_active=true;
CREATE INDEX IF NOT EXISTS test_series_tests_order_idx ON test_series_tests(series_id,sort_order) WHERE is_active=true;

INSERT INTO test_series_tests(series_id,test_id,sort_order,is_active)
SELECT series_id,id,ROW_NUMBER() OVER(PARTITION BY series_id ORDER BY created_at,id)-1,true
FROM tests
ON CONFLICT(series_id,test_id) DO NOTHING;

UPDATE tests t
SET is_free=true
FROM test_series ts
WHERE ts.id=t.series_id AND ts.access_type='PUBLIC';

INSERT INTO products(slug,type,title,description,exam_type,currency,price_minor,status,access_type,duration_days,access_starts_at,access_ends_at,metadata,created_by)
SELECT 'course-'||c.slug,'COURSE',c.title,c.short_desc,c.category,'INR',0,'DRAFT','LIFETIME',NULL,NULL,NULL,jsonb_build_object('legacyCourseSlug',c.slug,'requiresPriceReview',true),c.created_by
FROM courses c
ON CONFLICT(slug) DO NOTHING;

INSERT INTO product_items(product_id,target_type,course_id)
SELECT p.id,'COURSE',c.id
FROM courses c JOIN products p ON p.slug='course-'||c.slug
ON CONFLICT DO NOTHING;

INSERT INTO products(slug,type,title,description,exam_type,currency,price_minor,status,access_type,duration_days,access_starts_at,access_ends_at,metadata,created_by)
SELECT 'series-'||ts.slug,'TEST_SERIES',ts.title,ts.description,ts.exam_type,'INR',ROUND(ts.price*100)::bigint,'DRAFT',
  CASE WHEN ts.access_duration_days IS NOT NULL THEN 'DURATION' WHEN ts.ends_at IS NOT NULL THEN 'FIXED_DATE' ELSE 'LIFETIME' END,
  ts.access_duration_days,ts.starts_at,ts.ends_at,jsonb_build_object('legacySeriesSlug',ts.slug,'requiresReview',true),ts.created_by
FROM test_series ts
ON CONFLICT(slug) DO NOTHING;

INSERT INTO product_items(product_id,target_type,test_series_id)
SELECT p.id,'TEST_SERIES',ts.id
FROM test_series ts JOIN products p ON p.slug='series-'||ts.slug
ON CONFLICT DO NOTHING;

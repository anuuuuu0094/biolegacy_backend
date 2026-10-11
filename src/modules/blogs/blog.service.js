const pool = require("../../db/pool");
const ApiError = require("../../utils/apiError");
const audit = require("../../utils/audit");

function map(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    desc: row.summary,
    summary: row.summary,
    content: row.content,
    image: row.cover_image,
    coverImage: row.cover_image,
    category: row.category,
    date: row.published_at
      ? new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(row.published_at)
      : "",
    published: row.published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function list(includeDrafts = false) {
  const result = await pool.query(
    `SELECT * FROM blog_posts ${includeDrafts ? "" : "WHERE published=true"}
     ORDER BY COALESCE(published_at, created_at) DESC`
  );
  return result.rows.map(map);
}

async function get(slug, includeDrafts = false) {
  const result = await pool.query(
    `SELECT * FROM blog_posts WHERE slug=$1 ${includeDrafts ? "" : "AND published=true"}`,
    [slug]
  );
  if (!result.rows[0]) throw new ApiError(404, "Blog post not found");
  return map(result.rows[0]);
}

async function upsert(input, actorId, existingSlug = null) {
  const params = [
    input.slug,
    input.title,
    input.summary,
    input.content,
    input.coverImage || null,
    input.category,
    input.published,
    input.published ? new Date() : null,
    actorId,
  ];
  const result = existingSlug
    ? await pool.query(
        `UPDATE blog_posts SET slug=$1,title=$2,summary=$3,content=$4,cover_image=$5,category=$6,
         published=$7,published_at=COALESCE(published_at,$8),updated_at=NOW()
         WHERE slug=$10 RETURNING *`,
        [...params, existingSlug]
      )
    : await pool.query(
        `INSERT INTO blog_posts(slug,title,summary,content,cover_image,category,published,published_at,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        params
      );

  if (!result.rows[0]) throw new ApiError(404, "Blog post not found");
  await audit(actorId, existingSlug ? "UPDATE" : "CREATE", "blog_post", result.rows[0].id, { slug: input.slug });
  return map(result.rows[0]);
}

async function remove(slug, actorId) {
  const result = await pool.query(
    "UPDATE blog_posts SET published=false, updated_at=NOW() WHERE slug=$1 RETURNING id",
    [slug]
  );
  if (!result.rows[0]) throw new ApiError(404, "Blog post not found");
  await audit(actorId, "ARCHIVE", "blog_post", result.rows[0].id, { slug });
}

module.exports = { list, get, upsert, remove };

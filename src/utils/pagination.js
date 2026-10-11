function getPagination(query) {
  const requestedPage = Number(query.page ?? 1);
  const requestedLimit = Number(query.limit ?? 20);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 100) : 20;
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

function pageMeta(total, page, limit) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

module.exports = { getPagination, pageMeta };

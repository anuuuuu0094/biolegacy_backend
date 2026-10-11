const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const service = require("./blog.service");

const listPublic = asyncHandler(async (req, res) => success(res, await service.list(false), "Blogs fetched"));
const getPublic = asyncHandler(async (req, res) => success(res, await service.get(req.params.slug, false), "Blog fetched"));
const listAdmin = asyncHandler(async (req, res) => success(res, await service.list(true), "Blogs fetched"));
const create = asyncHandler(async (req, res) => success(res, await service.upsert(req.body, req.user.sub), "Blog created", 201));
const update = asyncHandler(async (req, res) => success(res, await service.upsert(req.body, req.user.sub, req.params.slug), "Blog updated"));
const remove = asyncHandler(async (req, res) => {
  await service.remove(req.params.slug, req.user.sub);
  success(res, null, "Blog archived");
});

module.exports = { listPublic, getPublic, listAdmin, create, update, remove };

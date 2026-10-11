const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const service = require("./course.service");

const listPublic = asyncHandler(async (req, res) => {
  const result = await service.list(req.query, false);
  success(res, result.data, "Courses fetched", 200, result.meta);
});

const getPublic = asyncHandler(async (req, res) => {
  success(res, await service.getBySlug(req.params.slug, false), "Course fetched");
});

const listAdmin = asyncHandler(async (req, res) => {
  const result = await service.list(req.query, true);
  success(res, result.data, "Courses fetched", 200, result.meta);
});

const create = asyncHandler(async (req, res) => {
  success(res, await service.create(req.body, req.user.sub), "Course created", 201);
});

const update = asyncHandler(async (req, res) => {
  success(res, await service.update(req.params.slug, req.body, req.user.sub), "Course updated");
});

const remove = asyncHandler(async (req, res) => {
  await service.remove(req.params.slug, req.user.sub);
  success(res, null, "Course archived");
});

const destroy = asyncHandler(async (req, res) => {
  await service.destroy(req.params.slug, req.user.sub);
  success(res, null, "Course permanently deleted");
});

module.exports = { listPublic, getPublic, listAdmin, create, update, remove, destroy };

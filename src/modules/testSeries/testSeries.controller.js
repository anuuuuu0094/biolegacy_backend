const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const service = require("./testSeries.service");

const listPublic = asyncHandler(async (req, res) => success(res, await service.list(false), "Test series fetched"));
const listAdmin = asyncHandler(async (req, res) => success(res, await service.list(true), "Test series fetched"));
const create = asyncHandler(async (req, res) => success(res, await service.create(req.body, req.user.sub), "Test series created", 201));
const update = asyncHandler(async (req, res) => success(res, await service.update(req.params.slug, req.body, req.user.sub), "Test series updated"));
const remove = asyncHandler(async (req, res) => {
  await service.remove(req.params.slug, req.user.sub);
  success(res, null, "Test series archived");
});

module.exports = { listPublic, listAdmin, create, update, remove };

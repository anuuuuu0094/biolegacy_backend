const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const service = require("./result.service");

const listPublic = asyncHandler(async (req, res) => success(res, await service.list(false), "Results fetched"));
const listAdmin = asyncHandler(async (req, res) => success(res, await service.list(true), "Results fetched"));
const create = asyncHandler(async (req, res) => success(res, await service.create(req.body, req.user.sub), "Result created", 201));
const update = asyncHandler(async (req, res) => success(res, await service.update(req.params.id, req.body, req.user.sub), "Result updated"));
const remove = asyncHandler(async (req, res) => {
  await service.remove(req.params.id, req.user.sub);
  success(res, null, "Result archived");
});

module.exports = { listPublic, listAdmin, create, update, remove };

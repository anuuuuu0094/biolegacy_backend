const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const service = require("./enquiry.service");

const create = asyncHandler(async (req, res) => {
  success(res, await service.create(req.body), "Enquiry submitted", 201);
});

const list = asyncHandler(async (req, res) => {
  const result = await service.list(req.query);
  success(res, result.data, "Enquiries fetched", 200, result.meta);
});

const update = asyncHandler(async (req, res) => {
  success(res, await service.update(req.params.id, req.body, req.user.sub), "Enquiry updated");
});

module.exports = { create, list, update };

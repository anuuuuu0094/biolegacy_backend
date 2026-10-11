const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const service = require("./siteSettings.service");

const getPublic = asyncHandler(async (req, res) => {
  success(res, await service.getPublic(), "Website settings fetched");
});

const updatePublic = asyncHandler(async (req, res) => {
  success(res, await service.updatePublic(req.body, req.user.sub), "Website settings updated");
});

module.exports = { getPublic, updatePublic };

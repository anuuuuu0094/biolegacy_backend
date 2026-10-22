const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const service = require("./student.service");

const learning = asyncHandler(async (req, res) => {
  success(res, await service.getLearning(req.user.sub), "Student learning data fetched");
});

const materialAccess = asyncHandler(async (req, res) => {
  success(res, await service.getMaterialAccess(req.user.sub, req.params.id, req.query.download), "Secure PDF access created");
});

module.exports = { learning, materialAccess };

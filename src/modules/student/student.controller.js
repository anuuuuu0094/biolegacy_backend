const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const service = require("./student.service");

const learning = asyncHandler(async (req, res) => {
  success(res, await service.getLearning(req.user.sub), "Student learning data fetched");
});

module.exports = { learning };

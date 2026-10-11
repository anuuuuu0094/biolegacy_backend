const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const service = require("./admin.service");

const dashboard = asyncHandler(async (req, res) => {
  success(res, await service.dashboard(), "Admin dashboard fetched");
});

const listStudents = asyncHandler(async (req, res) => {
  const result = await service.listStudents(req.query);
  success(res, result.data, "Student accounts fetched", 200, result.meta);
});

const updateStudentStatus = asyncHandler(async (req, res) => {
  const result = await service.updateStudentStatus(req.params.id, req.body.status, req.user.sub);
  success(res, result, "Student account status updated");
});

const listEnrollments = asyncHandler(async (req, res) => success(res, await service.listEnrollments(req.params.id), "Enrollments fetched"));
const saveEnrollment = asyncHandler(async (req, res) => success(res, await service.saveEnrollment(req.params.id, req.body, req.user.sub), "Enrollment saved"));
const listModules = asyncHandler(async (req, res) => success(res, await service.listModules(req.params.courseId), "Learning modules fetched"));
const createModule = asyncHandler(async (req, res) => success(res, await service.createModule(req.params.courseId, req.body, req.user.sub), "Learning module created", 201));
const updateModule = asyncHandler(async (req, res) => success(res, await service.updateModule(req.params.id, req.body, req.user.sub), "Learning module updated"));
const archiveModule = asyncHandler(async (req, res) => {
  await service.archiveModule(req.params.id, req.user.sub);
  success(res, null, "Learning module archived");
});

module.exports = { dashboard, listStudents, updateStudentStatus, listEnrollments, saveEnrollment, listModules, createModule, updateModule, archiveModule };

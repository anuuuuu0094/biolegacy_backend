const router = require("express").Router();
const controller = require("./admin.controller");
const { authenticate, authorize } = require("../../middleware/auth");
const validate = require("../../middleware/validate");
const Joi = require("joi");

const updateStudentStatusSchema = Joi.object({
  status: Joi.string().valid("ACTIVE", "PENDING", "SUSPENDED").required(),
});
const idSchema = Joi.object({ id: Joi.string().uuid().required() });
const courseIdSchema = Joi.object({ courseId: Joi.string().uuid().required() });
const enrollmentSchema = Joi.object({
  courseId: Joi.string().uuid().required(),
  status: Joi.string().valid("ACTIVE", "PAUSED", "COMPLETED", "CANCELLED").default("ACTIVE"),
});
const moduleSchema = Joi.object({
  title: Joi.string().trim().min(2).max(220).required(),
  description: Joi.string().trim().max(2000).allow("", null),
  videoUrl: Joi.string().trim().uri({ scheme: ["https"] }).allow("", null),
  sortOrder: Joi.number().integer().min(0).default(0),
  published: Joi.boolean().default(true),
});

router.get("/dashboard", authenticate, authorize("TEACHER_ADMIN"), controller.dashboard);
router.get("/students", authenticate, authorize("TEACHER_ADMIN"), controller.listStudents);
router.patch("/students/:id/status", authenticate, authorize("TEACHER_ADMIN"), validate(updateStudentStatusSchema), controller.updateStudentStatus);
router.get("/students/:id/enrollments", authenticate, authorize("TEACHER_ADMIN"), validate(idSchema, "params"), controller.listEnrollments);
router.post("/students/:id/enrollments", authenticate, authorize("TEACHER_ADMIN"), validate(idSchema, "params"), validate(enrollmentSchema), controller.saveEnrollment);
router.get("/courses/:courseId/modules", authenticate, authorize("TEACHER_ADMIN"), validate(courseIdSchema, "params"), controller.listModules);
router.post("/courses/:courseId/modules", authenticate, authorize("TEACHER_ADMIN"), validate(courseIdSchema, "params"), validate(moduleSchema), controller.createModule);
router.put("/modules/:id", authenticate, authorize("TEACHER_ADMIN"), validate(idSchema, "params"), validate(moduleSchema), controller.updateModule);
router.delete("/modules/:id", authenticate, authorize("TEACHER_ADMIN"), validate(idSchema, "params"), controller.archiveModule);

module.exports = router;

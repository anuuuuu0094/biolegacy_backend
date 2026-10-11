const router = require("express").Router();
const controller = require("./course.controller");
const validate = require("../../middleware/validate");
const { authenticate, authorize } = require("../../middleware/auth");
const { courseSchema, courseSlugParamsSchema } = require("./course.validation");

router.get("/admin/all", authenticate, authorize("TEACHER_ADMIN"), controller.listAdmin);
router.get("/", controller.listPublic);
router.get("/:slug", controller.getPublic);
router.post("/", authenticate, authorize("TEACHER_ADMIN"), validate(courseSchema), controller.create);
router.put("/:slug", authenticate, authorize("TEACHER_ADMIN"), validate(courseSchema), controller.update);
router.delete("/:slug/permanent", authenticate, authorize("TEACHER_ADMIN"), validate(courseSlugParamsSchema, "params"), controller.destroy);
router.delete("/:slug", authenticate, authorize("TEACHER_ADMIN"), validate(courseSlugParamsSchema, "params"), controller.remove);

module.exports = router;

const router = require("express").Router();
const controller = require("./blog.controller");
const validate = require("../../middleware/validate");
const { authenticate, authorize } = require("../../middleware/auth");
const { blogSchema } = require("./blog.validation");

router.get("/admin/all", authenticate, authorize("TEACHER_ADMIN"), controller.listAdmin);
router.get("/", controller.listPublic);
router.get("/:slug", controller.getPublic);
router.post("/", authenticate, authorize("TEACHER_ADMIN"), validate(blogSchema), controller.create);
router.put("/:slug", authenticate, authorize("TEACHER_ADMIN"), validate(blogSchema), controller.update);
router.delete("/:slug", authenticate, authorize("TEACHER_ADMIN"), controller.remove);

module.exports = router;

const router = require("express").Router();
const controller = require("./result.controller");
const validate = require("../../middleware/validate");
const { authenticate, authorize } = require("../../middleware/auth");
const { resultSchema } = require("./result.validation");

router.get("/admin/all", authenticate, authorize("TEACHER_ADMIN"), controller.listAdmin);
router.get("/", controller.listPublic);
router.post("/", authenticate, authorize("TEACHER_ADMIN"), validate(resultSchema), controller.create);
router.put("/:id", authenticate, authorize("TEACHER_ADMIN"), validate(resultSchema), controller.update);
router.delete("/:id", authenticate, authorize("TEACHER_ADMIN"), controller.remove);

module.exports = router;

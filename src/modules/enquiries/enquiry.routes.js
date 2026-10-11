const router = require("express").Router();
const controller = require("./enquiry.controller");
const validate = require("../../middleware/validate");
const { authenticate, authorize } = require("../../middleware/auth");
const { enquirySchema, updateEnquirySchema } = require("./enquiry.validation");

router.post("/", validate(enquirySchema), controller.create);
router.get("/", authenticate, authorize("TEACHER_ADMIN"), controller.list);
router.patch("/:id", authenticate, authorize("TEACHER_ADMIN"), validate(updateEnquirySchema), controller.update);

module.exports = router;

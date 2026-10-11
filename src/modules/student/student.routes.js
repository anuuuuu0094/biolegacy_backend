const router = require("express").Router();
const controller = require("./student.controller");
const { authenticate, authorize } = require("../../middleware/auth");

router.get("/me/learning", authenticate, authorize("STUDENT"), controller.learning);

module.exports = router;

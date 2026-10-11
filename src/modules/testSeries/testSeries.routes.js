const router = require("express").Router();
const controller = require("./testSeries.controller");
const validate = require("../../middleware/validate");
const { authenticate, authorize } = require("../../middleware/auth");
const { testSeriesSchema } = require("./testSeries.validation");
const { optionalAuthenticate } = require("../../middleware/auth");
const studentController = require("../neet/student.controller");
const { slugParams } = require("../neet/student.validation");

router.get("/admin/all", authenticate, authorize("TEACHER_ADMIN"), controller.listAdmin);
router.get("/", studentController.seriesList);
router.get("/:slug", optionalAuthenticate, validate(slugParams, "params"), studentController.seriesDetail);
router.post("/", authenticate, authorize("TEACHER_ADMIN"), validate(testSeriesSchema), controller.create);
router.put("/:slug", authenticate, authorize("TEACHER_ADMIN"), validate(testSeriesSchema), controller.update);
router.delete("/:slug", authenticate, authorize("TEACHER_ADMIN"), controller.remove);

module.exports = router;

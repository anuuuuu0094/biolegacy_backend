const router = require("express").Router();
const controller = require("./student.controller");
const { authenticate, authorize } = require("../../middleware/auth");
const validate = require("../../middleware/validate");
const Joi = require("joi");

const idSchema = Joi.object({ id: Joi.string().uuid().required() });
const materialAccessSchema = Joi.object({
  download: Joi.boolean().truthy("true").falsy("false").default(false),
});

router.get("/me/learning", authenticate, authorize("STUDENT"), controller.learning);
router.get("/materials/:id/access", authenticate, authorize("STUDENT"), validate(idSchema, "params"), validate(materialAccessSchema, "query"), controller.materialAccess);

module.exports = router;

const router = require("express").Router();
const Joi = require("joi");
const controller = require("./siteSettings.controller");
const validate = require("../../middleware/validate");
const { authenticate, authorize } = require("../../middleware/auth");

const linkSchema = Joi.object({ label: Joi.string().trim().max(80).required(), href: Joi.string().trim().max(500).required() });
const settingsSchema = Joi.object({
  primaryPhone: Joi.string().trim().max(40).required(),
  primaryWhatsapp: Joi.string().trim().max(40).required(),
  primaryEmail: Joi.string().trim().email().max(254).required(),
  address: Joi.string().trim().max(300).required(),
  mapEmbedUrl: Joi.string().trim().uri({ scheme: ["https"] }).max(4000).required(),
  mainNavigation: Joi.array().items(linkSchema).max(20).required(),
  quickLinks: Joi.array().items(Joi.object({ title: Joi.string().trim().max(120).required(), desc: Joi.string().trim().max(500).required(), href: Joi.string().trim().max(500).required() })).max(12).required(),
  studentPortalHighlights: Joi.array().items(Joi.string().trim().max(300)).max(20).required(),
});

router.get("/public", controller.getPublic);
router.put("/public", authenticate, authorize("TEACHER_ADMIN"), validate(settingsSchema), controller.updatePublic);

module.exports = router;

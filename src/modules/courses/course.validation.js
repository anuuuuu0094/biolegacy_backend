const Joi = require("joi");

const courseSchema = Joi.object({
  slug: Joi.string().trim().lowercase().min(2).max(160).required(),
  title: Joi.string().trim().min(2).max(220).required(),
  shortTitle: Joi.string().trim().min(2).max(120).required(),
  category: Joi.string().trim().min(2).max(80).required(),
  targetExamYear: Joi.number().integer().min(2024).max(2040).allow(null),
  shortDesc: Joi.string().trim().min(10).required(),
  longDesc: Joi.string().trim().min(10).required(),
  duration: Joi.string().trim().required(),
  totalHours: Joi.string().trim().allow("", null),
  mode: Joi.string().trim().required(),
  center: Joi.string().trim().allow("", null),
  image: Joi.string().trim().allow("", null),
  totalFees: Joi.string().trim().allow("", null),
  registrationFee: Joi.string().trim().allow("", null),
  totalSeats: Joi.number().integer().min(0).default(0),
  availableSeats: Joi.number().integer().min(0).default(0),
  batchStatus: Joi.string().trim().default("draft"),
  enrollmentOpen: Joi.boolean().default(false),
  isPopular: Joi.boolean().default(false),
  isFeatured: Joi.boolean().default(false),
  published: Joi.boolean().default(true),
  content: Joi.object().unknown(true).default({}),
  seo: Joi.object().unknown(true).default({}),
});

const courseSlugParamsSchema = Joi.object({
  slug: Joi.string().trim().lowercase().min(2).max(160).required(),
});

module.exports = { courseSchema, courseSlugParamsSchema };

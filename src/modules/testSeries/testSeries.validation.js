const Joi = require("joi");

const testSeriesSchema = Joi.object({
  courseId: Joi.string().uuid().allow("", null),
  slug: Joi.string().trim().lowercase().min(2).max(160).required(),
  title: Joi.string().trim().min(2).max(220).required(),
  description: Joi.string().trim().min(10).required(),
  audience: Joi.string().trim().allow("", null),
  testsCount: Joi.number().integer().min(0).default(0),
  analytics: Joi.string().trim().allow("", null),
  accessLabel: Joi.string().trim().allow("", null),
  isFeatured: Joi.boolean().default(false),
  published: Joi.boolean().default(true),
  content: Joi.object().unknown(true).default({}),
});

module.exports = { testSeriesSchema };

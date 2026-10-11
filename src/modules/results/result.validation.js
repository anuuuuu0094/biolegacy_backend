const Joi = require("joi");

const resultSchema = Joi.object({
  studentName: Joi.string().trim().min(2).max(120).required(),
  examName: Joi.string().trim().min(2).max(80).required(),
  examYear: Joi.number().integer().min(2000).max(2040).required(),
  achievement: Joi.string().trim().min(2).max(220).required(),
  imageUrl: Joi.string().trim().allow("", null),
  published: Joi.boolean().default(true),
  sortOrder: Joi.number().integer().min(0).default(0),
});

module.exports = { resultSchema };
